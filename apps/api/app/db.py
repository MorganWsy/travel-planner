"""数据库会话与元数据。

开发默认 SQLite（无需额外服务），生产通过 DATABASE_URL 切 PostgreSQL。
为保持两套环境行为一致，模型层不使用 PostGIS 专有类型：几何以 GeoJSON（WGS84）存入 JSON 列，
空间计算在服务层完成。PostGIS 迁移路径记录在 docs/ARCHITECTURE.md 第 10.7 节（Alembic 基线）。
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.sqlite else {}
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=not settings.sqlite,
    future=True,
)

if settings.sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - 环境相关
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
