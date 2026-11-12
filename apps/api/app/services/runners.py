"""任务处理器：优化与导出。

处理器接收独立 Session，避免复用请求线程的会话。
"""

from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import utcnow
from ..errors import AppError
from ..models import ExportRecord, Job, Trip
from . import guide as guide_service
from .optimize import optimize_day

settings = get_settings()


def _load_trip(db: Session, job: Job) -> Trip:
    trip = db.get(Trip, job.trip_id) if job.trip_id else None
    if not trip or trip.deleted_at is not None:
        raise AppError("NOT_FOUND", "行程不存在。")
    if trip.owner_id != job.owner_id:
        raise AppError("NOT_FOUND", "行程不存在。")
    return trip


def run_optimization(db: Session, job: Job) -> dict[str, Any]:
    trip = _load_trip(db, job)
    if job.input_revision is not None and trip.revision != job.input_revision:
        raise AppError(
            "REVISION_CONFLICT",
            "行程在优化期间已被修改，请重新发起优化。",
            details={"input_revision": job.input_revision, "current_revision": trip.revision},
        )
    day_ids = job.payload.get("day_ids") or []
    if not day_ids:
        raise AppError("VALIDATION_ERROR", "缺少 day_ids。")
    result = optimize_day(
        db,
        trip,
        day_id=day_ids[0],
        mode=job.payload.get("mode", "driving"),
        provider=job.payload.get("provider", "estimate"),
    )
    job.progress = 90
    job.stage = "solved"
    db.commit()
    return result.model_dump(mode="json")


_SAFE_NAME = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def _safe_name(title: str) -> str:
    cleaned = _SAFE_NAME.sub("_", title).strip(" ._")
    return (cleaned or "行程")[:60]


def run_export(db: Session, job: Job) -> dict[str, Any]:
    trip = _load_trip(db, job)
    revision = int(job.payload.get("revision") or trip.revision)
    fmt = str(job.payload.get("format") or "md")
    _rev, snapshot = guide_service.load_snapshot(db, trip, revision)
    guide = guide_service.build_guide(snapshot)

    export_id = job.id
    folder = Path(settings.storage_root) / "exports" / export_id
    folder.mkdir(parents=True, exist_ok=True)
    base = _safe_name(str(guide.get("title") or trip.title))
    if fmt == "docx":
        filename = f"{base}-r{revision}.docx"
        path = folder / filename
        guide_service.render_docx(guide, str(path))
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        filename = f"{base}-r{revision}.md"
        path = folder / filename
        path.write_text(guide_service.render_markdown(guide), encoding="utf-8")
        content_type = "text/markdown; charset=utf-8"

    record = ExportRecord(
        job_id=job.id,
        owner_id=job.owner_id,
        trip_id=trip.id,
        revision=revision,
        format=fmt,
        filename=filename,
        content_type=content_type,
        storage_path=str(path),
        bytes=path.stat().st_size if path.exists() else 0,
        redactions=guide.get("redactions", []),
        expires_at=utcnow() + timedelta(days=7),
    )
    db.add(record)
    db.commit()
    job.progress = 95
    job.stage = "written"
    db.commit()
    return {
        "export_id": record.id,
        "filename": filename,
        "bytes": record.bytes,
        "revision": revision,
        "download_url": f"/api/v1/exports/{record.id}/download",
    }


def dispatch(kind: str) -> Callable[[Session, Job], dict[str, Any]]:
    if kind == "optimization":
        return run_optimization
    if kind == "export":
        return run_export
    raise AppError("UNSUPPORTED_CAPABILITY", f"未知任务类型：{kind}")
