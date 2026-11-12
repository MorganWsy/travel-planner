"""接口集成测试：版本、权限、排程、优化、导出与分享。"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=8))


def new_trip(client, headers, days: int = 2) -> dict:
    response = client.post(
        "/api/v1/trips",
        json={"title": "杭州测试行程", "start_date": "2026-12-01", "end_date": f"2026-12-0{days}"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_place(client, headers, trip: dict, name: str, lon: float, lat: float) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={"name": name, "category": "attraction", "geometry": {"type": "Point", "coordinates": [lon, lat]}},
        headers={**headers, "If-Match": f'"{trip["revision"]}"'},
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_stop(client, headers, trip: dict, day_id: str | None, **payload) -> dict:
    body = {"day_id": day_id, "title": payload.pop("title", "事项"), "duration_seconds": 3600, **payload}
    response = client.post(
        f"/api/v1/trips/{trip['id']}/stops",
        json=body,
        headers={**headers, "If-Match": f'"{trip["revision"]}"'},
    )
    assert response.status_code == 201, response.text
    return response.json()


def wait_job(client, headers, job_id: str, limit: int = 60) -> dict:
    for _ in range(limit):
        job = client.get(f"/api/v1/jobs/{job_id}", headers=headers).json()
        if job["status"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.2)
    raise AssertionError("任务未在预期时间内结束")


def test_requires_csrf(client, auth) -> None:
    response = client.post("/api/v1/trips", json={"title": "x", "start_date": "2026-12-01", "end_date": "2026-12-02"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_FAILED"


def test_if_match_required_and_conflict(client, auth) -> None:
    trip = new_trip(client, auth)
    missing = client.patch(f"/api/v1/trips/{trip['id']}", json={"title": "新标题"}, headers=auth)
    assert missing.status_code == 428
    stale = client.patch(
        f"/api/v1/trips/{trip['id']}",
        json={"title": "新标题"},
        headers={**auth, "If-Match": '"99"'},
    )
    assert stale.status_code == 409
    ok = client.patch(
        f"/api/v1/trips/{trip['id']}",
        json={"title": "新标题"},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert ok.status_code == 200
    assert ok.json()["revision"] == trip["revision"] + 1
    revisions = client.get(f"/api/v1/trips/{trip['id']}/revisions", headers=auth).json()
    assert [row["revision"] for row in revisions][:2] == [2, 1]


def test_cross_user_access_is_404(client, auth, user_factory) -> None:
    trip = new_trip(client, auth)
    other_client, other_headers, _email = user_factory("other")
    assert other_client.get(f"/api/v1/trips/{trip['id']}", headers=other_headers).status_code == 404
    response = other_client.post(
        f"/api/v1/trips/{trip['id']}/stops",
        json={"title": "越权", "day_id": trip["days"][0]["id"]},
        headers={**other_headers, "If-Match": '"1"'},
    )
    assert response.status_code == 404


def test_move_between_days_and_lock(client, auth) -> None:
    trip = new_trip(client, auth)
    day1, day2 = trip["days"][0]["id"], trip["days"][1]["id"]
    trip = add_stop(client, auth, trip, day1, title="A")
    trip = add_stop(client, auth, trip, day2, title="B")
    trip = add_stop(client, auth, trip, None, title="候选")
    ids_day1 = [stop["id"] for stop in trip["stops"] if stop["day_id"] == day1]
    ids_day2 = [stop["id"] for stop in trip["stops"] if stop["day_id"] == day2]
    candidate = next(stop["id"] for stop in trip["stops"] if stop["day_id"] is None)

    moved = client.post(
        f"/api/v1/trips/{trip['id']}/reorder-stops",
        json={
            "containers": [
                {"day_id": day1, "stop_ids": ids_day1},
                {"day_id": day2, "stop_ids": ids_day2 + [candidate]},
                {"day_id": None, "stop_ids": []},
            ]
        },
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert moved.status_code == 200, moved.text
    trip = moved.json()
    assert len([stop for stop in trip["stops"] if stop["day_id"] == day2]) == 2

    # 锁定顺序后，普通重排必须被拒绝
    locked_target = next(stop for stop in trip["stops"] if stop["day_id"] == day2)
    locked = client.patch(
        f"/api/v1/trips/{trip['id']}/stops/{locked_target['id']}",
        json={"locked_position": True},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert locked.status_code == 200
    trip = locked.json()
    day2_ids = [stop["id"] for stop in trip["stops"] if stop["day_id"] == day2]
    rejected = client.post(
        f"/api/v1/trips/{trip['id']}/reorder-stops",
        json={"containers": [{"day_id": day2, "stop_ids": list(reversed(day2_ids))}]},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert rejected.status_code == 422
    assert "锁定" in rejected.json()["error"]["message"]


def test_timeline_reports_late_fixed_start(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    day = trip["days"][0]["id"]
    # 当天 10:00 才开始，固定预约在 09:30，必然迟到。
    patched = client.patch(
        f"/api/v1/trips/{trip['id']}/days/{day}",
        json={"start_local_time": "10:00"},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert patched.status_code == 200, patched.text
    trip = patched.json()
    fixed = datetime(2026, 12, 1, 9, 30, tzinfo=TZ).isoformat()
    trip = add_place(client, auth, trip, "早场", 120.15, 30.26)
    place = trip["places"][0]
    trip = add_stop(
        client,
        auth,
        trip,
        day,
        title="赶不上",
        place_id=place["id"],
        fixed_start=fixed,
        transport={"duration_seconds": 7200},
    )
    timeline = client.get(f"/api/v1/trips/{trip['id']}/timeline", headers=auth).json()
    assert "LATE_FIXED_START" in timeline["days"][0]["conflicts"]


def test_optimization_preview_and_apply(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    day = trip["days"][0]["id"]
    for name, lon, lat in [("西", 120.10, 30.25), ("中", 120.16, 30.26), ("东", 120.22, 30.27)]:
        trip = add_place(client, auth, trip, name, lon, lat)
    places = {place["name"]: place["id"] for place in trip["places"]}
    for name in ("东", "中", "西"):
        trip = add_stop(client, auth, trip, day, title=name, place_id=places[name], duration_seconds=1800)

    job = client.post(
        f"/api/v1/trips/{trip['id']}/optimization-jobs",
        json={"input_revision": trip["revision"], "scope": "day", "day_ids": [day], "mode": "walking", "provider": "estimate"},
        headers=auth,
    )
    assert job.status_code == 202, job.text
    done = wait_job(client, auth, job.json()["id"])
    assert done["status"] == "succeeded", done
    result = client.get(f"/api/v1/jobs/{done['id']}/result", headers=auth).json()["result"]
    assert result["matrix_source"] == "estimate"
    assert result["days"][0]["travel_seconds"] > 0

    applied = client.post(
        f"/api/v1/trips/{trip['id']}/apply-optimization",
        json={"job_id": done["id"]},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["revision"] == trip["revision"] + 1

    stale = client.post(
        f"/api/v1/trips/{trip['id']}/apply-optimization",
        json={"job_id": done["id"]},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert stale.status_code == 409


def test_export_markdown_and_docx(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    trip = add_stop(client, auth, trip, trip["days"][0]["id"], title="写攻略")
    for fmt in ("md", "docx"):
        created = client.post(
            f"/api/v1/trips/{trip['id']}/export-jobs",
            json={"format": fmt},
            headers=auth,
        )
        assert created.status_code == 202, created.text
        done = wait_job(client, auth, created.json()["id"])
        assert done["status"] == "succeeded", done
        result = client.get(f"/api/v1/jobs/{done['id']}/result", headers=auth).json()["result"]
        download = client.get(result["download_url"], headers=auth)
        assert download.status_code == 200
        assert len(download.content) > 200


def test_share_password_and_revoke(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    created = client.post(
        f"/api/v1/trips/{trip['id']}/shares",
        json={"expires_in_days": 1, "password": "1234", "allow_clone": True},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    payload = created.json()
    token = payload["token"]

    locked = client.get(f"/api/v1/shares/{token}")
    assert locked.status_code == 200
    assert locked.json()["requires_password"] is True

    wrong = client.post(f"/api/v1/shares/{token}/unlock", json={"password": "0000"})
    assert wrong.status_code == 401

    unlocked = client.post(f"/api/v1/shares/{token}/unlock", json={"password": "1234"})
    assert unlocked.status_code == 200
    assert unlocked.json()["snapshot"]["title"]

    revoked = client.delete(f"/api/v1/trips/{trip['id']}/shares/{payload['id']}", headers=auth)
    assert revoked.status_code == 200
    assert client.get(f"/api/v1/shares/{token}").status_code == 404


def test_csv_import(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    csv_body = "name,lon,lat\n湖滨,120.16,30.25\n断桥,120.15,30.26\n错误点,abc,30.0\n"
    response = client.post(
        f"/api/v1/trips/{trip['id']}/import",
        files={"file": ("points.csv", csv_body.encode("utf-8"), "text/csv")},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["feature_count"] == 2
    assert len(body["created_place_ids"]) == 2


def test_shared_snapshot_is_pinned(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    trip = add_stop(client, auth, trip, trip["days"][0]["id"], title="原始事项")
    created = client.post(f"/api/v1/trips/{trip['id']}/shares", json={"expires_in_days": 7}, headers=auth)
    token = created.json()["token"]

    trip = add_stop(client, auth, trip, trip["days"][0]["id"], title="分享后新增")
    snapshot = client.get(f"/api/v1/shares/{token}").json()["snapshot"]
    titles = [block["title"] for day in snapshot["days"] for block in day["blocks"]]
    assert "原始事项" in titles
    assert "分享后新增" not in titles


def _promote(email: str, role: str) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.role = role
        db.commit()


def test_provider_settings_masked_and_clear(client, user_factory) -> None:
    admin_client, admin_headers, admin_email = user_factory("admin")
    member_client, member_headers, member_email = user_factory("member")
    _promote(admin_email, "admin")
    _promote(member_email, "member")

    forbidden = member_client.put("/api/v1/settings/providers", json={"amap_key": "abcdef1234567890"}, headers=member_headers)
    assert forbidden.status_code == 403

    saved = admin_client.put("/api/v1/settings/providers", json={"amap_key": "abcdef1234567890"}, headers=admin_headers)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["amap_key"]["configured"] is True
    assert body["amap_key"]["source"] == "settings"
    assert body["amap_key"]["masked"].endswith("7890")
    assert "abcdef1234567890" not in saved.text

    # 掩码接口也不应回传明文
    read_back = admin_client.get("/api/v1/settings/providers", headers=admin_headers)
    assert "abcdef1234567890" not in read_back.text

    cleared = admin_client.put("/api/v1/settings/providers", json={"amap_key": None}, headers=admin_headers)
    assert cleared.status_code == 200
    assert cleared.json()["amap_key"]["configured"] is False


def test_reorder_keeps_manual_legs(client, auth) -> None:
    trip = new_trip(client, auth, days=1)
    day = trip["days"][0]["id"]
    trip = add_stop(client, auth, trip, day, title="甲")
    trip = add_stop(client, auth, trip, day, title="乙")
    first, second = [stop["id"] for stop in trip["stops"]]
    leg = client.post(
        f"/api/v1/trips/{trip['id']}/routes/manual",
        json={
            "from_stop_id": first,
            "to_stop_id": second,
            "distance_m": 1200,
            "duration_seconds": 600,
            "label": "步行",
        },
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert leg.status_code == 200, leg.text
    trip = leg.json()
    assert len(trip["route_legs"]) == 1
    assert trip["route_legs"][0]["distance_m"] == 1200, "保存路线时距离要一起落库，右栏卡片才能显示"

    reordered = client.post(
        f"/api/v1/trips/{trip['id']}/reorder-stops",
        json={"containers": [{"day_id": day, "stop_ids": [second, first]}]},
        headers={**auth, "If-Match": f'"{trip["revision"]}"'},
    )
    assert reordered.status_code == 200, reordered.text
    assert len(reordered.json()["route_legs"]) == 1, "手工交通不应因排序被删除"


def test_collect_pois_refreshes_existing_district_and_phone(client, auth, monkeypatch) -> None:
    """重新采集同名点位时，要补上旧记录缺失的区县和电话，而不是直接跳过。"""
    trip = new_trip(client, auth, days=1)
    created = client.post(
        f"/api/v1/trips/{trip['id']}/layers",
        json={"name": "景点", "kind": "system", "category": "attraction"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    layer = created.json()
    # 模拟早期入库的数据：只有地址和来源，没有区县、电话
    seeded = client.post(
        f"/api/v1/trips/{trip['id']}/layers/{layer['id']}/features",
        json={
            "name": "测试景点",
            "category": "风景名胜",
            "lon": 115.8587,
            "lat": 28.6432,
            "properties": {"address": "旧地址", "provider": "amap"},
        },
        headers=auth,
    )
    assert seeded.status_code == 200, seeded.text
    assert "adname" not in seeded.json()["features"][0]["properties"]

    def fake_around(_provider, **_kwargs):
        return (
            [
                {
                    "name": "测试景点",
                    "category": "风景名胜",
                    "address": "新地址",
                    "geometry": {"type": "Point", "coordinates": [115.8587, 28.6432]},
                    "provider": "amap",
                    "extra": {"adname": "西湖区", "tel": "0791-12345678", "distance": "120"},
                }
            ],
            "amap",
        )

    monkeypatch.setattr("app.routers.layers.registry.around", fake_around)
    refreshed = client.post(
        f"/api/v1/trips/{trip['id']}/layers/{layer['id']}/collect",
        json={"lon": 115.8587, "lat": 28.6432, "radius_m": 1000, "keywords": "景点", "limit": 10},
        headers=auth,
    )
    assert refreshed.status_code == 200, refreshed.text
    feature = refreshed.json()["features"][0]
    assert feature["properties"]["adname"] == "西湖区"
    assert feature["properties"]["tel"] == "0791-12345678"
    assert feature["properties"]["address"] == "新地址"


def test_tianditu_browser_key_enables_basemap_immediately(client, user_factory) -> None:
    admin_client, admin_headers, admin_email = user_factory("admin2")
    _promote(admin_email, "admin")
    before = client.get("/api/v1/config/public").json()
    # 高德瓦片不需要 Key，默认就在列表里；天地图必须有浏览器端 Key 才出现
    assert not any(item["id"].startswith("tianditu") for item in before["basemaps"])

    saved = admin_client.put(
        "/api/v1/settings/providers",
        json={"tianditu_browser_key": "0123456789abcdef0123456789abcdef"},
        headers=admin_headers,
    )
    assert saved.status_code == 200, saved.text
    after = client.get("/api/v1/config/public").json()
    ids = [item["id"] for item in after["basemaps"]]
    assert "tianditu-vec" in ids and "tianditu-img" in ids
    # 浏览器瓦片 Key 必然出现在 tiles 模板里；除此之外不应出现在说明等其他字段。
    vec = next(item for item in after["basemaps"] if item["id"] == "tianditu-vec")
    assert "tk=0123456789abcdef0123456789abcdef" in vec["tiles"][0]
    assert "0123456789abcdef0123456789abcdef" not in str(after.get("notes"))

    admin_client.put("/api/v1/settings/providers", json={"tianditu_browser_key": None}, headers=admin_headers)
    remaining = [item["id"] for item in client.get("/api/v1/config/public").json()["basemaps"]]
    assert not any(item.startswith("tianditu") for item in remaining)


def test_delete_place_cascade_removes_stops(client, auth) -> None:
    """删除标注要连同引用它的事项一起删，否则左栏会留下没有地点的空事项。"""
    created = client.post(
        "/api/v1/trips",
        json={"title": "级联删除", "start_date": "2026-12-01", "end_date": "2026-12-01"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    trip = created.json()
    headers = {**auth, "If-Match": f'"{trip["revision"]}"'}

    with_place = client.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={"name": "级联点", "category": "attraction", "geometry": {"type": "Point", "coordinates": [115.9, 28.6]}, "tags": []},
        headers=headers,
    )
    assert with_place.status_code == 201, with_place.text
    payload = with_place.json()
    place_id = next(item["id"] for item in payload["places"] if item["name"] == "级联点")

    headers = {**auth, "If-Match": f'"{payload["revision"]}"'}
    with_stop = client.post(
        f"/api/v1/trips/{trip['id']}/stops",
        json={
            "day_id": payload["days"][0]["id"],
            "place_id": place_id,
            "title": "级联事项",
            "kind": "attraction",
            "duration_seconds": 3600,
        },
        headers=headers,
    )
    assert with_stop.status_code == 201, with_stop.text
    payload = with_stop.json()
    stop_id = next(item["id"] for item in payload["stops"] if item["title"] == "级联事项")

    headers = {**auth, "If-Match": f'"{payload["revision"]}"'}
    removed = client.delete(f"/api/v1/trips/{trip['id']}/places/{place_id}?cascade=true", headers=headers)
    assert removed.status_code == 200, removed.text
    remaining = removed.json()
    assert all(item["id"] != stop_id for item in remaining["stops"])
    assert all(item["id"] != place_id for item in remaining["places"])


def test_delete_stop_prunes_place_without_reference(client, auth) -> None:
    """删事项时，若该地点已无其它引用，要一并删掉。

    否则地图上的标注和左栏「本行程地点」会留着一个已经不在行程里的点，
    用户看到的就是「删了没反应」。
    """
    created = client.post(
        "/api/v1/trips",
        json={"title": "删事项带掉地点", "start_date": "2026-12-02", "end_date": "2026-12-02"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    trip = created.json()
    headers = {**auth, "If-Match": f'"{trip["revision"]}"'}

    with_place = client.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={"name": "独用地", "category": "attraction", "geometry": {"type": "Point", "coordinates": [115.91, 28.61]}, "tags": []},
        headers=headers,
    )
    assert with_place.status_code == 201, with_place.text
    payload = with_place.json()
    place_id = next(item["id"] for item in payload["places"] if item["name"] == "独用地")

    headers = {**auth, "If-Match": f'"{payload["revision"]}"'}
    with_stop = client.post(
        f"/api/v1/trips/{trip['id']}/stops",
        json={
            "day_id": payload["days"][0]["id"],
            "place_id": place_id,
            "title": "独用事项",
            "kind": "attraction",
            "duration_seconds": 1800,
        },
        headers=headers,
    )
    assert with_stop.status_code == 201, with_stop.text
    payload = with_stop.json()
    stop_id = next(item["id"] for item in payload["stops"] if item["title"] == "独用事项")

    headers = {**auth, "If-Match": f'"{payload["revision"]}"'}
    removed = client.delete(f"/api/v1/trips/{trip['id']}/stops/{stop_id}", headers=headers)
    assert removed.status_code == 200, removed.text
    remaining = removed.json()
    assert all(item["id"] != place_id for item in remaining["places"]), "地点应随最后一个引用一起消失"
    assert all(item["id"] != stop_id for item in remaining["stops"])


def test_captcha_email_code_register_flow(client, monkeypatch) -> None:
    """完整注册链路：滑块挑战 → 发码（拦下邮件里的明文）→ 带码注册 → 验证码登录。

    这条用例覆盖的是真实校验路径：滑块百分比、挑战一次性、验证码哈希比对、
    密码强度、两次密码一致，全部走后端判断。
    """
    captured: dict[str, str] = {}

    from app.services import mailer

    def fake_send(email: str, code: str, scene: str) -> bool:
        captured["code"] = code
        return True

    monkeypatch.setattr(mailer, "send_code", fake_send)

    email = f"flow-{uuid.uuid4().hex[:8]}@example.com"

    challenge = client.post("/api/v1/auth/captcha")
    assert challenge.status_code == 200, challenge.text
    challenge_id = challenge.json()["challenge_id"]

    # 滑块没拖到位必须被拒
    short = client.post(
        "/api/v1/auth/email/send",
        json={"email": email, "scene": "register", "challenge_id": challenge_id, "slider_percent": 40},
    )
    assert short.status_code == 422, short.text

    # 同一个挑战被拒后应仍然可用（未达标不消耗），拖到位就能发码
    sent = client.post(
        "/api/v1/auth/email/send",
        json={"email": email, "scene": "register", "challenge_id": challenge_id, "slider_percent": 98},
    )
    assert sent.status_code == 200, sent.text
    code = captured["code"]
    assert len(code) == 6 and code.isdigit()

    # 验证码只能兑一次
    reused = client.post(
        "/api/v1/auth/email/send",
        json={"email": email, "scene": "register", "challenge_id": challenge_id, "slider_percent": 98},
    )
    assert reused.status_code == 422, reused.text

    weak = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "code": code,
            "password": "alllowercase123",
            "password_confirm": "alllowercase123",
            "display_name": "小写密码",
        },
    )
    assert weak.status_code == 422, weak.text

    mismatch = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "code": code,
            "password": "Strong-pass-1",
            "password_confirm": "Strong-pass-2",
            "display_name": "不一致",
        },
    )
    assert mismatch.status_code == 422, mismatch.text

    ok = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "code": code,
            "password": "Strong-pass-1",
            "password_confirm": "Strong-pass-1",
            "display_name": "流程用户",
            "phone": "13800000000",
        },
    )
    assert ok.status_code == 202, ok.text

    # 用密码登录（密码方式要求先过滑块）
    by_password = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": "Strong-pass-1",
            "challenge_id": client.post("/api/v1/auth/captcha").json()["challenge_id"],
            "slider_percent": 100,
        },
    )
    assert by_password.status_code == 200, by_password.text
    assert by_password.json()["user"]["phone"] == "13800000000"
