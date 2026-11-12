"""行程、日期与版本接口。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import AuthContext, check_revision, get_auth, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Place, RouteLeg, Share, Stop, Trip, TripDay, TripRevision
from ..schemas import (
    DateChangeRequest,
    RevisionSummary,
    DayPatch,
    DayOut,
    TripCreate,
    TripDetail,
    TripPatch,
    TripSummary,
)
from ..services import trip_content
from ..services import geostore, weather

router = APIRouter()
settings = get_settings()


def _summary(db: Session, trip: Trip) -> TripSummary:
    day_count = db.scalar(select(func.count(TripDay.id)).where(TripDay.trip_id == trip.id)) or 0
    stop_count = db.scalar(select(func.count(Stop.id)).where(Stop.trip_id == trip.id)) or 0
    return TripSummary(
        id=trip.id,
        title=trip.title,
        start_date=trip.start_date,
        end_date=trip.end_date,
        timezone=trip.timezone,
        currency=trip.currency,
        budget_minor=trip.budget_minor,
        revision=trip.revision,
        updated_at=trip.updated_at,
        day_count=day_count,
        stop_count=stop_count,
    )


def _create_days(db: Session, trip: Trip, start: date, end: date) -> None:
    cursor = start
    while cursor <= end:
        db.add(
            TripDay(
                trip_id=trip.id,
                date=cursor,
                start_local_time="09:00",
                end_local_time="20:00",
            )
        )
        cursor += timedelta(days=1)


@router.get("/trips", response_model=list[TripSummary])
def list_trips(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[TripSummary]:
    trips = db.scalars(
        select(Trip)
        .where(Trip.owner_id == auth.user.id, Trip.deleted_at.is_(None))
        .order_by(Trip.updated_at.desc())
    )
    return [_summary(db, trip) for trip in trips]


@router.post("/trips", response_model=TripDetail, status_code=201)
def create_trip(
    payload: TripCreate,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    trip = Trip(
        owner_id=auth.user.id,
        title=payload.title.strip(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        timezone=payload.timezone,
        currency=payload.currency.upper(),
        budget_minor=payload.budget_minor,
        preferences={},
        revision=1,
    )
    db.add(trip)
    db.flush()
    _create_days(db, trip, payload.start_date, payload.end_date)
    db.flush()
    snapshot = trip_content.build_snapshot(db, trip)
    db.add(
        TripRevision(
            trip_id=trip.id,
            revision=1,
            schema_version=trip_content.SCHEMA_VERSION,
            reason="create",
            snapshot=snapshot,
            redactions=[],
            created_by=auth.user.id,
        )
    )
    db.commit()
    db.refresh(trip)
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.get("/trips/{trip_id}", response_model=TripDetail)
def get_trip(
    trip_id: str,
    response: Response,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> TripDetail:
    trip = get_owned_trip(db, auth.user, trip_id)
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.patch("/trips/{trip_id}", response_model=TripDetail)
def patch_trip(
    trip_id: str,
    payload: TripPatch,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    if payload.title is not None:
        trip.title = payload.title.strip()
    if payload.budget_minor is not None:
        trip.budget_minor = payload.budget_minor
    if payload.preferences is not None:
        trip.preferences = payload.preferences
    trip_content.commit(db, trip, user_id=auth.user.id, reason="edit")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.delete("/trips/{trip_id}")
def delete_trip(
    trip_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    now = utcnow()
    trip.deleted_at = now
    for share in db.scalars(select(Share).where(Share.trip_id == trip.id, Share.revoked_at.is_(None))):
        share.revoked_at = now
    db.commit()
    return {"trip_id": trip.id, "revision": trip.revision, "deleted_id": trip.id}


@router.post("/trips/{trip_id}/clone", response_model=TripDetail, status_code=201)
def clone_trip(
    trip_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    source = get_owned_trip(db, auth.user, trip_id)
    clone = Trip(
        owner_id=auth.user.id,
        title=f"{source.title} 副本"[:120],
        start_date=source.start_date,
        end_date=source.end_date,
        timezone=source.timezone,
        currency=source.currency,
        budget_minor=source.budget_minor,
        preferences=dict(source.preferences or {}),
        revision=1,
    )
    db.add(clone)
    db.flush()

    day_map: dict[str, str] = {}
    for day in trip_content.load_days(db, source.id):
        new_day = TripDay(
            trip_id=clone.id,
            date=day.date,
            start_local_time=day.start_local_time,
            end_local_time=day.end_local_time,
            notes=day.notes,
        )
        db.add(new_day)
        db.flush()
        day_map[day.id] = new_day.id

    place_map: dict[str, str] = {}
    for place in trip_content.load_places(db, source.id):
        new_place = Place(
            owner_id=auth.user.id,
            trip_id=clone.id,
            name=place.name,
            category=place.category,
            geometry=place.geometry,
            navigation_geometry=place.navigation_geometry,
            user_attributes=dict(place.user_attributes or {}),
            notes=place.notes,
            tags=list(place.tags or []),
            source=dict(place.source or {}),
        )
        db.add(new_place)
        db.flush()
        place_map[place.id] = new_place.id

    stop_map: dict[str, str] = {}
    for stop in trip_content.load_stops(db, source.id):
        new_stop = Stop(
            trip_id=clone.id,
            day_id=day_map.get(stop.day_id) if stop.day_id else None,
            place_id=place_map.get(stop.place_id) if stop.place_id else None,
            kind=stop.kind,
            title=stop.title,
            position=stop.position,
            duration_seconds=stop.duration_seconds,
            priority=stop.priority,
            locked_day=stop.locked_day,
            locked_position=stop.locked_position,
            fixed_start=stop.fixed_start,
            time_windows=list(stop.time_windows or []),
            cost_minor=stop.cost_minor,
            notes=stop.notes,
            transport=dict(stop.transport or {}),
            source=dict(stop.source or {}),
        )
        db.add(new_stop)
        db.flush()
        stop_map[stop.id] = new_stop.id

    for leg in trip_content.load_legs(db, source.id):
        db.add(
            RouteLeg(
                trip_id=clone.id,
                day_id=day_map.get(leg.day_id) if leg.day_id else None,
                from_stop_id=stop_map.get(leg.from_stop_id) if leg.from_stop_id else None,
                to_stop_id=stop_map.get(leg.to_stop_id) if leg.to_stop_id else None,
                from_place_id=place_map.get(leg.from_place_id) if leg.from_place_id else None,
                to_place_id=place_map.get(leg.to_place_id) if leg.to_place_id else None,
                mode=leg.mode,
                provider=leg.provider,
                status=leg.status,
                distance_m=leg.distance_m,
                duration_seconds=leg.duration_seconds,
                geometry=leg.geometry,
                departure_at=leg.departure_at,
                retrieved_at=leg.retrieved_at,
                input_hash=leg.input_hash,
                source=dict(leg.source or {}),
            )
        )

    db.flush()
    snapshot = trip_content.build_snapshot(db, clone)
    db.add(
        TripRevision(
            trip_id=clone.id,
            revision=1,
            schema_version=trip_content.SCHEMA_VERSION,
            reason="clone",
            snapshot=snapshot,
            redactions=[],
            created_by=auth.user.id,
        )
    )
    db.commit()
    db.refresh(clone)
    return trip_content.serialize_trip(db, clone)


@router.post("/trips/{trip_id}/date-change-preview")
def date_change_preview(
    trip_id: str,
    payload: DateChangeRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    days = trip_content.load_days(db, trip.id)
    kept = {d.date for d in days if payload.start_date <= d.date <= payload.end_date}
    removed = [d for d in days if d.date not in kept]
    removed_ids = {d.id for d in removed}
    affected = [s for s in trip_content.load_stops(db, trip.id) if s.day_id in removed_ids]
    added = [
        (payload.start_date + timedelta(days=offset)).isoformat()
        for offset in range((payload.end_date - payload.start_date).days + 1)
        if payload.start_date + timedelta(days=offset) not in {d.date for d in days}
    ]
    return {
        "trip_id": trip.id,
        "kept_days": len(kept),
        "removed_days": [d.date.isoformat() for d in removed],
        "affected_stop_count": len(affected),
        "affected_stops": [{"id": s.id, "title": s.title} for s in affected][:50],
        "added_days": added,
        "overflow": "to_candidates",
    }


@router.post("/trips/{trip_id}/change-dates", response_model=TripDetail)
def change_dates(
    trip_id: str,
    payload: DateChangeRequest,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)

    days = trip_content.load_days(db, trip.id)
    kept_dates = {d.date for d in days if payload.start_date <= d.date <= payload.end_date}
    removed = [d for d in days if d.date not in kept_dates]
    removed_ids = {d.id for d in removed}

    for stop in trip_content.load_stops(db, trip.id):
        if stop.day_id in removed_ids:
            stop.day_id = None
            if stop.fixed_start is not None:
                note = "原日期被移除，固定预约已清除，请重新安排。"
                stop.notes = f"{stop.notes}\n{note}".strip() if stop.notes else note
                stop.fixed_start = None
            stop.position = 0

    for day in removed:
        db.execute(delete(TripDay).where(TripDay.id == day.id))

    existing = {d.date for d in days if d.date in kept_dates}
    cursor = payload.start_date
    while cursor <= payload.end_date:
        if cursor not in existing:
            db.add(TripDay(trip_id=trip.id, date=cursor, start_local_time="09:00", end_local_time="20:00"))
        cursor += timedelta(days=1)

    trip.start_date = payload.start_date
    trip.end_date = payload.end_date
    db.flush()
    _resequence_candidates(db, trip.id)
    trip_content.commit(db, trip, user_id=auth.user.id, reason="date-change")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


def _resequence_candidates(db: Session, trip_id: str) -> None:
    candidates = list(
        db.scalars(
            select(Stop).where(Stop.trip_id == trip_id, Stop.day_id.is_(None)).order_by(Stop.created_at)
        )
    )
    for index, stop in enumerate(candidates):
        stop.position = index


@router.patch("/trips/{trip_id}/days/{day_id}", response_model=TripDetail)
def patch_day(
    trip_id: str,
    day_id: str,
    payload: DayPatch,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    day = db.scalar(select(TripDay).where(TripDay.id == day_id, TripDay.trip_id == trip.id))
    if not day:
        raise AppError("NOT_FOUND", "日期不存在。")
    if payload.start_local_time is not None:
        day.start_local_time = payload.start_local_time
    if payload.end_local_time is not None:
        day.end_local_time = payload.end_local_time
    if payload.start_place_id is not None:
        _assert_place(db, trip.id, payload.start_place_id)
        day.start_place_id = payload.start_place_id or None
    if payload.end_place_id is not None:
        _assert_place(db, trip.id, payload.end_place_id)
        day.end_place_id = payload.end_place_id or None
    if payload.notes is not None:
        day.notes = payload.notes
    trip_content.commit(db, trip, user_id=auth.user.id, reason="day-edit")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


def _assert_place(db: Session, trip_id: str, place_id: str) -> None:
    if not place_id:
        return
    place = db.scalar(select(Place).where(Place.id == place_id, Place.trip_id == trip_id))
    if not place:
        raise AppError("VALIDATION_ERROR", "引用的地点不属于该行程。")


@router.get("/trips/{trip_id}/weather")
def trip_weather(trip_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict[str, Any]:
    """行程期间的每日天气。

    参考点取第一个有坐标的地点；没有坐标或超出预报窗口时如实返回 available=False。
    """
    trip = get_owned_trip(db, auth.user, trip_id)
    place = db.scalar(
        select(Place).where(Place.trip_id == trip.id, Place.geometry.is_not(None)).order_by(Place.created_at)
    )
    if place is None:
        return {"available": False, "reason": "行程里还没有带坐标的地点", "days": []}

    point = geostore.to_geojson(place.geometry)
    coords = (point or {}).get("coordinates") or []
    if len(coords) != 2:
        return {"available": False, "reason": "地点坐标不可用", "days": []}

    result = weather.fetch_daily(float(coords[1]), float(coords[0]), trip.start_date, trip.end_date)
    result["anchor"] = {"place": place.name, "lon": coords[0], "lat": coords[1]}
    return result


@router.get("/trips/{trip_id}/revisions", response_model=list[RevisionSummary])
def list_revisions(
    trip_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    trip = get_owned_trip(db, auth.user, trip_id)
    rows = db.scalars(
        select(TripRevision).where(TripRevision.trip_id == trip.id).order_by(TripRevision.revision.desc()).limit(200)
    )
    return [
        RevisionSummary(
            revision=row.revision,
            reason=row.reason,
            created_at=row.created_at,
            created_by=row.created_by,
            schema_version=row.schema_version,
        )
        for row in rows
    ]


@router.get("/trips/{trip_id}/revisions/{revision}")
def get_revision(
    trip_id: str,
    revision: int,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    trip = get_owned_trip(db, auth.user, trip_id)
    row = db.scalar(select(TripRevision).where(TripRevision.trip_id == trip.id, TripRevision.revision == revision))
    if not row:
        raise AppError("NOT_FOUND", "该历史版本不存在。")
    return {
        "revision": row.revision,
        "reason": row.reason,
        "created_at": row.created_at.isoformat(),
        "created_by": row.created_by,
        "schema_version": row.schema_version,
        "snapshot": row.snapshot,
        "redactions": row.redactions or [],
    }


@router.post("/trips/{trip_id}/restore", response_model=TripDetail)
def restore_revision(
    trip_id: str,
    payload: dict,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    source_revision = payload.get("source_revision")
    if not isinstance(source_revision, int):
        raise AppError("VALIDATION_ERROR", "需要提供 source_revision。")
    row = db.scalar(
        select(TripRevision).where(TripRevision.trip_id == trip.id, TripRevision.revision == source_revision)
    )
    if not row:
        raise AppError("NOT_FOUND", "该历史版本不存在。")
    trip_content.restore_snapshot(db, trip, row.snapshot, user_id=auth.user.id)
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)
