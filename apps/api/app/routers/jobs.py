"""任务查询、取消与重试。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, get_auth, require_csrf
from ..errors import AppError
from ..models import Job
from ..schemas import JobOut, JobResultOut
from ..services import jobs as job_service
from ..services.runners import dispatch

router = APIRouter()


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(
    kind: str | None = None,
    status: str | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[Job]:
    stmt = select(Job).where(Job.owner_id == auth.user.id)
    if kind:
        stmt = stmt.where(Job.kind == kind)
    if status:
        stmt = stmt.where(Job.status == status)
    return list(db.scalars(stmt.order_by(Job.created_at.desc()).limit(50)))


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Job:
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == auth.user.id))
    if not job:
        raise AppError("NOT_FOUND", "任务不存在。")
    return job


@router.get("/jobs/{job_id}/result", response_model=JobResultOut)
def get_result(job_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == auth.user.id))
    if not job:
        raise AppError("NOT_FOUND", "任务不存在。")
    if job.status != "succeeded":
        raise AppError("VALIDATION_ERROR", "任务尚未成功完成。", details={"status": job.status})
    return JobResultOut(job_id=job.id, kind=job.kind, result=job.result or {})


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, auth: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)) -> Job:
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == auth.user.id))
    if not job:
        raise AppError("NOT_FOUND", "任务不存在。")
    if job.status in ("succeeded", "failed", "cancelled"):
        raise AppError("VALIDATION_ERROR", "该任务已结束。")
    job.cancel_requested = True
    if job.status == "queued":
        job.status = "cancelled"
    db.commit()
    return job


@router.post("/jobs/{job_id}/retry", response_model=JobOut, status_code=202)
def retry_job(job_id: str, auth: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)) -> Job:
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == auth.user.id))
    if not job:
        raise AppError("NOT_FOUND", "任务不存在。")
    if job.status not in ("failed", "cancelled"):
        raise AppError("VALIDATION_ERROR", "只有失败或取消的任务可以重试。")
    new_job = job_service.create_job(
        db,
        owner_id=auth.user.id,
        kind=job.kind,
        trip_id=job.trip_id,
        input_revision=job.input_revision,
        payload=dict(job.payload or {}),
    )
    job_service.submit(new_job.id, dispatch(job.kind))
    return new_job
