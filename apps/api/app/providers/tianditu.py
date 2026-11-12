"""天地图适配器。

本项目主要使用天地图作为瓦片底图；POI 搜索与地理编码按公开文档接入，
但接口版本、参数和返回字段尚未用项目 Key 实测，能力报告保持 verified=false。
天地图坐标按 CGCS2000 记录：不做“改 SRID”式转换，也不宣称与 WGS84 完全同基准。
"""

from __future__ import annotations

from typing import Any

from .base import BaseAdapter, Capability, GeoItem, HttpProvider

BASE = "https://api.tianditu.gov.cn"


class TiandituAdapter(HttpProvider, BaseAdapter):
    name = "tianditu"
    label = "天地图"

    def __init__(self, *, timeout: float, qps: float, key: str) -> None:
        # 天地图的密钥参数名是 tk，不是高德那套 key
        super().__init__(timeout=timeout, qps=qps, key=key, key_param="tk")

    def capabilities(self) -> list[Capability]:
        entries = [
            ("search", "POI 搜索", "CGCS2000", "CGCS2000"),
            ("geocode", "地理编码", "CGCS2000", "CGCS2000"),
            ("reverse_geocode", "逆地理编码", "CGCS2000", "CGCS2000"),
        ]
        caps = [
            Capability(
                provider=self.name,
                capability=capability,
                configured=self.configured,
                verified=False,
                status="unverified" if self.configured else "unconfigured",
                reason=None if self.configured else "未配置 Key，可在设置页填写。",
                input_crs=input_crs,
                output_crs=output_crs,
            )
            for capability, _label, input_crs, output_crs in entries
        ]
        caps.append(
            Capability(
                provider=self.name,
                capability="route_driving",
                configured=False,
                verified=False,
                status="unsupported",
                reason="本版本未接入天地图路径服务，驾车/公交优先使用高德或手工录入。",
            )
        )
        caps.append(
            Capability(
                provider=self.name,
                capability="tiles",
                configured=bool(self.key),
                verified=False,
                status="unconfigured" if not self.key else "unverified",
                reason=None if self.key else "未配置浏览器瓦片 Key，可在设置页填写。",
            )
        )
        return caps

    def capability(self, capability: str) -> Capability:
        for item in self.capabilities():
            if item.capability == capability:
                return item
        return Capability(self.name, capability, self.configured, False, "unsupported", "未实现该能力")

    def _check_business_error(self, payload: dict[str, Any]) -> None:
        status = payload.get("status")
        if isinstance(status, dict):
            code = str(status.get("infocode", "0"))
            if code not in ("1000", "0"):
                from ..errors import AppError

                desc = str(status.get("cndesc") or status.get("infodetail") or "").strip()
                message = f"天地图返回错误 {code}" + (f"：{desc}" if desc else "。")
                raise AppError("PROVIDER_ERROR", message, details={"provider": "tianditu", "infocode": code})
        elif isinstance(status, str) and status not in ("0", "1"):
            from ..errors import AppError

            raise AppError("PROVIDER_ERROR", f"天地图返回业务错误：{status}")

    def _item(self, *, name: str, lon: float, lat: float, address: str | None, category: str | None, pid: str | None) -> GeoItem:
        return GeoItem(
            provider=self.name,
            provider_id=pid,
            name=name,
            category=category,
            address=address,
            geometry={"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            source_crs="CGCS2000",
            approximate=True,
            attribution="天地图",
            raw_location=[lon, lat],
        )

    def search(self, q: str, *, city: str | None, page: int, limit: int) -> list[GeoItem]:
        import json

        post_str = {
            "keyWord": q,
            "level": 12,
            "mapBound": "-180,-90,180,90",
            "queryType": 1,
            "start": (page - 1) * limit,
            "count": min(limit, 30),
        }
        payload = self._get(
            f"{BASE}/v2/search",
            {"postStr": json.dumps(post_str, ensure_ascii=False), "type": "query"},
        )
        items: list[GeoItem] = []
        for poi in payload.get("pois", []) or []:
            lonlat = str(poi.get("lonlat") or "")
            if "," not in lonlat:
                continue
            try:
                lon_s, lat_s = lonlat.split(",", 1)
                lon, lat = float(lon_s), float(lat_s)
            except ValueError:
                continue
            items.append(
                self._item(
                    name=str(poi.get("name") or "未命名地点"),
                    lon=lon,
                    lat=lat,
                    address=str(poi.get("address")) if poi.get("address") else None,
                    category=str(poi.get("poiType")) if poi.get("poiType") else None,
                    pid=str(poi.get("hotPointID")) if poi.get("hotPointID") else None,
                )
            )
        return items

    def geocode(self, address: str, *, city: str | None) -> list[GeoItem]:
        import json

        # 地理编码接口的参数名是 ds（不是搜索接口的 postStr），结果包在 result 里
        payload = self._get(
            f"{BASE}/geocoder",
            {"ds": json.dumps({"keyWord": address, "level": 12}, ensure_ascii=False)},
        )
        result = payload.get("result")
        if isinstance(result, list):
            result = result[0] if result else {}
        if not isinstance(result, dict):
            result = {}
        location = result.get("location") or {}
        try:
            lon = float(location.get("lon"))
            lat = float(location.get("lat"))
        except (TypeError, ValueError):
            return []
        return [
            self._item(
                name=str(result.get("formatted_address") or address),
                lon=lon,
                lat=lat,
                address=str(result.get("formatted_address") or ""),
                category="address",
                pid=None,
            )
        ]

    def reverse_geocode(self, lon: float, lat: float) -> GeoItem | None:
        raise NotImplementedError("天地图逆地理编码尚未实现")
