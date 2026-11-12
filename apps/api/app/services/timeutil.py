"""时间工具。

SQLite 会把带时区的时间存成无时区字符串，取回后必须显式补 UTC，
否则与 aware datetime 比较会抛 TypeError。所有读取数据库时间的地方都走 as_utc()。
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def as_utc_or_none(value: datetime | None) -> datetime | None:
    return as_utc(value) if value else None


def trip_zone(name: str) -> tzinfo:
    """返回行程时区。Windows 无系统 tzdata 时退回固定 +08:00，保证功能可用。"""
    for candidate in (name, "Asia/Shanghai"):
        try:
            return ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return timezone(timedelta(hours=8), name="UTC+08:00")


def local_dt(day: date, hhmm: str, tz: ZoneInfo) -> datetime:
    hour, minute = (int(part) for part in hhmm.split(":"))
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=tz)


def to_local(value: datetime, tz: ZoneInfo) -> datetime:
    return as_utc(value).astimezone(tz)


def to_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def day_end_of(day: date, hhmm: str, tz: ZoneInfo) -> datetime:
    """结束时间早于开始时间时视为跨到次日（例如 02:00 收工）。"""
    return local_dt(day, hhmm, tz)


def human_duration(seconds: int) -> str:
    minutes = max(int(round(seconds / 60)), 0)
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours}小时{mins}分"
    if hours:
        return f"{hours}小时"
    return f"{mins}分钟"


def ceil_minute(value: datetime) -> datetime:
    if value.second == 0 and value.microsecond == 0:
        return value
    return (value + timedelta(minutes=1)).replace(second=0, microsecond=0)
