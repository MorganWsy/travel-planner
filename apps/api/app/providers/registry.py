"""供应商注册表与能力汇总。

没有 Key 时所有查询能力返回 PROVIDER_NOT_CONFIGURED，页面据此展示“未配置”，
而不是伪造空结果。底图单独处理：无浏览器 Key 时前端使用空白底板。
"""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

from ..config import get_settings
from ..errors import AppError
from .amap import AmapAdapter
from .base import Capability, GeoItem, RouteResult
from .policy import public_policy
from .tianditu import TiandituAdapter

settings = get_settings()

# 运行期 Key：环境变量为默认值，设置页保存后覆盖。adapters() 依赖这份状态，变更时清缓存。
_RUNTIME_KEYS: dict[str, str] = {
    "amap_key": settings.amap_key,
    "tianditu_key": settings.tianditu_key,
    "tianditu_browser_key": settings.tianditu_browser_key,
}


def apply_keys(*, amap_key: str, tianditu_key: str, tianditu_browser_key: str) -> None:
    _RUNTIME_KEYS.update(
        amap_key=amap_key, tianditu_key=tianditu_key, tianditu_browser_key=tianditu_browser_key
    )
    adapters.cache_clear()


def runtime_key(field: str) -> str:
    return _RUNTIME_KEYS.get(field, "")


@lru_cache
def adapters() -> dict[str, Any]:
    return {
        "amap": AmapAdapter(
            timeout=settings.provider_timeout_seconds, qps=settings.provider_qps, key=_RUNTIME_KEYS["amap_key"]
        ),
        "tianditu": TiandituAdapter(
            timeout=settings.provider_timeout_seconds, qps=settings.provider_qps, key=_RUNTIME_KEYS["tianditu_key"]
        ),
    }


def capabilities() -> list[Capability]:
    result: list[Capability] = []
    for adapter in adapters().values():
        result.extend(adapter.capabilities())
    return result


def provider_flags() -> dict[str, bool]:
    return {name: adapter.configured for name, adapter in adapters().items()}


# 天地图瓦片子域。DataServer 是 XYZ 风格，l={z} 与 MapLibre 的瓦片级别直接对应；
# 不用 WMTS 的 TILEMATRIX（矩阵编号与 XYZ 级别差一级，容易整体错级），也不用 {s}
# 占位符——MapLibre 不解析它，会把 t{s} 当域名解析，瓦片永远请求失败。
TIANDITU_HOSTS = ("t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7")


def _td_tiles(layer: str, key: str) -> list[str]:
    from urllib.parse import quote

    tk = quote(key, safe="")
    return [
        f"https://{host}.tianditu.gov.cn/DataServer?T={layer}&x={{x}}&y={{y}}&l={{z}}&tk={tk}"
        for host in TIANDITU_HOSTS
    ]


_AMAP_HOSTS = ("01", "02", "03", "04")


def _amap_tiles(kind: str) -> list[str]:
    """高德公开瓦片。矢量与影像是两套域名前缀，注记单独一层（style=8）。"""
    if kind == "vec":
        return [
            f"https://webrd{host}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={{x}}&y={{y}}&z={{z}}"
            for host in _AMAP_HOSTS
        ]
    if kind == "img-note":
        return [f"https://webst{host}.is.autonavi.com/appmaptile?style=8&x={{x}}&y={{y}}&z={{z}}" for host in _AMAP_HOSTS]
    return [f"https://webst{host}.is.autonavi.com/appmaptile?style=6&x={{x}}&y={{y}}&z={{z}}" for host in _AMAP_HOSTS]


