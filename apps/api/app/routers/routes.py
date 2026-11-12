"""地图查询、路径查询与时间线接口。

路径查询默认不落库（供应商数据默认不允许持久化）；用户可显式把手上的数字
录为“手工交通”，那属于用户自填数据，会进入快照并可导出。
"""

from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import AuthContext, check_revision, get_auth, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Place, RouteLeg, Stop
from ..providers import registry
from ..providers.policy import public_policy
from ..schemas import (
    GeoResult,
    ManualLegRequest,
    RouteCandidate,
    RouteQueryRequest,
    RouteQueryResponse,
    SearchRequest,
    SearchResponse,
    TimelineOut,
    TripDetail,
)
from ..services import geostore, trip_content
from ..services.geo import point_coords
from ..services.timeline import compute_timeline
from ..services.tokens import verify_selection

router = APIRouter()
settings = get_settings()


@router.post("/maps/search", response_model=SearchResponse)
def maps_search(
    payload: SearchRequest,
    auth: AuthContext = Depends(get_auth),
) -> SearchResponse:
    grouped, warnings, actual = registry.search(
        payload.provider,
        payload.q,
        city=payload.city_code,
        page=payload.page,
        limit=payload.limit,
        user_id=auth.user.id,
    )
    return SearchResponse(results_by_provider=grouped, warnings=warnings, actual_provider=actual)


@router.post("/maps/suggest", response_model=SearchResponse)
def maps_suggest(
    payload: SearchRequest,
    auth: AuthContext = Depends(get_auth),
) -> SearchResponse:
    grouped, warnings, actual = registry.suggest(
        payload.provider, payload.q, city=payload.city_code, limit=min(payload.limit, 10), user_id=auth.user.id
    )
    return SearchResponse(results_by_provider=grouped, warnings=warnings, actual_provider=actual)


@router.post("/maps/details", response_model=GeoResult)
def maps_details(payload: dict, auth: AuthContext = Depends(get_auth)) -> GeoResult:
    token = payload.get("selection_token")
    if not token:
        raise AppError("VALIDATION_ERROR", "需要 selection_token。")
    data = verify_selection(token, user_id=auth.user.id)
    coords = data.get("c") or None
    return GeoResult(
        id=f"{data.get('p')}:detail",
        provider=str(data.get("p")),
        name=str(data.get("n") or ""),
        category=data.get("cat"),
        address=data.get("addr"),
        geometry={"type": "Point", "coordinates": coords} if coords else None,
        source_crs=str(data.get("crs") or "WGS84"),
        approximate=str(data.get("crs")) != "WGS84",
        attribution=str(data.get("p")),
        selection_token=token,
    )


@router.post("/maps/geocode", response_model=SearchResponse)
def maps_geocode(payload: dict, auth: AuthContext = Depends(get_auth)) -> SearchResponse:
    provider = str(payload.get("provider") or "auto")
    address = str(payload.get("address") or "").strip()
    city = payload.get("city_code")
    if not address:
        raise AppError("VALIDATION_ERROR", "需要地址文本。")
    names = ["amap"] if provider == "amap" else (["tianditu"] if provider == "tianditu" else ["amap", "tianditu"])
    grouped: dict[str, list] = {}
    warnings: list[str] = []
    for name in names:
        adapter = registry.adapters().get(name)
        if not adapter:
            continue
        if not adapter.configured:
            if provider in ("amap", "tianditu"):
                raise AppError("PROVIDER_NOT_CONFIGURED", f"{adapter.label}未配置 Key。")
            warnings.append(f"{adapter.label}未配置，已跳过。")
            continue
        try:
            items = adapter.geocode(address, city=city)
        except NotImplementedError:
            warnings.append(f"{adapter.label}未实现地理编码。")
            continue
        from ..services.tokens import sign_selection

        grouped[name] = [
            {
                "id": f"{name}:geocode:{index}",
                "provider": name,
                "name": item.name,
                "category": item.category,
                "address": item.address,
                "geometry": item.geometry,
                "source_crs": item.source_crs,
                "approximate": item.approximate,
                "attribution": item.attribution,
                "selection_token": sign_selection(
                    user_id=auth.user.id,
                    provider=name,
                    name=item.name,
                    coords=(item.geometry or {}).get("coordinates"),
                    category=item.category,
                    address=item.address,
                    crs=item.source_crs,
                )
                if item.geometry
                else None,
                "warnings": [],
            }
            for index, item in enumerate(items)
        ]
    if not grouped:
        raise AppError("PROVIDER_NOT_CONFIGURED", "没有可用的地理编码服务。", details={"warnings": warnings})
    return SearchResponse(results_by_provider=grouped, warnings=warnings, actual_provider=names[0] if len(names) == 1 else None)


