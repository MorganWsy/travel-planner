"""短期选择凭证。

用途：把服务端查到的地点结果安全地交给浏览器，再在“保存为地点”时取回，
避免客户端上传任意伪造的上游字段。凭证只绑定服务端已核实的字段与查询用户。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from ..config import get_settings
from ..errors import AppError

_TTL_SECONDS = 600


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(body: str) -> str:
    secret = get_settings().session_secret.encode("utf-8")
    return _b64encode(hmac.new(secret, body.encode("ascii"), hashlib.sha256).digest())


def sign_selection(*, user_id: str, provider: str, name: str, coords: list[float] | None, category: str | None, address: str | None, crs: str) -> str:
    payload = {
        "v": 1,
        "u": user_id,
        "p": provider,
        "n": name,
        "c": coords,
        "cat": category,
        "addr": address,
        "crs": crs,
        "exp": int(time.time()) + _TTL_SECONDS,
    }
    body = _b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return f"{body}.{_sign(body)}"


def verify_selection(token: str, *, user_id: str) -> dict[str, Any]:
    try:
        body, signature = token.split(".", 1)
    except ValueError as exc:
        raise AppError("INVALID_REQUEST", "选择凭证格式无效。") from exc
    if not hmac.compare_digest(_sign(body), signature):
        raise AppError("INVALID_REQUEST", "选择凭证校验失败。")
    try:
        payload = json.loads(_b64decode(body))
    except (json.JSONDecodeError, ValueError) as exc:
        raise AppError("INVALID_REQUEST", "选择凭证内容损坏。") from exc
    if payload.get("u") != user_id:
        raise AppError("INVALID_REQUEST", "选择凭证与当前账号不匹配。")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise AppError("INVALID_REQUEST", "选择凭证已过期，请重新搜索。")
    return payload
