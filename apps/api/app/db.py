"""数据库会话与元数据。

数据库连接从 DATABASE_URL / .env 读取；当前开发与测试均使用 PostgreSQL + PostGIS。
几何列由 GeoAlchemy2 映射到 PostGIS geometry，业务层仍以 GeoJSON（WGS84）读写。
迁移基线见 apps/api/migrations/versions/0001_initial.py，生产环境用 alembic upgrade head。
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
