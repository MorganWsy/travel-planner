"""攻略快照、Markdown 与 DOCX 导出。

导出与分享都从 trip_revisions 中的同一条快照生成，避免“当前行程已改、导出的还是旧内容”
这类不一致。快照里只包含自有或用户自填字段。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import AppError
from ..models import Trip, TripRevision
from .timeline import Entry, schedule_sequence
from .timeutil import as_utc_or_none, local_dt, trip_zone

GUIDE_SCHEMA_VERSION = 1


def load_snapshot(db: Session, trip: Trip, revision: int | None) -> tuple[int, dict[str, Any]]:
    target = revision if revision is not None else trip.revision
    row = db.scalar(select(TripRevision).where(TripRevision.trip_id == trip.id, TripRevision.revision == target))
    if not row:
        raise AppError("NOT_FOUND", "该版本不存在。")
    return row.revision, row.snapshot


def _place_name(places: dict[str, dict], place_id: str | None) -> str | None:
    if not place_id:
        return None
    return places.get(place_id, {}).get("name")


def _transit_lookup(legs: list[dict], overrides: dict[str, int]):
    index: dict[tuple[tuple[str, str], tuple[str, str]], dict] = {}
    for leg in legs:
        if leg.get("duration_seconds") is None:
            continue
        # 与 timeline.Entry.ref 保持同一种键：(kind, id)。用字符串会永远匹配不上。
        start = ("stop", leg["from_stop_id"]) if leg.get("from_stop_id") else (
            ("place", leg["from_place_id"]) if leg.get("from_place_id") else None
        )
        end = ("stop", leg["to_stop_id"]) if leg.get("to_stop_id") else (
            ("place", leg["to_place_id"]) if leg.get("to_place_id") else None
        )
        if not start or not end:
            continue
        current = index.get((start, end))
        if current is None or (leg.get("provider") == "manual" and current.get("provider") != "manual"):
            index[(start, end)] = leg

    def lookup(prev, cur):
        if prev is None:
            return 0, "start"
        leg = index.get((prev, cur))
        if leg is not None:
            return int(leg["duration_seconds"]), f"{leg.get('provider')}:{leg.get('mode')}"
        if cur[1] in overrides:
            return overrides[cur[1]], "manual"
        return None, None

    return lookup


def build_guide(snapshot: dict[str, Any]) -> dict[str, Any]:
    meta = snapshot.get("trip", {})
    tz = trip_zone(meta.get("timezone", "Asia/Shanghai"))
    places = {p["id"]: p for p in snapshot.get("places", [])}
    stops = snapshot.get("stops", [])
    legs = snapshot.get("route_legs", [])

    overrides: dict[str, int] = {}
    for stop in stops:
        transport = stop.get("transport") or {}
        if transport.get("duration_seconds") is not None:
            overrides[stop["id"]] = int(transport["duration_seconds"])

    lookup = _transit_lookup(legs, overrides)
    days_out: list[dict[str, Any]] = []
    known_cost = 0
    unknown_cost = 0

    for day in snapshot.get("days", []):
        day_date = date.fromisoformat(day["date"])
        day_start = local_dt(day_date, day.get("start_local_time", "09:00"), tz)
        day_end = local_dt(day_date, day.get("end_local_time", "20:00"), tz)
        if day_end <= day_start:
            day_end += timedelta(days=1)

        day_stops = sorted(
            [s for s in stops if s.get("day_id") == day["id"]],
            key=lambda s: (s.get("position", 0), s.get("created_at", "")),
        )
        entries: list[Entry] = []
        for stop in day_stops:
            windows: list[tuple[datetime, datetime]] = []
            for window in stop.get("time_windows") or []:
                try:
                    if str(window.get("date")) != day_date.isoformat():
                        continue
                    start_dt = local_dt(day_date, str(window["start_local_time"]), tz)
                    end_dt = local_dt(day_date, str(window["end_local_time"]), tz)
                except (KeyError, ValueError):
                    continue
                if end_dt <= start_dt:
                    end_dt += timedelta(days=1)
                windows.append((start_dt, end_dt))
            entries.append(
                Entry(
                    key=stop["id"],
                    ref=("stop", stop["id"]),
                    label=stop.get("title", ""),
                    kind=stop.get("kind", "attraction"),
                    duration_seconds=int(stop.get("duration_seconds", 3600)),
                    fixed_start=as_utc_or_none(_parse_dt(stop.get("fixed_start"))),
                    windows=sorted(windows),
                    cost_minor=stop.get("cost_minor"),
                )
            )

        start_ref = ("place", day["start_place_id"]) if day.get("start_place_id") else None
        scheduled = schedule_sequence(
            day_start=day_start,
            day_end=day_end,
            entries=entries,
            travel_lookup=(lambda prev, cur: lookup(start_ref, cur)) if start_ref else lookup,
        )

        blocks: list[dict[str, Any]] = []
        travel_total = 0
        visit_total = 0
        day_known = 0
        day_unknown = 0
        conflicts: list[str] = []
        finish = day_start
        for item in scheduled:
            stop = next((s for s in day_stops if s["id"] == item.entry.key), {})
            if item.travel_seconds is not None:
                travel_total += item.travel_seconds
            if item.start and item.end:
                visit_total += int((item.end - item.start).total_seconds())
                finish = item.end
            if item.entry.cost_minor is None:
                day_unknown += 1
            else:
                day_known += item.entry.cost_minor
            conflicts.extend(item.conflicts)
            blocks.append(
                {
                    "stop_id": item.entry.key,
                    "title": item.entry.label,
                    "kind": item.entry.kind,
                    "place_name": _place_name(places, stop.get("place_id")),
                    "start": item.start.isoformat() if item.start else None,
                    "end": item.end.isoformat() if item.end else None,
                    "travel_seconds": item.travel_seconds,
                    "wait_seconds": item.wait_seconds,
                    "cost_minor": item.entry.cost_minor,
                    "notes": stop.get("notes"),
                }
            )
        known_cost += day_known
        unknown_cost += day_unknown
        days_out.append(
            {
                "day_id": day["id"],
                "date": day["date"],
                "start_local_time": day.get("start_local_time"),
                "end_local_time": day.get("end_local_time"),
                "start_time": day_start.isoformat(),
                "finish_time": finish.isoformat(),
                "blocks": blocks,
                "totals": {
                    "travel_seconds": travel_total,
                    "visit_seconds": visit_total,
                    "cost_known_minor": day_known,
                    "unknown_cost_count": day_unknown,
                },
                "conflicts": sorted(set(conflicts)),
                "notes": day.get("notes"),
            }
        )

    sources = sorted({_source_label(place.get("source") or {}) for place in places.values()})
    return {
        "schema_version": GUIDE_SCHEMA_VERSION,
        "trip_id": meta.get("id"),
        "revision": meta.get("revision"),
        "generated_at": datetime.now(tz).isoformat(),
        "title": meta.get("title"),
        "date_range": f"{meta.get('start_date')} 至 {meta.get('end_date')}",
        "timezone": meta.get("timezone"),
        "currency": meta.get("currency", "CNY"),
        "days": days_out,
        "budget": {
            "budget_minor": meta.get("budget_minor"),
            "known_minor": known_cost,
            "unknown_cost_count": unknown_cost,
        },
        "place_count": len(places),
        "sources": sources,
        "redactions": [],
        "warnings": [] if stops else ["该版本没有事项。"],
    }


_SOURCE_LABEL = {"user": "用户自建地点", "import": "文件导入", "tianditu": "天地图", "amap": "高德地图"}


def _source_label(source: dict) -> str:
    if source.get("attribution"):
        return str(source["attribution"])
    return _SOURCE_LABEL.get(str(source.get("type")), str(source.get("type") or "用户自建地点"))


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        from datetime import timezone

        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _money(minor: int | None, currency: str) -> str:
    if minor is None:
        return "未知"
    return f"{minor / 100:.2f} {currency}"


def _hhmm(iso: str | None) -> str:
    if not iso:
        return "—"
    return iso[11:16]


def render_markdown(guide: dict[str, Any]) -> str:
    currency = guide.get("currency", "CNY")
    lines: list[str] = []
    lines.append(f"# {guide.get('title') or '旅行攻略'}")
    lines.append("")
    lines.append(f"- 行程日期：{guide.get('date_range')}")
    lines.append(f"- 时区：{guide.get('timezone')}　货币：{currency}　版本：r{guide.get('revision')}")
    budget = guide.get("budget", {})
    lines.append(
        f"- 预算：{_money(budget.get('budget_minor'), currency)}　已知费用合计：{_money(budget.get('known_minor'), currency)}"
        f"　未记录费用项：{budget.get('unknown_cost_count', 0)} 项"
    )
    lines.append(f"- 生成时间：{guide.get('generated_at')}")
    lines.append("")
    lines.append("> 交通耗时来自手工录入或已保存的路线结果；缺失时标注“未设置”，不推测到达时间。")
    lines.append("")

    for day in guide.get("days", []):
        lines.append(f"## {day['date']}（{day.get('start_local_time')}–{day.get('end_local_time')}）")
        lines.append("")
        if not day["blocks"]:
            lines.append("_当天没有安排。_")
            lines.append("")
            continue
        lines.append("| 时间 | 事项 | 地点 | 交通 | 费用 | 备注 |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for block in day["blocks"]:
            travel = f"{block['travel_seconds'] // 60} 分钟" if block.get("travel_seconds") is not None else "未设置"
            span = f"{_hhmm(block.get('start'))}–{_hhmm(block.get('end'))}"
            notes = (block.get("notes") or "").replace("\n", " ").replace("|", "／")
            lines.append(
                f"| {span} | {block.get('title')} | {block.get('place_name') or '—'} | {travel} "
                f"| {_money(block.get('cost_minor'), currency)} | {notes or '—'} |"
            )
        lines.append("")
        totals = day["totals"]
        lines.append(
            f"当天交通 {totals['travel_seconds'] // 60} 分钟，停留 {totals['visit_seconds'] // 60} 分钟，"
            f"已知费用 {_money(totals['cost_known_minor'], currency)}，未记费用 {totals['unknown_cost_count']} 项。"
        )
        if day.get("conflicts"):
            lines.append("")
            lines.append(f"**需注意**：{'、'.join(_CONFLICT_TEXT.get(code, code) for code in day['conflicts'])}")
        lines.append("")

    lines.append("## 数据来源")
    lines.append("")
    for source in guide.get("sources", []):
        lines.append(f"- {source}")
    lines.append("")
    lines.append("地点名称为用户自建或用户从搜索结果复制，未保存供应商原始记录。")
    return "\n".join(lines).strip() + "\n"


_CONFLICT_TEXT = {
    "LATE_FIXED_START": "固定预约时间晚于预计到达",
    "WINDOW_MISSED": "开放时间窗口已错过",
    "DAY_OVERFLOW": "超出当天结束时间",
    "MISSING_TRAVEL": "缺少交通耗时",
    "MISSING_RETURN_TRAVEL": "缺少返回终点的交通耗时",
}


def render_docx(guide: dict[str, Any], path: str) -> None:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Pt

    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Microsoft YaHei"
    style.font.size = Pt(10.5)
    # 中文字体必须显式写入 eastAsia，否则 Word/WPS 会回退到宋体。
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), "Microsoft YaHei")

    heading = document.add_heading(guide.get("title") or "旅行攻略", level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.LEFT

    currency = guide.get("currency", "CNY")
    budget = guide.get("budget", {})
    meta_lines = [
        f"行程日期：{guide.get('date_range')}",
        f"时区：{guide.get('timezone')}　货币：{currency}　版本：r{guide.get('revision')}",
        f"预算：{_money(budget.get('budget_minor'), currency)}　已知费用：{_money(budget.get('known_minor'), currency)}",
        f"生成时间：{guide.get('generated_at')}",
    ]
    for line in meta_lines:
        document.add_paragraph(line)

    for day in guide.get("days", []):
        document.add_heading(f"{day['date']}（{day.get('start_local_time')}–{day.get('end_local_time')}）", level=2)
        if not day["blocks"]:
            document.add_paragraph("当天没有安排。")
            continue
        table = document.add_table(rows=1, cols=5)
        table.style = "Table Grid"
        table.autofit = True
        header = table.rows[0].cells
        for index, text in enumerate(["时间", "事项", "地点", "交通", "费用"]):
            header[index].text = text
        for block in day["blocks"]:
            row = table.add_row().cells
            row[0].text = f"{_hhmm(block.get('start'))}–{_hhmm(block.get('end'))}"
            row[1].text = f"{block.get('title')}" + (f"\n{block['notes']}" if block.get("notes") else "")
            row[2].text = block.get("place_name") or "—"
            row[3].text = f"{block['travel_seconds'] // 60} 分钟" if block.get("travel_seconds") is not None else "未设置"
            row[4].text = _money(block.get("cost_minor"), currency)
        totals = day["totals"]
        document.add_paragraph(
            f"当天交通 {totals['travel_seconds'] // 60} 分钟，停留 {totals['visit_seconds'] // 60} 分钟，"
            f"已知费用 {_money(totals['cost_known_minor'], currency)}，未记费用 {totals['unknown_cost_count']} 项。"
        )
        if day.get("conflicts"):
            document.add_paragraph(
                "需注意：" + "、".join(_CONFLICT_TEXT.get(code, code) for code in day["conflicts"])
            )

    document.add_heading("数据来源", level=2)
    for source in guide.get("sources", []):
        document.add_paragraph(source, style="List Bullet")
    document.add_paragraph("地点为自建或用户复制的数据，未保存供应商原始记录。")
    document.save(path)
