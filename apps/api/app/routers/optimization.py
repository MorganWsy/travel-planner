"""行程优化任务与应用。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, check_revision, get_auth, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Job, Stop
from ..schemas import OptimizationRequest, TripDetail
from ..services import jobs as job_service
from ..services import trip_content
from ..services.optimize import compute_input_hash
from ..services.runners import dispatch

router = APIRouter()


@router.post("/trips/{trip_id}/optimization-jobs", status_code=202)
def create_optimization_job(
    trip_id: str,
    payload: OptimizationRequest,
    idempotency_key: str | None = None,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    trip = get_owned_trip(db, auth.user, trip_id)
    if payload.input_revision != trip.revision:
        raise AppError(
            "REVISION_CONFLICT",
            "行程已更新，请刷新后重新发起优化。",
            details={"expected_revision": payload.input_revision, "current_revision": trip.revision},
        )
    day = next((d for d in trip_content.load_days(db, trip.id) if d.id == payload.day_ids[0]), None)
    if not day:
        raise AppError("VALIDATION_ERROR", "指定的日期不属于该行程。")
    job = job_service.create_job(
        db,
        owner_id=auth.user.id,
        kind="optimization",
        trip_id=trip.id,
        input_revision=trip.revision,
        payload={
            "day_ids": payload.day_ids,
            "mode": payload.mode,
            "provider": payload.provider,
            "scope": payload.scope,
        },
        idempotency_key=idempotency_key,
    )
    if job.status == "queued" and job.progress == 0:
        job_service.submit(job.id, dispatch("optimization"))
    db.refresh(job)
    return job_service.job_out(job)


@router.post("/trips/{trip_id}/apply-optimization", response_model=TripDetail)
def apply_optimization(
    trip_id: str,
    payload: dict,
    request: Request,
    response: Response,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> TripDetail:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)
    job_id = payload.get("job_id")
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == auth.user.id, Job.trip_id == trip.id))
    if not job:
        raise AppError("NOT_FOUND", "优化任务不存在。")
    if job.status != "succeeded" or job.kind != "optimization":
        raise AppError("VALIDATION_ERROR", "任务没有可应用的优化结果。", details={"status": job.status})
    result = job.result or {}
    day_ids = (job.payload or {}).get("day_ids") or []
    if not day_ids:
        raise AppError("VALIDATION_ERROR", "任务缺少日期信息。")
    current_hash = compute_input_hash(
        db,
        trip,
        day_id=day_ids[0],
        mode=(job.payload or {}).get("mode", "driving"),
        provider=(job.payload or {}).get("provider", "estimate"),
    )
    if result.get("input_hash") != current_hash:
        raise AppError(
            "REVISION_CONFLICT",
            "行程内容在优化后已变化，建议方案不能覆盖当前版本，请重新优化。",
            details={"hint": "可先查看建议，再基于当前内容重新发起优化。"},
        )

    plan = (result.get("days") or [{}])[0]
    ordered = [row["stop_id"] for row in plan.get("stops", [])]
    stops = {s.id: s for s in trip_content.load_stops(db, trip.id)}
    for stop_id in ordered:
        if stop_id not in stops:
            raise AppError("VALIDATION_ERROR", "建议方案引用了已被删除的事项。")
    for index, stop_id in enumerate(ordered):
        stop = stops[stop_id]
        if stop.locked_position and stop.position != index:
            raise AppError("VALIDATION_ERROR", "已锁定顺序的事项与建议方案冲突，请先解锁。")
        stop.day_id = day_ids[0]
        stop.position = index

    trip_content.commit(db, trip, user_id=auth.user.id, reason="apply-optimization")
    response.headers["ETag"] = f'"{trip.revision}"'
    return trip_content.serialize_trip(db, trip)
