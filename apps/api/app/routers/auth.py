"""账号与会话接口。

会话使用服务端不透明令牌 + HttpOnly Cookie；CSRF 值由令牌与密钥派生，
刷新页面后可重算，因此不需要在浏览器 localStorage 保存登录凭证。
"""

from __future__ import annotations

import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import AuthContext, client_ip, enforce_origin, get_auth, rate_limit, require_csrf
from ..errors import AppError
from ..models import CaptchaChallenge, EmailCode, SessionToken, User
from ..schemas import (
    CaptchaOut,
    EmailSendOut,
    EmailSendRequest,
    LoginRequest,
    PasswordChange,
    RegisterRequest,
    SessionOut,
    SessionRow,
    UserOut,
)
from ..security import (
    derive_csrf,
    hash_password,
    new_token,
    token_hash,
    validate_password_strength,
    verify_password,
)
from ..services import avatars, mailer

router = APIRouter()
settings = get_settings()


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        phone=user.phone,
        avatar=user.avatar,
        role=user.role,
        created_at=user.created_at,
    )


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _code_hash(code: str) -> str:
    return token_hash(f"email-code:{code.strip()}")


def _consume_captcha(db: Session, challenge_id: str, percent: int) -> None:
    """校验滑块挑战：存在、未用过、未过期、拖动百分比达标，然后标记已用。"""
    row = db.get(CaptchaChallenge, challenge_id)
    if row is None or row.used:
        raise AppError("VALIDATION_ERROR", "滑块验证已失效，请重新拖动。")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=utcnow().tzinfo)
    if expires < utcnow():
        raise AppError("VALIDATION_ERROR", "滑块验证已过期，请重新拖动。")
    if percent < settings.captcha_threshold:
        raise AppError("VALIDATION_ERROR", "请把滑块拖到最右侧再继续。")
    row.used = True
    db.commit()


def _consume_email_code(db: Session, email: str, code: str) -> None:
    """取该邮箱最新一条未用且未过期的验证码做比对，成功后标记已用。"""
    row = db.scalar(
        select(EmailCode)
        .where(EmailCode.email == email, EmailCode.used.is_(False))
        .order_by(EmailCode.id.desc())
        .limit(1)
    )
    if row is None:
        raise AppError("VALIDATION_ERROR", "验证码错误或已过期，请重新获取。")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=utcnow().tzinfo)
    if expires < utcnow() or row.code_hash != _code_hash(code):
        raise AppError("VALIDATION_ERROR", "验证码错误或已过期，请重新获取。")
    row.used = True
    db.commit()


@router.post("/auth/captcha", response_model=CaptchaOut)
def create_captcha(request: Request, db: Session = Depends(get_db)) -> CaptchaOut:
    """生成滑块挑战 id。拖动百分比由后端校验，答案不下发。"""
    rate_limit(f"captcha:{client_ip(request)}", limit=120, window_seconds=3600)
    challenge_id = secrets.token_urlsafe(16)
    db.add(
        CaptchaChallenge(
            id=challenge_id,
            expires_at=utcnow() + timedelta(seconds=settings.captcha_ttl_seconds),
        )
    )
    db.commit()
    return CaptchaOut(challenge_id=challenge_id, threshold=settings.captcha_threshold)


@router.post("/auth/email/send", response_model=EmailSendOut)
def send_email_code(payload: EmailSendRequest, request: Request, db: Session = Depends(get_db)) -> EmailSendOut:
    """校验滑块 → 生成 6 位码 → 发邮件。60 秒内同一邮箱只允许一次。"""
    enforce_origin(request)
    rate_limit(f"email-code:{client_ip(request)}", limit=20, window_seconds=3600)
    _consume_captcha(db, payload.challenge_id, payload.slider_percent)

    taken = db.scalar(select(User).where(User.email == payload.email)) is not None
    if payload.scene == "register" and taken:
        raise AppError("RESOURCE_IN_USE", "该邮箱已注册，可直接登录。")
    if payload.scene == "login" and not taken:
        raise AppError("NOT_FOUND", "该邮箱尚未注册。")

    last = db.scalar(
        select(EmailCode).where(EmailCode.email == payload.email).order_by(EmailCode.id.desc()).limit(1)
    )
    if last is not None:
        sent = last.sent_at if last.sent_at.tzinfo else last.sent_at.replace(tzinfo=utcnow().tzinfo)
        elapsed = (utcnow() - sent).total_seconds()
        if elapsed < settings.email_code_resend_seconds:
            wait = int(settings.email_code_resend_seconds - elapsed)
            raise AppError("RATE_LIMITED", f"请 {wait} 秒后再发送。")

    code = f"{secrets.randbelow(1000000):06d}"
    db.add(
        EmailCode(
            email=payload.email,
            code_hash=_code_hash(code),
            expires_at=utcnow() + timedelta(seconds=settings.email_code_ttl_seconds),
        )
    )
    db.commit()

    sent = mailer.send_code(payload.email, code, payload.scene)
    return EmailSendOut(
        ok=True,
        dev=not sent,
        message="验证码已发送至邮箱。" if sent else "开发模式未配置 SMTP，验证码已写入服务端日志。",
    )


