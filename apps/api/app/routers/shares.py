"""分享链接：只读快照、可选密码、可撤销。

token 只在创建时返回一次，数据库只存哈希；访问密码单独散列。
接收者看到的内容来自创建时钉住的 revision，不受后续编辑影响。
"""

from __future__ import annotations

import hmac
from datetime import timedelta
from hashlib import sha256
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import AuthContext, get_auth, get_owned_trip, require_csrf
from ..errors import AppError
from ..models import Share, Trip
from ..schemas import ShareAccess, ShareCreate, ShareCreated, ShareSummary, ShareUnlock, TripDetail
from ..security import hash_password, new_token, token_hash, verify_password
from ..services import guide as guide_service
from ..services import trip_content

router = APIRouter()
settings = get_settings()


def _share_origin(request: Request) -> str:
    base = settings.public_base_url.rstrip("/")
    return base or f"{request.url.scheme}://{request.url.netloc}"


def _active_share(db: Session, token: str) -> Share:
    share = db.scalar(select(Share).where(Share.token_hash == token_hash(token)))
    if not share:
        raise AppError("NOT_FOUND", "分享链接不存在或已失效。")
    now = utcnow()
    if share.revoked_at is not None:
        raise AppError("NOT_FOUND", "分享链接已撤销。")
    expires = share.expires_at if share.expires_at.tzinfo else share.expires_at.replace(tzinfo=now.tzinfo)
    if expires < now:
        raise AppError("NOT_FOUND", "分享链接已过期。")
    trip = db.get(Trip, share.trip_id)
    if not trip or trip.deleted_at is not None:
        raise AppError("NOT_FOUND", "分享内容不可用。")
    return share


def _access_cookie_name(share: Share) -> str:
    return f"share_{share.id}"


def _access_value(share: Share, token: str) -> str:
    return hmac.new(settings.session_secret.encode(), f"{share.id}:{token}".encode(), sha256).hexdigest()


def _has_access(request: Request, share: Share, token: str) -> bool:
    if not share.password_hash:
        return True
    supplied = request.cookies.get(_access_cookie_name(share)) or ""
    return bool(supplied) and hmac.compare_digest(supplied, _access_value(share, token))


@router.post("/trips/{trip_id}/shares", response_model=ShareCreated, status_code=201)
def create_share(
    trip_id: str,
    payload: ShareCreate,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> ShareCreated:
    trip = get_owned_trip(db, auth.user, trip_id)
    revision = payload.revision or trip.revision
    if revision > trip.revision:
        raise AppError("VALIDATION_ERROR", "指定的版本尚不存在。")
    token = new_token(32)
    share = Share(
        trip_id=trip.id,
        revision=revision,
        token_hash=token_hash(token),
        password_hash=hash_password(payload.password) if payload.password else None,
        expires_at=utcnow() + timedelta(days=payload.expires_in_days),
        allow_clone=payload.allow_clone,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return ShareCreated(
        id=share.id,
        url=f"{_share_origin(request)}/s/{token}",
        token=token,
        expires_at=share.expires_at,
        revision=share.revision,
        has_password=bool(share.password_hash),
    )


@router.get("/trips/{trip_id}/shares", response_model=list[ShareSummary])
def list_shares(
    trip_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[ShareSummary]:
    trip = get_owned_trip(db, auth.user, trip_id)
    rows = db.scalars(select(Share).where(Share.trip_id == trip.id).order_by(Share.created_at.desc()))
    return [
        ShareSummary(
            id=row.id,
            revision=row.revision,
            expires_at=row.expires_at,
            revoked_at=row.revoked_at,
            allow_clone=row.allow_clone,
            has_password=bool(row.password_hash),
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.delete("/trips/{trip_id}/shares/{share_id}")
def revoke_share(
    trip_id: str,
    share_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    share = db.scalar(select(Share).where(Share.id == share_id, Share.trip_id == trip.id))
    if not share:
        raise AppError("NOT_FOUND", "分享不存在。")
    share.revoked_at = utcnow()
    db.commit()
    return {"status": "ok", "share_id": share.id}


# ------------------------------------------------------------------ 公开访问


def _share_payload(db: Session, share: Share) -> ShareAccess:
    _revision, snapshot = guide_service.load_snapshot(db, db.get(Trip, share.trip_id), share.revision)
    guide = guide_service.build_guide(snapshot)
    guide["markdown"] = guide_service.render_markdown(guide)
    guide["snapshot"] = snapshot
    return ShareAccess(
        requires_password=False,
        unlocked=True,
        snapshot=guide,
        allow_clone=share.allow_clone,
        expires_at=share.expires_at,
    )


@router.get("/shares/{token}", response_model=ShareAccess)
def read_share(token: str, request: Request, db: Session = Depends(get_db)) -> ShareAccess:
    share = _active_share(db, token)
    if not _has_access(request, share, token):
        return ShareAccess(requires_password=True, unlocked=False, allow_clone=share.allow_clone)
    return _share_payload(db, share)


@router.post("/shares/{token}/unlock", response_model=ShareAccess)
def unlock_share(
    token: str,
    payload: ShareUnlock,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> ShareAccess:
    from ..deps import client_ip, rate_limit

    share = _active_share(db, token)
    rate_limit(f"share-unlock:{share.id}:{client_ip(request)}", limit=5, window_seconds=900)
    if not share.password_hash:
        return _share_payload(db, share)
    if not verify_password(payload.password, share.password_hash):
        raise AppError("AUTH_REQUIRED", "访问密码不正确。")
    response.set_cookie(
        _access_cookie_name(share),
        _access_value(share, token),
        max_age=1800,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path=f"/api/v1/shares/{quote(token)}",
    )
    return _share_payload(db, share)


@router.post("/shares/{token}/clone", response_model=TripDetail, status_code=201)
def clone_share(
    token: str,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    share = _active_share(db, token)
    if not share.allow_clone:
        raise AppError("FORBIDDEN", "该分享未允许复制。")
    if not _has_access(request, share, token):
        raise AppError("AUTH_REQUIRED", "需要先解锁该分享。")
    _revision, snapshot = guide_service.load_snapshot(db, db.get(Trip, share.trip_id), share.revision)
    trip = trip_content.create_trip_from_snapshot(db, owner_id=auth.user.id, snapshot=snapshot, title_suffix="（来自分享）")
    return trip_content.serialize_trip(db, trip)
