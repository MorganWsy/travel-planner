"""单日行程排序优化（启发式）。

说明：本实现不承诺全局最优。它在“当天起终点 + 时间窗 + 固定预约 + 锁定项”约束下
用 2-opt / Or-opt 局部搜索降低总交通耗时，并返回可解释的冲突。
矩阵来源有两种：真实路网（高德 /v3/distance）或直线估算；估算结果必须在 assumptions 中标注。
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import utcnow
from ..errors import AppError
from ..models import Place, Stop, Trip
from ..providers import registry
from ..schemas import OptimizationDayPlan, OptimizationResult, OptimizationStopPlan
from . import geostore
from .geo import haversine_m, point_coords
from .timeutil import as_utc_or_none, local_dt, trip_zone

settings = get_settings()


@dataclass
class Node:
    index: int
    stop_id: str
    title: str
    coords: tuple[float, float] | None
    duration_seconds: int
    fixed_start: datetime | None
    windows: list[tuple[datetime, datetime]]
    locked: bool
    position: int


@dataclass
class Simulation:
    starts: list[datetime | None] = field(default_factory=list)
    arrivals: list[datetime | None] = field(default_factory=list)
    ends: list[datetime | None] = field(default_factory=list)
    travels: list[int | None] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    penalty: float = 0.0
    finish: datetime | None = None
    travel_total: int = 0


def _matrix_estimate(nodes: list[Node], mode: str) -> tuple[dict[tuple[int, int], int | None], str, list[str]]:
    factor = settings.estimate_detour_factor
    speed = settings.estimate_walking_kmh if mode == "walking" else settings.estimate_driving_kmh
    matrix: dict[tuple[int, int], int | None] = {}
    for a in nodes:
        for b in nodes:
            if a.index == b.index:
                matrix[(a.index, b.index)] = 0
                continue
            if not a.coords or not b.coords:
                matrix[(a.index, b.index)] = None
                continue
            distance = haversine_m(a.coords[0], a.coords[1], b.coords[0], b.coords[1])
            matrix[(a.index, b.index)] = int(distance * factor / (speed * 1000 / 3600))
    assumptions = [
        f"交通耗时按直线距离 × {factor} 绕行系数 / {speed} km/h 估算，不是真实路网结果。",
        "估算模式不反映实时路况与单行道限制，仅用于排序比较。",
    ]
    return matrix, "estimate", assumptions


def _matrix_amap(nodes: list[Node], mode: str) -> tuple[dict[tuple[int, int], int | None], str, list[str]]:
    adapter = registry.adapters()["amap"]
    if not adapter.configured:
        raise AppError("PROVIDER_NOT_CONFIGURED", "未配置高德 Key，无法获取真实路网矩阵，可改用估算模式。")
    matrix: dict[tuple[int, int], int | None] = {}
    assumptions = ["交通耗时为高德 /v3/distance 静态查询结果，未验证未来路况。"]
    for node in nodes:
        matrix[(node.index, node.index)] = 0
    for dest in nodes:
        if not dest.coords:
            for origin in nodes:
                matrix[(origin.index, dest.index)] = None
            continue
        origins = [n for n in nodes if n.coords]
        payload = adapter.distance_matrix(
            origins=[n.coords for n in origins if n.coords],
            destination=dest.coords,
            mode=mode,
        )
        for origin, seconds in zip(origins, payload, strict=False):
            matrix[(origin.index, dest.index)] = seconds
    return matrix, "amap", assumptions


def build_matrix(nodes: list[Node], *, mode: str, provider: str) -> tuple[dict[tuple[int, int], int | None], str, list[str]]:
    if provider == "amap":
        return _matrix_amap(nodes, mode)
    return _matrix_estimate(nodes, mode)


def _simulate(
    order: list[Node],
    *,
    matrix: dict[tuple[int, int], int | None],
    start_node: Node | None,
    end_node: Node | None,
    day_start: datetime,
    day_end: datetime,
) -> Simulation:
    result = Simulation()
    cursor = day_start
    prev = start_node
    for node in order:
        if prev is None:
            travel = 0
        else:
            travel = matrix.get((prev.index, node.index))
        if travel is None:
            result.conflicts.append("MISSING_TRAVEL")
            arrival = None
        else:
            arrival = cursor + timedelta(seconds=travel)
            result.travel_total += travel
        start: datetime | None
        if node.fixed_start is not None:
            if arrival is not None and arrival > node.fixed_start:
                result.conflicts.append("LATE_FIXED_START")
                result.penalty += 1_000_000 + (arrival - node.fixed_start).total_seconds() * 10
                start = arrival
            else:
                start = node.fixed_start
        elif node.windows and arrival is not None:
            start = None
            for window_start, window_end in node.windows:
                candidate = max(arrival, window_start)
                if candidate < window_end:
                    start = candidate
                    break
            if start is None:
                result.conflicts.append("WINDOW_MISSED")
                result.penalty += 500_000
                start = arrival
        else:
            start = arrival
        end = start + timedelta(seconds=node.duration_seconds) if start else None
        result.arrivals.append(arrival)
        result.starts.append(start)
        result.ends.append(end)
        result.travels.append(travel)
        if end:
            cursor = end
        prev = node

    if end_node is not None and order:
        travel = matrix.get((prev.index, end_node.index))
        if travel is None:
            result.conflicts.append("MISSING_RETURN_TRAVEL")
        else:
            cursor = cursor + timedelta(seconds=travel)
            result.travel_total += travel
    result.finish = cursor
    if cursor > day_end:
        result.conflicts.append("DAY_OVERFLOW")
        result.penalty += (cursor - day_end).total_seconds() * 100
    result.penalty += result.travel_total
    return result


def optimize_day(
    db: Session,
    trip: Trip,
    *,
    day_id: str,
    mode: str,
    provider: str,
) -> OptimizationResult:
    from . import trip_content
    from .timeline import _windows_for

    tz = trip_zone(trip.timezone)
    day = next((d for d in trip_content.load_days(db, trip.id) if d.id == day_id), None)
    if not day:
        raise AppError("NOT_FOUND", "日期不存在。")
    places: dict[str, Place] = {p.id: p for p in trip_content.load_places(db, trip.id)}
    stops = sorted([s for s in trip_content.load_stops(db, trip.id) if s.day_id == day_id], key=lambda s: (s.position, s.created_at))
    if not stops:
        raise AppError("VALIDATION_ERROR", "当天没有可优化的事项。")
    if len(stops) > 12:
        raise AppError("OPTIMIZATION_LIMIT", "单日优化最多 12 个事项，请先分日或减少事项。")

    day_start = local_dt(day.date, day.start_local_time, tz)
    day_end = local_dt(day.date, day.end_local_time, tz)
    if day_end <= day_start:
        day_end += timedelta(days=1)

    start_node = None
    end_node = None
    next_index = 0
    if day.start_place_id and day.start_place_id in places:
        start_node = Node(
            index=next_index,
            stop_id="__day_start__",
            title="当天起点",
            coords=point_coords(geostore.to_geojson(places[day.start_place_id].navigation_geometry))
            or point_coords(geostore.to_geojson(places[day.start_place_id].geometry)),
            duration_seconds=0,
            fixed_start=None,
            windows=[],
            locked=True,
            position=-1,
        )
        next_index += 1
    if day.end_place_id and day.end_place_id in places:
        end_node = Node(
            index=next_index,
            stop_id="__day_end__",
            title="当天终点",
            coords=point_coords(geostore.to_geojson(places[day.end_place_id].navigation_geometry))
            or point_coords(geostore.to_geojson(places[day.end_place_id].geometry)),
            duration_seconds=0,
            fixed_start=None,
            windows=[],
            locked=True,
            position=10_000,
        )
        next_index += 1

    nodes: list[Node] = []
    for stop in stops:
        place = places.get(stop.place_id) if stop.place_id else None
        coords = None
        if place:
            coords = point_coords(geostore.to_geojson(place.navigation_geometry)) or point_coords(
                geostore.to_geojson(place.geometry)
            )
        nodes.append(
            Node(
                index=next_index,
                stop_id=stop.id,
                title=stop.title,
                coords=coords,
                duration_seconds=stop.duration_seconds,
                fixed_start=as_utc_or_none(stop.fixed_start),
                windows=_windows_for(stop, day.date, tz),
                locked=stop.locked_position,
                position=stop.position,
            )
        )
        next_index += 1

    all_nodes = ([start_node] if start_node else []) + nodes + ([end_node] if end_node else [])
    matrix, matrix_source, assumptions = build_matrix(all_nodes, mode=mode, provider=provider)

    movable = [n for n in nodes if not n.locked]
    best_order = sorted(nodes, key=lambda n: n.position)
    best = _simulate(best_order, matrix=matrix, start_node=start_node, end_node=end_node, day_start=day_start, day_end=day_end)
    best_cost = best.penalty

    deadline = time.monotonic() + 2.0
    improved = True
    while improved and time.monotonic() < deadline:
        improved = False
        # Or-opt：把单个可移动节点插到其他位置
        for node in movable:
            for target in range(len(best_order)):
                candidate = [n for n in best_order if n is not node]
                candidate.insert(target, node)
                if not _locks_ok(candidate):
                    continue
                sim = _simulate(candidate, matrix=matrix, start_node=start_node, end_node=end_node, day_start=day_start, day_end=day_end)
                if sim.penalty + 1e-6 < best_cost:
                    best_order, best, best_cost = candidate, sim, sim.penalty
                    improved = True
                    break
            if improved:
                break
        if improved:
            continue
        # 2-opt：反转可移动区段
        for i in range(len(best_order) - 1):
            for j in range(i + 1, len(best_order)):
                candidate = best_order[:i] + list(reversed(best_order[i : j + 1])) + best_order[j + 1 :]
                if not _locks_ok(candidate):
                    continue
                sim = _simulate(candidate, matrix=matrix, start_node=start_node, end_node=end_node, day_start=day_start, day_end=day_end)
                if sim.penalty + 1e-6 < best_cost:
                    best_order, best, best_cost = candidate, sim, sim.penalty
                    improved = True
                    break
            if improved:
                break

    input_hash = compute_input_hash(db, trip, day_id=day_id, mode=mode, provider=provider)

    plans = [
        OptimizationStopPlan(
            stop_id=node.stop_id,
            title=node.title,
            position=index,
            arrival=best.arrivals[index],
            start=best.starts[index],
            end=best.ends[index],
            travel_seconds=best.travels[index],
        )
        for index, node in enumerate(best_order)
    ]
    solver_status = "infeasible" if any(code in ("LATE_FIXED_START", "WINDOW_MISSED") for code in best.conflicts) else (
        "time_limit" if time.monotonic() >= deadline else "feasible"
    )
    if solver_status == "infeasible" and not best_order:
        raise AppError("VALIDATION_ERROR", "没有可排程的事项。")

    conflict_rows = [{"code": code, "day_id": day_id} for code in sorted(set(best.conflicts))]
    return OptimizationResult(
        input_revision=trip.revision,
        input_hash=input_hash,
        solver_status=solver_status,
        matrix_source=matrix_source,
        days=[
            OptimizationDayPlan(
                day_id=day_id,
                date=day.date,
                stops=plans,
                travel_seconds=best.travel_total,
                finish=best.finish,
            )
        ],
        unassigned=[],
        conflicts=conflict_rows,
        totals={
            "travel_seconds": best.travel_total,
            "stop_count": len(best_order),
            "finish": best.finish.isoformat() if best.finish else None,
        },
        assumptions=assumptions,
    )


def _locks_ok(order: list[Node]) -> bool:
    locked_positions = [n.index for n in order if n.locked]
    return locked_positions == sorted(locked_positions)


def compute_input_hash(db: Session, trip: Trip, *, day_id: str, mode: str, provider: str) -> str:
    from . import trip_content

    stops = sorted(
        [s for s in trip_content.load_stops(db, trip.id) if s.day_id == day_id],
        key=lambda s: (s.position, s.created_at),
    )
    payload = {
        "revision": trip.revision,
        "day": day_id,
        "mode": mode,
        "provider": provider,
        "stops": [
            {
                "id": s.id,
                "title": s.title,
                "duration": s.duration_seconds,
                "priority": s.priority,
                "fixed_start": s.fixed_start.isoformat() if s.fixed_start else None,
                "windows": s.time_windows,
                "place": s.place_id,
            }
            for s in stops
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
