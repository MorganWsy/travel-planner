"""FastAPI 依赖：会话认证、CSRF、内容版本与限流。"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlparse

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db, utcnow
from .errors import AppError
from .models import SessionToken, Trip, User
from .security import constant_time_equals, derive_csrf, token_hash

settings = get_settings()

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, list[float]] = {}


def rate_limit(bucket: str, *, limit: int, window_seconds: int) -> None:
    """进程内固定窗口限流。单进程部署足够；多副本需换成 Redis 实现（见遗留项）。"""
    if settings.app_env == "test":
        # 集成测试共用 127.0.0.1，若按真实阈值会互相触发限流；生产配置不受影响。
        return
    now = time.monotonic()
    with _RATE_LOCK:
        stamps = [t for t in _RATE_BUCKETS.get(bucket, []) if now - t < window_seconds]
        if len(stamps) >= limit:
            retry_after = int(window_seconds - (now - stamps[0])) + 1
            raise AppError(
                "RATE_LIMITED",
                "请求过于频繁，请稍后再试。",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        stamps.append(now)
        _RATE_BUCKETS[bucket] = stamps


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def allowed_origins() -> set[str]:
    origins = {
        "http://localhost:5177",
        "http://127.0.0.1:5177",
        "http://localhost:8007",
        "http://127.0.0.1:8007",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    }
    parsed = urlparse(settings.public_base_url)
    if parsed.scheme and parsed.netloc:
        origins.add(f"{parsed.scheme}://{parsed.netloc}")
    return origins


def enforce_origin(request: Request) -> None:
    """状态修改请求校验 Origin，阻断跨站表单提交。缺少 Origin 的 CLI/测试请求放行。"""
    origin = request.headers.get("origin")
    if not origin:
        return
    if origin.rstrip("/") not in allowed_origins():
        raise AppError("CSRF_FAILED", "请求来源不被允许。")


@dataclass
class AuthContext:
    user: User
    session: SessionToken
    csrf_token: str


def _load_session(request: Request, db: Session) -> tuple[SessionToken, str] | None:
    raw = request.cookies.get(settings.cookie_name)
    if not raw:
        return None
    row = db.scalar(select(SessionToken).where(SessionToken.token_hash == token_hash(raw)))
    if not row:
        return None
    now = utcnow()
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=now.tzinfo)
    idle_deadline = (row.last_seen_at if row.last_seen_at.tzinfo else row.last_seen_at.replace(tzinfo=now.tzinfo)) + timedelta(
        days=settings.session_idle_days
    )
    if expires < now or idle_deadline < now:
        db.delete(row)
        db.commit()
        return None
    if (now - (row.last_seen_at if row.last_seen_at.tzinfo else row.last_seen_at.replace(tzinfo=now.tzinfo))).total_seconds() > 60:
        row.last_seen_at = now
        db.commit()
    return row, derive_csrf(raw, settings.session_secret)


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    loaded = _load_session(request, db)
    if not loaded:
        raise AppError("AUTH_REQUIRED", "请先登录。")
    row, csrf = loaded
    user = db.get(User, row.user_id)
    if not user or user.status != "active":
        raise AppError("AUTH_REQUIRED", "会话对应的账号不可用。")
    return AuthContext(user=user, session=row, csrf_token=csrf)


def get_optional_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext | None:
    try:
        return get_auth(request, db)
    except AppError:
        return None


def require_csrf(request: Request, auth: AuthContext = Depends(get_auth)) -> AuthContext:
    enforce_origin(request)
    supplied = request.headers.get("x-csrf-token") or ""
    if not supplied or not constant_time_equals(supplied, auth.csrf_token):
        raise AppError("CSRF_FAILED", "会话校验失败，请刷新页面后重试。")
    return auth


def require_admin(auth: AuthContext = Depends(require_csrf)) -> AuthContext:
    if auth.user.role != "admin":
        raise AppError("FORBIDDEN", "只有管理员可以修改实例级设置。")
    return auth


_IF_MATCH_RE = re.compile(r'^"?(\d+)"?$')


def parse_if_match(request: Request) -> int:
    raw = request.headers.get("if-match")
    if raw is None or not raw.strip():
        raise AppError("REVISION_REQUIRED", "缺少 If-Match 版本号。", details={"header": "If-Match"})
    match = _IF_MATCH_RE.match(raw.strip())
    if not match:
        raise AppError("INVALID_REQUEST", "If-Match 必须是行程版本号。")
    return int(match.group(1))


def get_owned_trip(db: Session, user: User, trip_id: str, *, lock: bool = False) -> Trip:
    stmt = select(Trip).where(Trip.id == trip_id, Trip.owner_id == user.id, Trip.deleted_at.is_(None))
    if lock:
        stmt = stmt.with_for_update()
    trip = db.scalar(stmt)
    if not trip:
        raise AppError("NOT_FOUND", "行程不存在。")
    return trip


def check_revision(trip: Trip, expected: int) -> None:
    if trip.revision != expected:
        raise AppError(
            "REVISION_CONFLICT",
            "行程已更新，请重新加载后合并修改。",
            details={"expected_revision": expected, "current_revision": trip.revision},
        )
