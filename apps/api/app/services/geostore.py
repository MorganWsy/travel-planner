"""PostGIS 几何读写边界。

数据库使用真正的 geometry(POINT/LINESTRING, 4326) 列；对外的接口与快照一律使用
GeoJSON（[经度, 纬度]）。转换只在这一层发生，业务代码不直接接触 WKB。
"""

from __future__ import annotations

from typing import Any

from geoalchemy2.elements import WKBElement
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import LineString, Point, mapping

SRID = 4326


def _coords(value: dict[str, Any] | None) -> list[float] | None:
    if not value:
        return None
    raw = value.get("coordinates")
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        return None
    try:
        return [float(raw[0]), float(raw[1])]
    except (TypeError, ValueError):
        return None


def point_wkb(geojson: dict[str, Any] | None) -> WKBElement | None:
    coords = _coords(geojson)
    if not coords:
        return None
    if not (-180 <= coords[0] <= 180 and -90 <= coords[1] <= 90):
        return None
    return from_shape(Point(coords[0], coords[1]), srid=SRID)


def line_wkb(geojson: dict[str, Any] | None) -> WKBElement | None:
    if not geojson or geojson.get("type") != "LineString":
        return None
    points = geojson.get("coordinates") or []
    cleaned: list[tuple[float, float]] = []
    for pair in points:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        try:
            cleaned.append((float(pair[0]), float(pair[1])))
        except (TypeError, ValueError):
            continue
    if len(cleaned) < 2:
        return None
    return from_shape(LineString(cleaned), srid=SRID)


def to_geojson(value: Any) -> dict[str, Any] | None:
    """把数据库几何转回 GeoJSON。已是非空 dict 的原样返回（兼容快照读取）。"""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    try:
        shape = to_shape(value)
    except Exception:
        return None
    data = mapping(shape)
    return {"type": data["type"], "coordinates": _plain(data["coordinates"])}


def _plain(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value
