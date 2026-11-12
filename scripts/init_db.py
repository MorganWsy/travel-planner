"""初始化数据库：建库、启用 PostGIS、建表。

只读 apps/api/.env 中的 DATABASE_URL，不需要在终端里输入密码，也不需要 psql。
若目标数据库不存在，会先连到同一实例的 postgres 库创建它（需要该账号有 CREATEDB 权限）。
这是本地开发/测试的快速入口，使用 SQLAlchemy create_all；
生产或需要可回滚 schema 时改用 `alembic upgrade head`。

用法：
    apps/api/.venv/Scripts/python.exe scripts/init_db.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

# Windows 控制台默认 GBK，PostgreSQL 的中文错误会乱码。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import psycopg  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app import models  # noqa: F401,E402  注册模型
from app.config import get_settings  # noqa: E402
from app.db import Base, engine  # noqa: E402


def ensure_database() -> None:
    url = make_url(get_settings().database_url)
    if url.get_backend_name() != "postgresql":
        print(f"当前 DATABASE_URL 不是 PostgreSQL：{url.drivername}")
        raise SystemExit(1)
    target = url.database
    if not url.username or not target:
        print("DATABASE_URL 缺少用户名或数据库名。")
        raise SystemExit(1)
    maintenance = (
        f"host={url.host or '127.0.0.1'} port={url.port or 5432} "
        f"user={url.username} password={url.password or ''} dbname=postgres"
    )
    try:
        with psycopg.connect(maintenance, autocommit=True, connect_timeout=8) as conn:
            exists = conn.execute("select 1 from pg_database where datname = %s", (target,)).fetchone()
            if exists:
                print(f"数据库已存在：{target}")
            else:
                conn.execute(f'CREATE DATABASE "{target}"')
                print(f"已创建数据库：{target}")
    except psycopg.OperationalError as exc:
        code = getattr(exc, "sqlstate", None) or getattr(getattr(exc, "diag", None), "sqlstate", None) or ""
        raw = str(exc)
        if code == "28P01" or "28P01" in raw or "Password" in raw or "password" in raw:
            print("密码认证失败：请把 apps/api/.env 中的 CHANGE_ME 换成 postgres 账号的真实密码。")
        elif "3D000" in raw or code == "3D000":
            print("目标实例上没有 postgres 维护库，无法自动建库。")
        elif code in ("28000", "42501") or "42501" in raw:
            print(f"账号权限不足（{code}）：建库需要 CREATEDB 权限。")
        else:
            print(f"连接失败（SQLSTATE {code or '未知'}）：请检查主机、端口与账号。")
        raise SystemExit(2)


def main() -> None:
    ensure_database()
    with engine.begin() as conn:
        version = conn.execute(text("select version()")).scalar_one()
        print(str(version).split(" on ")[0])
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        print("PostGIS", conn.execute(text("select PostGIS_Version()")).scalar_one())
    Base.metadata.create_all(bind=engine)
    # 已有库的增量变更：create_all 不会补列，这里显式补齐。
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member'"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(40)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
        conn.execute(text("ALTER TABLE places ADD COLUMN IF NOT EXISTS icon VARCHAR(40)"))
        conn.execute(
            text(
                "UPDATE users SET role = 'admin' "
                "WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1) "
                "AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')"
            )
        )
    print("tables:", ", ".join(sorted(Base.metadata.tables)))
    print("初始化完成。")


if __name__ == "__main__":
    main()
