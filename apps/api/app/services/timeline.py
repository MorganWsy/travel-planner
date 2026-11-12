"""行程时间推算与冲突检测。

规则（对应方案 7.1）：
- 从当天开始时间顺推：交通 → 等待开放 → 停留 → 下一项。
- 固定预约：早到允许等待，晚到记冲突，不悄悄压缩停留。
- 没有交通耗时（无路网结果且无手工录入）时，到达时间标为不确定，不给出伪精确时间。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Place, Stop, Trip
from ..schemas import DayTimeline, TimelineBlock, TimelineOut
from . import trip_content
from .timeutil import as_utc, as_utc_or_none, local_dt, trip_zone

Ref = tuple[str, str] | None


@dataclass
class Entry:
    key: str
    ref: Ref
    label: str
    kind: str
    duration_seconds: int
    fixed_start: datetime | None
    windows: list[tuple[datetime, datetime]]
    cost_minor: int | None


@dataclass
class Scheduled:
    entry: Entry
    arrival: datetime | None
    start: datetime | None
    end: datetime | None
    travel_seconds: int | None
    travel_source: str | None
    wait_seconds: int
    conflicts: list[str] = field(default_factory=list)


def _leg_index(db: Session, trip_id: str) -> dict[tuple[Ref, Ref], object]:
    """按 (起点引用, 终点引用) 建索引。手工录入优先于供应商结果，同源取最近一次。"""
    index: dict[tuple[Ref, Ref], object] = {}
    for leg in trip_content.load_legs(db, trip_id):
        if leg.duration_seconds is None:
            continue
        start: Ref = ("stop", leg.from_stop_id) if leg.from_stop_id else (
            ("place", leg.from_place_id) if leg.from_place_id else None
        )
        end: Ref = ("stop", leg.to_stop_id) if leg.to_stop_id else (
            ("place", leg.to_place_id) if leg.to_place_id else None
        )
        if start is None or end is None:
            continue
        current = index.get((start, end))
        index[(start, end)] = leg if _leg_rank(leg) >= _leg_rank(current) else current
    return index


def _leg_rank(leg) -> tuple[int, float]:
    if leg is None:
        return (-1, 0.0)
    manual = 1 if leg.provider == "manual" else 0
    stamp = as_utc(leg.retrieved_at).timestamp() if leg.retrieved_at else 0.0
    return (manual, stamp)


def _travel_lookup(index, manual_overrides: dict[Ref, int]):
    def lookup(prev: Ref, cur: Ref) -> tuple[int | None, str | None]:
        if prev is None:
            return 0, "start"
        leg = index.get((prev, cur))
        if leg is not None:
            return int(leg.duration_seconds or 0), f"{leg.provider}:{leg.mode}"
        if cur in manual_overrides:
            return manual_overrides[cur], "manual"
        return None, None

    return lookup


def schedule_sequence(
    *,
    day_start: datetime,
    day_end: datetime,
    entries: list[Entry],
    travel_lookup,
) -> list[Scheduled]:
    result: list[Scheduled] = []
    cursor = day_start
    prev: Ref = None
    for entry in entries:
        travel, source = travel_lookup(prev, entry.ref)
        conflicts: list[str] = []
        if travel is None:
            arrival = None
            conflicts.append("MISSING_TRAVEL")
        else:
            arrival = cursor + timedelta(seconds=travel)

        start: datetime | None
        wait = 0
        if entry.fixed_start is not None:
            fixed = entry.fixed_start
            if arrival is not None and arrival > fixed:
                conflicts.append("LATE_FIXED_START")
                start = arrival
            else:
                start = fixed
                if arrival is not None:
                    wait = int((fixed - arrival).total_seconds())
        elif entry.windows:
            start = None
            if arrival is not None:
                for window_start, window_end in entry.windows:
                    candidate = max(arrival, window_start)
                    if candidate < window_end:
                        start = candidate
                        wait = int((candidate - arrival).total_seconds())
                        break
                if start is None:
                    conflicts.append("WINDOW_MISSED")
                    start = arrival
        else:
            start = arrival

        end = start + timedelta(seconds=entry.duration_seconds) if start else None
        result.append(
            Scheduled(
                entry=entry,
                arrival=arrival,
                start=start,
                end=end,
                travel_seconds=travel,
                travel_source=source,
                wait_seconds=wait,
                conflicts=conflicts,
            )
        )
        if end is not None:
            cursor = end
        prev = entry.ref
    return result


def compute_timeline(db: Session, trip: Trip, *, day_id: str | None = None) -> TimelineOut:
    tz = trip_zone(trip.timezone)
    places: dict[str, Place] = {p.id: p for p in trip_content.load_places(db, trip.id)}
    stops = trip_content.load_stops(db, trip.id)
    days = trip_content.load_days(db, trip.id)
    legacy_index = _leg_index(db, trip.id)
    manual_overrides: dict[Ref, int] = {}
    for stop in stops:
        transport = stop.transport or {}
        if transport.get("duration_seconds") is not None:
            manual_overrides[("stop", stop.id)] = int(transport["duration_seconds"])
    travel_lookup = _travel_lookup(legacy_index, manual_overrides)

    day_results: list[DayTimeline] = []
    for day in days:
        if day_id and day.id != day_id:
            continue
        day_start = local_dt(day.date, day.start_local_time, tz)
        day_end = local_dt(day.date, day.end_local_time, tz)
        if day_end <= day_start:
            day_end += timedelta(days=1)

        day_stops = sorted([s for s in stops if s.day_id == day.id], key=lambda s: (s.position, s.created_at))
        entries: list[Entry] = []
        for stop in day_stops:
            place = places.get(stop.place_id) if stop.place_id else None
            ref: Ref = ("stop", stop.id)
            entries.append(
                Entry(
                    key=stop.id,
                    ref=ref,
                    label=stop.title,
                    kind=stop.kind,
                    duration_seconds=stop.duration_seconds,
                    fixed_start=as_utc_or_none(stop.fixed_start),
                    windows=_windows_for(stop, day.date, tz),
                    cost_minor=stop.cost_minor,
                )
            )

        start_ref: Ref = ("place", day.start_place_id) if day.start_place_id else None
        if start_ref:
            travel_lookup_for_day = _with_start(travel_lookup, start_ref)
        else:
            travel_lookup_for_day = travel_lookup

        scheduled = schedule_sequence(
            day_start=day_start,
            day_end=day_end,
            entries=entries,
            travel_lookup=travel_lookup_for_day,
        )

        conflicts: list[str] = []
        blocks: list[TimelineBlock] = []
        travel_total = 0
        visit_total = 0
        cost_total = 0
        unknown_cost = 0
        uncertain = False
        finish: datetime | None = day_start

        for item in scheduled:
            if item.travel_seconds is None:
                uncertain = True
            else:
                travel_total += item.travel_seconds
            if item.start is None:
                uncertain = True
            if item.start and item.end:
                visit_total += int((item.end - item.start).total_seconds())
                finish = item.end
            if item.entry.cost_minor is None:
                unknown_cost += 1
            else:
                cost_total += item.entry.cost_minor
            conflicts.extend(item.conflicts)
            blocks.append(
                TimelineBlock(
                    stop_id=item.entry.key,
                    title=item.entry.label,
                    kind=item.entry.kind,
                    place_id=next((s.place_id for s in day_stops if s.id == item.entry.key), None),
                    start=item.start,
                    end=item.end,
                    travel_seconds=item.travel_seconds,
                    travel_source=item.travel_source,
                    wait_seconds=item.wait_seconds,
                    cost_minor=item.entry.cost_minor,
                    position=next((s.position for s in day_stops if s.id == item.entry.key), 0),
                    status="uncertain" if "MISSING_TRAVEL" in item.conflicts else ("late" if item.conflicts else "ok"),
                    conflicts=item.conflicts,
                )
            )

        if day.end_place_id and day.end_place_id in places and day_stops:
            last_stop = day_stops[-1]
            travel, _ = travel_lookup(("stop", last_stop.id), ("place", day.end_place_id))
            if travel is None:
                uncertain = True
                conflicts.append("MISSING_RETURN_TRAVEL")
            elif finish is not None:
                finish = finish + timedelta(seconds=travel)
                travel_total += travel

        if finish is not None and finish > day_end:
            conflicts.append("DAY_OVERFLOW")

        deduped = sorted(set(conflicts))
        day_results.append(
            DayTimeline(
                day_id=day.id,
                date=day.date,
                start=day_start,
                end=finish,
                free_seconds=max(int((day_end - finish).total_seconds()), 0) if finish else None,
                travel_seconds=travel_total,
                visit_seconds=visit_total,
                cost_known_minor=cost_total,
                unknown_cost_count=unknown_cost,
                uncertain=uncertain,
                blocks=blocks,
                conflicts=deduped,
            )
        )

    warnings: list[str] = []
    if any(day.uncertain for day in day_results):
        warnings.append("部分日期缺少交通耗时，到达时间为估算或未知，请补充交通或查询路线。")
    return TimelineOut(trip_id=trip.id, revision=trip.revision, days=day_results, warnings=warnings)


def _with_start(lookup, start_ref: Ref):
    def wrapped(prev: Ref, cur: Ref):
        if prev is None:
            return lookup(start_ref, cur)
        return lookup(prev, cur)

    return wrapped


def _windows_for(stop: Stop, day: date, tz) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    for window in stop.time_windows or []:
        try:
            if str(window.get("date")) != day.isoformat():
                continue
            start = local_dt(day, str(window["start_local_time"]), tz)
            end = local_dt(day, str(window["end_local_time"]), tz)
        except (KeyError, ValueError):
            continue
        if end <= start:
            end += timedelta(days=1)
        windows.append((start, end))
    return sorted(windows)
