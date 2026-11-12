"""测试夹具。

纯逻辑测试（坐标、排程）无需数据库即可运行；
接口集成测试需要显式提供带 PostGIS 的测试库：
    set TEST_DATABASE_URL=postgresql+psycopg://travel:密码@127.0.0.1:5432/travel_planner_test
未提供时集成用例会跳过，不会退回 SQLite（几何列依赖 PostGIS）。
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-production")


@pytest.fixture(scope="session")
def db_ready():
    if not TEST_DATABASE_URL:
        pytest.skip("需要 TEST_DATABASE_URL 指向已启用 PostGIS 的测试库")
    from sqlalchemy import text

    from app import models  # noqa: F401
    from app.db import Base, engine

    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_ready):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


TEST_PASSWORD = "Test-password-123"


def seed_code(email: str, code: str = "123456") -> None:
    """直接写一条邮箱验证码记录。

    注册要校验验证码，而验证码只存哈希、发码还要过滑块，测试里没法从接口拿回来。
    这里用同一个哈希函数插库，走的仍是真实校验路径，不绕过校验逻辑。
    """
    from datetime import timedelta

    from app.db import SessionLocal, utcnow
    from app.models import EmailCode
    from app.security import token_hash

    with SessionLocal() as db:
        db.add(
            EmailCode(
                email=email,
                code_hash=token_hash(f"email-code:{code}"),
                expires_at=utcnow() + timedelta(minutes=5),
            )
        )
        db.commit()


def make_user(client, prefix: str) -> tuple[dict[str, str], str]:
    email = f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"
    seed_code(email)
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "code": "123456",
            "password": TEST_PASSWORD,
            "password_confirm": TEST_PASSWORD,
            "display_name": "测试用户",
        },
    )
    assert response.status_code == 202, response.text
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": TEST_PASSWORD,
            "challenge_id": client.post("/api/v1/auth/captcha").json()["challenge_id"],
            "slider_percent": 100,
        },
    )
    assert login.status_code == 200, login.text
    return {"X-CSRF-Token": login.json()["csrf_token"]}, email


@pytest.fixture()
def auth(client) -> dict[str, str]:
    headers, _email = make_user(client, "owner")
    return headers


@pytest.fixture()
def user_factory(db_ready):
    """为需要多账号的用例创建独立 Cookie 会话，避免相互覆盖登录态。"""
    from fastapi.testclient import TestClient

    from app.main import app

    contexts = []

    def factory(prefix: str):
        test_client = TestClient(app)
        test_client.__enter__()
        contexts.append(test_client)
        headers, email = make_user(test_client, prefix)
        return test_client, headers, email

    yield factory
    for test_client in contexts:
        test_client.__exit__(None, None, None)


def _set_role(client, email: str, role: str) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.role = role
        db.commit()


@pytest.fixture()
def admin_auth(client) -> dict[str, str]:
    headers, email = make_user(client, "admin")
    _set_role(client, email, "admin")
    return headers


@pytest.fixture()
def member_auth(client) -> dict[str, str]:
    headers, email = make_user(client, "member")
    _set_role(client, email, "member")
    return headers