@router.post("/maps/weather")
def maps_weather(payload: dict, auth: AuthContext = Depends(get_auth)) -> dict:
    city = str(payload.get("city_code") or "").strip()
    if not city:
        raise AppError("VALIDATION_ERROR", "需要城市 adcode。")
    adapter = registry.adapters()["amap"]
    if not adapter.configured:
        raise AppError(
            "PROVIDER_NOT_CONFIGURED",
            "未配置高德 Key，天气查询不可用；可在行程备注中记录天气信息。",
        )
    return adapter.weather(city)


def _endpoint(db: Session, trip_id: str, *, stop_id: str | None, place_id: str | None) -> tuple[tuple[float, float], list[str], Stop | None]:
    notes: list[str] = []
    place: Place | None = None
    stop: Stop | None = None
    if stop_id:
        stop = db.scalar(select(Stop).where(Stop.id == stop_id, Stop.trip_id == trip_id))
        if not stop:
            raise AppError("NOT_FOUND", "起点或终点事项不存在。")
        if stop.place_id:
            place = db.scalar(select(Place).where(Place.id == stop.place_id, Place.trip_id == trip_id))
    elif place_id:
        place = db.scalar(select(Place).where(Place.id == place_id, Place.trip_id == trip_id))
        if not place:
            raise AppError("NOT_FOUND", "起点或终点地点不存在。")
    if place is None:
        raise AppError("VALIDATION_ERROR", "该端点没有关联地点，无法查询路线。")
    coords = point_coords(geostore.to_geojson(place.navigation_geometry))
    if coords:
        notes.append("使用已填写的导航入口坐标。")
    else:
        coords = point_coords(geostore.to_geojson(place.geometry))
        if coords:
            notes.append("未填写导航入口，使用地点坐标，请自行核实入口。")
    if not coords:
        raise AppError("VALIDATION_ERROR", "地点缺少坐标，无法查询路线。")
    return coords, notes, stop


