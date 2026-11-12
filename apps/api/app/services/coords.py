"""坐标系转换。

只提供一条受控路径：高德 GCJ-02 → 标准 WGS84（近似），以及反向的 WGS84 → GCJ-02。
算法为中国区通用的公开偏移模型，逆变换用迭代逼近；结果始终标注 approximate，不赋予测绘精度。
禁止对同一坐标重复应用偏移，因此所有调用点都必须显式声明源坐标系。
"""

from __future__ import annotations

import math
from typing import Any

_A = 6378245.0
_EE = 0.00669342162296594323


def out_of_china(lon: float, lat: float) -> bool:
    """粗略判断是否在中国区外。只用于决定是否施加偏移，不作为边界判定依据。"""
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lon(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lon: float, lat: float) -> tuple[float, float]:
    if out_of_china(lon, lat):
        return lon, lat
    dlat = _transform_lat(lon - 105.0, lat - 35.0)
    dlon = _transform_lon(lon - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - _EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * math.pi)
    dlon = (dlon * 180.0) / (_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lon + dlon, lat + dlat


def gcj02_to_wgs84(lon: float, lat: float, *, iterations: int = 6) -> tuple[float, float]:
    """迭代反解。收敛量级为米，结果标注 approximate。"""
    if out_of_china(lon, lat):
        return lon, lat
    target_lon, target_lat = lon, lat
    guess_lon, guess_lat = lon, lat
    for _ in range(iterations):
        conv_lon, conv_lat = wgs84_to_gcj02(guess_lon, guess_lat)
        guess_lon += target_lon - conv_lon
        guess_lat += target_lat - conv_lat
    return guess_lon, guess_lat


def transform_geometry(geometry: dict[str, Any] | None, *, source_crs: str, target_crs: str = "WGS84") -> dict[str, Any] | None:
    """点几何转换。非 Point 或未知坐标系返回 None，由调用方决定是否拒绝。"""
    if not geometry or geometry.get("type") != "Point":
        return None
    coords = geometry.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) != 2:
        return None
    lon, lat = float(coords[0]), float(coords[1])
    src = source_crs.upper().replace("-", "")
    dst = target_crs.upper().replace("-", "")
    if src == dst:
        return {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}
    if src == "GCJ02" and dst == "WGS84":
        lon, lat = gcj02_to_wgs84(lon, lat)
    elif src == "WGS84" and dst == "GCJ02":
        lon, lat = wgs84_to_gcj02(lon, lat)
    else:
        return None
    return {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}
