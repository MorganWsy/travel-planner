"""健康检查、公开配置、能力报告与轻量数据导入。"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import AuthContext, check_revision, get_auth, get_owned_trip, parse_if_match, require_csrf
from ..errors import AppError
from ..models import Dataset, Place, Trip
from ..providers import registry
from ..schemas import CapabilityOut, ImportResult, PublicConfig
from ..services import geostore, trip_content

router = APIRouter()
settings = get_settings()

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_FEATURES = 2000


@router.get("/health/live")
def health_live() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
def health_ready(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - 依赖环境
        raise AppError("INTERNAL_ERROR", "数据库未就绪。") from exc
    return {"status": "ok", "database": "ok"}


@router.get("/config/public", response_model=PublicConfig)
def public_config() -> PublicConfig:
    notes = [
        "未配置地图 Key 时使用空白底板与手工地点，不使用模拟供应商响应冒充真实数据。",
        "供应商能力均标注 verified=false，需用项目 Key 实测后才能改为已验证。",
    ]
    if not registry.runtime_key("amap_key"):
        notes.append("未配置高德 Web 服务 Key：路线查询与 POI 搜索不可用，可在设置页填写或手工录入交通耗时。")
    if not registry.runtime_key("tianditu_browser_key"):
        notes.append("未配置天地图浏览器端 Key：底图为空白经纬网，可在设置页填写。")
    return PublicConfig(
        app_version=settings.app_version,
        app_env=settings.app_env,
        registration_mode=settings.registration_mode,
        providers=registry.provider_flags(),
        basemaps=registry.basemaps(),
        limits={
            "max_days": settings.limits_max_days,
            "max_stops_per_day": settings.limits_max_stops_per_day,
            "max_candidates": settings.limits_max_candidates,
        },
        features={
            "share": True,
            "export_md": True,
            "export_docx": True,
            "optimization": True,
            "offline_guide": True,
            "gis_raster": False,
            "realtime_transit": settings.amap_key != "",
        },
        notes=notes,
    )


@router.get("/providers/capabilities", response_model=list[CapabilityOut])
def provider_capabilities(auth: AuthContext = Depends(get_auth)) -> list[dict]:
    return registry.provider_view()


def _csv_places(raw: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        raise AppError("VALIDATION_ERROR", "CSV 缺少表头。")
    fields = {name.strip().lower(): name for name in reader.fieldnames}
    lon_key = next((fields[k] for k in ("lon", "lng", "longitude", "经度") if k in fields), None)
    lat_key = next((fields[k] for k in ("lat", "latitude", "纬度") if k in fields), None)
    if not lon_key or not lat_key:
        raise AppError("VALIDATION_ERROR", "CSV 需要 lon/lat 或 经度/纬度 列。")
    name_key = next((fields[k] for k in ("name", "名称", "title") if k in fields), None)
    category_key = next((fields[k] for k in ("category", "类型") if k in fields), None)
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for index, row in enumerate(reader, start=2):
        try:
            lon = float(row[lon_key])
            lat = float(row[lat_key])
        except (TypeError, ValueError):
            skipped.append({"line": index, "reason": "坐标无法解析"})
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            skipped.append({"line": index, "reason": "坐标超出范围"})
            continue
        rows.append(
            {
                "name": (row.get(name_key) or f"导入点 {index}").strip()[:120] if name_key else f"导入点 {index}",
                "category": (row.get(category_key) or "other").strip() if category_key else "other",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return rows, skipped


def _geojson_places(raw: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AppError("VALIDATION_ERROR", "GeoJSON 解析失败。") from exc
    features = data.get("features") if data.get("type") == "FeatureCollection" else [data]
    rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for index, feature in enumerate(features or []):
        geometry = (feature or {}).get("geometry") or {}
        if geometry.get("type") != "Point":
            skipped.append({"index": index, "reason": "仅支持 Point 要素"})
            continue
        coords = geometry.get("coordinates") or []
        if len(coords) != 2:
            skipped.append({"index": index, "reason": "坐标格式无效"})
            continue
        try:
            lon, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            skipped.append({"index": index, "reason": "坐标无法解析"})
            continue
        props = (feature or {}).get("properties") or {}
        rows.append(
            {
                "name": str(props.get("name") or f"导入点 {index + 1}")[:120],
                "category": str(props.get("category") or "other"),
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return rows, skipped


@router.post("/trips/{trip_id}/import", response_model=ImportResult, status_code=201)
def import_places(
    trip_id: str,
    request: Request,
    file: UploadFile = File(...),
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> ImportResult:
    expected = parse_if_match(request)
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    check_revision(trip, expected)

    payload = file.file.read(MAX_IMPORT_BYTES + 1)
    if len(payload) > MAX_IMPORT_BYTES:
        raise AppError("FILE_TOO_LARGE", "导入文件不得超过 5MB。")
    try:
        raw = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AppError("VALIDATION_ERROR", "仅支持 UTF-8 编码的文本文件。") from exc

    suffix = (file.filename or "").lower()
    if suffix.endswith(".csv"):
        fmt = "csv"
        rows, skipped = _csv_places(raw)
    elif suffix.endswith(".geojson") or suffix.endswith(".json"):
        fmt = "geojson"
        rows, skipped = _geojson_places(raw)
    else:
        raise AppError("CRS_UNSUPPORTED", "当前仅支持 CSV 与 GeoJSON 点数据；Shapefile/GeoTIFF 尚未实现。")

    if len(rows) > MAX_FEATURES:
        raise AppError("FILE_TOO_LARGE", f"单次导入最多 {MAX_FEATURES} 个点。")
    if not rows:
        raise AppError("VALIDATION_ERROR", "没有可导入的有效点。", details={"skipped": skipped[:20]})

    dataset = Dataset(
        owner_id=auth.user.id,
        trip_id=trip.id,
        kind="vector",
        format=fmt,
        original_crs="WGS84",
        feature_count=len(rows),
        status="ready",
        statistics={"skipped": len(skipped)},
    )
    db.add(dataset)
    db.flush()

    created: list[str] = []
    for row in rows:
        place = Place(
            owner_id=auth.user.id,
            trip_id=trip.id,
            name=row["name"],
            category=row["category"] if row["category"] in {
                "attraction",
                "meal",
                "lodging",
                "transport",
                "shopping",
                "viewpoint",
                "other",
            } else "other",
            geometry=geostore.point_wkb(row["geometry"]),
            user_attributes={},
            tags=[],
            source={"type": "import", "attribution": f"{fmt.upper()} 导入", "source_crs": "WGS84"},
        )
        db.add(place)
        db.flush()
        created.append(place.id)

    trip_content.commit(db, trip, user_id=auth.user.id, reason="import-places")
    return ImportResult(
        dataset_id=dataset.id,
        format=fmt,
        feature_count=len(rows),
        created_place_ids=created,
        skipped=skipped[:50],
        warnings=[] if fmt == "geojson" else ["CSV 默认按 WGS84 经纬度解释，其他坐标系需先转换。"],
    )
