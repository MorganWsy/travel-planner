"""攻略预览与导出任务。"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import AuthContext, check_revision, get_auth, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import ExportRecord, Job
from ..schemas import ExportRequest, GuideSnapshot
from ..services import guide as guide_service
from ..services import jobs as job_service
from ..services.runners import dispatch

router = APIRouter()
settings = get_settings()


@router.get("/trips/{trip_id}/guide", response_model=GuideSnapshot)
def get_guide(
    trip_id: str,
    revision: int | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    _revision, snapshot = guide_service.load_snapshot(db, trip, revision)
    guide = guide_service.build_guide(snapshot)
    guide["markdown"] = guide_service.render_markdown(guide)
    return GuideSnapshot(**guide)


@router.get("/trips/{trip_id}/exports")
def list_exports(
    trip_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[dict]:
    trip = get_owned_trip(db, auth.user, trip_id)
    rows = db.scalars(
        select(ExportRecord).where(ExportRecord.trip_id == trip.id).order_by(ExportRecord.created_at.desc()).limit(20)
    )
    now = utcnow()
    return [
        {
            "id": row.id,
            "format": row.format,
            "filename": row.filename,
            "bytes": row.bytes,
            "revision": row.revision,
            "expires_at": row.expires_at.isoformat(),
            "expired": (row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=now.tzinfo)) < now,
            "download_url": f"/api/v1/exports/{row.id}/download",
        }
        for row in rows
    ]


@router.post("/trips/{trip_id}/export-jobs", response_model=dict, status_code=202)
def create_export_job(
    trip_id: str,
    payload: ExportRequest,
    idempotency_key: str | None = None,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    revision = payload.revision or trip.revision
    if revision > trip.revision:
        raise AppError("VALIDATION_ERROR", "指定的版本尚不存在。")
    job = job_service.create_job(
        db,
        owner_id=auth.user.id,
        kind="export",
        trip_id=trip.id,
        input_revision=revision,
        payload={"revision": revision, "format": payload.format, "include_maps": payload.include_maps},
        idempotency_key=idempotency_key,
    )
    if job.status == "queued" and job.progress == 0:
        job_service.submit(job.id, dispatch("export"))
    db.refresh(job)
    return job_service.job_out(job)


@router.get("/exports/{export_id}/download")
def download_export(
    export_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> FileResponse:
    record = db.get(ExportRecord, export_id)
    if not record or record.owner_id != auth.user.id:
        raise AppError("NOT_FOUND", "导出文件不存在。")
    job = db.get(Job, record.job_id) if record.job_id else None
    if job is None or job.status != "succeeded":
        raise AppError("NOT_FOUND", "导出任务未完成。")
    now = utcnow()
    expires = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=now.tzinfo)
    if expires < now:
        raise AppError("NOT_FOUND", "导出文件已过期，请重新生成。")
    trip = get_owned_trip(db, auth.user, record.trip_id)
    path = Path(record.storage_path)
    if not path.exists():
        raise AppError("NOT_FOUND", "导出文件已被清理，请重新生成。")
    return FileResponse(
        path,
        media_type=record.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(record.filename)}",
            "Cache-Control": "no-store",
            "X-Trip-Revision": str(record.revision),
            "X-Trip-Id": trip.id,
        },
    )
