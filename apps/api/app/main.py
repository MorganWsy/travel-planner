"""FastAPI 应用入口。"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import PROJECT_ROOT, get_settings
from .db import Base, engine
from .errors import AppError
from .routers import auth, exports, jobs, layers, misc, optimization, places, routes, settings as settings_router, shares, stops, trips

settings = get_settings()
WEB_DIST = PROJECT_ROOT / "apps" / "web" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 开发环境直接建表；生产环境通过 scripts/init_db.py 或 Alembic 迁移后再启动。
    if settings.app_env != "production":
        Base.metadata.create_all(bind=engine)
    # 把数据库中的 Key 覆盖到运行配置；失败不应阻止服务启动（页面会显示未配置）。
    try:
        from .db import SessionLocal
        from .services import app_settings

        with SessionLocal() as db:
            app_settings.apply_runtime(db)
    except Exception as exc:  # pragma: no cover - 依赖数据库
        print("加载实例设置失败：", exc)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Travel Planner API",
        version=settings.app_version,
        summary="旅游规划平台后端：行程、地点、时间线、优化、分享与导出。",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5177",
            "http://127.0.0.1:5177",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content=exc.envelope(getattr(request.state, "request_id", "")),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for error in exc.errors():
            details.append(
                {
                    "loc": [str(part) for part in error.get("loc", [])],
                    "msg": error.get("msg", ""),
                    "type": error.get("type", ""),
                }
            )
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "请求字段校验失败。",
                    "request_id": getattr(request.state, "request_id", ""),
                    "details": {"errors": details},
                }
            },
        )

    api_prefix = "/api/v1"
    for module in (misc, auth, settings_router, trips, places, stops, routes, layers, optimization, jobs, exports, shares):
        app.include_router(module.router, prefix=api_prefix)

    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str):
            target = WEB_DIST / full_path
            if full_path and target.is_file():
                return FileResponse(target)
            return FileResponse(WEB_DIST / "index.html")

    return app


app = create_app()
