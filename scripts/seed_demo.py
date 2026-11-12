"""生成一份可浏览的南昌三日示例行程（不含任何供应商数据）。

用途：在未配置地图 Key 的情况下验证界面、时间线与导出链路。所有地点均为自建，
坐标是示例值（百米级，供演示排布），实际入口请在页面里按需校正；交通耗时为手工录入，
页面与导出都会标注“手工录入 / 非路网结果”。

运行：
    apps/api/.venv/Scripts/python.exe scripts/seed_demo.py
账号：demo@example.com / demo-password-123
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal, utcnow  # noqa: E402
from app.models import Place, RouteLeg, Stop, Trip, TripDay, TripRevision, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services import geostore, trip_content  # noqa: E402

EMAIL = "demo@example.com"
PASSWORD = "demo-password-123"

PLACES = [
    ("南昌西站", "transport", 115.7930, 28.6280),
    ("万寿宫历史文化街区", "attraction", 115.8880, 28.6750),
    ("滕王阁", "attraction", 115.8810, 28.6830),
    ("八一广场", "attraction", 115.8990, 28.6770),
    ("八一起义纪念馆", "attraction", 115.8920, 28.6775),
    ("佑民寺", "attraction", 115.8975, 28.6820),
    ("绳金塔", "attraction", 115.8930, 28.6620),
    ("江西省博物馆", "attraction", 115.8560, 28.6870),
    ("秋水广场", "viewpoint", 115.8600, 28.6810),
    ("南昌之星摩天轮", "viewpoint", 115.8580, 28.6740),
    ("南昌站", "transport", 115.9130, 28.6640),
    ("胜利路步行街", "shopping", 115.8920, 28.6800),
]

# (天序号, 标题, 类型, 分钟, 费用分, 关联地点, 备注)
STOPS = [
    (0, "抵达南昌西站", "transport", 30, None, "南昌西站", "地铁 2 号线进城，约 35 分钟到万寿宫。"),
    (0, "万寿宫街区闲逛", "attraction", 90, None, "万寿宫历史文化街区", "傍晚亮灯后人气最高，适合先垫一顿小吃。"),
    (0, "滕王阁", "attraction", 120, 5000, "滕王阁", "日落前登阁，赣江与八一大桥视野最好。"),
    (0, "八一广场夜景", "free", 45, None, "八一广场", "从滕王阁步行或打车约 15 分钟。"),
    (1, "八一起义纪念馆", "attraction", 90, 0, "八一起义纪念馆", "免费，需提前在公众号预约，周一闭馆。"),
    (1, "佑民寺", "attraction", 45, 1000, "佑民寺", "市区内的小寺，转一圈即可。"),
    (1, "胜利路步行街午饭", "meal", 75, 8000, "胜利路步行街", "拌粉、瓦罐汤就近解决。"),
    (1, "绳金塔与塔前街", "attraction", 105, 10000, "绳金塔", "白天登塔看老城，傍晚塔前街小吃更热闹；时间宽裕可晚些再来。"),
    (2, "江西省博物馆", "attraction", 150, 0, "江西省博物馆", "新馆在凤凰洲，免费预约，海昏侯展值得看。"),
    (2, "秋水广场与赣江边", "free", 60, None, "秋水广场", "看对岸滕王阁与八一大桥。"),
    (2, "南昌之星摩天轮", "attraction", 45, 5000, "南昌之星摩天轮", "傍晚时段视野好，排队约 20 分钟。"),
    (2, "南昌站返程", "transport", 30, None, "南昌站", "预留 40 分钟安检进站。"),
]

# (天序号, 上一事项标题, 当前事项标题, 分钟, 说明)
LEGS = [
    (0, "抵达南昌西站", "万寿宫街区闲逛", 35, "地铁 2 号线"),
    (0, "万寿宫街区闲逛", "滕王阁", 10, "步行"),
    (0, "滕王阁", "八一广场夜景", 15, "打车"),
    (1, "八一起义纪念馆", "佑民寺", 8, "步行"),
    (1, "佑民寺", "胜利路步行街午饭", 6, "步行"),
    (1, "胜利路步行街午饭", "绳金塔与塔前街", 15, "打车"),
    (2, "江西省博物馆", "秋水广场与赣江边", 10, "打车"),
    (2, "秋水广场与赣江边", "南昌之星摩天轮", 8, "步行"),
    (2, "南昌之星摩天轮", "南昌站返程", 25, "打车"),
]


def main() -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == EMAIL))
        if not user:
            user = User(
                email=EMAIL,
                password_hash=hash_password(PASSWORD),
                display_name="示例用户",
                role="admin",
                verified_at=utcnow(),
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        existing = db.scalar(select(Trip).where(Trip.owner_id == user.id, Trip.deleted_at.is_(None)))
        if existing:
            print(f"已存在行程：{existing.title}（{existing.id}），不再重复创建。")
            return

        trip = Trip(
            owner_id=user.id,
            title="南昌三日（示例）",
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 3),
            timezone="Asia/Shanghai",
            currency="CNY",
            budget_minor=150000,
            preferences={"note": "示例数据，用于验证界面与导出", "city": "南昌"},
            revision=1,
        )
        db.add(trip)
        db.flush()

        days: list[TripDay] = []
        for offset in range(3):
            day = TripDay(
                trip_id=trip.id,
                date=date.fromordinal(trip.start_date.toordinal() + offset),
                start_local_time="09:00" if offset else "13:30",
                end_local_time="21:30" if offset != 2 else "18:30",
            )
            db.add(day)
            days.append(day)
        db.flush()

        places: list[Place] = []
        for name, category, lon, lat in PLACES:
            place = Place(
                owner_id=user.id,
                trip_id=trip.id,
                name=name,
                category=category,
                geometry=geostore.point_wkb({"type": "Point", "coordinates": [lon, lat]}),
                user_attributes={"coordinate_note": "示例坐标，百米级，请按实际入口校正"},
                tags=[],
                source={"type": "user", "attribution": None},
            )
            db.add(place)
            places.append(place)
        db.flush()
        place_map = {place.name: place for place in places}

        stops: list[Stop] = []
        for day_index, title, kind, minutes, cost, place_name, note in STOPS:
            position = len([item for item in stops if item.day_id == days[day_index].id])
            stop = Stop(
                trip_id=trip.id,
                day_id=days[day_index].id,
                place_id=place_map[place_name].id,
                kind=kind,
                title=title,
                position=position,
                duration_seconds=minutes * 60,
                priority="required" if kind == "transport" else "preferred",
                cost_minor=cost,
                notes=note,
                transport={},
                source={"type": "user"},
            )
            db.add(stop)
            stops.append(stop)
        db.flush()

        for day_index, from_title, to_title, minutes, label in LEGS:
            day_id = days[day_index].id
            from_stop = next((stop for stop in stops if stop.day_id == day_id and stop.title == from_title), None)
            to_stop = next((stop for stop in stops if stop.day_id == day_id and stop.title == to_title), None)
            if not from_stop or not to_stop:
                continue
            db.add(
                RouteLeg(
                    trip_id=trip.id,
                    day_id=days[day_index].id,
                    from_stop_id=from_stop.id,
                    to_stop_id=to_stop.id,
                    mode="manual",
                    provider="manual",
                    status="manual",
                    duration_seconds=minutes * 60,
                    retrieved_at=utcnow(),
                    source={"type": "user", "label": label, "note": "手工录入，非路网计算结果"},
                )
            )

        db.flush()
        snapshot = trip_content.build_snapshot(db, trip)
        db.add(
            TripRevision(
                trip_id=trip.id,
                revision=1,
                schema_version=trip_content.SCHEMA_VERSION,
                reason="seed",
                snapshot=snapshot,
                redactions=[],
                created_by=user.id,
            )
        )
        db.commit()
        print(f"已创建示例行程：{trip.id}")
        print(f"账号：{EMAIL} / {PASSWORD}")


if __name__ == "__main__":
    main()
