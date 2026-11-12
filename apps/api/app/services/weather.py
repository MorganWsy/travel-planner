"""每日天气。

数据源 Open-Meteo（https://open-meteo.com），免费、无需 Key、按坐标查询。
取行程里第一个有坐标的地点当参考点——一条行程通常在同一个城市内活动，
逐点查会成倍放大请求量，收益也很小。

行程日期若超出预报窗口（约 16 天），Open-Meteo 会返回空数组，这里如实返回
`available=false`，前端显示「暂无预报」，不编造数据。
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import httpx

_API = "https://api.open-meteo.com/v1/forecast"
_CACHE_TTL = 1800.0
_cache: dict[str, tuple[float, dict[str, Any]]] = {}

# WMO 天气代码 → 中文描述 + 图标键
_WMO = {
    0: ("晴", "sun"),
    1: ("少云", "sun"),
    2: ("多云", "cloud"),
    3: ("阴", "cloud"),
    45: ("雾", "fog"),
    48: ("雾凇", "fog"),
    51: ("小毛雨", "rain"),
    53: ("毛雨", "rain"),
    55: ("强毛雨", "rain"),
    61: ("小雨", "rain"),
    63: ("中雨", "rain"),
    65: ("大雨", "rain"),
    66: ("冻雨", "rain"),
    67: ("强冻雨", "rain"),
    71: ("小雪", "snow"),
    73: ("中雪", "snow"),
    75: ("大雪", "snow"),
    77: ("米雪", "snow"),
    80: ("阵雨", "rain"),
    81: ("强阵雨", "rain"),
    82: ("暴雨", "rain"),
    85: ("阵雪", "snow"),
    86: ("强阵雪", "snow"),
    95: ("雷阵雨", "storm"),
    96: ("雷阵雨伴冰雹", "storm"),
    99: ("强雷暴伴冰雹", "storm"),
}


def describe(code: int | None) -> tuple[str, str]:
    if code is None:
        return ("—", "unknown")
    return _WMO.get(int(code), ("其他", "cloud"))


def fetch_daily(lat: float, lon: float, start: date, end: date) -> dict[str, Any]:
    """按坐标与日期区间取每日预报。失败返回 available=False，不抛给调用方。"""
    key = f"{lat:.3f},{lon:.3f},{start}:{end}"
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < _CACHE_TTL:
        return cached[1]

    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "timezone": "Asia/Shanghai",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    try:
        response = httpx.get(_API, params=params, timeout=6.0)
        payload = response.json() if response.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        payload = {}

    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    if not times:
        # 区分「日期太远」和「服务不可用」：前者是正常情况，不该报成故障
        ahead = (start - date.today()).days
        reason = (
            f"距出行还有 {ahead} 天，超出 16 天预报范围"
            if ahead > 15
            else "天气服务暂时不可用"
        )
        result = {"available": False, "reason": reason, "days": []}
    else:
        codes = daily.get("weather_code") or []
        highs = daily.get("temperature_2m_max") or []
        lows = daily.get("temperature_2m_min") or []
        rains = daily.get("precipitation_probability_max") or []
        days = []
        for index, day in enumerate(times):
            label, icon = describe(codes[index] if index < len(codes) else None)
            days.append(
                {
                    "date": day,
                    "code": codes[index] if index < len(codes) else None,
                    "label": label,
                    "icon": icon,
                    "high": highs[index] if index < len(highs) else None,
                    "low": lows[index] if index < len(lows) else None,
                    "rain": rains[index] if index < len(rains) else None,
                }
            )
        result = {"available": True, "days": days}

    _cache[key] = (time.monotonic(), result)
    return result
