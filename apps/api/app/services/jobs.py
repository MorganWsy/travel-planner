"""任务执行器。

本机没有 Redis/RQ，因此用进程内线程池 + 数据库状态机实现同一套语义：
先落库（queued）再执行，执行过程更新 status/progress/stage，失败写 error_code。
换 RQ 时只需替换 submit()，接口与状态字段不变。
"""

from __future__ import annotations

import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal, utcnow
from ..errors import AppError
from ..models import Job

executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="job")

Runner = Callable[[Session, Job], dict[str, Any]]


def create_job(
    db: Session,
    *,
    owner_id: str,
    kind: str,
    trip_id: str | None,
    input_revision: int | None,
    payload: dict[str, Any],
    idempotency_key: str | None = None,
) -> Job:
    if idempotency_key:
        existing = db.scalar(
            select(Job).where(
                Job.owner_id == owner_id,
                Job.kind == kind,
                Job.idempotency_key == idempotency_key,
                Job.created_at >= utcnow() - timedelta(hours=24),
            )
        )
        if existing:
            if (existing.payload or {}) != payload:
                raise AppError("IDEMPOTENCY_CONFLICT", "相同幂等键的请求内容不同。")
            return existing
    job = Job(
        owner_id=owner_id,
        trip_id=trip_id,
        kind=kind,
        status="queued",
        progress=0,
        stage="queued",
        input_revision=input_revision,
        idempotency_key=idempotency_key,
        payload=payload,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def submit(job_id: str, runner: Runner) -> None:
    executor.submit(_run, job_id, runner)


def _run(job_id: str, runner: Runner) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None or job.status != "queued" or job.cancel_requested:
            if job is not None and job.status == "queued":
                job.status = "cancelled"
                job.finished_at = utcnow()
                db.commit()
            return
        job.status = "running"
        job.started_at = utcnow()
        job.stage = "running"
        job.progress = 5
        db.commit()
        try:
            result = runner(db, job)
            job.result = result
            job.progress = 100
            job.stage = "done"
            job.status = "succeeded"
        except AppError as exc:
            job.status = "failed"
            job.error = {"code": exc.code, "message": exc.message, "details": exc.details}
            job.stage = "failed"
        except Exception:
            # 不把堆栈返回给客户端；服务端日志保留一次完整记录。
            traceback.print_exc()
            job.status = "failed"
            job.error = {"code": "INTERNAL_ERROR", "message": "任务执行失败，请稍后重试。"}
            job.stage = "failed"
        finally:
            job.finished_at = utcnow()
            db.commit()


def job_out(job: Job) -> dict[str, Any]:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "input_revision": job.input_revision,
        "cancel_requested": job.cancel_requested,
        "error": job.error,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }
