"""排程与冲突规则测试（不依赖数据库）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.timeline import Entry, schedule_sequence

TZ = timezone(timedelta(hours=8))


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 12, 1, hour, minute, tzinfo=TZ)


def entry(key: str, *, duration: int = 3600, fixed: datetime | None = None, windows=None) -> Entry:
    return Entry(
        key=key,
        ref=("stop", key),
        label=key,
        kind="attraction",
        duration_seconds=duration,
        fixed_start=fixed,
        windows=windows or [],
        cost_minor=None,
    )


def travel(seconds: int):
    def lookup(prev, cur):
        if prev is None:
            return 0, "start"
        return seconds, "manual"

    return lookup


def test_fixed_start_earlier_than_arrival_is_conflict() -> None:
    scheduled = schedule_sequence(
        day_start=at(10, 30),
        day_end=at(20),
        entries=[entry("A", fixed=at(10))],
        travel_lookup=travel(1800),
    )
    assert scheduled[0].arrival == at(10, 30)
    assert "LATE_FIXED_START" in scheduled[0].conflicts
    assert scheduled[0].start == at(10, 30)


def test_fixed_start_allows_waiting() -> None:
    scheduled = schedule_sequence(
        day_start=at(9),
        day_end=at(20),
        entries=[entry("A", fixed=at(11))],
        travel_lookup=travel(1800),
    )
    assert scheduled[0].start == at(11)
    assert scheduled[0].wait_seconds == 120 * 60


def test_opening_window_shifts_start() -> None:
    scheduled = schedule_sequence(
        day_start=at(9),
        day_end=at(20),
        entries=[entry("A", windows=[(at(10), at(12))])],
        travel_lookup=travel(600),
    )
    assert scheduled[0].start == at(10)
    assert scheduled[0].wait_seconds == 60 * 60


def test_window_missed_is_reported() -> None:
    scheduled = schedule_sequence(
        day_start=at(13),
        day_end=at(20),
        entries=[entry("A", windows=[(at(9), at(11))])],
        travel_lookup=travel(0),
    )
    assert "WINDOW_MISSED" in scheduled[0].conflicts
    assert scheduled[0].start == at(13)


def test_missing_travel_marks_arrival_unknown() -> None:
    scheduled = schedule_sequence(
        day_start=at(9),
        day_end=at(20),
        entries=[entry("A"), entry("B")],
        travel_lookup=lambda prev, cur: (0, "start") if prev is None else (None, None),
    )
    assert scheduled[1].arrival is None
    assert "MISSING_TRAVEL" in scheduled[1].conflicts


def test_sequence_accumulates_duration() -> None:
    scheduled = schedule_sequence(
        day_start=at(9),
        day_end=at(20),
        entries=[entry("A", duration=5400), entry("B", duration=1800)],
        travel_lookup=travel(600),
    )
    assert scheduled[0].end == at(10, 30)
    assert scheduled[1].start == at(10, 40)
    assert scheduled[1].end == at(11, 10)
