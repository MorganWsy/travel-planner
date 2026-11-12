"""专题图层：可开关的 GeoJSON 点图层，跟随行程保存、可导出分享。

两类图层：mine=用户自建（打点、导入），system=系统预置（地铁站/酒店这类 POI 专题，
由「采集」从地图供应商抓周边点位入库）。坐标一律 WGS84。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, get_owned_trip, get_auth, require_csrf
from ..errors import AppError
from ..models import MapLayer, MapLayerFeature
from ..providers import registry
from ..schemas import (
    MapFeatureCreate,
    MapLayerCollectRequest,
    MapLayerCreate,
    MapLayerFeatureOut,
    MapLayerOut,
    MapLayerPatch,
)
from ..services import geostore

router = APIRouter()

# 系统专题图层的采集关键词：图层 category → 周边搜索词
SYSTEM_KEYWORDS = {
    "metro_station": "地铁站",
    "bus_station": "公交站",
    "hotel": "酒店",
    "attraction": "景点",
    "mall": "商场",
    "restaurant": "餐厅",
    "toilet": "公共厕所",
}


def _feature_out(feature: MapLayerFeature) -> MapLayerFeatureOut:
    return MapLayerFeatureOut(
        id=feature.id,
        name=feature.name,
        category=feature.category,
        geometry=geostore.to_geojson(feature.geometry),
        properties=feature.properties or {},
    )


def _layer_out(layer: MapLayer, features: list[MapLayerFeature]) -> MapLayerOut:
    return MapLayerOut(
        id=layer.id,
        name=layer.name,
        kind=layer.kind,
        category=layer.category,
        icon=layer.icon,
        color=layer.color,
        visible=layer.visible,
        opacity=layer.opacity if layer.opacity is not None else 1.0,
        position=layer.position,
        features=[_feature_out(f) for f in features],
    )


def load_layers(db: Session, trip_id: str) -> list[MapLayer]:
    return list(
        db.scalars(
            select(MapLayer).where(MapLayer.trip_id == trip_id).order_by(MapLayer.position, MapLayer.created_at)
        )
    )


def layer_payload(db: Session, layer: MapLayer) -> MapLayerOut:
    features = list(
        db.scalars(
            select(MapLayerFeature).where(MapLayerFeature.layer_id == layer.id).order_by(MapLayerFeature.created_at)
        )
    )
    return _layer_out(layer, features)


def _owned_layer(db: Session, trip_id: str, layer_id: str) -> MapLayer:
    layer = db.scalar(select(MapLayer).where(MapLayer.id == layer_id, MapLayer.trip_id == trip_id))
    if not layer:
        raise AppError("NOT_FOUND", "图层不存在。")
    return layer


@router.get("/trips/{trip_id}/layers", response_model=list[MapLayerOut])
def list_layers(trip_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[MapLayerOut]:
    trip = get_owned_trip(db, auth.user, trip_id)
    return [layer_payload(db, layer) for layer in load_layers(db, trip.id)]


@router.post("/trips/{trip_id}/layers", response_model=MapLayerOut, status_code=201)
def create_layer(
    trip_id: str,
    payload: MapLayerCreate,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MapLayerOut:
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    position = len(load_layers(db, trip.id))
    layer = MapLayer(
        trip_id=trip.id,
        name=payload.name.strip(),
        kind=payload.kind,
        category=payload.category,
        icon=payload.icon,
        color=payload.color,
        visible=payload.visible,
        opacity=payload.opacity,
        position=position,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer_payload(db, layer)


@router.patch("/trips/{trip_id}/layers/{layer_id}", response_model=MapLayerOut)
def patch_layer(
    trip_id: str,
    layer_id: str,
    payload: MapLayerPatch,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MapLayerOut:
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    layer = _owned_layer(db, trip.id, layer_id)
    if payload.name is not None:
        layer.name = payload.name.strip()
    if payload.icon is not None:
        layer.icon = payload.icon
    if payload.color is not None:
        layer.color = payload.color
    if payload.visible is not None:
        layer.visible = payload.visible
    if payload.opacity is not None:
        layer.opacity = payload.opacity
    db.commit()
    return layer_payload(db, layer)


@router.delete("/trips/{trip_id}/layers/{layer_id}", status_code=204)
def delete_layer(
    trip_id: str,
    layer_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> Response:
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    layer = _owned_layer(db, trip.id, layer_id)
    if layer.kind == "system":
        raise AppError("VALIDATION_ERROR", "系统专题图层不允许删除。")
    db.delete(layer)  # 级联删掉图层里的点
    db.commit()
    return Response(status_code=204)


@router.post("/trips/{trip_id}/layers/{layer_id}/features", response_model=MapLayerOut)
def add_feature(
    trip_id: str,
    layer_id: str,
    payload: MapFeatureCreate,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MapLayerOut:
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    layer = _owned_layer(db, trip.id, layer_id)
    geometry = geostore.point_wkb({"type": "Point", "coordinates": [payload.lon, payload.lat]})
    if geometry is None:
        raise AppError("VALIDATION_ERROR", "坐标不合法。")
    db.add(
        MapLayerFeature(
            layer_id=layer.id,
            name=payload.name.strip(),
            category=payload.category,
            geometry=geometry,
            properties=payload.properties or {},
        )
    )
    db.commit()
    return layer_payload(db, layer)


@router.delete("/trips/{trip_id}/layers/{layer_id}/features/{feature_id}", response_model=MapLayerOut)
def delete_feature(
    trip_id: str,
    layer_id: str,
    feature_id: str,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MapLayerOut:
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    layer = _owned_layer(db, trip.id, layer_id)
    db.execute(delete(MapLayerFeature).where(MapLayerFeature.id == feature_id, MapLayerFeature.layer_id == layer.id))
    db.commit()
    return layer_payload(db, layer)


@router.post("/trips/{trip_id}/layers/{layer_id}/collect", response_model=MapLayerOut)
def collect_pois(
    trip_id: str,
    layer_id: str,
    payload: MapLayerCollectRequest,
    auth: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> MapLayerOut:
    """按图层类别在给定位置抓周边 POI 入库（WGS84）。同名点去重。"""
    trip = get_owned_trip(db, auth.user, trip_id, lock=True)
    layer = _owned_layer(db, trip.id, layer_id)
    keywords = payload.keywords or (SYSTEM_KEYWORDS.get(layer.category or "") if layer.category else None) or layer.name
    rows, provider = registry.around(
        "auto",
        lon=payload.lon,
        lat=payload.lat,
        radius_m=payload.radius_m,
        keywords=keywords,
        limit=payload.limit,
    )
    existing = {
        f.name
        for f in db.scalars(select(MapLayerFeature).where(MapLayerFeature.layer_id == layer.id))
    }
    added = 0
    for row in rows:
        name = str(row.get("name") or "未命名地点")
        if name in existing:
            continue
        geometry = geostore.point_wkb(row.get("geometry"))
        if geometry is None:
            continue
        # 只存供应商真实返回的字段（地址/区县/电话/距离/来源），不补任何猜测值
        extra = row.get("extra") or {}
        properties = {
            "address": row.get("address"),
            "adname": extra.get("adname"),
            "tel": extra.get("tel"),
            "distance": extra.get("distance"),
            "provider": provider,
        }
        db.add(
            MapLayerFeature(
                layer_id=layer.id,
                name=name,
                category=row.get("category"),
                geometry=geometry,
                properties={k: v for k, v in properties.items() if v not in (None, "")},
            )
        )
        existing.add(name)
        added += 1
    db.commit()
    if added == 0:
        raise AppError("EMPTY_RESULT", "这一带没抓到新的点位，可换关键词、半径或地图位置再试。")
    return layer_payload(db, layer)


@router.get("/trips/{trip_id}/layers/{layer_id}/export")
def export_layer(
    trip_id: str,
    layer_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """导出成 GeoJSON（WGS84），浏览器直接下载。"""
    trip = get_owned_trip(db, auth.user, trip_id)
    layer = _owned_layer(db, trip.id, layer_id)
    payload = layer_payload(db, layer)
    features = []
    for feature in payload.features:
        if not feature.geometry:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"name": feature.name, "category": feature.category, **feature.properties},
                "geometry": feature.geometry,
            }
        )
    return {
        "type": "FeatureCollection",
        "name": layer.name,
        "features": features,
    }