@router.post("/trips/{trip_id}/routes/query", response_model=RouteQueryResponse)
def query_route(
    trip_id: str,
    payload: RouteQueryRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> RouteQueryResponse:
    trip = get_owned_trip(db, auth.user, trip_id)
    origin, from_notes, _ = _endpoint(db, trip.id, stop_id=payload.from_stop_id, place_id=payload.from_place_id)
    destination, to_notes, _ = _endpoint(db, trip.id, stop_id=payload.to_stop_id, place_id=payload.to_place_id)
    if payload.mode == "manual":
        raise AppError("UNSUPPORTED_CAPABILITY", "手工交通请使用 /routes/manual 接口。")
    used_city: list[str] = []
    city_code = payload.city_code
    # 公交规划必须给 citycode，用户通常不知道填什么：没填就按起点坐标自动识别
    if payload.mode == "transit" and not city_code:
        city_code = registry.city_code(*origin)
        if city_code:
            used_city = [f"未填写城市代码，已按起点坐标识别为 {city_code}"]
        else:
            raise AppError(
                "INVALID_REQUEST",
                "公交规划需要城市代码；本次按起点坐标也没识别出来，请在城市代码里填起点所在城市的 citycode。",
            )
    result = registry.route(
        payload.provider,
        origin=origin,
        destination=destination,
        mode=payload.mode,
        departure_at=payload.departure_at,
        city_code=city_code,
        strategy=payload.strategy or 0,
    )
    policy = public_policy(result.provider, "route_driving" if payload.mode == "driving" else f"route_{payload.mode}", str(settings.provider_policy_path))
    candidate = RouteCandidate(
        distance_m=result.distance_m,
        duration_seconds=result.duration_seconds,
        geometry=result.geometry,
        provider=result.provider,
        mode=result.mode,
        status=result.status,
        retrieved_at=utcnow(),
        departure_at=payload.departure_at,
        steps=result.steps,
        policy={"uses": policy["uses"], "attribution": policy["attribution"]},
        warnings=result.warnings
        + (
            ["该结果默认不保存；如需固定耗时，请在下方填写并保存交通耗时。"]
            if policy["uses"].get("persist") != "allowed"
            else []
        ),
    )
    return RouteQueryResponse(candidates=[candidate], actual_provider=result.provider, endpoint_note=from_notes + to_notes + used_city)


@router.post("/trips/{trip_id}/routes/manual", response_model=TripDetail)
def manual_leg(
    trip_id: str,
    payload: ManualLegRequest,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    if not (payload.from_stop_id or payload.from_place_id) or not (payload.to_stop_id or payload.to_place_id):
        raise AppError("VALIDATION_ERROR", "需要同时提供起点和终点。")

    day_id = None
    if payload.from_stop_id:
        stop = db.scalar(select(Stop).where(Stop.id == payload.from_stop_id, Stop.trip_id == trip.id))
        if not stop:
            raise AppError("NOT_FOUND", "起点事项不存在。")
        day_id = stop.day_id
    if payload.to_stop_id:
        stop = db.scalar(select(Stop).where(Stop.id == payload.to_stop_id, Stop.trip_id == trip.id))
        if not stop:
            raise AppError("NOT_FOUND", "终点事项不存在。")
        day_id = day_id or stop.day_id

    db.execute(
        delete(RouteLeg).where(
            RouteLeg.trip_id == trip.id,
            RouteLeg.mode == "manual",
            RouteLeg.from_stop_id == payload.from_stop_id,
            RouteLeg.to_stop_id == payload.to_stop_id,
            RouteLeg.from_place_id == payload.from_place_id,
            RouteLeg.to_place_id == payload.to_place_id,
        )
    )
    db.add(
        RouteLeg(
            trip_id=trip.id,
            day_id=day_id,
            from_stop_id=payload.from_stop_id,
            to_stop_id=payload.to_stop_id,
            from_place_id=payload.from_place_id,
            to_place_id=payload.to_place_id,
            mode="manual",
            provider="manual",
            status="manual",
            distance_m=payload.distance_m,
            duration_seconds=payload.duration_seconds,
            geometry=None,
            departure_at=payload.departure_at,
            retrieved_at=utcnow(),
            source={
                "type": "user",
                "label": payload.label,
                "note": "用户手工录入的交通耗时，非路网计算结果。",
            },
        )
    )
    trip_content.commit(db, trip, user_id=auth.user.id, reason="manual-leg")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.delete("/trips/{trip_id}/routes/{leg_id}", response_model=TripDetail)
def delete_leg(
    trip_id: str,
    leg_id: str,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    leg = db.scalar(select(RouteLeg).where(RouteLeg.id == leg_id, RouteLeg.trip_id == trip.id))
    if not leg:
        raise AppError("NOT_FOUND", "交通段不存在。")
    db.delete(leg)
    trip_content.commit(db, trip, user_id=auth.user.id, reason="leg-delete")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.get("/trips/{trip_id}/timeline", response_model=TimelineOut)
def timeline(
    trip_id: str,
    day_id: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> TimelineOut:
    trip = get_owned_trip(db, auth.user, trip_id)
    return compute_timeline(db, trip, day_id=day_id)
