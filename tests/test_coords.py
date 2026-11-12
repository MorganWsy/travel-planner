"""坐标转换一致性测试。

注意：往返误差 ≤2m 只说明算法自洽，不代表底图叠加精度，也不代表 POI 实际位置精度。
"""

from __future__ import annotations

import pytest

from app.services.coords import gcj02_to_wgs84, wgs84_to_gcj02
from app.services.geo import haversine_m

CITIES = {
    "北京": (116.397428, 39.90923),
    "上海": (121.473701, 31.230416),
    "成都": (104.066541, 30.572269),
    "广州": (113.264385, 23.129112),
}


@pytest.mark.parametrize("city,point", CITIES.items())
def test_roundtrip_within_two_meters(city: str, point: tuple[float, float]) -> None:
    lon, lat = point
    gcj_lon, gcj_lat = wgs84_to_gcj02(lon, lat)
    back_lon, back_lat = gcj02_to_wgs84(gcj_lon, gcj_lat)
    error = haversine_m(lon, lat, back_lon, back_lat)
    assert error <= 2.0, f"{city} 往返误差 {error:.3f} m"


def test_offset_is_material_in_china() -> None:
    lon, lat = CITIES["北京"]
    gcj_lon, gcj_lat = wgs84_to_gcj02(lon, lat)
    offset = haversine_m(lon, lat, gcj_lon, gcj_lat)
    assert 300 < offset < 800, f"北京偏移 {offset:.1f} m，超出经验区间"


@pytest.mark.parametrize("point", [(-74.006, 40.7128), (139.6917, 35.6895), (151.2093, -33.8688)])
def test_outside_china_is_unchanged(point: tuple[float, float]) -> None:
    lon, lat = point
    assert wgs84_to_gcj02(lon, lat) == (lon, lat)
    assert gcj02_to_wgs84(lon, lat) == (lon, lat)
