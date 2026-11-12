import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AppSelect from "./AppSelect";
import { GLYPH_BY_ID, GLYPH_LIBRARY, defaultGlyphOf, defaultIcon, drawGlyphDot, drawPinIcon, iconId, resolveGlyph, resolveShape } from "./mapIcons";
// MapLibre 6 起只发布 ESM，且不再提供默认导出；统一用命名空间导入
import * as maplibregl from "maplibre-gl";
import { LngLatBounds, type Map as MapLibreMap } from "maplibre-gl";
import { Input } from "antd";
import HoverTip from "./HoverTip";
import LayerPanel, { categoryLabelOf } from "./LayerPanel";
import type { LayerPanelProps } from "./LayerPanel";
import type { PublicConfig, TimelineOut, TripDetail } from "../api/api";
import { useThemeStore } from "../store/theme";
import { useMapLineStyle, type LineDash } from "../store/app";
import { notify } from "../lib/notify";
import { errorText } from "../api/client";
import { formatArea, formatDistance, gcj02ToWgs84, haversineMeters, wgs84ToGcj02 } from "../lib/coords";
import {
  IconAttraction,
  IconClose,
  IconFit,
  IconLodging,
  IconMeal,
  IconMinus,
  IconOther,
  IconPitch,
  IconPlus,
  IconRotate,
  IconRuler,
  IconShopping,
  IconStack,
  IconTransport,
  IconViewpoint,
} from "./icons";

interface Props {
  trip: TripDetail;
  timeline?: TimelineOut;
  config?: PublicConfig;
  basemapId: string;
  selectedStopId: string | null;
  selectedPlaceId: string | null;
  /** 地点 → 访问序号与首个引用它的事项，编号和右栏卡片同源 */
  placeStops: Map<string, { number: number; stopId: string }>;
  /** 右栏点卡片时递增；地图据此把相机移到该地点 */
  focusStop: { stopId: string; token: number } | null;
  /** 本次会话查询到的真实路网几何：只显示，不入库、不进快照与导出 */
  displayRoutes?: GeoJSON.FeatureCollection;
  /** 图层面板：数据与操作都由上层给，这里只负责在地图上摆一个入口 */
  layerPanel?: LayerPanelProps;
  /** 专题图层（GeoJSON 点图层，跟随行程保存） */
  layers?: Array<{
    id: string;
    name: string;
    kind: string;
    icon?: string | null;
    color?: string | null;
    visible: boolean;
    opacity?: number | null;
    features?: Array<{
      id: string;
      name: string;
      category?: string | null;
      properties?: Record<string, unknown> | null;
      geometry?: { [key: string]: unknown } | null;
    }> | null;
  }>;
  /** 地图视野中心变化时上报（提示文字按规划所在地取坐标） */
  onViewportChange?: (center: { lon: number; lat: number }) => void;
  /** 地图选点模式：点一下取坐标（新建地点用，用户只知道大概位置） */
  pickMode?: boolean;
  onPickPoint?: (lon: number, lat: number) => void;
  onPickCancel?: () => void;
  onSelectStop: (stopId: string | null, placeId: string | null) => void;
  onSelectPlace: (placeId: string) => void;
  onBasemapChange: (id: string) => void;
  /** 清除会话态的真实路网显示（不入库，只影响地图） */
  onClearRoutes?: () => void;
  /** 点搜索结果时临时高亮的点；加进行程前不写入数据 */
  preview?: { lon: number; lat: number; name: string; crs: string } | null;
  onAddAtPoint: (payload: { name: string; category: string; icon: string; lon: number; lat: number }) => Promise<void>;
  onAddToCandidate: (payload: { name: string; category: string; icon: string; lon: number; lat: number; placeId?: string }) => Promise<void>;
  onUpdatePlace: (
    placeId: string,
    payload: { name?: string; category?: string; icon?: string; geometry?: { type: "Point"; coordinates: [number, number] } },
  ) => Promise<void>;
  onDeletePlace: (placeId: string) => Promise<void>;
}

type Basemap = PublicConfig["basemaps"][number];

/** 测距指针：十字准星 + 中心圆点，比默认 crosshair 更容易看清落点 */
const MEASURE_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><line x1='13' y1='1' x2='13' y2='25' stroke='%23e8590c' stroke-width='1'/><line x1='1' y1='13' x2='25' y2='13' stroke='%23e8590c' stroke-width='1'/><circle cx='13' cy='13' r='4' fill='none' stroke='%23e8590c' stroke-width='1.2'/><circle cx='13' cy='13' r='2.4' fill='%23e8590c'/></svg>\") 13 13, crosshair";

const CATEGORY_META = [
  { id: "attraction", label: "景点", glyph: "景", color: "#1668dc", Icon: IconAttraction },
  { id: "meal", label: "餐饮", glyph: "餐", color: "#c76a15", Icon: IconMeal },
  { id: "lodging", label: "住宿", glyph: "住", color: "#7c3aed", Icon: IconLodging },
  { id: "transport", label: "交通", glyph: "车", color: "#0891b2", Icon: IconTransport },
  { id: "shopping", label: "购物", glyph: "购", color: "#c2255c", Icon: IconShopping },
  { id: "viewpoint", label: "观景", glyph: "观", color: "#2b8a3e", Icon: IconViewpoint },
  { id: "other", label: "其他", glyph: "·", color: "#67717e", Icon: IconOther },
];

const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(
  CATEGORY_META.map((item) => [item.id, item.color]),
);

const CATEGORY_OPTIONS = CATEGORY_META.map((item) => ({ value: item.id, label: item.label }));

function dashArrayOf(dash: LineDash): number[] | null {
  if (dash === "dashed") return [4, 3];
  if (dash === "dotted") return [1, 3];
  return null;
}

function graticule(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = 70; lon <= 140; lon += 5) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[lon, 0], [lon, 60]] } });
  }
  for (let lat = 0; lat <= 60; lat += 5) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[70, lat], [140, lat]] } });
  }
  return { type: "FeatureCollection", features };
}

function styleFor(basemap: Basemap | undefined, dark: boolean): maplibregl.StyleSpecification {
  if (basemap && basemap.type === "raster" && basemap.tiles?.length) {
    const attribution = basemap.attribution || "";
    const sources: maplibregl.StyleSpecification["sources"] = {
      base: { type: "raster", tiles: basemap.tiles as string[], tileSize: 256, maxzoom: 18, attribution },
    };
    const layers: maplibregl.StyleSpecification["layers"] = [
      { id: "bg", type: "background", paint: { "background-color": dark ? "#0f151c" : "#f4f6f8" } },
      { id: "base", type: "raster", source: "base" },
    ];
    if (basemap.annotations?.length) {
      sources.anno = { type: "raster", tiles: basemap.annotations as string[], tileSize: 256, maxzoom: 18, attribution };
      layers.push({ id: "anno", type: "raster", source: "anno" });
    }
    return { version: 8, sources, layers };
  }
  return {
    version: 8,
    sources: { graticule: { type: "geojson", data: graticule() } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": dark ? "#0f151c" : "#f4f6f8" } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": dark ? "#1d2732" : "#dfe5ec", "line-width": 0.7 },
      },
    ],
  };
}

