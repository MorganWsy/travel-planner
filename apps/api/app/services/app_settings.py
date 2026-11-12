"""运行期实例配置（目前是地图数据源 Key）。

优先级：数据库中的设置 > 环境变量。数据库里的密钥用 SESSION_SECRET 派生的
Fernet 密钥加密后存放，接口只返回掩码，不回传明文。

单实例部署；多副本时需要把刷新动作广播到其他进程（见遗留项）。
"""

from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import utcnow
from ..models import AppSetting

PROVIDER_FIELDS = ("amap_key", "tianditu_key", "tianditu_browser_key")
_ENV_MAP = {
    "amap_key": "amap_key",
    "tianditu_key": "tianditu_key",
    "tianditu_browser_key": "tianditu_browser_key",
}
LABELS = {
    "amap_key": "高德 Web 服务 Key",
    "tianditu_key": "天地图服务器端 Key",
    "tianditu_browser_key": "天地图浏览器端 Key",
}
SETTING_KEY = "providers"


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"tp-settings:{get_settings().session_secret}".encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        # SESSION_SECRET 变了以后旧密文无法解密：视为未配置，提示用户重填。
        return ""


def _row(db: Session) -> AppSetting | None:
    return db.scalar(select(AppSetting).where(AppSetting.key == SETTING_KEY))


def load_stored(db: Session) -> dict[str, str]:
    row = _row(db)
    if not row or not isinstance(row.value, dict):
        return {}
    result: dict[str, str] = {}
    for field in PROVIDER_FIELDS:
        cipher = row.value.get(field)
        if isinstance(cipher, str) and cipher:
            plain = decrypt(cipher)
            if plain:
                result[field] = plain
    return result


def effective(db: Session | None) -> dict[str, str]:
    """合并环境变量与数据库设置。数据库为空则表示“跟随环境变量”。"""
    settings = get_settings()
    base = {field: getattr(settings, _ENV_MAP[field], "") for field in PROVIDER_FIELDS}
    if db is None:
        return base
    base.update(load_stored(db))
    return base


def masked(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 6}{value[-4:]}"


def describe(db: Session) -> dict[str, Any]:
    settings = get_settings()
    stored = load_stored(db)
    out: dict[str, Any] = {}
    for field in PROVIDER_FIELDS:
        env_value = getattr(settings, _ENV_MAP[field], "")
        value = stored.get(field) or env_value
        out[field] = {
            "label": LABELS[field],
            "configured": bool(value),
            "masked": masked(value),
            "source": "settings" if stored.get(field) else ("env" if env_value else None),
        }
    return out


def save(db: Session, *, updates: dict[str, str | None], user_id: str) -> dict[str, str]:
    """只处理传入的字段：None 或空串表示清除该字段（回退到环境变量）。"""
    row = _row(db)
    if row is None:
        row = AppSetting(key=SETTING_KEY, value={})
        db.add(row)
        db.flush()
    current = dict(row.value or {})
    for field, value in updates.items():
        if field not in PROVIDER_FIELDS:
            continue
        if value is None or value == "":
            current.pop(field, None)
        else:
            current[field] = encrypt(value.strip())
    # 整体赋新 dict，确保 SQLAlchemy 识别 JSON 列变更
    row.value = current
    row.updated_at = utcnow()
    row.updated_by = user_id
    db.commit()
    return load_stored(db)


def apply_runtime(db: Session) -> None:
    """把生效的 Key 注入供应商注册表，并清掉能力缓存。"""
    from ..providers import registry

    values = effective(db)
    registry.apply_keys(
        amap_key=values.get("amap_key", ""),
        tianditu_key=values.get("tianditu_key", ""),
        tianditu_browser_key=values.get("tianditu_browser_key", ""),
    )
