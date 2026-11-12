"""行程事项接口：创建、编辑、跨天移动与排序。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import AuthContext, check_revision, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Place, RouteLeg, Stop, TripDay
from ..schemas import ReorderRequest, StopCreate, StopPatch, TripDetail
from ..services import trip_content

router = APIRouter()
settings = get_settings()


def _day(db: Session, trip_id: str, day_id: str) -> TripDay:
    day = db.scalar(select(TripDay).where(TripDay.id == day_id, TripDay.trip_id == trip_id))
    if not day:
        raise AppError("VALIDATION_ERROR", "指定的日期不属于该行程。")
    return day


def _check_limits(db: Session, trip_id: str, day_id: str | None, *, exclude: str | None = None) -> None:
    if day_id is None:
        count = len([s for s in trip_content.load_stops(db, trip_id) if s.day_id is None and s.id != exclude])
        if count >= settings.limits_max_candidates:
            raise AppError("VALIDATION_ERROR", f"候选池最多 {settings.limits_max_candidates} 个地点。")
        return
    count = len([s for s in trip_content.load_stops(db, trip_id) if s.day_id == day_id and s.id != exclude])
    if count >= settings.limits_max_stops_per_day:
        raise AppError("VALIDATION_ERROR", f"每天最多 {settings.limits_max_stops_per_day} 个事项。")


def _next_position(db: Session, trip_id: str, day_id: str | None) -> int:
    rows = [s for s in trip_content.load_stops(db, trip_id) if s.day_id == day_id]
    return max((s.position for s in rows), default=-1) + 1


def _assert_place(db: Session, trip_id: str, place_id: str | None) -> None:
    if not place_id:
        return
    if not db.scalar(select(Place.id).where(Place.id == place_id, Place.trip_id == trip_id)):
        raise AppError("VALIDATION_ERROR", "引用的地点不属于该行程。")


@router.post("/trips/{trip_id}/stops", response_model=TripDetail, status_code=201)
def create_stop(
    trip_id: str,
    payload: StopCreate,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    if payload.day_id:
        _day(db, trip.id, payload.day_id)
    _assert_place(db, trip.id, payload.place_id)
    _check_limits(db, trip.id, payload.day_id)

    stop = Stop(
        trip_id=trip.id,
        day_id=payload.day_id,
        place_id=payload.place_id,
        kind=payload.kind,
        title=payload.title.strip(),
        position=_next_position(db, trip.id, payload.day_id),
        duration_seconds=payload.duration_seconds,
        priority=payload.priority,
        locked_day=payload.locked_day,
        locked_position=payload.locked_position,
        fixed_start=payload.fixed_start,
        time_windows=[w.model_dump(mode="json") for w in payload.time_windows],
        cost_minor=payload.cost_minor,
        notes=payload.notes,
        transport=payload.transport or {},
        source={"type": "user"},
    )
    db.add(stop)
    trip_content.commit(db, trip, user_id=auth.user.id, reason="stop-create")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.patch("/trips/{trip_id}/stops/{stop_id}", response_model=TripDetail)
def patch_stop(
    trip_id: str,
    stop_id: str,
    payload: StopPatch,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    stop = db.scalar(select(Stop).where(Stop.id == stop_id, Stop.trip_id == trip.id))
    if not stop:
        raise AppError("NOT_FOUND", "事项不存在。")

    if payload.day_id is not None and payload.day_id != "":
        if payload.day_id != stop.day_id:
            if stop.locked_day:
                raise AppError("VALIDATION_ERROR", "该事项已锁定日期，需先解锁。")
            _day(db, trip.id, payload.day_id)
            _check_limits(db, trip.id, payload.day_id, exclude=stop.id)
            stop.position = _next_position(db, trip.id, payload.day_id)
            stop.day_id = payload.day_id
    if payload.place_id is not None:
        if payload.place_id == "":
            stop.place_id = None
        else:
            _assert_place(db, trip.id, payload.place_id)
            stop.place_id = payload.place_id
    if payload.kind is not None:
        stop.kind = payload.kind
    if payload.title is not None:
        stop.title = payload.title.strip()
    if payload.duration_seconds is not None:
        stop.duration_seconds = payload.duration_seconds
    if payload.priority is not None:
        stop.priority = payload.priority
    if payload.locked_day is not None:
        stop.locked_day = payload.locked_day
    if payload.locked_position is not None:
        stop.locked_position = payload.locked_position
    if payload.clear_fixed_start:
        stop.fixed_start = None
    elif payload.fixed_start is not None:
        stop.fixed_start = payload.fixed_start
    if payload.time_windows is not None:
        stop.time_windows = [w.model_dump(mode="json") for w in payload.time_windows]
    if payload.cost_minor is not None:
        stop.cost_minor = payload.cost_minor
    if payload.notes is not None:
        stop.notes = payload.notes
    if payload.transport is not None:
        stop.transport = payload.transport

    trip_content.commit(db, trip, user_id=auth.user.id, reason="stop-edit")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


@router.delete("/trips/{trip_id}/stops/{stop_id}", response_model=TripDetail)
def delete_stop(
    trip_id: str,
    stop_id: str,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    stop = db.scalar(select(Stop).where(Stop.id == stop_id, Stop.trip_id == trip.id))
    if not stop:
        raise AppError("NOT_FOUND", "事项不存在。")
    day_id = stop.day_id
    place_id = stop.place_id
    db.delete(stop)
    db.execute(
        delete(RouteLeg).where(
            RouteLeg.trip_id == trip.id,
            (RouteLeg.from_stop_id == stop_id) | (RouteLeg.to_stop_id == stop_id),
        )
    )
    db.flush()
    # 删掉事项后，如果这个地点再没有别的引用，就一并删掉：
    # 否则地图上的标注和左栏「本行程地点」会留着一个已经不在行程里的点，
    # 用户看到的就是「删了没反应」。
    if place_id:
        still_used = db.scalar(
            select(Stop.id).where(Stop.trip_id == trip.id, Stop.place_id == place_id).limit(1)
        )
        if not still_used:
            place = db.scalar(select(Place).where(Place.id == place_id, Place.trip_id == trip.id))
            if place:
                db.delete(place)
                db.flush()
    _resequence(db, trip.id, day_id)
    trip_content.commit(db, trip, user_id=auth.user.id, reason="stop-delete")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)


def _resequence(db: Session, trip_id: str, day_id: str | None) -> None:
    rows = [s for s in trip_content.load_stops(db, trip_id) if s.day_id == day_id]
    for index, stop in enumerate(sorted(rows, key=lambda s: (s.position, s.created_at))):
        stop.position = index


@router.post("/trips/{trip_id}/reorder-stops", response_model=TripDetail)
def reorder_stops(
    trip_id: str,
    payload: ReorderRequest,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)

    all_stops = {s.id: s for s in trip_content.load_stops(db, trip.id)}
    container_ids = [c.day_id for c in payload.containers]
    if len(set(container_ids)) != len(container_ids):
        raise AppError("VALIDATION_ERROR", "同一日期不能出现在多个容器中。")
    for day_id in container_ids:
        if day_id:
            _day(db, trip.id, day_id)

    submitted: list[str] = []
    for container in payload.containers:
        submitted.extend(container.stop_ids)
    if len(set(submitted)) != len(submitted):
        raise AppError("VALIDATION_ERROR", "同一个事项不能重复出现在多个容器中。")
    unknown = [sid for sid in submitted if sid not in all_stops]
    if unknown:
        raise AppError("VALIDATION_ERROR", "存在不属于该行程的事项。", details={"stop_ids": unknown})

    current = {
        day_id: [s.id for s in sorted([x for x in all_stops.values() if x.day_id == day_id], key=lambda s: (s.position, s.created_at))]
        for day_id in container_ids
    }
    submitted_map = {c.day_id: c.stop_ids for c in payload.containers}
    current_union = {sid for ids in current.values() for sid in ids}
    submitted_union = set(submitted)
    if current_union != submitted_union:
        raise AppError(
            "VALIDATION_ERROR",
            "排序请求必须覆盖受影响容器的全部事项，且不能夹带其他容器的内容。",
            details={
                "missing": sorted(current_union - submitted_union),
                "unexpected": sorted(submitted_union - current_union),
            },
        )
    for day_id, ids in submitted_map.items():
        if day_id and len(ids) > settings.limits_max_stops_per_day:
            raise AppError("VALIDATION_ERROR", f"每天最多 {settings.limits_max_stops_per_day} 个事项。")

    # 锁定校验：锁定日期的事项不能换天；锁定顺序的事项相对次序不得改变。
    for day_id, ids in submitted_map.items():
        for stop_id in ids:
            stop = all_stops[stop_id]
            if stop.locked_day and stop.day_id != day_id:
                raise AppError("VALIDATION_ERROR", f"事项“{stop.title}”已锁定日期，需先解锁。")
            if stop.locked_position and stop.day_id != day_id:
                raise AppError("VALIDATION_ERROR", f"事项“{stop.title}”已锁定顺序，不能换天。")
    for old_day, old_ids in current.items():
        new_ids = submitted_map.get(old_day, [])
        for sid in old_ids:
            if not all_stops[sid].locked_position:
                continue
            # 锁定顺序的含义是该事项在当天序列中的位置不变，插入或删除都不允许。
            if sid not in new_ids or new_ids.index(sid) != old_ids.index(sid):
                raise AppError(
                    "VALIDATION_ERROR",
                    f"事项“{all_stops[sid].title}”已锁定顺序，需先解锁再调整。",
                )

    for day_id, ids in submitted_map.items():
        for index, stop_id in enumerate(ids):
            stop = all_stops[stop_id]
            stop.day_id = day_id
            stop.position = index

    # 供应商路线可能带几何，顺序变了就不再相邻，删除避免地图画出过期路径；
    # 用户手工录入的耗时保留：若两个事项仍相邻可以继续用，不相邻时排程不会取到它。
    affected = set(submitted_map.keys())
    db.execute(
        delete(RouteLeg).where(
            RouteLeg.trip_id == trip.id,
            RouteLeg.provider != "manual",
            RouteLeg.day_id.in_([d for d in affected if d]),
        )
    )
    trip_content.commit(db, trip, user_id=auth.user.id, reason="reorder")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)
