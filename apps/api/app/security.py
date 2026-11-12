"""口令散列、令牌与会话签名工具。

口令使用标准库 scrypt（N=2^14, r=8, p=1）。方案文档原写 Argon2id，但本机无该依赖且
scrypt 同为内存硬散列并被 stdlib 支持；差异记录在 docs/DELIVERY.md，可平滑替换。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def derive_csrf(session_token: str, secret: str) -> str:
    """由会话令牌派生 CSRF 值。

    这样刷新页面后服务端可重算同一值，无需在库中保存 CSRF 明文；
    攻击者没有 HttpOnly Cookie 就无法构造合法请求头。
    """
    digest = hmac.new(secret.encode("utf-8"), f"csrf:{session_token}".encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")[:43]


_PASSWORD_HINT = "密码至少 8 位，且同时包含大写字母、小写字母和数字。"


def validate_password_strength(password: str) -> None:
    """密码强度：8 位以上且大写、小写、数字各至少一个。

    与前端 PASSWORD_RULE 保持同一条规则；前端只是提前提示，真正的判定在这里。
    """
    from .errors import AppError

    if len(password) < 8:
        raise AppError("VALIDATION_ERROR", _PASSWORD_HINT)
    if not any(ch.isupper() for ch in password):
        raise AppError("VALIDATION_ERROR", _PASSWORD_HINT)
    if not any(ch.islower() for ch in password):
        raise AppError("VALIDATION_ERROR", _PASSWORD_HINT)
    if not any(ch.isdigit() for ch in password):
        raise AppError("VALIDATION_ERROR", _PASSWORD_HINT)


def password_hint() -> str:
    return _PASSWORD_HINT
