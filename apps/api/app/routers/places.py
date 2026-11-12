"""地点接口。

从供应商搜索结果保存时只走 selection_token：客户端不能直接提交上游字段。
默认策略下供应商记录不允许持久化，因此保存的是“用户自有地点 + 来源说明”，
不保存 provider_id，也不保存原始供应商响应。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, check_revision, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Place, Stop, Trip
from ..schemas import PlaceCreate, PlacePatch, TripDetail
from ..services import geostore, trip_content
from ..services.tokens import verify_selection

router = APIRouter()


def _assert_exists(db: Session, trip_id: str, place_id: str) -> Place:
    place = db.scalar(select(Place).where(Place.id == place_id, Place.trip_id == trip_id))
    if not place:
        raise AppError("NOT_FOUND", "地点不存在。")
    return place


def _next_place_source(payload: PlaceCreate, auth: AuthContext) -> dict:
    if not payload.selection_token:
        return {"type": "user", "attribution": None}
    token = verify_selection(payload.selection_token, user_id=auth.user.id)
    return {
        "type": "user",
        "provider": token.get("p"),
        "provider_id": None,  # 默认策略不允许持久化上游 ID
        "source_crs": token.get("crs"),
        "retrieved_at": None,
        "attribution": f"{token.get('p')}（用户复制，非原始记录）",
        "approximate": token.get("crs") != "WGS84",
        "transform_method": "gcj2wgs_iterative" if token.get("crs") == "GCJ02" else None,
    }


@router.post("/trips/{trip_id}/places", response_model=TripDetail, status_code=201)
def create_place(
    trip_id: str,
    payload: PlaceCreate,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)

    geometry = payload.geometry
    if payload.selection_token:
        token = verify_selection(payload.selection_token, user_id=auth.user.id)
        coords = token.get("c") or None
        if not coords:
            raise AppError("VALIDATION_ERROR", "该搜索结果没有可用坐标。")
        geometry = {"type": "Point", "coordinates": [float(coords[0]), float(coords[1])]}

    place = Place(
        owner_id=auth.user.id,
        trip_id=trip.id,
        name=payload.name.strip(),
        category=payload.category,
        icon=payload.icon,
        geometry=geostore.point_wkb(geometry),
        navigation_geometry=geostore.point_wkb(payload.navigation_geometry),
        user_attributes=payload.user_attributes or {},
        notes=payload.notes,
        tags=payload.tags,
        source=_next_place_source(payload, auth),
    )
    db.add(place)
    trip_content.commit(db, trip, user_id=auth.user.id, reason="place-create")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.patch("/trips/{trip_id}/places/{place_id}", response_model=TripDetail)
def patch_place(
    trip_id: str,
    place_id: str,
    payload: PlacePatch,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    place = _assert_exists(db, trip.id, place_id)

    if payload.name is not None:
        place.name = payload.name.strip()
    if payload.category is not None:
        place.category = payload.category
    if payload.icon is not None:
        place.icon = payload.icon or None
    if payload.geometry is not None:
        place.geometry = payload.geometry
    if payload.navigation_geometry is not None:
        place.navigation_geometry = payload.navigation_geometry
    if payload.user_attributes is not None:
        place.user_attributes = payload.user_attributes
    if payload.notes is not None:
        place.notes = payload.notes
    if payload.tags is not None:
        place.tags = payload.tags

    trip_content.commit(db, trip, user_id=auth.user.id, reason="place-edit")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.delete("/trips/{trip_id}/places/{place_id}", response_model=TripDetail)
def delete_place(
    trip_id: str,
    place_id: str,
    request: Request,
    response: Response,
    detach: bool = False,
    cascade: bool = False,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    place = _assert_exists(db, trip.id, place_id)

    referencing_stops = list(db.scalars(select(Stop).where(Stop.place_id == place.id)))
    day_refs = [
        day
        for day in trip_content.load_days(db, trip.id)
        if day.start_place_id == place.id or day.end_place_id == place.id
    ]
    if cascade:
        # 删除标注＝连同引用它的事项一起删，否则事项会变成没有地点的空壳
        for stop in referencing_stops:
            db.delete(stop)
        referencing_stops = []
    if (referencing_stops or day_refs) and not detach:
        raise AppError(
            "RESOURCE_IN_USE",
            "该地点仍被事项或当天起终点引用，需先解除引用。",
            details={
                "stop_ids": [s.id for s in referencing_stops],
                "day_ids": [d.id for d in day_refs],
                "hint": "可带 detach=true 显式解除引用后删除。",
            },
        )
    for stop in referencing_stops:
        stop.place_id = None
    for day in day_refs:
        if day.start_place_id == place.id:
            day.start_place_id = None
        if day.end_place_id == place.id:
            day.end_place_id = None
    db.delete(place)

    trip_content.commit(db, trip, user_id=auth.user.id, reason="place-delete")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)
