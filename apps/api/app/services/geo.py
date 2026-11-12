"""几何与距离工具（WGS84，[longitude, latitude]）。

本项目不依赖 PostGIS 完成这一层：地点数量在单行程量级，球面距离足够，
且避免在 SQLite 开发环境中引入空间扩展。返回单位统一为米。
"""

from __future__ import annotations

import math
from typing import Any

EARTH_RADIUS_M = 6371008.8


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def point_coords(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    if not geometry or geometry.get("type") != "Point":
        return None
    coords = geometry.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) != 2:
        return None
    try:
        return float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return None


def distance_between(a: dict[str, Any] | None, b: dict[str, Any] | None) -> float | None:
    left = point_coords(a)
    right = point_coords(b)
    if not left or not right:
        return None
    return haversine_m(left[0], left[1], right[0], right[1])


def bbox_of_points(points: list[tuple[float, float]]) -> list[float] | None:
    if not points:
        return None
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return [min(lons), min(lats), max(lons), max(lats)]


def detour_estimate(distance_m: float, *, kmh: float, factor: float) -> int:
    """直线距离估算耗时（秒）。仅用于明确标注为估算的场合。"""
    if distance_m <= 0:
        return 0
    road_m = distance_m * factor
    speed_ms = max(kmh, 0.5) * 1000 / 3600
    return int(round(road_m / speed_ms))