def basemaps() -> list[dict[str, Any]]:
    maps: list[dict[str, Any]] = [
        {
            "id": "blank",
            "label": "空白底板",
            "type": "blank",
            "attribution": "无底图（经纬网示意）",
            "note": "只用经纬网摆放点位，不代表真实地理底图。",
        },
        # 高德瓦片不需要 Key，放前面：首次打开就有底图，不会看到一片空白
        {
            "id": "amap-vec",
            "label": "高德矢量",
            "type": "raster",
            "tiles": _amap_tiles("vec"),
            "attribution": "高德",
            "crs": "GCJ02",
            "note": "GCJ-02 基准：点位会换算到同一基准后绘制，保存与导出仍是 WGS84。",
        },
        {
            "id": "amap-img",
            "label": "高德影像",
            "type": "raster",
            "tiles": _amap_tiles("img"),
            "annotations": _amap_tiles("img-note"),
            "attribution": "高德",
            "crs": "GCJ02",
            "note": "GCJ-02 基准；影像上的路网注记可单独关掉。",
        },
    ]
    key = _RUNTIME_KEYS["tianditu_browser_key"]
    if key:
        for layer_id, label, base_layer, anno_layer in (
            ("tianditu-vec", "天地图矢量", "vec_w", "cva_w"),
            ("tianditu-img", "天地图影像", "img_w", "cia_w"),
        ):
            maps.append(
                {
                    "id": layer_id,
                    "label": label,
                    "type": "raster",
                    "tiles": _td_tiles(base_layer, key),
                    "annotations": _td_tiles(anno_layer, key),
                    "attribution": "天地图",
                    "crs": "WGS84",
                    "note": "需在天地图控制台为浏览器端 Key 配置域名白名单（本机填 localhost）。",
                }
            )
    return maps


def _pick(provider: str) -> list[str]:
    if provider == "amap":
        return ["amap"]
    if provider == "tianditu":
        return ["tianditu"]
    if provider == "both":
        return ["amap", "tianditu"]
    configured = [name for name, adapter in adapters().items() if adapter.configured]
    if not configured:
        raise AppError(
            "PROVIDER_NOT_CONFIGURED",
            "尚未配置任何地图数据源 Key，可先在行程中手工新建地点。",
            details={"providers": list(adapters().keys())},
        )
    return [configured[0]]


def suggest(provider: str, q: str, *, city: str | None, limit: int, user_id: str) -> tuple[dict[str, list[dict]], list[str], str | None]:
    """输入提示。

    和 search 的区别：走各家的「输入提示」接口（高德是 inputtips），只按关键字前缀匹配、
    不带分页、不做完整排序，因此明显更快。天气同理——这里只为了把下拉列表填出来，
    真正要坐标和详情时前端会再调一次 search。
    """
    from ..services.tokens import sign_selection

    names = _pick(provider)
    grouped: dict[str, list[dict]] = {}
    warnings: list[str] = []
    actual: str | None = None
    for name in names:
        adapter = adapters()[name]
        if not hasattr(adapter, "suggest") or not adapter.configured:
            continue
        try:
            items = adapter.suggest(q, city=city, limit=limit)
        except AppError as exc:
            warnings.append(f"{name}: {exc.message}")
            continue
        if items:
            grouped[name] = [_geo_payload(item, user_id, sign_selection) for item in items]
            actual = name
    if not grouped and not warnings:
        warnings.append("当前数据源不提供输入提示，可直接点查询。")
    return grouped, warnings, actual


def search(provider: str, q: str, *, city: str | None, page: int, limit: int, user_id: str) -> tuple[dict[str, list[dict]], list[str], str | None]:
    from ..services.tokens import sign_selection

    names = _pick(provider)
    grouped: dict[str, list[dict]] = {}
    warnings: list[str] = []
    failures: list[AppError] = []
    for name in names:
        adapter = adapters()[name]
        try:
            items: list[GeoItem] = adapter.search(q, city=city, page=page, limit=limit)
            grouped[name] = [_geo_payload(item, user_id, sign_selection) for item in items]
        except AppError as exc:
            failures.append(exc)
            if provider != "both":
                raise
            warnings.append(f"{name} 查询失败：{exc.message}")
    if not grouped and failures:
        raise failures[0]
    actual = names[0] if len(names) == 1 else None
    return grouped, warnings, actual