@router.post("/auth/register", status_code=202)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    enforce_origin(request)
    rate_limit(f"register:{client_ip(request)}", limit=5, window_seconds=3600)
    if payload.password != payload.password_confirm:
        raise AppError("VALIDATION_ERROR", "两次输入的密码不一致。")
    validate_password_strength(payload.password)
    if settings.registration_mode == "invite":
        if not payload.invite_code or payload.invite_code not in settings.invite_code_set():
            raise AppError("FORBIDDEN", "邀请码无效。")
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        # 不暴露邮箱是否已注册。
        return {"status": "accepted", "message": "如果邮箱可用，注册已受理。"}
    # 验证码是注册的唯一凭证：先校验，通过后再落库
    _consume_email_code(db, payload.email, payload.code)
    # 单实例部署：第一个注册者是管理员，可配置数据源 Key；其余为普通成员。
    is_first = (db.scalar(select(func.count(User.id))) or 0) == 0
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        phone=(payload.phone or "").strip() or None,
        avatar=avatars.random_avatar(),
        role="admin" if is_first else "member",
        verified_at=utcnow(),
    )
    db.add(user)
    db.commit()
    return {"status": "accepted", "message": "注册成功，可直接登录。"}


@router.post("/auth/login", response_model=SessionOut)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    enforce_origin(request)
    rate_limit(f"login:{client_ip(request)}:{payload.email}", limit=10, window_seconds=900)
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        # 密码登录允许用昵称当账号：昵称不唯一，取最早注册的那个
        user = db.scalar(
            select(User).where(User.display_name == payload.email.strip()).order_by(User.created_at).limit(1)
        )
    if payload.code:
        # 邮箱验证码登录：码本身就是凭证，不比对密码
        _consume_email_code(db, payload.email, payload.code)
    else:
        # 密码登录也要过安全验证：只在前端拦按钮是拦不住脚本的
        if not payload.challenge_id:
            raise AppError("VALIDATION_ERROR", "请先完成安全验证。")
        _consume_captcha(db, payload.challenge_id, payload.slider_percent or 0)
        if not payload.password or not user or not verify_password(payload.password, user.password_hash):
            raise AppError("AUTH_REQUIRED", "邮箱或密码不正确。")
    if not user:
        raise AppError("AUTH_REQUIRED", "该邮箱尚未注册。")
    if user.status != "active":
        raise AppError("AUTH_REQUIRED", "账号不可用。")
    token = new_token(32)
    row = SessionToken(
        user_id=user.id,
        token_hash=token_hash(token),
        expires_at=utcnow() + timedelta(days=settings.session_ttl_days),
        last_seen_at=utcnow(),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(row)
    db.commit()
    _set_cookie(response, token)
    return SessionOut(user=_user_out(user), csrf_token=derive_csrf(token, settings.session_secret))


@router.get("/auth/session", response_model=SessionOut)
def read_session(auth: AuthContext = Depends(get_auth)) -> SessionOut:
    return SessionOut(user=_user_out(auth.user), csrf_token=auth.csrf_token)


@router.post("/auth/logout")
def logout(
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    db.delete(auth.session)
    db.commit()
    response.delete_cookie(settings.cookie_name, path="/")
    return {"status": "ok"}


@router.patch("/auth/password")
def change_password(
    payload: PasswordChange,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, auth.user.password_hash):
        raise AppError("AUTH_REQUIRED", "当前密码不正确。")
    if payload.current_password == payload.new_password:
        raise AppError("VALIDATION_ERROR", "新密码不能与当前密码相同。")
    auth.user.password_hash = hash_password(payload.new_password)
    for row in db.scalars(select(SessionToken).where(SessionToken.user_id == auth.user.id)):
        if row.id != auth.session.id:
            db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/auth/sessions", response_model=list[SessionRow])
def list_sessions(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[SessionRow]:
    rows = db.scalars(
        select(SessionToken).where(SessionToken.user_id == auth.user.id).order_by(SessionToken.last_seen_at.desc())
    )
    return [
        SessionRow(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            current=row.id == auth.session.id,
        )
        for row in rows
    ]


@router.delete("/auth/sessions/{session_id}")
def revoke_session(
    session_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(SessionToken, session_id)
    if not row or row.user_id != auth.user.id:
        raise AppError("NOT_FOUND", "会话不存在。")
    if row.id == auth.session.id:
        raise AppError("INVALID_REQUEST", "请在退出登录中结束当前会话。")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.patch("/users/me", response_model=UserOut)
def update_me(
    payload: dict,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> UserOut:
    user = auth.user
    if "display_name" in payload:
        name = str(payload.get("display_name", "")).strip()
        if not 1 <= len(name) <= 40:
            raise AppError("VALIDATION_ERROR", "昵称长度需在 1–40 字之间。")
        user.display_name = name
    if "email" in payload:
        email = str(payload.get("email", "")).strip().lower()
        if "@" not in email or len(email) > 320:
            raise AppError("VALIDATION_ERROR", "邮箱格式不正确。")
        taken = db.scalar(select(User).where(User.email == email, User.id != user.id))
        if taken:
            raise AppError("RESOURCE_IN_USE", "该邮箱已被其他账号使用。")
        user.email = email
    if "avatar" in payload:
        avatar = str(payload.get("avatar") or "").strip()
        # 只接受预设库的 png 文件名：路径穿越和外部 URL 一律拒掉
        if avatar and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,70}\.png", avatar):
            raise AppError("VALIDATION_ERROR", "头像必须是预设库里的文件名。")
        user.avatar = avatar or None
    db.commit()
    return _user_out(user)
