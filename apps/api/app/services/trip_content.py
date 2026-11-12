"""行程内容读取、快照与版本提交。

所有内容写操作都必须经过 commit()：锁定行程行 → 校验 revision → 写快照 → revision+1。
这样历史、分享、导出都能拿到同一份可追溯的数据。
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..errors import AppError
from ..routers.layers import layer_payload, load_layers
from ..models import Place, RouteLeg, Stop, Trip, TripDay, TripRevision
from . import geostore
from ..schemas import (
    DayOut,
    PlaceOut,
    RouteLegOut,
    SourceOut,
    StopOut,
    TripDetail,
    TripWarning,
)

SCHEMA_VERSION = 1


def load_days(db: Session, trip_id: str) -> list[TripDay]:
    return list(db.scalars(select(TripDay).where(TripDay.trip_id == trip_id).order_by(TripDay.date)))


def load_places(db: Session, trip_id: str) -> list[Place]:
    return list(db.scalars(select(Place).where(Place.trip_id == trip_id).order_by(Place.created_at)))


def load_stops(db: Session, trip_id: str) -> list[Stop]:
    """按行程日期与当天顺序返回事项；候选池（day_id 为空）排在最后。

    不能按 day_id 排序：它是 UUID，顺序与日期无关，会让地图编号与列表错位。
    """
    return list(
        db.scalars(
            select(Stop)
            .outerjoin(TripDay, Stop.day_id == TripDay.id)
            .where(Stop.trip_id == trip_id)
            .order_by(TripDay.date.is_(None), TripDay.date, Stop.position, Stop.created_at)
        )
    )


def load_legs(db: Session, trip_id: str) -> list[RouteLeg]:
    return list(db.scalars(select(RouteLeg).where(RouteLeg.trip_id == trip_id)))


def _source_out(raw: dict[str, Any] | None) -> SourceOut:
    data = dict(raw or {})
    return SourceOut(
        type=data.get("type", "user"),
        provider=data.get("provider"),
        provider_id=data.get("provider_id"),
        source_crs=data.get("source_crs"),
        retrieved_at=data.get("retrieved_at"),
        attribution=data.get("attribution"),
        approximate=bool(data.get("approximate", False)),
        transform_method=data.get("transform_method"),
    )


def place_out(place: Place) -> PlaceOut:
    return PlaceOut(
        id=place.id,
        trip_id=place.trip_id,
        name=place.name,
        category=place.category,
        icon=place.icon,
        geometry=geostore.to_geojson(place.geometry),
        navigation_geometry=geostore.to_geojson(place.navigation_geometry),
        user_attributes=place.user_attributes or {},
        notes=place.notes,
        tags=place.tags or [],
        source=_source_out(place.source),
        updated_at=place.updated_at,
    )


def stop_out(stop: Stop) -> StopOut:
    return StopOut(
        id=stop.id,
        trip_id=stop.trip_id,
        day_id=stop.day_id,
        place_id=stop.place_id,
        kind=stop.kind,
        title=stop.title,
        position=stop.position,
        duration_seconds=stop.duration_seconds,
        priority=stop.priority,
        locked_day=stop.locked_day,
        locked_position=stop.locked_position,
        fixed_start=stop.fixed_start,
        time_windows=stop.time_windows or [],
        cost_minor=stop.cost_minor,
        notes=stop.notes,
        transport=stop.transport or {},
        updated_at=stop.updated_at,
    )


def leg_out(leg: RouteLeg) -> RouteLegOut:
    return RouteLegOut(
        id=leg.id,
        day_id=leg.day_id,
        from_stop_id=leg.from_stop_id,
        to_stop_id=leg.to_stop_id,
        from_place_id=leg.from_place_id,
        to_place_id=leg.to_place_id,
        mode=leg.mode,
        provider=leg.provider,
        status=leg.status,
        distance_m=leg.distance_m,
        duration_seconds=leg.duration_seconds,
        geometry=leg.geometry,
        departure_at=leg.departure_at,
        retrieved_at=leg.retrieved_at,
    )


def build_warnings(db: Session, trip: Trip) -> list[TripWarning]:
    from .timeline import compute_timeline

    timeline = compute_timeline(db, trip)
    warnings: list[TripWarning] = []
    seen: set[str] = set()
    for day in timeline.days:
        for code in day.conflicts:
            if code in seen:
                continue
            seen.add(code)
            warnings.append(TripWarning(code=code, message=_CONFLICT_TEXT.get(code, code), day_id=day.day_id))
    if not load_places(db, trip.id):
        warnings.append(TripWarning(code="NO_PLACES", message="尚未添加地点，可先搜索或手工新建。"))
    return warnings


_CONFLICT_TEXT = {
    "LATE_FIXED_START": "预计到达时间晚于固定预约时间。",
    "WINDOW_MISSED": "当天已无可用开放时间窗口。",
    "DAY_OVERFLOW": "当天安排超出结束时间。",
    "MISSING_TRAVEL": "缺少两站之间的交通耗时，到达时间不确定。",
    "NO_COORDINATES": "地点缺少坐标，无法计算路程。",
}


def serialize_trip(db: Session, trip: Trip) -> TripDetail:
    return TripDetail(
        id=trip.id,
        title=trip.title,
        start_date=trip.start_date,
        end_date=trip.end_date,
        timezone=trip.timezone,
        currency=trip.currency,
        budget_minor=trip.budget_minor,
        preferences=trip.preferences or {},
        revision=trip.revision,
        updated_at=trip.updated_at,
        days=[
            DayOut(
                id=day.id,
                date=day.date,
                start_local_time=day.start_local_time,
                end_local_time=day.end_local_time,
                start_place_id=day.start_place_id,
                end_place_id=day.end_place_id,
                notes=day.notes,
            )
            for day in load_days(db, trip.id)
        ],
        places=[place_out(p) for p in load_places(db, trip.id)],
        stops=[stop_out(s) for s in load_stops(db, trip.id)],
        route_legs=[leg_out(l) for l in load_legs(db, trip.id)],
        map_layers=[layer_payload(db, layer) for layer in load_layers(db, trip.id)],
        warnings=build_warnings(db, trip),
    )


def _stop_dict(stop: Stop) -> dict[str, Any]:
    return {
        "id": stop.id,
        "day_id": stop.day_id,
        "place_id": stop.place_id,
        "kind": stop.kind,
        "title": stop.title,
        "position": stop.position,
        "duration_seconds": stop.duration_seconds,
        "priority": stop.priority,
        "locked_day": stop.locked_day,
        "locked_position": stop.locked_position,
        "fixed_start": stop.fixed_start.isoformat() if stop.fixed_start else None,
        "time_windows": stop.time_windows or [],
        "cost_minor": stop.cost_minor,
        "notes": stop.notes,
        "transport": stop.transport or {},
        "source": stop.source or {},
    }


def _place_dict(place: Place) -> dict[str, Any]:
    return {
        "id": place.id,
        "name": place.name,
        "category": place.category,
        "geometry": geostore.to_geojson(place.geometry),
        "navigation_geometry": geostore.to_geojson(place.navigation_geometry),
        "user_attributes": place.user_attributes or {},
        "notes": place.notes,
        "tags": place.tags or [],
        "source": place.source or {},
    }


def _leg_dict(leg: RouteLeg) -> dict[str, Any]:
    return {
        "id": leg.id,
        "day_id": leg.day_id,
        "from_stop_id": leg.from_stop_id,
        "to_stop_id": leg.to_stop_id,
        "from_place_id": leg.from_place_id,
        "to_place_id": leg.to_place_id,
        "mode": leg.mode,
        "provider": leg.provider,
        "status": leg.status,
        "distance_m": leg.distance_m,
        "duration_seconds": leg.duration_seconds,
        "geometry": geostore.to_geojson(leg.geometry),
        "departure_at": leg.departure_at.isoformat() if leg.departure_at else None,
        "retrieved_at": leg.retrieved_at.isoformat() if leg.retrieved_at else None,
        "input_hash": leg.input_hash,
        "source": leg.source or {},
    }


def build_snapshot(db: Session, trip: Trip) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "trip": {
            "id": trip.id,
            "title": trip.title,
            "start_date": trip.start_date.isoformat(),
            "end_date": trip.end_date.isoformat(),
            "timezone": trip.timezone,
            "currency": trip.currency,
            "budget_minor": trip.budget_minor,
            "preferences": trip.preferences or {},
            "revision": trip.revision,
        },
        "days": [
            {
                "id": day.id,
                "date": day.date.isoformat(),
                "start_local_time": day.start_local_time,
                "end_local_time": day.end_local_time,
                "start_place_id": day.start_place_id,
                "end_place_id": day.end_place_id,
                "notes": day.notes,
            }
            for day in load_days(db, trip.id)
        ],
        "places": [_place_dict(p) for p in load_places(db, trip.id)],
        "stops": [_stop_dict(s) for s in load_stops(db, trip.id)],
        "route_legs": [_leg_dict(l) for l in load_legs(db, trip.id)],
    }


def commit(db: Session, trip: Trip, *, user_id: str, reason: str = "edit") -> Trip:
    """写入新版本。调用前必须先 flush 内容变更，保证快照读到的是最新状态。"""
    db.flush()
    trip.revision = trip.revision + 1
    trip.updated_at = utcnow()
    db.flush()
    snapshot = build_snapshot(db, trip)
    db.add(
        TripRevision(
            trip_id=trip.id,
            revision=trip.revision,
            schema_version=SCHEMA_VERSION,
            reason=reason,
            snapshot=snapshot,
            redactions=[],
            created_by=user_id,
        )
    )
    db.commit()
    db.refresh(trip)
    return trip


def restore_snapshot(db: Session, trip: Trip, snapshot: dict[str, Any], *, user_id: str) -> Trip:
    """把快照内容写回为新的 revision。ID 保持不变，资产与分享引用不会断。"""
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise AppError("INVALID_REQUEST", "该历史版本的结构不受支持。")

    db.execute(delete(RouteLeg).where(RouteLeg.trip_id == trip.id))
    db.execute(delete(Stop).where(Stop.trip_id == trip.id))
    db.execute(delete(Place).where(Place.trip_id == trip.id))
    db.execute(delete(TripDay).where(TripDay.trip_id == trip.id))

    meta = snapshot.get("trip", {})
    trip.title = meta.get("title", trip.title)
    trip.start_date = date.fromisoformat(meta["start_date"])
    trip.end_date = date.fromisoformat(meta["end_date"])
    trip.timezone = meta.get("timezone", trip.timezone)
    trip.currency = meta.get("currency", trip.currency)
    trip.budget_minor = meta.get("budget_minor")
    trip.preferences = meta.get("preferences", {})

    for item in snapshot.get("days", []):
        db.add(
            TripDay(
                id=item["id"],
                trip_id=trip.id,
                date=date.fromisoformat(item["date"]),
                start_local_time=item.get("start_local_time", "09:00"),
                end_local_time=item.get("end_local_time", "20:00"),
                start_place_id=item.get("start_place_id"),
                end_place_id=item.get("end_place_id"),
                notes=item.get("notes"),
            )
        )
    for item in snapshot.get("places", []):
        db.add(
            Place(
                id=item["id"],
                owner_id=trip.owner_id,
                trip_id=trip.id,
                name=item.get("name", "未命名地点"),
                category=item.get("category", "attraction"),
                geometry=geostore.point_wkb(item.get("geometry")),
                navigation_geometry=geostore.point_wkb(item.get("navigation_geometry")),
                user_attributes=item.get("user_attributes", {}),
                notes=item.get("notes"),
                tags=item.get("tags", []),
                source=item.get("source", {"type": "user"}),
            )
        )
    db.flush()
    for item in snapshot.get("stops", []):
        fixed_start = item.get("fixed_start")
        db.add(
            Stop(
                id=item["id"],
                trip_id=trip.id,
                day_id=item.get("day_id"),
                place_id=item.get("place_id"),
                kind=item.get("kind", "attraction"),
                title=item.get("title", "未命名事项"),
                position=item.get("position", 0),
                duration_seconds=item.get("duration_seconds", 3600),
                priority=item.get("priority", "preferred"),
                locked_day=item.get("locked_day", False),
                locked_position=item.get("locked_position", False),
                fixed_start=_parse_dt(fixed_start),
                time_windows=item.get("time_windows", []),
                cost_minor=item.get("cost_minor"),
                notes=item.get("notes"),
                transport=item.get("transport", {}),
                source=item.get("source", {}),
            )
        )
    db.flush()
    for item in snapshot.get("route_legs", []):
        db.add(
            RouteLeg(
                id=item["id"],
                trip_id=trip.id,
                day_id=item.get("day_id"),
                from_stop_id=item.get("from_stop_id"),
                to_stop_id=item.get("to_stop_id"),
                from_place_id=item.get("from_place_id"),
                to_place_id=item.get("to_place_id"),
                mode=item.get("mode", "driving"),
                provider=item.get("provider", "manual"),
                status=item.get("status", "unknown"),
                distance_m=item.get("distance_m"),
                duration_seconds=item.get("duration_seconds"),
                geometry=geostore.line_wkb(item.get("geometry")),
                departure_at=_parse_dt(item.get("departure_at")),
                retrieved_at=_parse_dt(item.get("retrieved_at")),
                input_hash=item.get("input_hash"),
                source=item.get("source", {}),
            )
        )

    return commit(db, trip, user_id=user_id, reason="restore")


def _parse_dt(raw: str | None):
    if not raw:
        return None
    from datetime import datetime

    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        from datetime import timezone

        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def latest_snapshot(db: Session, trip_id: str, revision: int) -> dict[str, Any] | None:
    row = db.scalar(
        select(TripRevision).where(TripRevision.trip_id == trip_id, TripRevision.revision == revision)
    )
    return row.snapshot if row else None


def create_trip_from_snapshot(db: Session, *, owner_id: str, snapshot: dict[str, Any], title_suffix: str = "（副本）") -> Trip:
    """从快照复制一份新行程。所有主键重映射，避免与原行程冲突。"""
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise AppError("INVALID_REQUEST", "该快照的结构不受支持。")
    meta = snapshot.get("trip", {})
    trip = Trip(
        owner_id=owner_id,
        title=(str(meta.get("title") or "行程") + title_suffix)[:120],
        start_date=date.fromisoformat(meta["start_date"]),
        end_date=date.fromisoformat(meta["end_date"]),
        timezone=meta.get("timezone", "Asia/Shanghai"),
        currency=meta.get("currency", "CNY"),
        budget_minor=meta.get("budget_minor"),
        preferences=dict(meta.get("preferences") or {}),
        revision=1,
    )
    db.add(trip)
    db.flush()

    day_map: dict[str, str] = {}
    for item in snapshot.get("days", []):
        day = TripDay(
            trip_id=trip.id,
            date=date.fromisoformat(item["date"]),
            start_local_time=item.get("start_local_time", "09:00"),
            end_local_time=item.get("end_local_time", "20:00"),
            notes=item.get("notes"),
        )
        db.add(day)
        db.flush()
        day_map[item["id"]] = day.id

    place_map: dict[str, str] = {}
    for item in snapshot.get("places", []):
        place = Place(
            owner_id=owner_id,
            trip_id=trip.id,
            name=item.get("name", "未命名地点"),
            category=item.get("category", "attraction"),
            geometry=geostore.point_wkb(item.get("geometry")),
            navigation_geometry=geostore.point_wkb(item.get("navigation_geometry")),
            user_attributes=dict(item.get("user_attributes") or {}),
            notes=item.get("notes"),
            tags=list(item.get("tags") or []),
            source=dict(item.get("source") or {"type": "user"}),
        )
        db.add(place)
        db.flush()
        place_map[item["id"]] = place.id

    for item in snapshot.get("days", []):
        day = db.get(TripDay, day_map[item["id"]])
        if day is None:
            continue
        if item.get("start_place_id") in place_map:
            day.start_place_id = place_map[item["start_place_id"]]
        if item.get("end_place_id") in place_map:
            day.end_place_id = place_map[item["end_place_id"]]

    stop_map: dict[str, str] = {}
    for item in snapshot.get("stops", []):
        stop = Stop(
            trip_id=trip.id,
            day_id=day_map.get(item.get("day_id")) if item.get("day_id") else None,
            place_id=place_map.get(item.get("place_id")) if item.get("place_id") else None,
            kind=item.get("kind", "attraction"),
            title=item.get("title", "未命名事项"),
            position=item.get("position", 0),
            duration_seconds=item.get("duration_seconds", 3600),
            priority=item.get("priority", "preferred"),
            locked_day=item.get("locked_day", False),
            locked_position=item.get("locked_position", False),
            fixed_start=_parse_dt(item.get("fixed_start")),
            time_windows=list(item.get("time_windows") or []),
            cost_minor=item.get("cost_minor"),
            notes=item.get("notes"),
            transport=dict(item.get("transport") or {}),
            source=dict(item.get("source") or {}),
        )
        db.add(stop)
        db.flush()
        stop_map[item["id"]] = stop.id

    for item in snapshot.get("route_legs", []):
        db.add(
            RouteLeg(
                trip_id=trip.id,
                day_id=day_map.get(item.get("day_id")) if item.get("day_id") else None,
                from_stop_id=stop_map.get(item.get("from_stop_id")) if item.get("from_stop_id") else None,
                to_stop_id=stop_map.get(item.get("to_stop_id")) if item.get("to_stop_id") else None,
                from_place_id=place_map.get(item.get("from_place_id")) if item.get("from_place_id") else None,
                to_place_id=place_map.get(item.get("to_place_id")) if item.get("to_place_id") else None,
                mode=item.get("mode", "manual"),
                provider=item.get("provider", "manual"),
                status=item.get("status", "unknown"),
                distance_m=item.get("distance_m"),
                duration_seconds=item.get("duration_seconds"),
                geometry=geostore.line_wkb(item.get("geometry")),
                departure_at=_parse_dt(item.get("departure_at")),
                retrieved_at=_parse_dt(item.get("retrieved_at")),
                input_hash=item.get("input_hash"),
                source=dict(item.get("source") or {}),
            )
        )

    db.flush()
    snapshot_new = build_snapshot(db, trip)
    db.add(
        TripRevision(
            trip_id=trip.id,
            revision=1,
            schema_version=SCHEMA_VERSION,
            reason="clone-share",
            snapshot=snapshot_new,
            redactions=[],
            created_by=owner_id,
        )
    )
    db.commit()
    db.refresh(trip)
    return trip
