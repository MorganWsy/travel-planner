"""实例设置：地图数据源 Key。

写入需要管理员；读取只返回掩码，明文永不回传浏览器。
保存后立即重建适配器，不需要重启服务。
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, get_auth, require_admin
from ..errors import AppError
from ..providers import registry
from ..schemas import (
    EgressIPOut,
    ProviderSettingsOut,
    ProviderTestOut,
    ProviderTestRequest,
    ProviderUpdateRequest,
)
from ..services import app_settings, egress

router = APIRouter()

_NOTES = [
    "Key 只保存在本实例的数据库里，接口不会回传明文；保存后立即生效。",
    "高德用「Web 服务」类型；天地图底图用「浏览器端」、搜索用「服务器端」，两者不能混用。",
]


@router.get("/settings/providers", response_model=ProviderSettingsOut)
def read_provider_settings(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> ProviderSettingsOut:
    described = app_settings.describe(db)
    return ProviderSettingsOut(
        amap_key=described["amap_key"],
        tianditu_key=described["tianditu_key"],
        tianditu_browser_key=described["tianditu_browser_key"],
        capabilities=registry.provider_view(),
        notes=_NOTES,
    )


@router.get("/settings/egress-ip", response_model=EgressIPOut)
def read_egress_ip(refresh: bool = False, auth: AuthContext = Depends(get_auth)) -> EgressIPOut:
    """给天地图服务器端 Key 的白名单当参考值。

    只读，不写数据，所以不要求 CSRF 头；探测走外网，失败返回空值。
    """
    ip = egress.detect(force=refresh)
    return EgressIPOut(ip=ip, checked=True)


@router.put("/settings/providers", response_model=ProviderSettingsOut)
def update_provider_settings(
    payload: ProviderUpdateRequest,
    auth: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProviderSettingsOut:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise AppError("VALIDATION_ERROR", "没有需要保存的字段。")
    for field, value in updates.items():
        if value is not None and value.strip() and len(value.strip()) < 8:
            raise AppError("VALIDATION_ERROR", f"{app_settings.LABELS[field]} 看起来太短，请检查。")
    app_settings.save(db, updates=updates, user_id=auth.user.id)
    app_settings.apply_runtime(db)
    return read_provider_settings(auth, db)


@router.post("/settings/providers/test", response_model=ProviderTestOut)
def test_provider(
    payload: ProviderTestRequest,
    auth: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProviderTestOut:
    app_settings.apply_runtime(db)
    adapter = registry.adapters().get(payload.provider)
    if adapter is None:
        raise AppError("UNSUPPORTED_CAPABILITY", "未知的数据源。")
    if not adapter.configured:
        return ProviderTestOut(ok=False, message="尚未配置 Key。", latency_ms=0)
    started = time.monotonic()
    try:
        items = adapter.search("西湖", city="330100", page=1, limit=3)
    except AppError as exc:
        return ProviderTestOut(
            ok=False,
            message=exc.message,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    elapsed = int((time.monotonic() - started) * 1000)
    if not items:
        return ProviderTestOut(
            ok=False,
            message="接口可达，但没有返回结果，请检查该 Key 是否开通搜索服务。",
            latency_ms=elapsed,
        )
    return ProviderTestOut(
        ok=True,
        message=f"连接正常，返回 {len(items)} 条测试结果。",
        latency_ms=elapsed,
        sample=items[0].name,
    )
