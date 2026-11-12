"""高德 Web 服务适配器。

Key 只从服务端环境变量读取，不进入前端、响应或日志。
所有坐标按 GCJ-02 处理：入参由 WGS84 转换，出参转换回 WGS84 并标记 approximate。
接口路径按公开文档编写，是否已开通仍由能力报告标明 verified=false，需用项目 Key 实测后才可改为已验证。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..errors import AppError
from .base import (
    BaseAdapter,
    Capability,
    GeoItem,
    HttpProvider,
    RouteResult,
    now_utc,
    parse_polyline,
    to_wgs84,
)
from ..services.coords import wgs84_to_gcj02

BASE = "https://restapi.amap.com"

_ENDPOINTS = {
    "search": f"{BASE}/v5/place/text",
    "around": f"{BASE}/v5/place/around",
    "suggest": f"{BASE}/v3/assistant/inputtips",
    "geocode": f"{BASE}/v3/geocode/geo",
    "regeo": f"{BASE}/v3/geocode/regeo",
    "driving": f"{BASE}/v5/direction/driving",
    "walking": f"{BASE}/v5/direction/walking",
    "bicycling": f"{BASE}/v5/direction/bicycling",
    "electrobike": f"{BASE}/v5/direction/electrobike",
    "transit": f"{BASE}/v3/direction/transit/integrated",
    "distance": f"{BASE}/v3/distance",
    "weather": f"{BASE}/v3/weather/weatherInfo",
}

_INFOCode_MAP = {
    "10001": ("PROVIDER_NOT_CONFIGURED", "高德 Key 无效或该服务未开通。"),
    "10003": ("PROVIDER_QUOTA_EXCEEDED", "高德当日调用量已超限。"),
    "10004": ("RATE_LIMITED", "高德访问过于频繁。"),
    "10044": ("PROVIDER_QUOTA_EXCEEDED", "高德该服务日调用量已超限。"),
    "10045": ("PROVIDER_QUOTA_EXCEEDED", "高德该服务并发量已超限。"),
}


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _split_location(value: str | None) -> list[float] | None:
    if not value or "," not in value:
        return None
    left, right = value.split(",", 1)
    lon, lat = _num(left), _num(right)
    if lon is None or lat is None:
        return None
    return [lon, lat]


class AmapAdapter(HttpProvider, BaseAdapter):
    name = "amap"
    label = "高德"

    def __init__(self, *, timeout: float, qps: float, key: str) -> None:
        super().__init__(timeout=timeout, qps=qps, key=key)

    # ------------------------------------------------------------ 能力
    def capabilities(self) -> list[Capability]:
        entries = [
            ("search", "POI 关键字搜索", "GCJ02", "GCJ02", False, False),
            ("suggest", "输入提示", "GCJ02", "GCJ02", False, False),
            ("geocode", "地理编码", "GCJ02", "GCJ02", False, False),
            ("reverse_geocode", "逆地理编码", "GCJ02", "GCJ02", False, False),
            ("route_driving", "驾车路径", "GCJ02", "GCJ02", True, True),
            ("route_walking", "步行路径", "GCJ02", "GCJ02", False, False),
            ("route_bicycling", "骑行路径", "GCJ02", "GCJ02", False, False),
            ("route_electrobike", "电动车路径", "GCJ02", "GCJ02", False, False),
            ("route_transit", "公交路径", "GCJ02", "GCJ02", True, False),
            ("weather", "天气", None, None, False, False),
        ]
        return [
            Capability(
                provider=self.name,
                capability=capability,
                configured=self.configured,
                verified=False,
                status="unverified" if self.configured else "unconfigured",
                reason=None if self.configured else "未配置 Key，可在设置页填写。",
                input_crs=input_crs,
                output_crs=output_crs,
                supports_departure_time=departure,
                supports_batch=batch,
            )
            for capability, _label, input_crs, output_crs, departure, batch in entries
        ]

    def capability(self, capability: str) -> Capability:
        for item in self.capabilities():
            if item.capability == capability:
                return item
        return Capability(self.name, capability, self.configured, False, "unsupported", "未实现该能力")

    def _check_business_error(self, payload: dict[str, Any]) -> None:
        if str(payload.get("status", "1")) == "1":
            return
        infocode = str(payload.get("infocode", ""))
        code, message = _INFOCode_MAP.get(infocode, ("PROVIDER_ERROR", "高德返回业务错误。"))
        raise AppError(code, message, details={"provider": "amap", "infocode": infocode or None})

    # ------------------------------------------------------------ 查询
    def search(self, q: str, *, city: str | None, page: int, limit: int) -> list[GeoItem]:
        params: dict[str, Any] = {
            "keywords": q,
            "page_size": min(limit, 25),
            "page_num": page,
            "show_fields": "business",
        }
        if city:
            params["region"] = city
            params["city_limit"] = "true"
        payload = self._get(_ENDPOINTS["search"], params)
        items: list[GeoItem] = []
        for poi in payload.get("pois", []) or []:
            location = _split_location(poi.get("location"))
            geometry, approximate = to_wgs84(location, source_crs="GCJ02")
            items.append(
                GeoItem(
                    provider=self.name,
                    provider_id=poi.get("id"),
                    name=str(poi.get("name") or "未命名地点"),
                    category=(poi.get("type") or "").split(";")[0] or None,
                    address=str(poi.get("address")) if poi.get("address") else None,
                    geometry=geometry,
                    source_crs="GCJ02",
                    approximate=approximate,
                    attribution="高德地图",
                    raw_location=location,
                    extra={"adname": poi.get("adname"), "cityname": poi.get("cityname")},
                )
            )
        return items

    def around(self, lon: float, lat: float, *, radius_m: int, keywords: str | None, limit: int) -> list[GeoItem]:
        """周边 POI：专题图层打点用。坐标入参 WGS84，出参转回 WGS84。"""
        gcj_lon, gcj_lat = wgs84_to_gcj02(lon, lat)
        params: dict[str, Any] = {
            "location": f"{gcj_lon:.6f},{gcj_lat:.6f}",
            "radius": max(50, min(radius_m, 50000)),
            "page_size": min(limit, 25),
            "sortrule": "distance",
        }
        if keywords:
            params["keywords"] = keywords
        payload = self._get(_ENDPOINTS["around"], params)
        items: list[GeoItem] = []
        for poi in payload.get("pois", []) or []:
            location = _split_location(poi.get("location"))
            geometry, approximate = to_wgs84(location, source_crs="GCJ02")
            if not geometry:
                continue
            items.append(
                GeoItem(
                    provider=self.name,
                    provider_id=poi.get("id"),
                    name=str(poi.get("name") or "未命名地点"),
                    category=(poi.get("type") or "").split(";")[0] or None,
                    address=str(poi.get("address")) if poi.get("address") else None,
                    geometry=geometry,
                    source_crs="GCJ02",
                    approximate=approximate,
                    attribution="高德地图",
                    raw_location=location,
                    extra={
                        "adname": poi.get("adname"),
                        "distance": poi.get("distance"),
                        "tel": poi.get("tel") or (poi.get("biz_ext") or {}).get("tel"),
                    },
                )
            )
        return items

    def suggest(self, q: str, *, city: str | None, limit: int = 10) -> list[GeoItem]:
        params: dict[str, Any] = {"keywords": q, "datatype": "all"}
        if city:
            params["city"] = city
        payload = self._get(_ENDPOINTS["suggest"], params)
        items: list[GeoItem] = []
        for tip in payload.get("tips", []) or []:
            location = _split_location(tip.get("location"))
            if location is None:
                continue
            geometry, approximate = to_wgs84(location, source_crs="GCJ02")
            items.append(
                GeoItem(
                    provider=self.name,
                    provider_id=tip.get("id") or None,
                    name=str(tip.get("name") or "未命名地点"),
                    category=(tip.get("typecode") or None),
                    address=str(tip.get("address")) if tip.get("address") else None,
                    geometry=geometry,
                    source_crs="GCJ02",
                    approximate=approximate,
                    attribution="高德地图",
                    raw_location=location,
                )
            )
        return items[:limit]

    def geocode(self, address: str, *, city: str | None) -> list[GeoItem]:
        params: dict[str, Any] = {"address": address}
        if city:
            params["city"] = city
        payload = self._get(_ENDPOINTS["geocode"], params)
        items: list[GeoItem] = []
        for row in payload.get("geocodes", []) or []:
            location = _split_location(row.get("location"))
            geometry, approximate = to_wgs84(location, source_crs="GCJ02")
            items.append(
                GeoItem(
                    provider=self.name,
                    provider_id=None,
                    name=str(row.get("formatted_address") or address),
                    category="address",
                    address=str(row.get("formatted_address") or ""),
                    geometry=geometry,
                    source_crs="GCJ02",
                    approximate=approximate,
                    attribution="高德地图",
                    raw_location=location,
                )
            )
        return items

    def reverse_geocode(self, lon: float, lat: float) -> GeoItem | None:
        gcj_lon, gcj_lat = wgs84_to_gcj02(lon, lat)
        payload = self._get(
            _ENDPOINTS["regeo"],
            {"location": f"{gcj_lon:.6f},{gcj_lat:.6f}", "extensions": "base"},
        )
        regeocode = payload.get("regeocode") or {}
        formatted = regeocode.get("formatted_address")
        if not formatted:
            return None
        return GeoItem(
            provider=self.name,
            provider_id=None,
            name=str(formatted),
            category="address",
            address=str(formatted),
            geometry={"type": "Point", "coordinates": [lon, lat]},
            source_crs="GCJ02",
            approximate=True,
            attribution="高德地图",
            raw_location=[lon, lat],
        )

    def city_code(self, lon: float, lat: float) -> str | None:
        """公交规划必须给 citycode，用户通常不知道；按坐标从逆地理里取一个。

        取不到就返回 None，调用方应提示用户手工填写，不猜编号。
        """
        gcj_lon, gcj_lat = wgs84_to_gcj02(lon, lat)
        try:
            payload = self._get(
                _ENDPOINTS["regeo"],
                {"location": f"{gcj_lon:.6f},{gcj_lat:.6f}", "extensions": "base"},
            )
        except AppError:
            return None
        code = ((payload.get("regeocode") or {}).get("addressComponent") or {}).get("citycode")
        if isinstance(code, str) and code.strip():
            return code.strip()
        return None

    # ------------------------------------------------------------ 路径
    def route(
        self,
        *,
        origin: tuple[float, float],
        destination: tuple[float, float],
        mode: str,
        departure_at: datetime | None,
        city_code: str | None,
        strategy: int = 0,
    ) -> RouteResult:
        o = wgs84_to_gcj02(*origin)
        d = wgs84_to_gcj02(*destination)
        origin_str = f"{o[0]:.6f},{o[1]:.6f}"
        dest_str = f"{d[0]:.6f},{d[1]:.6f}"

        if mode == "driving":
            payload = self._get(
                _ENDPOINTS["driving"],
                {
                    "origin": origin_str,
                    "destination": dest_str,
                    "strategy": 32,
                    "show_fields": "cost,polyline",
                },
            )
            path = ((payload.get("route") or {}).get("paths") or [{}])[0]
            duration = int(_num((path.get("cost") or {}).get("duration")) or 0)
            distance = int(_num(path.get("distance")) or 0)
            geometry = self._steps_geometry(path.get("steps") or [])
            return RouteResult(
                provider=self.name,
                mode=mode,
                distance_m=distance,
                duration_seconds=duration,
                geometry=geometry,
                steps=[{"instruction": step.get("instruction"), "distance_m": _num(step.get("distance"))} for step in (path.get("steps") or [])][:60],
            )

        if mode == "walking":
            payload = self._get(
                _ENDPOINTS["walking"],
                {"origin": origin_str, "destination": dest_str, "show_fields": "polyline"},
            )
            path = ((payload.get("route") or {}).get("paths") or [{}])[0]
            distance = int(_num(path.get("distance")) or 0)
            duration = int(_num(path.get("cost", {}).get("duration") if isinstance(path.get("cost"), dict) else path.get("duration")) or 0)
            if duration == 0 and distance:
                duration = int(distance / (4.5 * 1000 / 3600))
            geometry = self._steps_geometry(path.get("steps") or [])
            return RouteResult(
                provider=self.name,
                mode=mode,
                distance_m=distance,
                duration_seconds=duration,
                geometry=geometry,
                steps=[{"instruction": step.get("instruction")} for step in (path.get("steps") or [])][:60],
            )

        if mode in ("bicycling", "electrobike"):
            # 路径规划 2.0 的骑行/电动车接口同 walking：show_fields=cost,polyline
            payload = self._get(
                _ENDPOINTS[mode],
                {"origin": origin_str, "destination": dest_str, "show_fields": "cost,polyline"},
            )
            path = ((payload.get("route") or {}).get("paths") or [{}])[0]
            distance = int(_num(path.get("distance")) or 0)
            cost = path.get("cost") if isinstance(path.get("cost"), dict) else {}
            # 骑行/电动车把 duration 放在基础字段里，不是驾车/步行的 cost.duration
            duration = int(_num(path.get("duration")) or _num(cost.get("duration")) or 0)
            geometry = self._steps_geometry(path.get("steps") or [])
            # 上游没给耗时就如实标记 partial，不用距离除以固定速度推算
            warnings = [] if duration > 0 else ["高德未返回该方式的耗时，请手工录入；不用距离折算。"]
            return RouteResult(
                provider=self.name,
                mode=mode,
                distance_m=distance,
                duration_seconds=duration,
                geometry=geometry,
                status="ready" if duration > 0 else "partial",
                warnings=warnings,
                steps=[{"instruction": step.get("instruction"), "distance_m": _num(step.get("distance"))} for step in (path.get("steps") or [])][:60],
            )

        if mode == "transit":
            if not city_code:
                raise AppError("INVALID_REQUEST", "公交查询需要提供城市代码。")
            params: dict[str, Any] = {
                "origin": origin_str,
                "destination": dest_str,
                "city": city_code,
                "cityd": city_code,
                "strategy": strategy or 0,
                "nightflag": 0,
            }
            if departure_at is not None:
                params["date"] = departure_at.strftime("%Y-%m-%d")
                params["time"] = departure_at.strftime("%H:%M")
            payload = self._get(_ENDPOINTS["transit"], params)
            transits = ((payload.get("route") or {}).get("transits") or [])
            if not transits:
                raise AppError("PROVIDER_ERROR", "高德未返回公交方案。")
            best = transits[0]
            steps: list[dict[str, Any]] = []
            seg_polylines: list[str] = []
            for segment in best.get("segments", []) or []:
                # 每段内部顺序必须是：步行（到上车站）→ 乘车；先前把乘车排在步行前，
                # 线路会在“车上段”和“步行段”之间来回跳，整条路网看起来是乱的。
                walking = segment.get("walking") or {}
                for step in walking.get("steps", []) or []:
                    if step.get("polyline"):
                        seg_polylines.append(step["polyline"])
                if walking.get("distance"):
                    steps.append({"type": "walk", "distance_m": _num(walking.get("distance"))})
                bus = segment.get("bus") or {}
                # buslines 里可能列多条备选，只取第一条（方案选定的那条），全拼进去会画出并行的备选线
                for line in (bus.get("buslines") or [])[:1]:
                    steps.append(
                        {
                            "type": "bus",
                            "line_type": line.get("type"),
                            "name": line.get("name"),
                            "departure_stop": (line.get("departure_stop") or {}).get("name"),
                            "arrival_stop": (line.get("arrival_stop") or {}).get("name"),
                            "duration_seconds": _num(line.get("duration")),
                        }
                    )
                    if line.get("polyline"):
                        seg_polylines.append(line["polyline"])
                # 火车/高铁段走 railway，polyline 在段上，漏掉会让两站之间拉直线
                railway = segment.get("railway") or {}
                if railway.get("polyline"):
                    seg_polylines.append(railway["polyline"])
                    steps.append(
                        {
                            "type": "railway",
                            "name": railway.get("name") or railway.get("trip"),
                            "duration_seconds": _num(railway.get("time")),
                        }
                    )
            # 高德 v3 公交方案整体的 polyline 常为空，线路坐标在各分段里：
            # bus.buslines[].polyline 与 walking.steps[].polyline，按顺序拼起来才是实际路线
            geometry = None
            if seg_polylines:
                geometry = parse_polyline(";".join(seg_polylines), source_crs="GCJ02")
            elif best.get("polyline"):
                geometry = parse_polyline(best.get("polyline", ""), source_crs="GCJ02")
            return RouteResult(
                provider=self.name,
                mode=mode,
                distance_m=int(_num(best.get("distance")) or 0),
                duration_seconds=int(_num(best.get("duration")) or 0),
                geometry=geometry,
                steps=steps[:60],
                warnings=["公交方案来自高德实时查询，发车时刻与换乘可能随查询时间变化。"],
            )

        raise AppError("UNSUPPORTED_CAPABILITY", "高德适配器不支持该出行方式。")

    def _steps_geometry(self, steps: list[dict[str, Any]]) -> dict[str, Any] | None:
        coords: list[list[float]] = []
        for step in steps:
            polyline = step.get("polyline")
            if not polyline:
                continue
            line = parse_polyline(polyline, source_crs="GCJ02")
            if not line:
                continue
            coords.extend(line["coordinates"])
        if len(coords) < 2:
            return None
        return {"type": "LineString", "coordinates": coords}

    def distance_matrix(self, *, origins: list[tuple[float, float]], destination: tuple[float, float], mode: str) -> list[int | None]:
        """一对多距离查询（/v3/distance）。返回每个起点的耗时秒数，缺项为 None。"""
        if not origins:
            return []
        gcj_origins = [wgs84_to_gcj02(*point) for point in origins]
        gcj_destination = wgs84_to_gcj02(*destination)
        type_code = "3" if mode == "walking" else "1"
        results: list[int | None] = []
        chunk_size = 50
        for start in range(0, len(gcj_origins), chunk_size):
            chunk = gcj_origins[start : start + chunk_size]
            payload = self._get(
                _ENDPOINTS["distance"],
                {
                    "origins": "|".join(f"{lon:.6f},{lat:.6f}" for lon, lat in chunk),
                    "destination": f"{gcj_destination[0]:.6f},{gcj_destination[1]:.6f}",
                    "type": type_code,
                },
            )
            rows = {str(row.get("origin_id")): row for row in payload.get("results", []) or []}
            for offset in range(len(chunk)):
                row = rows.get(str(offset + 1))
                duration = _num(row.get("duration")) if row else None
                results.append(int(duration) if duration is not None else None)
        return results

    def weather(self, city_code: str) -> dict[str, Any]:
        payload = self._get(_ENDPOINTS["weather"], {"city": city_code, "extensions": "all"})
        forecasts = payload.get("forecasts") or []
        if not forecasts:
            raise AppError("PROVIDER_ERROR", "高德未返回天气数据。")
        forecast = forecasts[0]
        return {
            "provider": self.name,
            "city": forecast.get("city"),
            "retrieved_at": now_utc(),
            "casts": (forecast.get("casts") or [])[:4],
            "attribution": "高德地图",
        }
