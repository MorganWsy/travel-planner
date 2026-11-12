"""攻略快照的排程计算（不依赖数据库）。"""

from __future__ import annotations

from app.services.guide import build_guide

SNAPSHOT = {
    "schema_version": 1,
    "trip": {
        "id": "t1",
        "title": "测试行程",
        "start_date": "2026-12-01",
        "end_date": "2026-12-01",
        "timezone": "Asia/Shanghai",
        "currency": "CNY",
        "budget_minor": 100000,
        "revision": 3,
        "preferences": {},
    },
    "days": [
        {
            "id": "d1",
            "date": "2026-12-01",
            "start_local_time": "09:00",
            "end_local_time": "20:00",
            "start_place_id": None,
            "end_place_id": None,
            "notes": None,
        }
    ],
    "places": [
        {"id": "p1", "name": "甲", "category": "attraction", "geometry": {"type": "Point", "coordinates": [115.88, 28.68]}, "source": {"type": "user"}},
        {"id": "p2", "name": "乙", "category": "attraction", "geometry": {"type": "Point", "coordinates": [115.90, 28.68]}, "source": {"type": "user"}},
    ],
    "stops": [
        {"id": "s1", "day_id": "d1", "place_id": "p1", "kind": "attraction", "title": "甲", "position": 0,
         "duration_seconds": 3600, "cost_minor": 5000, "time_windows": [], "transport": {}, "notes": None},
        {"id": "s2", "day_id": "d1", "place_id": "p2", "kind": "attraction", "title": "乙", "position": 1,
         "duration_seconds": 1800, "cost_minor": None, "time_windows": [], "transport": {}, "notes": None},
    ],
    "route_legs": [
        {"id": "l1", "day_id": "d1", "from_stop_id": "s1", "to_stop_id": "s2", "mode": "manual",
         "provider": "manual", "duration_seconds": 900, "distance_m": 1200},
    ],
}


def test_manual_leg_is_used_in_guide() -> None:
    guide = build_guide(SNAPSHOT)
    day = guide["days"][0]
    first, second = day["blocks"]
    assert first["travel_seconds"] == 0
    assert first["start"].endswith("09:00:00+08:00")
    assert second["travel_seconds"] == 900
    assert second["start"] is not None
    assert day["totals"]["travel_seconds"] == 900
    assert day["conflicts"] == []


def test_guide_reports_unknown_cost_and_source_label() -> None:
    guide = build_guide(SNAPSHOT)
    assert guide["budget"]["known_minor"] == 5000
    assert guide["budget"]["unknown_cost_count"] == 1
    assert guide["sources"] == ["用户自建地点"]
