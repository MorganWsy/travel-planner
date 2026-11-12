"""请求与响应模型（对外契约的唯一来源，供 OpenAPI 生成前端类型）。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator


def iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


UTC = Annotated[datetime, PlainSerializer(iso_z, return_type=str)]

PRIORITY = Literal["required", "preferred", "optional"]
STOP_KIND = Literal["attraction", "meal", "lodging", "transport", "free"]
PLACE_CATEGORY = Literal["attraction", "meal", "lodging", "transport", "shopping", "viewpoint", "other"]
TRANSPORT_MODE = Literal["driving", "walking", "bicycling", "electrobike", "transit", "manual"]


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _check_point(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if value.get("type") != "Point":
        raise ValueError("仅支持 Point 几何。")
    coords = value.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) != 2:
        raise ValueError("coordinates 必须是 [longitude, latitude]。")
    lon, lat = float(coords[0]), float(coords[1])
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValueError("经纬度超出有效范围。")
    return {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}


# ---------------------------------------------------------------- 账号


class RegisterRequest(APIModel):
    email: str = Field(min_length=5, max_length=320)
    code: str = Field(min_length=6, max_length=6, description="邮箱验证码")
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=3, max_length=40)
    phone: str | None = Field(default=None, max_length=20)
    invite_code: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        candidate = value.strip().lower()
        if "@" not in candidate or candidate.startswith("@") or candidate.endswith("@"):
            raise ValueError("邮箱格式无效。")
        return candidate


class CaptchaOut(APIModel):
    challenge_id: str
    threshold: int = 95


class EmailSendRequest(APIModel):
    email: str = Field(min_length=5, max_length=320)
    scene: Literal["login", "register"] = "login"
    challenge_id: str = Field(min_length=8, max_length=64)
    slider_percent: int = Field(ge=0, le=100)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        candidate = value.strip().lower()
        if "@" not in candidate:
            raise ValueError("邮箱格式无效。")
        return candidate


class EmailSendOut(APIModel):
    ok: bool = True
    dev: bool = False
    message: str = ""


class LoginRequest(APIModel):
    """两种登录方式共用一条接口：填 code 走邮箱验证码，填 password 走密码。

    email 这个字段名为了兼容既有客户端没有改，但密码登录时它可以填邮箱**或昵称**；
    验证码登录仍然只接受邮箱（验证码是发到邮箱的）。
    """

    email: str = Field(min_length=1, max_length=320, description="邮箱，或密码登录时的昵称")
    password: str | None = Field(default=None, max_length=128)
    code: str | None = Field(default=None, max_length=6)
    # 密码登录必须带滑块凭证；验证码登录的凭证在发码时已经用掉了
    challenge_id: str | None = Field(default=None, max_length=64)
    slider_percent: int | None = Field(default=None, ge=0, le=100)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        candidate = value.strip()
        return candidate.lower() if "@" in candidate else candidate


class UserOut(APIModel):
    id: str
    email: str
    display_name: str
    phone: str | None = None
    avatar: str | None = None
    role: str = "member"
    created_at: UTC


class SessionOut(APIModel):
    user: UserOut
    csrf_token: str


class PasswordChange(APIModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class SessionRow(APIModel):
    id: str
    created_at: UTC
    last_seen_at: UTC
    expires_at: UTC
    user_agent: str | None = None
    current: bool = False


# ---------------------------------------------------------------- 行程


class TripCreate(APIModel):
    title: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    timezone: str = Field(default="Asia/Shanghai", max_length=64)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    budget_minor: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _range(self) -> "TripCreate":
        if self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期。")
        if (self.end_date - self.start_date).days + 1 > 30:
            raise ValueError("单个行程最多 30 天。")
        return self


class TripPatch(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    budget_minor: int | None = Field(default=None, ge=0)
    preferences: dict[str, Any] | None = None


class TripSummary(APIModel):
    id: str
    title: str
    start_date: date
    end_date: date
    timezone: str
    currency: str
    budget_minor: int | None
    revision: int
    updated_at: UTC
    day_count: int = 0
    stop_count: int = 0


class DayOut(APIModel):
    id: str
    date: date
    start_local_time: str
    end_local_time: str
    start_place_id: str | None
    end_place_id: str | None
    notes: str | None


class DayPatch(APIModel):
    start_local_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_local_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    start_place_id: str | None = None
    end_place_id: str | None = None
    notes: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def _window(self) -> "DayPatch":
        if self.start_local_time and self.end_local_time and self.end_local_time <= self.start_local_time:
            raise ValueError("当天结束时间必须晚于开始时间。")
        return self


class SourceOut(APIModel):
    type: str = "user"
    provider: str | None = None
    provider_id: str | None = None
    source_crs: str | None = None
    retrieved_at: UTC | None = None
    attribution: str | None = None
    approximate: bool = False
    transform_method: str | None = None


class PlaceCreate(APIModel):
    name: str = Field(min_length=1, max_length=120)
    category: PLACE_CATEGORY = "attraction"
    icon: str | None = Field(default=None, max_length=40)
    geometry: dict[str, Any] | None = None
    navigation_geometry: dict[str, Any] | None = None
    user_attributes: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    # 从搜索结果创建时使用：只接受服务端短时凭证，不接受客户端伪造的上游字段。
    selection_token: str | None = None
    user_overrides: dict[str, Any] | None = None

    _point = field_validator("geometry", "navigation_geometry")(classmethod(lambda cls, v: _check_point(v)))

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        cleaned = [t.strip() for t in value if t.strip()]
        if any(len(t) > 30 for t in cleaned):
            raise ValueError("单个标签不得超过 30 字。")
        return cleaned


class PlacePatch(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: PLACE_CATEGORY | None = None
    icon: str | None = Field(default=None, max_length=40)
    geometry: dict[str, Any] | None = None
    navigation_geometry: dict[str, Any] | None = None
    user_attributes: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=10000)
    tags: list[str] | None = Field(default=None, max_length=20)

    _point = field_validator("geometry", "navigation_geometry")(classmethod(lambda cls, v: _check_point(v)))

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [t.strip() for t in value if t.strip()]
        if any(len(t) > 30 for t in cleaned):
            raise ValueError("单个标签不得超过 30 字。")
        return cleaned


class PlaceOut(APIModel):
    id: str
    trip_id: str
    name: str
    category: str
    icon: str | None = None
    geometry: dict[str, Any] | None
    navigation_geometry: dict[str, Any] | None
    user_attributes: dict[str, Any]
    notes: str | None
    tags: list[str]
    source: SourceOut
    updated_at: UTC


class TimeWindow(APIModel):
    date: date
    start_local_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_local_time: str = Field(pattern=r"^\d{2}:\d{2}$")

    @model_validator(mode="after")
    def _order(self) -> "TimeWindow":
        if self.end_local_time <= self.start_local_time:
            raise ValueError("时间窗口结束必须晚于开始。")
        return self


class StopCreate(APIModel):
    day_id: str | None = None
    place_id: str | None = None
    kind: STOP_KIND = "attraction"
    title: str = Field(min_length=1, max_length=120)
    duration_seconds: int = Field(default=3600, ge=0, le=86400)
    priority: PRIORITY = "preferred"
    locked_day: bool = False
    locked_position: bool = False
    fixed_start: datetime | None = None
    time_windows: list[TimeWindow] = Field(default_factory=list)
    cost_minor: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=10000)
    transport: dict[str, Any] = Field(default_factory=dict)


class StopPatch(APIModel):
    day_id: str | None = None
    place_id: str | None = None
    kind: STOP_KIND | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    priority: PRIORITY | None = None
    locked_day: bool | None = None
    locked_position: bool | None = None
    fixed_start: datetime | None = None
    time_windows: list[TimeWindow] | None = None
    cost_minor: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=10000)
    transport: dict[str, Any] | None = None
    clear_fixed_start: bool = False


class StopOut(APIModel):
    id: str
    trip_id: str
    day_id: str | None
    place_id: str | None
    kind: str
    title: str
    position: int
    duration_seconds: int
    priority: str
    locked_day: bool
    locked_position: bool
    fixed_start: UTC | None
    time_windows: list[TimeWindow]
    cost_minor: int | None
    notes: str | None
    transport: dict[str, Any]
    updated_at: UTC


class RouteLegOut(APIModel):
    id: str
    day_id: str | None
    from_stop_id: str | None
    to_stop_id: str | None
    from_place_id: str | None
    to_place_id: str | None
    mode: str
    provider: str
    status: str
    distance_m: int | None
    duration_seconds: int | None
    geometry: dict[str, Any] | None
    departure_at: UTC | None
    retrieved_at: UTC | None


class TripWarning(APIModel):
    code: str
    message: str
    day_id: str | None = None
    stop_id: str | None = None


class MapLayerFeatureOut(APIModel):
    id: str
    name: str
    category: str | None = None
    geometry: dict[str, Any] | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class MapLayerOut(APIModel):
    id: str
    name: str
    kind: str
    category: str | None = None
    icon: str | None = None
    color: str | None = None
    visible: bool = True
    opacity: float = 1.0
    position: int = 0
    features: list[MapLayerFeatureOut] = Field(default_factory=list)


class MapLayerCreate(APIModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["mine", "system"] = "mine"
    category: str | None = None
    icon: str | None = None
    color: str | None = None
    visible: bool = True
    opacity: float = Field(default=1.0, ge=0, le=1)


class MapLayerPatch(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = None
    color: str | None = None
    visible: bool | None = None
    opacity: float | None = Field(default=None, ge=0, le=1)


class MapFeatureCreate(APIModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = None
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    properties: dict[str, Any] = Field(default_factory=dict)


class MapLayerCollectRequest(APIModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    radius_m: int = Field(default=2000, ge=100, le=20000)
    keywords: str | None = Field(default=None, max_length=40)
    limit: int = Field(default=40, ge=1, le=100)


class TripDetail(APIModel):
    id: str
    title: str
    start_date: date
    end_date: date
    timezone: str
    currency: str
    budget_minor: int | None
    preferences: dict[str, Any]
    revision: int
    updated_at: UTC
    days: list[DayOut]
    places: list[PlaceOut]
    stops: list[StopOut]
    route_legs: list[RouteLegOut]
    map_layers: list[MapLayerOut] = Field(default_factory=list)
    warnings: list[TripWarning] = Field(default_factory=list)


class ReorderRequest(APIModel):
    containers: list["ReorderContainer"]

    @field_validator("containers")
    @classmethod
    def _not_empty(cls, value: list["ReorderContainer"]) -> list["ReorderContainer"]:
        if not value:
            raise ValueError("至少提供一个容器。")
        return value


class ReorderContainer(APIModel):
    day_id: str | None
    stop_ids: list[str]


ReorderRequest.model_rebuild()


class DateChangeRequest(APIModel):
    start_date: date
    end_date: date
    overflow: Literal["to_candidates"] = "to_candidates"

    @model_validator(mode="after")
    def _range(self) -> "DateChangeRequest":
        if self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期。")
        if (self.end_date - self.start_date).days + 1 > 30:
            raise ValueError("单个行程最多 30 天。")
        return self


class RevisionSummary(APIModel):
    revision: int
    reason: str
    created_at: UTC
    created_by: str
    schema_version: int


class RevisionDetail(RevisionSummary):
    snapshot: dict[str, Any]


# ---------------------------------------------------------------- 时间线


class TimelineBlock(APIModel):
    stop_id: str
    title: str
    kind: str
    place_id: str | None
    start: UTC | None
    end: UTC | None
    travel_seconds: int | None
    travel_source: str | None
    wait_seconds: int
    cost_minor: int | None
    position: int
    status: str
    conflicts: list[str] = Field(default_factory=list)


class DayTimeline(APIModel):
    day_id: str
    date: date
    start: UTC | None
    end: UTC | None
    free_seconds: int | None
    travel_seconds: int
    visit_seconds: int
    cost_known_minor: int
    unknown_cost_count: int
    uncertain: bool
    blocks: list[TimelineBlock]
    conflicts: list[str] = Field(default_factory=list)


class TimelineOut(APIModel):
    trip_id: str
    revision: int
    days: list[DayTimeline]
    warnings: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- 供应商


class SearchRequest(APIModel):
    provider: Literal["tianditu", "amap", "auto", "both"] = "auto"
    q: str = Field(min_length=1, max_length=80)
    city_code: str | None = Field(default=None, max_length=20)
    page: int = Field(default=1, ge=1, le=10)
    limit: int = Field(default=20, ge=1, le=50)


class GeoResult(APIModel):
    id: str
    provider: str
    name: str
    category: str | None = None
    address: str | None = None
    geometry: dict[str, Any] | None
    source_crs: str
    approximate: bool = False
    attribution: str | None = None
    selection_token: str | None = None
    warnings: list[str] = Field(default_factory=list)


class SearchResponse(APIModel):
    results_by_provider: dict[str, list[GeoResult]]
    warnings: list[str] = Field(default_factory=list)
    actual_provider: str | None = None


class RouteQueryRequest(APIModel):
    from_stop_id: str | None = None
    to_stop_id: str | None = None
    from_place_id: str | None = None
    to_place_id: str | None = None
    mode: TRANSPORT_MODE = "driving"
    provider: Literal["amap", "manual", "auto"] = "auto"
    departure_at: datetime | None = None
    city_code: str | None = None
    # 高德公交换乘策略：0 推荐 / 2 最少换乘 / 5 不乘地铁 / 6 地铁图 / 7 地铁优先 / 8 时间短
    strategy: int | None = Field(default=None, ge=0, le=13)

    @model_validator(mode="after")
    def _endpoints(self) -> "RouteQueryRequest":
        has_from = bool(self.from_stop_id or self.from_place_id)
        has_to = bool(self.to_stop_id or self.to_place_id)
        if not (has_from and has_to):
            raise ValueError("必须同时提供起点和终点。")
        return self


class RouteCandidate(APIModel):
    distance_m: int
    duration_seconds: int
    geometry: dict[str, Any] | None
    provider: str
    mode: str
    status: str = "ready"
    retrieved_at: UTC
    departure_at: UTC | None = None
    steps: list[dict[str, Any]] = Field(default_factory=list)
    policy: dict[str, Any] = Field(default_factory=dict)
    selection_token: str | None = None
    warnings: list[str] = Field(default_factory=list)


class RouteQueryResponse(APIModel):
    candidates: list[RouteCandidate]
    actual_provider: str
    endpoint_note: list[str] = Field(default_factory=list)


class ManualLegRequest(APIModel):
    from_stop_id: str | None = None
    to_stop_id: str | None = None
    from_place_id: str | None = None
    to_place_id: str | None = None
    mode: TRANSPORT_MODE = "manual"
    distance_m: int | None = Field(default=None, ge=0)
    duration_seconds: int = Field(ge=0, le=86400)
    departure_at: datetime | None = None
    label: str | None = Field(default=None, max_length=80)


class BasemapOut(APIModel):
    id: str
    label: str
    type: str
    tiles: list[str] | None = None
    annotations: list[str] | None = None
    attribution: str | None = None
    note: str | None = None
    crs: str | None = None


class CapabilityOut(APIModel):
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
    policy: dict[str, Any] | None = None


class ProviderKeyOut(APIModel):
    label: str
    configured: bool
    masked: str
    source: str | None = None


class ProviderSettingsOut(APIModel):
    amap_key: ProviderKeyOut
    tianditu_key: ProviderKeyOut
    tianditu_browser_key: ProviderKeyOut
    capabilities: list[CapabilityOut] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class EgressIPOut(APIModel):
    """服务器出口 IP。天地图「服务器端」Key 的白名单要填这个值。"""

    ip: str | None = None
    checked: bool = False


class ProviderUpdateRequest(APIModel):
    amap_key: str | None = Field(default=None, max_length=200)
    tianditu_key: str | None = Field(default=None, max_length=200)
    tianditu_browser_key: str | None = Field(default=None, max_length=200)


class ProviderTestRequest(APIModel):
    provider: Literal["amap", "tianditu"]


class ProviderTestOut(APIModel):
    ok: bool
    message: str
    latency_ms: int
    sample: str | None = None


class PublicConfig(APIModel):
    app_version: str
    app_env: str
    registration_mode: str
    providers: dict[str, bool]
    basemaps: list[BasemapOut]
    limits: dict[str, int]
    features: dict[str, bool]
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- 优化


class OptimizationRequest(APIModel):
    input_revision: int
    scope: Literal["day"] = "day"
    day_ids: list[str] = Field(min_length=1, max_length=1)
    mode: Literal["driving", "walking"] = "driving"
    provider: Literal["amap", "estimate"] = "estimate"


class OptimizationStopPlan(APIModel):
    stop_id: str
    title: str
    position: int
    arrival: UTC | None
    start: UTC | None
    end: UTC | None
    travel_seconds: int | None


class OptimizationDayPlan(APIModel):
    day_id: str
    date: date
    stops: list[OptimizationStopPlan]
    travel_seconds: int
    finish: UTC | None


class OptimizationResult(APIModel):
    input_revision: int
    input_hash: str
    solver_status: Literal["feasible", "infeasible", "time_limit"]
    matrix_source: str
    days: list[OptimizationDayPlan]
    unassigned: list[dict[str, Any]] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    totals: dict[str, Any] = Field(default_factory=dict)
    assumptions: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- 分享与导出


class ShareCreate(APIModel):
    revision: int | None = None
    expires_in_days: Literal[1, 7, 30] = 7
    password: str | None = Field(default=None, min_length=4, max_length=64)
    allow_clone: bool = False


class ShareCreated(APIModel):
    id: str
    url: str
    token: str
    expires_at: UTC
    revision: int
    has_password: bool


class ShareSummary(APIModel):
    id: str
    revision: int
    expires_at: UTC
    revoked_at: UTC | None
    allow_clone: bool
    has_password: bool
    created_at: UTC


class ShareAccess(APIModel):
    requires_password: bool = False
    unlocked: bool = False
    snapshot: dict[str, Any] | None = None
    allow_clone: bool = False
    expires_at: UTC | None = None


class ShareUnlock(APIModel):
    password: str = Field(min_length=1, max_length=64)


class GuideRequest(APIModel):
    revision: int | None = None


class ExportRequest(APIModel):
    revision: int | None = None
    format: Literal["md", "docx"] = "md"
    include_maps: bool = False


class ExportOut(APIModel):
    id: str
    trip_id: str
    revision: int
    format: str
    filename: str
    bytes: int
    expires_at: UTC
    download_url: str


class JobOut(APIModel):
    id: str
    kind: str
    status: str
    progress: int
    stage: str | None
    input_revision: int | None
    cancel_requested: bool
    error: dict[str, Any] | None
    created_at: UTC
    started_at: UTC | None
    finished_at: UTC | None


class GuideBlock(APIModel):
    stop_id: str
    title: str
    kind: str
    place_name: str | None
    start: str | None
    end: str | None
    travel_seconds: int | None
    wait_seconds: int
    cost_minor: int | None
    notes: str | None


class GuideTotals(APIModel):
    travel_seconds: int
    visit_seconds: int
    cost_known_minor: int
    unknown_cost_count: int


class GuideDay(APIModel):
    day_id: str
    date: str
    start_local_time: str | None
    end_local_time: str | None
    start_time: str
    finish_time: str
    blocks: list[GuideBlock]
    totals: GuideTotals
    conflicts: list[str]
    notes: str | None


class GuideBudget(APIModel):
    budget_minor: int | None
    known_minor: int
    unknown_cost_count: int


class GuideSnapshot(APIModel):
    schema_version: int
    trip_id: str | None
    revision: int | None
    generated_at: str
    title: str | None
    date_range: str
    timezone: str | None
    currency: str
    days: list[GuideDay]
    budget: GuideBudget
    place_count: int
    sources: list[str]
    redactions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    markdown: str | None = None


class JobResultOut(APIModel):
    job_id: str
    kind: str
    result: dict[str, Any]


class ImportResult(APIModel):
    dataset_id: str
    format: str
    feature_count: int
    created_place_ids: list[str]
    skipped: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