function niceScale(metersPerPixel: number, maxPx = 88): { label: string; width: number } {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return { label: "—", width: 0 };
  const target = metersPerPixel * maxPx;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  let nice = pow;
  for (const factor of [1, 2, 5, 10]) {
    if (factor * pow <= target) nice = factor * pow;
  }
  const label = nice >= 1000 ? `${(nice / 1000).toFixed(nice >= 10000 ? 0 : 1)} km` : `${Math.round(nice)} m`;
  return { label, width: Math.round(nice / metersPerPixel) };
}

/** 球面多边形面积（平方米），用于测距闭合后的面积读数。 */
function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const R = 6371008.8;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [lon1, lat1] = points[i];
    const [lon2, lat2] = points[(i + 1) % points.length];
    total +=
      ((lon2 - lon1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

/**
 * 测距时可吸附的目标坐标。
 * - 地点标注任何时候都能吸（第一个测点落在景点上是有意义的）。
 * - 测距自身的点只有「回到起点闭合」才允许：至少已有 3 个不同点，图形才有面积。
 *   吸到刚放下的那个点会生成 0 长度线段，2 个点回到起点是退化图形，都不给提示。
 */
function snapTarget(
  map: MapLibreMap,
  point: { x: number; y: number },
  measurePoints: [number, number][],
): [number, number] | null {
  const layers = ["place-icon", "measure-dots"].filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const hits = map.queryRenderedFeatures(
    [
      [point.x - 12, point.y - 12],
      [point.x + 12, point.y + 12],
    ],
    { layers },
  );
  for (const hit of hits) {
    if (hit.geometry.type !== "Point") continue;
    const coords = hit.geometry.coordinates as [number, number];
    if (hit.layer.id === "place-icon") {
      // 瓦片里的坐标经过量化会有微小偏差，用 feature 上带的原始经纬度更准
      const lon = hit.properties?.mapLon;
      const lat = hit.properties?.mapLat;
      return typeof lon === "number" && typeof lat === "number" ? [lon, lat] : coords;
    }
    const first = measurePoints[0];
    if (measurePoints.length >= 3 && first) {
      // 同样不能按经纬度严格相等比较：栅格化后的点位和原始值差几个小数位，
      // 改用屏幕像素距离判断是不是「回到了起点」
      const a = map.project(first);
      const b = map.project(coords);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 12) return first;
    }
  }
  return null;
}

function CompassNeedle({ bearing }: { bearing: number }) {
  return (
    <svg
      className="compass-needle"
      viewBox="6.2 0.4 7.6 19.2"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ transform: `rotate(${-bearing}deg)` }}
    >
      <path d="M10 1.4 L12.9 10 L7.1 10 Z" fill="#e05252" />
      <path d="M7.1 10 L12.9 10 L10 18.6 Z" fill="#ffffff" stroke="#8f979f" strokeWidth="1.1" />
      <circle cx="10" cy="10" r="1.8" fill="#e05252" stroke="#ffffff" strokeWidth="0.9" />
    </svg>
  );
}