def _geo_payload(item: GeoItem, user_id: str, signer) -> dict[str, Any]:
    token = None
    if item.geometry is not None:
        coords = item.geometry["coordinates"]
        token = signer(
            user_id=user_id,
            provider=item.provider,
            name=item.name,
            coords=coords,
            category=item.category,
            address=item.address,
            crs=item.source_crs,
        )
    return {
        "id": f"{item.provider}:{item.provider_id or abs(hash((item.name, tuple(item.raw_location or []))))}",
        "provider": item.provider,
        "name": item.name,
        "category": item.category,
        "address": item.address,
        "geometry": item.geometry,
        "source_crs": item.source_crs,
        "approximate": item.approximate,
        "attribution": item.attribution,
        "selection_token": token,
        "warnings": [] if item.geometry else ["该结果未返回可用坐标，无法在地图上定位。"],
    }


def route(
    provider: str,
    *,
    origin: tuple[float, float],
    destination: tuple[float, float],
    mode: str,
    departure_at: datetime | None,
    city_code: str | None,
    strategy: int = 0,
) -> RouteResult:
    if mode == "manual":
        raise AppError("UNSUPPORTED_CAPABILITY", "手工交通请使用手工路段接口。")
    if origin is None or destination is None:
        raise AppError("VALIDATION_ERROR", "起点或终点缺少坐标。")
    candidate = provider
    if candidate in ("auto",):
        candidate = "amap" if adapters()["amap"].configured else ""
    if not candidate:
        raise AppError(
            "PROVIDER_NOT_CONFIGURED",
            "未配置高德 Key，无法查询真实路网路线；可改用“手工录入交通”。",
        )
    adapter = adapters().get(candidate)
    if adapter is None:
        raise AppError("UNSUPPORTED_CAPABILITY", "未知的路径供应商。")
    if not adapter.configured:
        raise AppError("PROVIDER_NOT_CONFIGURED", f"{adapter.label}未配置 Key，该能力暂不可用。")
    return adapter.route(
        origin=origin,
        destination=destination,
        mode=mode,
        departure_at=departure_at,
        city_code=city_code,
        strategy=strategy,
    )


def around(
    provider: str,
    *,
    lon: float,
    lat: float,
    radius_m: int,
    keywords: str | None,
    limit: int,
) -> tuple[list[dict[str, Any]], str]:
    """周边 POI 查询，供专题图层采集。返回（条目, 实际供应商）。"""
    candidates = [provider] if provider in ("amap", "tianditu") else ["amap", "tianditu"]
    tried: list[str] = []
    last_error: Exception | None = None
    for candidate in candidates:
        adapter = adapters().get(candidate)
        if adapter is None or not adapter.configured or not hasattr(adapter, "around"):
            continue
        tried.append(candidate)
        try:
            items = adapter.around(lon, lat, radius_m=radius_m, keywords=keywords, limit=limit)
        except Exception as exc:  # noqa: BLE001 - 上游失败不阻塞另一个供应商
            last_error = exc
            continue
        rows = [
            {
                "name": item.name,
                "category": item.category,
                "address": item.address,
                "geometry": item.geometry,
                "provider": item.provider,
                # extra 里是供应商回传的区县/电话/距离等，入库展示用，不在这里丢弃
                "extra": item.extra or {},
            }
            for item in items
            if item.geometry
        ]
        return rows, candidate
    if last_error:
        raise last_error
    raise AppError(
        "PROVIDER_NOT_CONFIGURED",
        f"周边 POI 查询需要地图供应商 Key，已试过：{'、'.join(tried) or '无'}。",
    )


def city_code(lon: float, lat: float) -> str | None:
    """公交规划要 citycode，用户不知道填什么时按坐标自动识别一个；识别不到返回 None。"""
    adapter = adapters()["amap"]
    if not adapter.configured:
        return None
    return adapter.city_code(lon, lat)


def provider_view() -> list[dict[str, Any]]:
    rows = []
    for cap in capabilities():
        row = {
            "provider": cap.provider,
            "capability": cap.capability,
            "configured": cap.configured,
            "verified": cap.verified,
            "status": cap.status,
            "reason": cap.reason,
            "input_crs": cap.input_crs,
            "output_crs": cap.output_crs,
            "supports_departure_time": cap.supports_departure_time,
            "supports_batch": cap.supports_batch,
        }
        if cap.capability in ("search", "geocode", "route_driving", "route_transit"):
            row["policy"] = public_policy(cap.provider, cap.capability, str(settings.provider_policy_path))
        rows.append(row)
    return rows
