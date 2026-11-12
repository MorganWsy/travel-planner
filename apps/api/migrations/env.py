"""Alembic 运行环境。

数据库 URL 只从 `app.config.get_settings()` 读取（即 DATABASE_URL / .env），
不在 alembic.ini 中保存任何账号、密码或环境地址。
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context

# 兼容从仓库根目录执行 `alembic -c apps/api/alembic.ini` 的情况
API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app import models  # noqa: F401,E402  注册所有模型到 Base.metadata
from app.config import get_settings  # noqa: E402
from app.db import Base, engine  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# PostGIS 自带系统表，不参与业务模型对比，避免自动生成 drop table。
POSTGIS_SYSTEM_TABLES = {"spatial_ref_sys"}


def include_object(object_, name, type_, reflected, compare_to):  # noqa: ANN001
    if type_ == "table" and name in POSTGIS_SYSTEM_TABLES:
        return False
    return True


def run_migrations_offline() -> None:
    """生成 SQL 时使用同一套配置与 metadata。"""
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """直接复用应用的 Engine，确保连接参数与运行时一致。"""
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()