export default function MapCanvas({
  trip,
  timeline,
  config,
  basemapId,
  selectedStopId,
  selectedPlaceId,
  placeStops,
  focusStop,
  displayRoutes,
  layers,
  layerPanel,
  onViewportChange,
  pickMode,
  onPickPoint,
  onPickCancel,
  onSelectStop,
  onSelectPlace,
  onBasemapChange,
  onClearRoutes,
  preview,
  onAddAtPoint,
  onAddToCandidate,
  onUpdatePlace,
  onDeletePlace,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const cameraRef = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const fittedRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);
  const tileErrorCount = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const measuringRef = useRef(false);
  const tripRef = useRef(trip);
  const handlersRef = useRef({ onSelectStop, onSelectPlace });
  tripRef.current = trip;
  handlersRef.current = { onSelectStop, onSelectPlace };

  const dark = useThemeStore((state) => state.resolved) === "dark";
  const lineVisible = useMapLineStyle((state) => state.lineVisible);
  const lineColor = useMapLineStyle((state) => state.lineColor);
  const lineDash = useMapLineStyle((state) => state.lineDash);
  const lineWidth = useMapLineStyle((state) => state.lineWidth);
  const setLineStyle = useMapLineStyle((state) => state.setLineStyle);
  const [status, setStatus] = useState({ lon: 115.9, lat: 28.68, zoom: 10, mpp: 0 });
  // MapLibre 6 要求 WebGL2；初始化失败时在画布位置给出明确提示，而不是留一块空白
  const [mapError, setMapError] = useState<string | null>(null);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  // 底图不透明度：标注压在卫星影像或深色矢量上时，调低底图才看得清
  // 默认压低到 70%：标注压在卫星/矢量底图上才看得清，用户仍可拉回 100%
  const [basemapOpacity, setBasemapOpacity] = useState(0.7);
  const [annoOn, setAnnoOn] = useState(true);
  const [menu, setMenu] = useState<{
    mode: "create" | "edit";
    lngLat: [number, number];
    lon: number;
    lat: number;
    placeId?: string;
  } | null>(null);
  const previewMarker = useRef<maplibregl.Marker | null>(null);
  // 选中标注的波纹：DOM Marker 才能做 CSS 动画，MapLibre 的 circle 图层做不了
  const rippleMarker = useRef<maplibregl.Marker | null>(null);
  // 专题图层点位的选中态：波纹与图标放大共用，点别处即取消
  const layerSelRef = useRef<{ featureId: string; coords: [number, number] } | null>(null);
  const pickModeRef = useRef(false);
  const viewportRef = useRef<((center: { lon: number; lat: number }) => void) | undefined>(undefined);
  const onPickPointRef = useRef<((lon: number, lat: number) => void) | undefined>(undefined);
  const measureLabelMarkers = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  // 浮层内容挂在这个容器里，由 Popup 接管定位
  const [menuEl] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(() => ({ name: "", category: "other", icon: defaultIcon("other") }));
  const [menuBusy, setMenuBusy] = useState(false);
  // measuring＝浮层要不要显示；measureAdding＝还能不能继续左键加点
  const [measuring, setMeasuring] = useState(false);
  const [measureAdding, setMeasureAdding] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  // 鼠标落在已有点的吸附范围内时，在那一处画一圈提示，告诉用户「松手会吸到这里」
  const [snapAt, setSnapAt] = useState<{ x: number; y: number } | null>(null);
  // mousemove / click 是地图事件回调，读不到最新的 state，用 ref 同步当前测点
  const measurePointsRef = useRef<[number, number][]>([]);
  const focusTokenRef = useRef(0);

  measuringRef.current = measureAdding;
  measurePointsRef.current = measurePoints;
  pickModeRef.current = pickMode ?? false;
  onPickPointRef.current = onPickPoint;
  viewportRef.current = onViewportChange;

  const basemap = useMemo(
    () => config?.basemaps.find((item) => item.id === basemapId) ?? config?.basemaps[0],
    [config, basemapId],
  );
  const hasAnno = Boolean(basemap?.annotations?.length);

  const project = useCallback(
    (coords: [number, number]): [number, number] =>
      basemap?.crs === "GCJ02" ? wgs84ToGcj02(coords[0], coords[1]) : coords,
    [basemap?.crs],
  );

  // 选点模式：光标改十字，Esc 取消
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
    if (!pickMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPickCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode, onPickCancel]);

  useEffect(() => {
    if (!containerRef.current) return;
    tileErrorCount.current = 0;
    setMapError(null);
    const camera = cameraRef.current;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleFor(basemap, useThemeStore.getState().resolved === "dark"),
        center: camera?.center ?? [115.9, 28.68],
        zoom: camera?.zoom ?? 10,
        bearing: camera?.bearing ?? 0,
        pitch: camera?.pitch ?? 0,
        attributionControl: false,
        dragPan: false,
      });
    } catch (error) {
      // MapLibre 6 在无法创建 WebGL2 上下文时从构造函数抛出 GPUInitializationError
      setMapError(error instanceof Error ? error.message : "地图初始化失败");
      return;
    }
    mapRef.current = map;
    // 构造参数里的 dragPan:false 不可靠，这里显式关掉左键平移
    map.dragPan.disable();
    map.getCanvas().style.cursor = "default";
    setBearing(map.getBearing());
    setPitch(map.getPitch());

    const paint = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const center = map.getCenter();
        const mpp = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
        setStatus((prev) =>
          prev.zoom === map.getZoom() && Math.abs(prev.lon - center.lng) < 1e-7
            ? prev
            : { ...prev, lon: center.lng, lat: center.lat, zoom: map.getZoom(), mpp },
        );
      });
    };

    paint();
    const onStyleReady = () => {
      paint();
      drawRef.current();
    };
    map.on("style.load", onStyleReady);
    map.on("load", onStyleReady);
    map.on("idle", paint);
    map.on("move", paint);
    map.on("rotate", () => {
      let value = map.getBearing() % 360;
      if (value < 0) value += 360;
      setBearing(value);
    });
    map.on("pitch", () => setPitch(map.getPitch()));
    map.on("mousemove", (event) => {
      setStatus((prev) => ({ ...prev, lon: event.lngLat.lng, lat: event.lngLat.lat }));
      if (!measuringRef.current) {
        setSnapAt(null);
        return;
      }
      const target = snapTarget(map, event.point, measurePointsRef.current);
      if (target) {
        const point = map.project(target);
        setSnapAt({ x: point.x, y: point.y });
      } else {
        setSnapAt(null);
      }
    });
    map.on("mouseout", () => {
      const center = map.getCenter();
      setStatus((prev) => ({ ...prev, lon: center.lng, lat: center.lat }));
    });

    map.on("click", "place-icon", (event) => {
      if (measuringRef.current) return;
      const feature = event.features?.[0];
      if (!feature) return;
      const placeId = String(feature.properties?.placeId ?? "");
      const stopId = feature.properties?.stopId ? String(feature.properties.stopId) : null;
      if (stopId) handlersRef.current.onSelectStop(stopId, placeId);
      else handlersRef.current.onSelectPlace(placeId);
    });

    // 专题图层点位信息浮层：与右键浮层同一套样式（.map-menu），标题「图层名：点名」，
    // 右侧 ✕ 关闭；正文只留点位信息（类别/地址/电话/经纬度等），不再重复图层行。
    let infoPopup: maplibregl.Popup | null = null;
    const closeLayerInfo = () => {
      infoPopup?.remove();
      infoPopup = null;
      if (layerSelRef.current) {
        layerSelRef.current = null;
        drawRef.current();
      }
    };
    const showLayerInfo = (hit: maplibregl.MapGeoJSONFeature) => {
      const p = (hit.properties ?? {}) as Record<string, unknown>;
      const coords = (hit.geometry as { coordinates?: [number, number] }).coordinates;
      if (!coords) return;
      const box = document.createElement("div");
      box.className = "map-menu map-menu-info";
      const head = document.createElement("div");
      head.className = "map-menu-head";
      const title = document.createElement("span");
      title.className = "map-menu-title";
      const layerName = String(p.layerName ?? "");
      title.textContent = `${layerName || categoryLabelOf(String(p.category ?? "")) || "点位"}：${String(p.name ?? "未命名")}`;
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "map-menu-close";
      closeBtn.setAttribute("aria-label", "关闭");
      closeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        closeLayerInfo();
      });
      head.append(title, closeBtn);
      box.appendChild(head);
      // 只展示供应商真实回传的字段（categories/地址/电话/区县/距离/来源），缺失的行直接不显示
      const rows: Array<[string, string]> = [];
      const category = categoryLabelOf(String(p.category ?? ""));
      if (category) rows.push(["类别", category]);
      if (p.address) rows.push(["地址", String(p.address)]);
      if (p.tel) rows.push(["电话", String(p.tel)]);
      if (p.adname) rows.push(["区县", String(p.adname)]);
      if (p.distance !== undefined && p.distance !== null && p.distance !== "") rows.push(["距离", `${p.distance} 米`]);
      if (p.provider) rows.push(["来源", String(p.provider) === "amap" ? "高德地图" : String(p.provider)]);
      rows.push(["经度", Number(p.lon).toFixed(5)]);
      rows.push(["纬度", Number(p.lat).toFixed(5)]);
      for (const [key, value] of rows) {
        const row = document.createElement("div");
        row.className = "map-menu-row";
        const k = document.createElement("span");
        k.className = "map-menu-label";
        k.textContent = key;
        const v = document.createElement("b");
        v.textContent = value;
        row.append(k, v);
        box.appendChild(row);
      }
      infoPopup?.remove();
      infoPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        closeOnMove: false,
        offset: 12,
        maxWidth: "300px",
        className: "map-popup",
      })
        .setLngLat(coords)
        .setDOMContent(box)
        .addTo(map);
      // 选中反馈与地点标注一致：波纹 + 图标放大
      layerSelRef.current = { featureId: String(p.id ?? ""), coords };
      drawRef.current();
    };

    map.on("click", (event) => {
      // 专题图层点位：点击弹点位信息（选点模式让位给取坐标；压住地点标注时不弹，避免抢选中）
      if (!pickModeRef.current) {
        const hits = map.queryRenderedFeatures(event.point);
        const layerHit = hits.find(
          (f) => typeof f.layer?.id === "string" && f.layer.id.startsWith("layer-") && f.layer.id.endsWith("-sym"),
        );
        const onPlace = map.getLayer("place-icon")
          ? map.queryRenderedFeatures(
              [
                [event.point.x - 8, event.point.y - 8],
                [event.point.x + 8, event.point.y + 8],
              ],
              { layers: ["place-icon"] },
            )
          : [];
        if (layerHit && !onPlace.length) {
          showLayerInfo(layerHit);
          handlersRef.current.onSelectStop(null, null);
          return;
        }
      }
      // 点其他区域：收起信息浮层并取消图层点位选中
      closeLayerInfo();
      setMenu(null);
      // 点到标注之外就取消高亮；标注自身的 click 已先一步设置选中，这里不能把它清掉
      const onMarker = map.getLayer("place-icon")
        ? map.queryRenderedFeatures(
            [
              [event.point.x - 8, event.point.y - 8],
              [event.point.x + 8, event.point.y + 8],
            ],
            { layers: ["place-icon"] },
          )
        : [];
      if (!onMarker.length) handlersRef.current.onSelectStop(null, null);
      if (!measuringRef.current) return;
      // 捕捉：只吸有意义的点（地点标注，或已有 3 点后回到起点闭合）
      const snap = snapTarget(map, event.point, measurePointsRef.current);
      const coords: [number, number] = snap ?? [event.lngLat.lng, event.lngLat.lat];
      setMeasurePoints((prev) => {
        // 已经闭合的图形不再往上加点：再点一下就是量新的一块
        if (prev.length > 3) {
          const first = map.project(prev[0]);
          const firstPoint = prev[0];
          if (Math.abs(firstPoint[0] - prev[prev.length - 1][0]) < 1e-9 && Math.abs(firstPoint[1] - prev[prev.length - 1][1]) < 1e-9) {
            if (Math.hypot(first.x - event.point.x, first.y - event.point.y) >= 12) {
              return [coords];
            }
          }
        }
        // 闭合按屏幕像素判断：至少 3 个不同点，围出来的图形才有面积
        if (prev.length >= 3) {
          const first = map.project(prev[0]);
          if (Math.hypot(first.x - event.point.x, first.y - event.point.y) < 12) {
            return [...prev, prev[0]];
          }
        }
        return [...prev, coords];
      });
    });

    // 视野中心上报：moveend 覆盖缩放/复位，dragend 覆盖拖拽
    // （拖拽结束时这个 headless 环境下 moveend 不一定补发，两条都听才稳）
    const reportCenter = () => {
      const center = map.getCenter();
      viewportRef.current?.({ lon: center.lng, lat: center.lat });
    };
    map.on("moveend", reportCenter);
    map.on("dragend", reportCenter);

    map.on("click", (event) => {
      if (!pickModeRef.current) return;
      const [lon, lat] =
        basemap?.crs === "GCJ02" ? gcj02ToWgs84(event.lngLat.lng, event.lngLat.lat) : [event.lngLat.lng, event.lngLat.lat];
      onPickPointRef.current?.(lon, lat);
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      if (pickModeRef.current) return;
      // 测距中右键：只结束加点，保留测距浮层与已有结果，不再补最后一个点
      if (measuringRef.current) {
        setMeasureAdding(false);
        measuringRef.current = false;
        map.getCanvas().style.cursor = "default";
        return;
      }
      const hits = map.getLayer("place-icon")
        ? map.queryRenderedFeatures(
            [
              [event.point.x - 10, event.point.y - 10],
              [event.point.x + 10, event.point.y + 10],
            ],
            { layers: ["place-icon"] },
          )
        : [];
      const hit = hits[0];
      const placeId = hit?.properties?.placeId ? String(hit.properties.placeId) : null;
      const place = placeId ? tripRef.current.places.find((item) => item.id === placeId) : null;
      if (place) {
        // 右键标注也高亮：和左键、右栏卡片三处选中状态保持一致
        const stopId = hit?.properties?.stopId ? String(hit.properties.stopId) : null;
        if (stopId) handlersRef.current.onSelectStop(stopId, place.id);
        else handlersRef.current.onSelectPlace(place.id);
        const coords = place.geometry?.coordinates as [number, number] | undefined;
        setDraft({ name: place.name, category: place.category || "other", icon: place.icon || defaultIcon(place.category || "other") });
        setMenu({
          mode: "edit",
          lngLat: [event.lngLat.lng, event.lngLat.lat],
          lon: coords?.[0] ?? 0,
          lat: coords?.[1] ?? 0,
          placeId: place.id,
        });
        return;
      }
      handlersRef.current.onSelectStop(null, null);
      setDraft({ name: "", category: "other", icon: defaultIcon("other") });
      // 浮层里显示的经纬度统一用 WGS84，落库口径与状态栏一致
      const [lon, lat] =
        basemap?.crs === "GCJ02" ? gcj02ToWgs84(event.lngLat.lng, event.lngLat.lat) : [event.lngLat.lng, event.lngLat.lat];
      setMenu({ mode: "create", lngLat: [event.lngLat.lng, event.lngLat.lat], lon, lat });
    });

    map.on("error", (event) => {
      if (!basemap?.id.startsWith("tianditu")) return;
      const message = String((event as unknown as { error?: { message?: string } }).error?.message ?? "");
      if (!/403|Forbidden/i.test(message)) return;
      tileErrorCount.current += 1;
      if (tileErrorCount.current !== 3) return;
      notify.notify("底图瓦片加载失败", {
        type: "warning",
        description:
          "天地图返回 403（域名不匹配）。请到天地图控制台，把当前访问地址加入该「浏览器端」Key 的域名白名单，例如 localhost 与 127.0.0.1。",
        duration: 10,
        key: "tile-forbidden",
      });
    });

    // 左键不再拖图：按住中键（滚轮）平移，符合 GIS 软件习惯
    const canvas = map.getCanvas();
    let dragging = false;
    let last = { x: 0, y: 0 };
    const onDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      dragging = true;
      last = { x: event.clientX, y: event.clientY };
      // 抓住地图时指针变抓手，松开恢复，位置指示才符合“我在搬这张图”
      canvas.style.cursor = "grabbing";
    };
    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      event.preventDefault();
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
      map.panBy([-dx, -dy], { duration: 0 });
    };
    const onUp = (event: MouseEvent) => {
      if (event.button === 1) {
        dragging = false;
        canvas.style.cursor = measuringRef.current ? MEASURE_CURSOR : "default";
      }
    };
    const onAux = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("auxclick", onAux);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      const center = map.getCenter();
      cameraRef.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("auxclick", onAux);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rippleMarker.current?.remove();
      rippleMarker.current = null;
      previewMarker.current?.remove();
      previewMarker.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getLayer("base")) return;
      try {
        map.setPaintProperty("base", "raster-opacity", basemapOpacity);
        // 深色主题下把栅格底图压暗：天地图/高德没有官方深色瓦片，
        // 用 raster 的亮度/饱和度参数调，比给整个 canvas 加 CSS 滤镜好——
        // 后者会把标注和线路一起染黑
        map.setPaintProperty("base", "raster-brightness-max", dark ? 0.62 : 1);
        map.setPaintProperty("base", "raster-saturation", dark ? -0.18 : 0);
      } catch {
        // 样式还没就绪，等 idle 再试一次
      }
    };

    apply();
    // 首次进入时 style 还没加载完，apply 会扑空，这里补一次
    map.once("idle", apply);
    return () => {
      map.off("idle", apply);
    };
  }, [basemapOpacity, basemapId, dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    if (map.getLayer("bg")) {
      map.setPaintProperty("bg", "background-color", dark ? "#0f151c" : "#f4f6f8");
    }
    if (map.getLayer("graticule")) {
      map.setPaintProperty("graticule", "line-color", dark ? "#1d2732" : "#dfe5ec");
    }
  }, [dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("anno")) return;
    map.setLayoutProperty("anno", "visibility", annoOn ? "visible" : "none");
  }, [annoOn, basemapId]);

  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // antd 浮层（气泡/下拉/弹窗）里的点击不算“点地图外”，否则卡住的气泡会误关面板
      if (target?.closest(".ant-tooltip, .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .ant-modal-wrap, .maplibregl-popup")) return;
      if (toolsRef.current && !toolsRef.current.contains(target as Node)) setLayersOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [layersOpen]);

  // 搜索结果预览：飞过去并插一个临时标记，加进行程后由正式标注取代
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!preview) {
      previewMarker.current?.remove();
      previewMarker.current = null;
      return;
    }
    // 后端返回的 geometry 已经统一成 WGS84（source_crs 只记录上游来源，不是这份坐标的坐标系）。
    // 之前按 source_crs 又转了一次，预览点才会跟加进行程后的标注差出几十米。
    const lonlat = project([preview.lon, preview.lat]);

    const element = document.createElement("div");
    element.className = "preview-pin";
    element.title = preview.name;
    element.innerHTML = `<span class="preview-pin-dot"></span><span class="preview-pin-ring"></span>`;

    previewMarker.current?.remove();
    previewMarker.current = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat(lonlat)
      .addTo(map);
    map.flyTo({ center: lonlat, zoom: Math.max(map.getZoom(), 15), duration: 700 });
  }, [preview, basemap?.crs]);

  // 右栏点卡片：相机移到该事项所在地点，高亮由 selectedPlaceId 驱动，两处同步
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStop || focusStop.token === focusTokenRef.current) return;
    focusTokenRef.current = focusStop.token;
    const stop = trip.stops.find((item) => item.id === focusStop.stopId);
    const place = stop?.place_id ? trip.places.find((item) => item.id === stop.place_id) : null;
    const coords = place?.geometry?.coordinates as [number, number] | undefined;
    if (!coords) return;
    map.flyTo({ center: project(coords), zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [focusStop, trip, project]);

  // 浮层交给 maplibregl.Popup 托管：锚点是经纬度，地图平移/缩放/旋转时引擎自己跟，
  // 靠边时还会自动翻转方位，不用手算屏幕坐标和边界夹取。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !menuEl) return;
    if (!menu) {
      popupRef.current?.remove();
      popupRef.current = null;
      return;
    }
    let popup = popupRef.current;
    if (!popup) {
      popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: 12,
        maxWidth: "380px",
        className: "map-popup",
      });
      popupRef.current = popup;
    }
    popup.setLngLat(menu.lngLat).setDOMContent(menuEl).addTo(map);
  }, [menu, menuEl]);

  useEffect(() => {
    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      for (const marker of measureLabelMarkers.current) marker.remove();
      measureLabelMarkers.current = [];
    };
  }, []);

  // 点浮层外面（非地图区域）也关掉
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!(target instanceof Element)) return;
      if (menuRef.current?.contains(target)) return;
      if (mapRef.current?.getCanvas().contains(target)) return;
      // 下拉、气泡这些浮层挂在 body 上，点它们不算「点到外面」
      if (target.closest(".ant-select-dropdown, .ant-tooltip, .ant-dropdown")) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  useEffect(() => {
    if (!measuring) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMeasuring(false);
      setMeasureAdding(false);
      setMeasurePoints([]);
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = "default";
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [measuring]);

  const measure = useMemo(() => {
    const last = measurePoints[measurePoints.length - 1];
    const closed =
      measurePoints.length > 3 &&
      !!last &&
      Math.abs(measurePoints[0][0] - last[0]) < 1e-9 &&
      Math.abs(measurePoints[0][1] - last[1]) < 1e-9;
    let total = 0;
    for (let i = 1; i < measurePoints.length; i += 1) {
      total += haversineMeters(measurePoints[i - 1], measurePoints[i]);
    }
    return { closed, total, area: closed ? polygonArea(measurePoints) : 0 };
  }, [measurePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      const accent = dark ? "#4c9aff" : "#1668dc";

      // 图标按需现画：每个点用「类别颜色 + 形状轮廓 + 图标图案 + 序号」拼出一张图。
      // 图案来自图标库，同一类别下可换，所以 key 里带 glyph id，不按类别固定。
      const ensureImage = (place: TripDetail["places"][number], category: string, number: number | null) => {
        const shape = resolveShape(place.icon);
        const glyph = resolveGlyph(place.icon, category);
        const key = `pin-${category}-${shape.id}-${glyph.id}${number === null ? "" : `-n${number}`}`;
        if (!map.hasImage(key)) {
          const color = CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
          const image = drawPinIcon(shape, color, {
            category,
            glyph: glyph.paths,
            label: number === null ? undefined : String(number),
          });
          if (image) map.addImage(key, image, { pixelRatio: 2 });
        }
        return key;
      };

      const placeFeatures: GeoJSON.Feature[] = [];
      for (const place of trip.places) {
        const raw = place.geometry?.coordinates as [number, number] | undefined;
        if (!raw) continue;
        const meta = placeStops.get(place.id);
        const mapped = project(raw);
        const category = place.category || "other";
        placeFeatures.push({
          type: "Feature",
          properties: {
            placeId: place.id,
            mapLon: mapped[0],
            mapLat: mapped[1],
            stopId: meta?.stopId ?? null,
            index: meta ? meta.number : null,
            label: meta ? String(meta.number) : "",
            category,
            iconKey: ensureImage(place, category, meta ? meta.number : null),
            color: CATEGORY_COLOR[place.category] ?? CATEGORY_COLOR.other,
            selected: selectedPlaceId === place.id,
          },
          geometry: { type: "Point", coordinates: mapped },
        });
      }

      // 真实路网几何只有两个来源：已落库的路段（本项目的持久化策略不允许保存供应商几何），
      // 以及本次会话刚查询到、只留在内存里的结果。手工录入的耗时没有几何，不在这里画线。
      // 两个来源存的都是 WGS84，必须逐点 project 到当前底图基准，否则 GCJ02 底图上会整体偏移。
      const projectLine = (geometry: { coordinates: number[][] }) => ({
        type: "LineString" as const,
        coordinates: geometry.coordinates.map((pair) => project([pair[0], pair[1]])),
      });
      const realRoutes: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          ...trip.route_legs
            .filter((leg) => leg.geometry)
            .map((leg) => ({
              type: "Feature" as const,
              properties: { id: leg.id },
              geometry: projectLine(leg.geometry as unknown as { coordinates: number[][] }),
            })),
          ...(displayRoutes?.features ?? []).map((feature) => ({
            ...feature,
            geometry:
              feature.geometry && feature.geometry.type === "LineString"
                ? projectLine(feature.geometry as unknown as { coordinates: number[][] })
                : feature.geometry,
          })),
        ],
      };
      const sketchLines: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const day of trip.days) {
        const dayStops = trip.stops.filter((stop) => stop.day_id === day.id).sort((a, b) => a.position - b.position);
        const points: [number, number][] = [];
        for (const stop of dayStops) {
          const place = trip.places.find((item) => item.id === stop.place_id);
          const coords = place?.geometry?.coordinates as [number, number] | undefined;
          if (coords) points.push(project(coords));
        }
        if (points.length > 1) {
          sketchLines.features.push({
            type: "Feature",
            properties: { day: day.id, approximate: true },
            geometry: { type: "LineString", coordinates: points },
          });
        }
      }

      const ensureSource = (id: string, data: GeoJSON.FeatureCollection, layer: maplibregl.LayerSpecification) => {
        const existing = map.getSource(id);
        if (existing) {
          (existing as maplibregl.GeoJSONSource).setData(data);
        } else {
          map.addSource(id, { type: "geojson", data });
          map.addLayer(layer);
        }
      };

      const dashArray = dashArrayOf(lineDash);
      ensureSource("sketch-lines", sketchLines, {
        id: "sketch-lines",
        type: "line",
        source: "sketch-lines",
        paint: {
          "line-color": lineColor,
          "line-width": lineWidth,
          ...(dashArray ? { "line-dasharray": dashArray } : {}),
        },
        layout: { visibility: lineVisible ? "visible" : "none" },
      });
      if (map.getLayer("sketch-lines")) {
        map.setPaintProperty("sketch-lines", "line-color", lineColor);
        map.setPaintProperty("sketch-lines", "line-width", lineWidth);
        // MapLibre 6 的类型不再接受 null；undefined 在运行时同样表示“复位成样式默认值”
        map.setPaintProperty("sketch-lines", "line-dasharray", dashArray ?? undefined);
        map.setLayoutProperty("sketch-lines", "visibility", lineVisible ? "visible" : "none");
      }
      ensureSource("real-routes", realRoutes, {
        id: "real-routes",
        type: "line",
        source: "real-routes",
        paint: { "line-color": accent, "line-width": 2.4, "line-opacity": 0.85 },
      });

      // 专题图层：每层一个 GeoJSON 源 + 一个符号层，显隐只切数据，不重建图层
      for (const layer of layers ?? []) {
        const features: GeoJSON.Feature[] = [];
        if (layer.visible) {
          for (const feature of layer.features ?? []) {
            const coords = (feature.geometry as { coordinates?: number[] } | null | undefined)?.coordinates as
              | [number, number]
              | undefined;
            if (!coords) continue;
            // 属性里带足点位信息，点击标注时浮层展示（坐标存 WGS84 原值，口径与状态栏一致）
            const detail = (feature.properties ?? {}) as Record<string, unknown>;
            features.push({
              type: "Feature",
              properties: {
                id: feature.id,
                name: feature.name,
                category: feature.category ?? "",
                lon: coords[0],
                lat: coords[1],
                layerId: layer.id,
                layerName: layer.name,
                address: detail.address ?? "",
                tel: detail.tel ?? "",
                adname: detail.adname ?? "",
                distance: detail.distance ?? "",
                provider: detail.provider ?? "",
                selected: layerSelRef.current?.featureId === feature.id ? 1 : 0,
              },
              geometry: { type: "Point", coordinates: project(coords) },
            });
          }
        }
        const imageKey = `layerdot-${layer.id}`;
        if (!map.hasImage(imageKey)) {
          const glyph = (layer.icon && GLYPH_BY_ID.get(layer.icon)) || GLYPH_BY_ID.get("pin");
          const image = drawGlyphDot(layer.color || "#1668dc", glyph?.paths ?? []);
          if (image) map.addImage(imageKey, image, { pixelRatio: 2 });
        }
        const sourceId = `layer-${layer.id}`;
        ensureSource(sourceId, { type: "FeatureCollection", features }, {
          id: `${sourceId}-sym`,
          type: "symbol",
          source: sourceId,
          layout: {
            "icon-image": imageKey,
            // 选中放大与地点标注同一套路：数据里带 selected，表达式自动跟着数据走
            "icon-size": ["case", ["==", ["get", "selected"], 1], 1.25, 0.9],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": layer.opacity ?? 1 },
        });
        // 图层改透明度时 ensureSource 只更新数据，这里补一次绘制属性
        if (map.getLayer(`${sourceId}-sym`)) {
          map.setPaintProperty(`${sourceId}-sym`, "icon-opacity", layer.opacity ?? 1);
        }
      }

      // 只保留 source 与图标层：序号不再是独立圆形徽标，而是画在针形图标头部里
      const placesData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: placeFeatures };
      const existingPlaces = map.getSource("places");
      if (existingPlaces) {
        (existingPlaces as maplibregl.GeoJSONSource).setData(placesData);
      } else {
        map.addSource("places", { type: "geojson", data: placesData });
      }
      // 旧版静态光环图层若还在（热更新时地图实例未重建），先清掉
      if (map.getLayer("place-highlight")) map.removeLayer("place-highlight");
      // 选中高亮改成波纹：和搜索结果预览点同一套动画，图标同时放大。
      // 波纹是 DOM Marker，MapLibre 的 circle 图层做不了 CSS 动画。
      // 地点标注与专题图层点位共用一个波纹：两者互斥选中，谁亮就站在谁的坐标上。
      const selectedFeature = placeFeatures.find((feature) => feature.properties?.selected === true);
      const placeCoords =
        selectedFeature?.geometry.type === "Point"
          ? (selectedFeature.geometry.coordinates as [number, number])
          : null;
      const rippleCoords = placeCoords ?? layerSelRef.current?.coords ?? null;
      if (rippleCoords) {
        let marker = rippleMarker.current;
        if (!marker) {
          const el = document.createElement("div");
          el.className = "select-ripple";
          el.innerHTML = "<i></i><i></i>";
          // setLngLat 必须在 addTo 之前：addTo 会立刻触发一次 _update，
          // 此时若还没有经纬度，MapLibre 会对 undefined 取 .lng 并抛错
          marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(rippleCoords).addTo(map);
          rippleMarker.current = marker;
        }
        marker.setLngLat(rippleCoords);
      } else {
        rippleMarker.current?.remove();
        rippleMarker.current = null;
      }
      // 图标层：所有标注都画成选定的针形，形状由 place.icon 决定。
      // 这里必须单独 addLayer——ensureSource 会先看 source 是否存在，places 已由上面的
      // circle 图层建过，走 ensureSource 就只 setData、图层永远加不上，地图上只剩数字圈。
      if (!map.getLayer("place-icon")) {
        map.addLayer({
          id: "place-icon",
          type: "symbol",
          source: "places",
          layout: {
            "icon-image": ["get", "iconKey"],
            "icon-size": ["case", ["get", "selected"], 1.38, 1.15],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      }

      const measureLine: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features:
          measurePoints.length > 1
            ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: measurePoints } }]
            : [],
      };
      const measureDots: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: measurePoints.map((point) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: point },
        })),
      };
      const measureLabels: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      for (let i = 1; i < measurePoints.length; i += 1) {
        const a = measurePoints[i - 1];
        const b = measurePoints[i];
        measureLabels.features.push({
          type: "Feature",
          properties: { label: formatDistance(haversineMeters(a, b)) },
          geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        });
      }
      // 闭合时在范围中心给一块汇总：面积 + 周长
      if (measure.closed && measurePoints.length > 3) {
        const ring = measurePoints.slice(0, -1);
        const cx = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
        const cy = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
        measureLabels.features.push({
          type: "Feature",
          properties: {
            label: `面积 ${formatArea(measure.area)}\n周长 ${formatDistance(measure.total)}`,
            summary: true,
          },
          geometry: { type: "Point", coordinates: [cx, cy] },
        });
      }

      ensureSource("measure-line", measureLine, {
        id: "measure-line",
        type: "line",
        source: "measure-line",
        paint: { "line-color": "#e8590c", "line-width": 2, "line-dasharray": [3, 2] },
      });
      ensureSource("measure-dots", measureDots, {
        id: "measure-dots",
        type: "circle",
        source: "measure-dots",
        paint: { "circle-radius": 4, "circle-color": "#e8590c", "circle-stroke-color": "#e8590c", "circle-stroke-width": 1 },
      });
      // 测距读数用 DOM 标注而不是 symbol 文本：
      // symbol 只能描边（halo），给不了真正的底色块，而且字号随缩放一起变。
      for (const marker of measureLabelMarkers.current) marker.remove();
      measureLabelMarkers.current = measureLabels.features.map((feature) => {
        const el = document.createElement("div");
        el.className = `measure-label${feature.properties?.summary ? " summary" : ""}`;
        // 小比例尺下把字号压小，避免多个读数挤在一起盖住线
        const zoom = map.getZoom();
        el.style.fontSize = zoom >= 15 ? "13px" : zoom >= 13 ? "12px" : "11px";
        el.textContent = String(feature.properties?.label ?? "");
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coords).addTo(map);
      });

      if (map.getLayer("anno")) {
        map.setLayoutProperty("anno", "visibility", annoOn ? "visible" : "none");
      }
    };

    drawRef.current = draw;
    try {
      draw();
    } catch {
      // 样式或 sprite 尚未就绪。这里不能等 style.load：它只在样式重建时触发一次，
      // 错过就再也不来，标注会一直空到用户下次切底图。styledata 每次样式数据变化都触发。
      map.once("styledata", draw);
    }
  }, [trip, selectedStopId, selectedPlaceId, placeStops, dark, basemapId, annoOn, measurePoints, project, lineColor, lineDash, lineVisible, lineWidth, displayRoutes, layers]);

  const fitToPlaces = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = trip.places
      .map((place) => place.geometry?.coordinates as [number, number] | undefined)
      .filter(Boolean) as [number, number][];
    if (!points.length) return;
    const projected = points.map((point) => project(point));
    const bounds = projected.reduce((acc, point) => acc.extend(point), new LngLatBounds(projected[0], projected[0]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 400 });
  }, [trip.places, project]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${trip.id}:${trip.places.length}:${basemap?.crs ?? ""}`;
    if (fittedRef.current === key) return;
    const run = () => {
      fitToPlaces();
      fittedRef.current = key;
    };
    if (map.getStyle()) run();
    else map.once("style.load", run);
  }, [trip.id, trip.places.length, basemap?.crs, fitToPlaces]);

  const resetNorth = () => {
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  };

  const toggleMeasure = () => {
    if (measuring) {
      setMeasuring(false);
      setMeasureAdding(false);
      setMeasurePoints([]);
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = "default";
      return;
    }
    setMeasuring(true);
    setMeasureAdding(true);
    setMeasurePoints([]);
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = MEASURE_CURSOR;
  };

  const submitPoint = async () => {
    if (!menu) return;
    const name = draft.name.trim();
    if (!name) {
      notify.warning("请填写名称");
      return;
    }
    setMenuBusy(true);
    try {
      if (menu.mode === "edit" && menu.placeId) {
        await onUpdatePlace(menu.placeId, {
          name,
          category: draft.category,
          icon: draft.icon,
          geometry: { type: "Point", coordinates: [menu.lon, menu.lat] },
        });
      } else {
        // 同一位置不允许重复落点：容差在设置页里配，0 表示不限制
        const tolerance = Number(localStorage.getItem("tp-marker-tolerance") ?? 15);
        const tooClose =
          tolerance > 0 &&
          trip.places.some((place) => {
            const coords = place.geometry?.coordinates as [number, number] | undefined;
            return coords ? haversineMeters(coords, [menu.lon, menu.lat]) < tolerance : false;
          });
        if (tooClose) {
          notify.warning("这个位置已有标注，换个位置再添加");
          return;
        }
        await onAddAtPoint({ name, category: draft.category, icon: draft.icon, lon: menu.lon, lat: menu.lat });
      }
      setMenu(null);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setMenuBusy(false);
    }
  };

  const submitCandidate = async () => {
    if (!menu) return;
    const name = draft.name.trim();
    if (!name) {
      notify.warning("请填写名称");
      return;
    }
    setMenuBusy(true);
    try {
      await onAddToCandidate({
        name,
        category: draft.category,
        icon: draft.icon,
        lon: menu.lon,
        lat: menu.lat,
        placeId: menu.mode === "edit" ? menu.placeId : undefined,
      });
      setMenu(null);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setMenuBusy(false);
    }
  };

  const removePoint = async () => {
    if (!menu?.placeId) return;
    setMenuBusy(true);
    try {
      await onDeletePlace(menu.placeId);
      setMenu(null);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setMenuBusy(false);
    }
  };

  const conflictCount = timeline?.days.reduce((sum, day) => sum + (day.conflicts?.length ?? 0), 0) ?? 0;
  const scale = niceScale(status.mpp);
  const activeBasemapId = basemap?.id ?? "blank";
  const showAngles = Math.round(bearing) !== 0 || Math.round(pitch) !== 0;

  return (
    <div className="map-wrap">
      <div className="map" ref={containerRef} />
      {mapError ? (
        <div className="map-fallback" role="alert">
          <b>地图无法初始化</b>
          <span>当前浏览器没有可用的 WebGL2 上下文，地图引擎无法启动。</span>
          <span>请更新浏览器或显卡驱动后重试；日程、时间线和攻略仍可正常使用。</span>
          <code>{mapError}</code>
        </div>
      ) : null}

      <div className="map-tools" ref={toolsRef}>
        <div className="map-tool-group">
          <div className="map-btn-slot">
            <HoverTip title="放大" placement="right">
              <button type="button" className="map-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="放大">
                <IconPlus />
              </button>
            </HoverTip>
          </div>
          <div className="map-btn-slot">
            <HoverTip title="缩小" placement="right">
              <button type="button" className="map-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="缩小">
                <IconMinus />
              </button>
            </HoverTip>
          </div>
          <div className="map-btn-slot">
            <HoverTip title="缩放到全部地点" placement="right">
              <button type="button" className="map-btn" onClick={fitToPlaces} aria-label="缩放至全部地点">
                <IconFit />
              </button>
            </HoverTip>
          </div>
          <div className="map-btn-slot">
            <HoverTip title="指北针：点击回正" placement="top" disabled={showAngles}>
              <button type="button" className="map-btn" onClick={resetNorth} aria-label="指北针，点击回正">
                <CompassNeedle bearing={bearing} />
              </button>
            </HoverTip>
            {showAngles ? (
              <div className="map-btn-pop">
                <HoverTip title="俯仰角"><span className="mb-item">
                  <IconPitch width={12} height={12} />
                  <b>{Math.round(pitch)}°</b>
                </span></HoverTip>
                <HoverTip title="旋转角"><span className="mb-item">
                  <IconRotate width={12} height={12} />
                  <b>{Math.round(bearing)}°</b>
                </span></HoverTip>
              </div>
            ) : null}
          </div>
          <div className="map-btn-slot">
            <HoverTip title="测距：左键加测点，右键结束" placement="top" disabled={measuring}>
              <button
                type="button"
                className={`map-btn${measuring ? " active" : ""}`}
                onClick={toggleMeasure}
                aria-label="测距"
              >
                <IconRuler />
              </button>
            </HoverTip>
            {measuring ? (
              <div className="map-btn-pop">
                <span>
                  {measurePoints.length} 点 · {formatDistance(measure.total)}
                  {measure.closed ? ` · ${formatArea(measure.area)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMeasurePoints([]);
                    setMeasureAdding(true);
                    if (mapRef.current) mapRef.current.getCanvas().style.cursor = MEASURE_CURSOR;
                  }}
                >
                  清除
                </button>
              </div>
            ) : null}
          </div>
          {layerPanel ? (
            <div className="map-btn-slot">
              <HoverTip title="图层" placement="top" disabled={layersOpen}>
                <button
                  type="button"
                  className={`map-btn${layersOpen ? " active" : ""}`}
                  onClick={() => setLayersOpen((value) => !value)}
                  aria-label="图层"
                  aria-expanded={layersOpen}
                >
                  <IconStack />
                </button>
              </HoverTip>
              {layersOpen ? (
                <div className="layer-pop">
                  <LayerPanel
                    {...layerPanel}
                    basemap={{
                      options: (config?.basemaps ?? [{ id: "blank", label: "空白底板" }]).map((item) => ({ id: item.id, label: item.label })),
                      activeId: activeBasemapId,
                      onChange: onBasemapChange,
                      opacity: basemapOpacity,
                      onOpacityChange: setBasemapOpacity,
                      hasAnno,
                      annoOn,
                      onAnnoChange: setAnnoOn,
                      lineVisible,
                      onLineChange: (value: boolean) => setLineStyle({ lineVisible: value }),
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {menu && menuEl
        ? createPortal(
            <div className="map-menu" ref={menuRef}>
              <div className="map-menu-head">
                <span className="map-menu-title">{menu.mode === "edit" ? "编辑标注" : "在此添加地点"}</span>
                <button type="button" className="map-menu-close" aria-label="关闭" onClick={() => setMenu(null)}>
                  <IconClose />
                </button>
              </div>

              <div className="map-menu-row">
                <span className="map-menu-label">名称</span>
                <Input
                  size="middle"
                  allowClear
                  placeholder="地点名称"
                  value={draft.name}
                  autoFocus
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitPoint();
                    if (event.key === "Escape") setMenu(null);
                  }}
                />
              </div>

              <div className="map-menu-row">
                <span className="map-menu-label">类别</span>
                <AppSelect
                  size="middle"
                  value={draft.category}
                  onChange={(value) =>
                    // 换类别时图案回到该类默认、形状保留：颜色随类别，图案可再换
                    setDraft({
                      ...draft,
                      category: value,
                      icon: iconId(value, resolveShape(draft.icon).id, defaultGlyphOf(value).id),
                    })
                  }
                  options={CATEGORY_OPTIONS}
                  popupMatchSelectWidth={false}
                  style={{ width: "100%" }}
                />
              </div>

              <div className="map-menu-row map-menu-row-icons">
                <span className="map-menu-label">图标</span>
                <div className="map-menu-glyphs">
                  {GLYPH_LIBRARY.map((glyph) => {
                    const active = resolveGlyph(draft.icon, draft.category).id === glyph.id;
                    const color = CATEGORY_COLOR[draft.category] ?? CATEGORY_COLOR.other;
                    return (
                      <HoverTip key={glyph.id} title={glyph.label} placement="top">
                        <button
                          type="button"
                          className={`map-menu-glyph${active ? " on" : ""}`}
                          aria-label={glyph.label}
                          style={active ? { borderColor: color, background: `${color}18` } : undefined}
                          onClick={() =>
                            setDraft({ ...draft, icon: iconId(draft.category, resolveShape(draft.icon).id, glyph.id) })
                          }
                        >
                          <svg viewBox={glyph.box} width={18} height={18} preserveAspectRatio="xMidYMid meet" aria-hidden>
                            {glyph.paths.map((d) => (
                              <path key={d} d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
                            ))}
                          </svg>
                        </button>
                      </HoverTip>
                    );
                  })}
                </div>
              </div>

              <div className="map-menu-row">
                <span className="map-menu-label">经度</span>
                <Input
                  size="middle"
                  value={menu.lon.toFixed(6)}
                  disabled={menu.mode !== "edit"}
                  onChange={(event) => setMenu({ ...menu, lon: Number(event.target.value) || 0 })}
                />
              </div>

              <div className="map-menu-row">
                <span className="map-menu-label">纬度</span>
                <Input
                  size="middle"
                  value={menu.lat.toFixed(6)}
                  disabled={menu.mode !== "edit"}
                  onChange={(event) => setMenu({ ...menu, lat: Number(event.target.value) || 0 })}
                />
              </div>

              <div className="map-menu-actions">
                {menu.mode === "edit" ? (
                  <button type="button" className="danger" disabled={menuBusy} onClick={() => void removePoint()}>
                    删除
                  </button>
                ) : null}
                <button type="button" disabled={menuBusy} onClick={() => void submitCandidate()}>
                  候选
                </button>
                <button type="button" className="primary" disabled={menuBusy} onClick={() => void submitPoint()}>
                  {menuBusy ? "保存中…" : menu.mode === "edit" ? "保存" : "添加"}
                </button>
              </div>
            </div>,
            menuEl,
          )
        : null}

      {snapAt && measuring ? (
        <span className="snap-ring" style={{ left: snapAt.x, top: snapAt.y }} aria-hidden />
      ) : null}

      {pickMode ? (
        <div className="map-pick-hint">
          <span>在地图上点击选择位置，Esc 取消</span>
          <button type="button" className="map-menu-close" aria-label="取消选点" onClick={() => onPickCancel?.()}>
            <IconClose />
          </button>
        </div>
      ) : null}

      {conflictCount > 0 || (displayRoutes?.features.length ?? 0) > 0 ? (
        <div className="map-hint">
          {(displayRoutes?.features.length ?? 0) > 0 ? (
            <span>
              实线为最近一次查询的路网路线（仅本次会话显示，不入库）
              {onClearRoutes ? (
                <button type="button" onClick={() => onClearRoutes()}>
                  清除路网
                </button>
              ) : null}
            </span>
          ) : (
            "示意连线非实际路线"
          )}
          {conflictCount > 0 ? ` · ${conflictCount} 处时间冲突` : ""}
        </div>
      ) : null}

      <div className="map-status">
        <HoverTip title="按当前纬度换算的图上距离"><span className="scale">
          <i style={{ width: Math.max(16, scale.width) }} />
          <b>{scale.label}</b>
        </span></HoverTip>
        <i className="status-sep" />
        <span>
          经度 <b>{status.lon.toFixed(5)}</b>
        </span>
        <span>
          纬度 <b>{status.lat.toFixed(5)}</b>
        </span>
        <i className="status-sep" />
        <span>
          层级 <b>{status.zoom.toFixed(1)}</b>
        </span>
        <i className="status-sep" />
        <HoverTip title="WGS84 地理坐标系，EPSG 编号 4326">
          <span>
            EPSG: <b>4326</b>
          </span>
        </HoverTip>
      </div>
    </div>
  );
}
