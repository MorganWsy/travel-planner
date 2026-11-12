"""供应商适配器公共层。

边界规则：
- 上游字段只出现在适配器内部，业务层只消费统一结果。
- 未配置 Key 返回 PROVIDER_NOT_CONFIGURED，不伪造空结果。
- 每次响应都带 provider、source_crs、retrieved_at，坐标转换只在这里发生。
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from ..errors import AppError
from ..services.coords import transform_geometry


@dataclass
class Capability:
    provider: str
    capability: str
    configured: bool
    verified: bool
    status: str
    reason: str | None = None
    input_crs: str | None = None
    output_crs: str | None = None
    supports_departure_time: bool = False
    supports_batch: bool = False


@dataclass
class GeoItem:
    provider: str
    provider_id: str | None
    name: str
    category: str | None
    address: str | None
    geometry: dict[str, Any] | None
    source_crs: str
    approximate: bool
    attribution: str
    raw_location: list[float] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class RouteResult:
    provider: str
    mode: str
    distance_m: int
    duration_seconds: int
    geometry: dict[str, Any] | None
    steps: list[dict[str, Any]] = field(default_factory=list)
    status: str = "ready"
    warnings: list[str] = field(default_factory=list)


class RateGate:
    """最小调用间隔，保护上游配额。多进程部署时需换成共享限流。"""

    def __init__(self, qps: float) -> None:
        self.min_interval = 1.0 / max(qps, 0.1)
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            delta = time.monotonic() - self._last
            if delta < self.min_interval:
                time.sleep(self.min_interval - delta)
            self._last = time.monotonic()


class HttpProvider:
    name = "base"
    label = "基础适配器"

    def __init__(self, *, timeout: float, qps: float, key: str, key_param: str = "key") -> None:
        self.key = key
        # 各家的密钥参数名不一样：高德是 key，天地图是 tk。写死 key 会让天地图全部请求缺参。
        self.key_param = key_param
        self.timeout = timeout
        self.gate = RateGate(qps)

    @property
    def configured(self) -> bool:
        return bool(self.key)

    def capability(self, capability: str, **kwargs) -> Capability:
        raise NotImplementedError

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.configured:
            raise AppError("PROVIDER_NOT_CONFIGURED", f"{self.label}未配置 Key，该能力暂不可用。")
        self.gate.wait()
        params = {**params, self.key_param: self.key}
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                with httpx.Client(timeout=httpx.Timeout(self.timeout, connect=3.0)) as client:
                    response = client.get(url, params=params)
                if response.status_code >= 500:
                    last_error = AppError("PROVIDER_ERROR", f"{self.label}上游返回 {response.status_code}。")
                else:
                    response.raise_for_status()
                    # 上游出错时常回一段 HTML 或空体，json() 会抛 JSONDecodeError（ValueError 子类）；
                    # 这里必须自己兜住，否则会冒泡成 500，前端只能看到「服务器错误」。
                    payload = response.json()
                    if not isinstance(payload, dict):
                        raise AppError("PROVIDER_ERROR", f"{self.label}返回了无法解析的结果。")
                    self._check_business_error(payload)
                    return payload
            except httpx.TimeoutException as exc:
                last_error = AppError("PROVIDER_TIMEOUT", f"{self.label}请求超时。")
                last_error.__cause__ = exc
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # 上游 4xx 的响应体里常带具体原因（如天地图 301012「Key 权限类型错误」），
                # 直接透出来比只说 HTTP 403 有用得多
                detail = ""
                upstream_code = ""
                try:
                    body = exc.response.json()
                    if isinstance(body, dict):
                        message = body.get("msg") or body.get("resolve") or body.get("message")
                        if message:
                            detail = f"：{message}"
                        upstream_code = str(body.get("code") or "")
                except ValueError:
                    detail = ""
                if upstream_code == "301008" or "IP" in detail:
                    # 直接告诉用户该填哪个 IP，省得他去猜服务器的出口地址
                    from ..services import egress

                    current = egress.detect()
                    where = f"本机当前出口 IP 是 {current}，" if current else ""
                    hint = f"天地图判定请求来源 IP 不在该 Key 的白名单内。{where}请把它加入服务器端 Key 的 IP 白名单。"
                elif upstream_code == "301012" or "权限类型" in detail:
                    hint = "这个 Key 不是服务器端类型，搜索需要换成「服务器端」Key。"
                else:
                    hint = "请检查 Key 是否有效、是否开通该服务。" if status in (401, 403) else ""
                last_error = AppError("PROVIDER_ERROR", f"{self.label}返回 HTTP {status}{detail}。{hint}")
                last_error.__cause__ = exc
            except httpx.HTTPError as exc:
                last_error = AppError("PROVIDER_ERROR", f"{self.label}请求失败：{type(exc).__name__}。")
                last_error.__cause__ = exc
            except ValueError as exc:
                last_error = AppError("PROVIDER_ERROR", f"{self.label}返回了无法解析的内容，请检查 Key 与服务是否匹配。")
                last_error.__cause__ = exc
            if attempt == 0:
                time.sleep(0.4)
        raise last_error or AppError("PROVIDER_ERROR", f"{self.label}请求失败。")

    def _check_business_error(self, payload: dict[str, Any]) -> None:
        """HTTP 200 但业务失败必须映射为应用错误，不能当成空结果。"""
        raise NotImplementedError


class BaseAdapter:
    name: str
    label: str

    @property
    def configured(self) -> bool:  # pragma: no cover - 由子类覆盖
        return False

    def capabilities(self) -> list[Capability]:
        raise NotImplementedError


def to_wgs84(point: list[float] | None, *, source_crs: str) -> tuple[dict[str, Any] | None, bool]:
    """把上游坐标转成标准 WGS84 点，返回 (geometry, approximate)。"""
    if not point or len(point) != 2:
        return None, False
    geom = {"type": "Point", "coordinates": [float(point[0]), float(point[1])]}
    if source_crs.upper() == "WGS84":
        return geom, False
    converted = transform_geometry(geom, source_crs=source_crs, target_crs="WGS84")
    if converted is None:
        return None, True
    return converted, True


def parse_polyline(polyline: str, *, source_crs: str) -> dict[str, Any] | None:
    coords: list[list[float]] = []
    for pair in polyline.split(";"):
        parts = pair.split(",")
        if len(parts) != 2:
            continue
        try:
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if source_crs.upper() == "GCJ02":
            from ..services.coords import gcj02_to_wgs84

            lon, lat = gcj02_to_wgs84(lon, lat)
        coords.append([round(lon, 6), round(lat, 6)])
    if len(coords) < 2:
        return None
    return {"type": "LineString", "coordinates": coords}


def now_utc() -> datetime:
    from datetime import timezone

    return datetime.now(timezone.utc)
