import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DatePicker,
  Dropdown,
  Input,
  Segmented,
  Spin,
  TimePicker,
  Tooltip,
  type InputRef,
} from "antd";
import AppSelect from "../components/AppSelect";
import AppNumber from "../components/AppNumber";
import { useWorkspaceStore } from "../store/app";
import dayjs, { Dayjs } from "dayjs";
import { api, type GeoResult, type JobOut, type OptimizationResult, type RouteCandidate, type TripDetail } from "../api/api";
import { ApiError, errorText } from "../api/client";
import { notify } from "../lib/notify";
import { formatDistance } from "../lib/coords";
import MapCanvas from "../components/MapCanvas";
import SearchPanel from "../components/SearchPanel";
import DayPanel from "../components/DayPanel";
import SidePanel from "../components/SidePanel";
import TopBar from "../components/TopBar";
import { IconAlert, IconBook, IconEdit, IconHistory, IconMore, IconShare } from "../components/icons";
import DragModal from "../components/DragModal";
import Field from "../components/Field";

type MobileTab = "day" | "search";
type RouteMode = "walking" | "bicycling" | "electrobike" | "driving" | "transit";

const ROUTE_MODES: Array<{ value: RouteMode; label: string }> = [
  { value: "walking", label: "步行" },
  { value: "bicycling", label: "自行车" },
  { value: "electrobike", label: "电动车" },
  { value: "driving", label: "驾车" },
  { value: "transit", label: "公交地铁" },
];
const ROUTE_MODE_LABEL: Record<RouteMode, string> = Object.fromEntries(
  ROUTE_MODES.map((item) => [item.value, item.label]),
) as Record<RouteMode, string>;
// 界面不直接显示供应商内部 id，避免“来源 amap”这类技术字样
const PROVIDER_LABEL: Record<string, string> = { amap: "高德地图", tianditu: "天地图", manual: "手工" };
const providerLabel = (value: string) => PROVIDER_LABEL[value] ?? value;
// 高德公交换乘策略：5 不乘地铁、7 地铁优先，可用于把地铁和普通公交分开看
const TRANSIT_STRATEGIES: Array<{ value: number; label: string }> = [
  { value: 0, label: "推荐" },
  { value: 2, label: "最少换乘" },
  { value: 5, label: "不乘地铁" },
  { value: 7, label: "地铁优先" },
  { value: 8, label: "时间短" },
];

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1024px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1024px)");
    const handler = () => setNarrow(query.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  return narrow;
}

export default function WorkspacePage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const narrow = useNarrow();
  const { activeDayId, setActiveDay, selectedStopId, selectedPlaceId, selectStop, selectPlace, basemapId, setBasemap } =
    useWorkspaceStore();

  // 侧栏初始状态：手动切换过就以手动为准，否则按设置页的默认值
  const [preview, setPreview] = useState<{ lon: number; lat: number; name: string; crs: string } | null>(null);
  // 左右栏不记忆：刷新、登录、从别的页面回来都保持展开，收起只是当前这一屏的临时状态
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("day");
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [addStopDay, setAddStopDay] = useState<string | null>(null);
  const [newStop, setNewStop] = useState<Record<string, unknown>>({ kind: "attraction", minutes: 60, priority: "preferred" });
  const [shareOpen, setShareOpen] = useState(false);
  const [shareForm, setShareForm] = useState<{ days: 1 | 7 | 30; password: string; allowClone: boolean }>({
    days: 7,
    password: "",
    allowClone: false,
  });
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [routeOpen, setRouteOpen] = useState<{ from: string; to: string } | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("walking");
  const [routeStrategy, setRouteStrategy] = useState<number>(0);
  const [routeResult, setRouteResult] = useState<RouteCandidate | null>(null);
  const [routeNotes, setRouteNotes] = useState<string[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [manualMinutes, setManualMinutes] = useState<number>(30);
  // 只存在于本次会话的实际路网几何：不入库、不进快照/导出/分享
  const [displayRoutes, setDisplayRoutes] = useState<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const [optimizeOpen, setOptimizeOpen] = useState<{ job: JobOut; result: OptimizationResult } | null>(null);
  const [optimizeProvider, setOptimizeProvider] = useState<"estimate" | "amap">("estimate");
  const [datesOpen, setDatesOpen] = useState(false);
  const [datesPreview, setDatesPreview] = useState<{ removed_days: string[]; added_days: string[]; affected_stop_count: number } | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{ revision: number; at: number } | null>(null);
  // 右栏点卡片时递增，地图据此飞到对应地点；地图自身点标注不触发，避免相机被抢
  const [focusStop, setFocusStop] = useState<{ stopId: string; token: number } | null>(null);
  // 视野中心：经纬度提示文字按「规划所在地」取值
  const [mapCenter, setMapCenter] = useState<{ lon: number; lat: number } | null>(null);
  // 新建地点时让用户在地图上点位置：多数人只知道大概位置，说不出经纬度
  const [pickMode, setPickMode] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<{ lon: number; lat: number } | null>(null);
  // 选点有两用：给新建地点填坐标，或给某个图层打一个点
  const [pickLayerId, setPickLayerId] = useState<string | null>(null);
  const basemapAutoRef = useRef(true);
  const titleRef = useRef<InputRef>(null);

  const tripQuery = useQuery({ queryKey: ["trip", tripId], queryFn: () => api.getTrip(tripId), enabled: !!tripId });
  const configQuery = useQuery({ queryKey: ["public-config"], queryFn: api.publicConfig });
  const trip = tripQuery.data;
  // 与地图共用一份编号；依赖 trip 快照，避免每次渲染都生成新 Map 触发地图重绘
  const order = useMemo(
    () =>
      trip
        ? buildOrder(trip)
        : { byStop: new Map<string, number>(), byPlace: new Map<string, { number: number; stopId: string; title?: string }>() },
    [trip],
  );

  const weatherQuery = useQuery({
    queryKey: ["trip-weather", trip?.id],
    queryFn: () => api.tripWeather(trip!.id),
    enabled: Boolean(trip?.id),
    staleTime: 30 * 60 * 1000,
  });
  const weatherByDate = useMemo(() => {
    const map: Record<string, { label: string; icon: string; high: number | null; low: number | null; rain: number | null }> = {};
    for (const day of weatherQuery.data?.days ?? []) {
      map[day.date] = { label: day.label, icon: day.icon, high: day.high, low: day.low, rain: day.rain };
    }
    return map;
  }, [weatherQuery.data]);

  const timelineQuery = useQuery({
    queryKey: ["timeline", tripId, trip?.revision],
    queryFn: () => api.timeline(tripId),
    enabled: !!tripId && !!trip,
  });

  useEffect(() => {
    if (!trip) return;
    if (!activeDayId || !trip.days.some((day) => day.id === activeDayId)) {
      setActiveDay(trip.days[0]?.id ?? null);
    }
    setTitleDraft((current) => (current === null ? trip.title : current));
  }, [trip, activeDayId, setActiveDay]);

  useEffect(() => {
    if (!configQuery.data) return;
    const maps = configQuery.data.basemaps;
    const exists = maps.some((item) => item.id === basemapId);
    if (!exists) {
      setBasemap(maps[0]?.id ?? "blank");
      return;
    }
    // 用户还没手动选过底图时，一旦设置页写入了浏览器端 Key，就直接切到真实底图。
    // 否则填完 Key 后看到的仍是空白经纬网，会误以为配置没生效。
    if (basemapAutoRef.current && basemapId === "blank") {
      const real = maps.find((item) => item.id !== "blank");
      if (real) setBasemap(real.id);
    }
  }, [configQuery.data, basemapId, setBasemap]);

  const chooseBasemap = (id: string) => {
    basemapAutoRef.current = false;
    setBasemap(id);
  };

  // 待确认的信息不再弹通知：右栏每个事项带冲突标记、底部有统计，
  // 再弹一次只是重复遮挡地图。只有首次打开这条行程、且还没有任何事项时才提示一次。

  const toggleLeft = () => setLeftCollapsed((value) => !value);
  const toggleRight = () => setRightCollapsed((value) => !value);

  const applyTrip = (next: TripDetail) => {
    queryClient.setQueryData(["trip", tripId], next);
    queryClient.invalidateQueries({ queryKey: ["timeline", tripId] });
    setLastSaved({ revision: next.revision, at: Date.now() });
  };

  const run = async <T,>(task: () => Promise<T>, after?: (value: T) => void): Promise<T> => {
    setBusy(true);
    try {
      const value = await task();
      after?.(value);
      return value;
    } catch (error) {
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
        setConflict(error.message);
      }
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const mutateTrip = (task: () => Promise<TripDetail>) => run(task, applyTrip);

  const patchTitle = async () => {
    if (!trip || titleDraft === null) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(trip.title);
      notify.warning("行程名称不能为空");
      return;
    }
    if (nextTitle === trip.title) return;
    await mutateTrip(() => api.patchTrip(trip.id, trip.revision, { title: nextTitle })).catch((error) => {
      // 保存失败时把输入框还原到服务端当前标题，避免界面显示一个并未落库的名字
      setTitleDraft(trip.title);
      notify.error(errorText(error));
    });
  };

  const reorder = async (dayId: string, orderedIds: string[]) => {
    if (!trip) return;
    await mutateTrip(() => api.reorderStops(trip.id, trip.revision, [{ day_id: dayId, stop_ids: orderedIds }]));
  };

  const moveToDay = async (stopId: string, targetDayId: string | null) => {
    if (!trip) return;
    const stop = trip.stops.find((item) => item.id === stopId);
    if (!stop) return;
    const containers: Array<{ day_id: string | null; stop_ids: string[] }> = [];
    const sourceIds = trip.stops
      .filter((item) => item.day_id === stop.day_id && item.id !== stopId)
      .sort((a, b) => a.position - b.position)
      .map((item) => item.id);
    containers.push({ day_id: stop.day_id, stop_ids: sourceIds });
    if (targetDayId && targetDayId !== stop.day_id) {
      const targetIds = trip.stops
        .filter((item) => item.day_id === targetDayId)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.id);
      containers.push({ day_id: targetDayId, stop_ids: [...targetIds, stopId] });
    } else if (!targetDayId) {
      const candidateIds = trip.stops
        .filter((item) => !item.day_id)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.id);
      containers.push({ day_id: null, stop_ids: [...candidateIds, stopId] });
    }
    await mutateTrip(() => api.reorderStops(trip.id, trip.revision, containers));
  };

  const deleteStop = async (stopId: string) => {
    if (!trip) return;
    await mutateTrip(() => api.deleteStop(trip.id, stopId, trip.revision));
    if (selectedStopId === stopId) selectStop(null);
  };

  const patchStop = async (stopId: string, payload: Record<string, unknown>) => {
    if (!trip) return;
    await mutateTrip(() => api.patchStop(trip.id, stopId, trip.revision, payload as never));
  };

  const patchDay = async (dayId: string, payload: Record<string, unknown>) => {
    if (!trip) return;
    await mutateTrip(() => api.patchDay(trip.id, dayId, trip.revision, payload));
  };

  const addFromResult = async (result: GeoResult, dayId: string | null) => {
    if (!trip) return;
    const before = new Set(trip.places.map((place) => place.id));
    const next = await mutateTrip(() =>
      api.createPlace(trip.id, trip.revision, {
        name: result.name,
        category: categoryOf(result),
        selection_token: result.selection_token,
        notes: result.address ?? undefined,
        tags: [],
      }),
    );
    const created = next.places.find((place) => !before.has(place.id));
    if (!created) throw new Error("地点创建失败");
    await mutateTrip(() =>
      api.createStop(next.id, next.revision, {
        day_id: dayId,
        place_id: created.id,
        title: result.name,
        kind: kindOf(result),
        duration_seconds: 3600,
      }),
    );
  };

  // 图层改动不进 revision：操作后刷新行程即可
  const mutateLayer = async <T,>(task: () => Promise<T>): Promise<T> => {
    const value = await run(task);
    await queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    return value;
  };

  // 只建地点、不进当天：地图上这类点位只做参考，是否排行程另说
  const createPlaceOnly = async (payload: { name: string; category: string; lon: number; lat: number; notes?: string }) => {
    if (!trip) return;
    await mutateTrip(() =>
      api.createPlace(trip.id, trip.revision, {
        name: payload.name,
        category: payload.category,
        geometry: { type: "Point", coordinates: [payload.lon, payload.lat] },
        notes: payload.notes || undefined,
        tags: [],
      }),
    );
  };

  const addLocalPlace = async (placeId: string, dayId: string | null) => {
    if (!trip) return;
    const place = trip.places.find((item) => item.id === placeId);
    if (!place) return;
    await mutateTrip(() =>
      api.createStop(trip.id, trip.revision, {
        day_id: dayId,
        place_id: place.id,
        title: place.name,
        kind: "attraction",
        duration_seconds: 3600,
      }),
    );
    notify.success(`已加入：${place.name}`);
  };

  const addManual = async (
    payload: { name: string; category: string; icon?: string; lon: number; lat: number; notes?: string },
    dayId: string | null,
  ) => {
    if (!trip) return;
    const before = new Set(trip.places.map((place) => place.id));
    const next = await mutateTrip(() =>
      api.createPlace(trip.id, trip.revision, {
        name: payload.name,
        category: payload.category,
        icon: payload.icon,
        geometry: { type: "Point", coordinates: [payload.lon, payload.lat] },
        notes: payload.notes || undefined,
        tags: [],
      }),
    );
    const created = next.places.find((place) => !before.has(place.id));
    if (!created) throw new Error("地点创建失败");
    await mutateTrip(() =>
      api.createStop(next.id, next.revision, {
        day_id: dayId,
        place_id: created.id,
        title: payload.name,
        kind: payload.category === "meal" ? "meal" : payload.category === "lodging" ? "lodging" : "attraction",
        duration_seconds: 3600,
      }),
    );
  };

  const updatePlace = async (
    placeId: string,
    payload: { name?: string; category?: string; icon?: string; geometry?: { type: "Point"; coordinates: [number, number] } },
  ) => {
    if (!trip) return;
    await mutateTrip(() => api.patchPlace(trip.id, placeId, trip.revision, payload as never));
    notify.success("标注已更新");
  };

  // 地图浮层的「候选」：不进当天，只落进候选池（day_id=null）
  const addToCandidate = async (payload: {
    name: string;
    category: string;
    icon: string;
    lon: number;
    lat: number;
    placeId?: string;
  }) => {
    if (!trip) return;
    let placeId = payload.placeId;
    if (!placeId) {
      const before = new Set(trip.places.map((place) => place.id));
      const next = await mutateTrip(() =>
        api.createPlace(trip.id, trip.revision, {
          name: payload.name,
          category: payload.category,
          icon: payload.icon,
          geometry: { type: "Point", coordinates: [payload.lon, payload.lat] },
          tags: [],
        }),
      );
      const created = next.places.find((place) => !before.has(place.id));
      if (!created) throw new Error("地点创建失败");
      placeId = created.id;
    }
    await mutateTrip(() =>
      api.createStop(trip.id, trip.revision, {
        day_id: null,
        place_id: placeId,
        title: payload.name,
        kind: "attraction",
        duration_seconds: 3600,
      }),
    );
    notify.success("已加入候选池");
  };

  const deletePlace = async (placeId: string) => {
    if (!trip) return;
    // cascade=true：连同引用它的事项一起删，否则会留下没有地点的空事项
    await mutateTrip(() => api.deletePlace(trip.id, placeId, trip.revision, true, true));
    if (selectedPlaceId === placeId) selectPlace(null);
    notify.success("已删除标注");
  };

  const importPlaces = async (file: File) => {
    if (!trip) return;
    const result = await run(() => api.importPlaces(trip.id, trip.revision, file));
    await tripQuery.refetch();
    notify.success(`导入 ${result.feature_count} 个点`);
  };

  const addStop = async () => {
    if (!trip || !addStopDay) return;
    const addStopDate = trip.days.find((item) => item.id === addStopDay)?.date ?? dayjs().format("YYYY-MM-DD");
    const title = String(newStop.title ?? "").trim();
    if (!title) return notify.warning("请填写标题");
    // 填了经纬度就顺手建一个地点绑上：没有位置的事项无法参与路线规划
    let placeId: string | undefined;
    const lon = Number(newStop.lon);
    const lat = Number(newStop.lat);
    if (newStop.lon !== undefined && newStop.lon !== "" && newStop.lat !== undefined && newStop.lat !== "" && Number.isFinite(lon) && Number.isFinite(lat)) {
      const before = new Set(trip.places.map((place) => place.id));
      const next = await mutateTrip(() =>
        api.createPlace(trip.id, trip.revision, {
          name: title,
          category: "attraction",
          geometry: { type: "Point", coordinates: [lon, lat] },
          tags: [],
        }),
      );
      const created = next.places.find((place) => !before.has(place.id));
      placeId = created?.id;
    }
    await mutateTrip(() =>
      api.createStop(trip.id, trip.revision, {
        day_id: addStopDay,
        title,
        kind: newStop.kind ?? "attraction",
        duration_seconds: Math.max(0, Number(newStop.minutes ?? 60)) * 60,
        cost_minor: newStop.cost === undefined || newStop.cost === null ? null : Math.round(Number(newStop.cost) * 100),
        priority: newStop.priority ?? "preferred",
        notes: newStop.notes ? String(newStop.notes) : null,
        place_id: placeId,
        fixed_start: newStop.fixedStart
          ? dayjs(`${addStopDate}T${(newStop.fixedStart as Dayjs).format("HH:mm")}:00`).toISOString()
          : undefined,
      }),
    ).catch((error) => notify.error(errorText(error)));
    setAddStopDay(null);
    setNewStop({ kind: "attraction", minutes: 60, priority: "preferred" });
  };

  const queryRoute = async () => {
    if (!trip || !routeOpen) return;
    setRouteError(null);
    setRouteResult(null);
    setRouteNotes([]);
    const pair = `${routeOpen.from}>${routeOpen.to}`;
    try {
      const response = await run(() =>
        api.queryRoute(trip.id, {
          from_stop_id: routeOpen.from,
          to_stop_id: routeOpen.to,
          mode: routeMode,
          provider: "auto",
          strategy: routeMode === "transit" ? routeStrategy : undefined,
        }),
      );
      const candidate = response.candidates[0];
      if (!candidate) throw new Error("未返回路线结果");
      setRouteResult(candidate);
      if (candidate.duration_seconds > 0) {
        setManualMinutes(Math.max(1, Math.round(candidate.duration_seconds / 60)));
      }
      // 说明分点收集：端点提示（含自动识别的城市代码）+ 上游 warnings，去重后按语义排序
      const picked = new Set<string>();
      for (const line of [...(response.endpoint_note ?? []), ...(candidate.warnings ?? [])]) {
        const text = line.trim();
        // 「未填城市代码/导航入口」这类过程性提示不进结果说明，只留对用户有用的结论
        if (!text || text.includes("城市代码") || text.includes("导航入口")) continue;
        picked.add(text);
      }
      const order = (line: string) => (line.includes("公交方案") ? 0 : 1);
      setRouteNotes([...picked].sort((a, b) => order(a) - order(b)));
      // 会话内显示实际路网几何；供应商几何按策略不落库，刷新后自动消失
      setDisplayRoutes((prev) => ({
        type: "FeatureCollection",
        features: [
          ...prev.features.filter((feature) => feature.properties?.pair !== pair),
          ...(candidate.geometry
            ? [
                {
                  type: "Feature" as const,
                  // 距离/耗时跟着会话路线一起走：地图中段显示距离，保存后右栏卡片复用同一份数据。
                  properties: {
                    pair,
                    mode: routeMode,
                    distance_m: candidate.distance_m,
                    duration_seconds: candidate.duration_seconds,
                  },
                  geometry: candidate.geometry as unknown as GeoJSON.LineString,
                },
              ]
            : []),
        ],
      }));
    } catch (error) {
      setRouteError(errorText(error));
    }
  };

  const saveManualLeg = async () => {
    if (!trip || !routeOpen) return;
    await mutateTrip(() =>
      api.manualLeg(trip.id, trip.revision, {
        from_stop_id: routeOpen.from,
        to_stop_id: routeOpen.to,
        duration_seconds: Math.max(0, manualMinutes) * 60,
        // 查询过路线时把真实距离一并保存，右栏卡片才能显示「X 公里」
        distance_m: routeResult?.distance_m ?? undefined,
        label: routeResult ? `${ROUTE_MODE_LABEL[routeMode]} · ${providerLabel(routeResult.provider)}` : "手工录入",
      }),
    ).catch((error) => notify.error(errorText(error)));
    setRouteOpen(null);
    setRouteResult(null);
    setRouteError(null);
    setRouteNotes([]);
  };

  const optimize = async (dayId: string) => {
    if (!trip) return;
    try {
      const job = await run(() => api.optimize(trip.id, trip.revision, dayId, "driving", optimizeProvider));
      let current = job;
      for (let attempt = 0; attempt < 40 && current.status !== "succeeded" && current.status !== "failed"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        current = await api.job(job.id);
      }
      if (current.status !== "succeeded") {
        notify.error(current.error?.message ? String(current.error.message) : "优化失败");
        return;
      }
      const result = await api.jobResult(job.id);
      setOptimizeOpen({ job: current, result: result.result });
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  const applyOptimization = async () => {
    if (!trip || !optimizeOpen) return;
    await mutateTrip(() => api.applyOptimization(trip.id, trip.revision, optimizeOpen.job.id)).catch((error) =>
      notify.error(errorText(error)),
    );
    setOptimizeOpen(null);
    notify.success("已应用建议顺序");
  };

  const createShare = async () => {
    if (!trip) return;
    const created = await run(() =>
      api.createShare(trip.id, {
        expires_in_days: shareForm.days,
        password: shareForm.password || null,
        allow_clone: shareForm.allowClone,
      }),
    );
    setShareLink(created.url);
  };

  const changeDates = async () => {
    if (!trip || !dateRange) return;
    try {
      const preview = await run(() =>
        api.previewDates(trip.id, dateRange[0].format("YYYY-MM-DD"), dateRange[1].format("YYYY-MM-DD")),
      );
      setDatesPreview(preview);
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  const applyDates = async () => {
    if (!trip || !dateRange) return;
    try {
      await mutateTrip(() =>
        api.changeDates(trip.id, trip.revision, dateRange[0].format("YYYY-MM-DD"), dateRange[1].format("YYYY-MM-DD")),
      );
      setDatesOpen(false);
    } catch (error) {
      notify.error(errorText(error));
    }
    setDatesPreview(null);
  };

  const dayLabel = useMemo(() => (trip ? `${trip.start_date} → ${trip.end_date}` : ""), [trip]);
  const routeFrom = trip?.stops.find((stop) => stop.id === routeOpen?.from)?.title ?? "起点";
  const routeTo = trip?.stops.find((stop) => stop.id === routeOpen?.to)?.title ?? "终点";

  if (tripQuery.isLoading) {
    return (
      <div className="app-shell">
        <TopBar showBack backTo="/" />
        <div className="state-wrap">
          <Spin size="large" />
        </div>
      </div>
    );
  }
  if (tripQuery.isError || !trip) {
    const detail = tripQuery.isError ? errorText(tripQuery.error) : "没有找到该行程，或当前账号没有访问权限。";
    return (
      <div className="app-shell">
        <TopBar showBack backTo="/" />
        <div className="state-wrap">
          <div className="state-card">
            <span className="state-icon">
              <IconAlert width={22} height={22} />
            </span>
            <h2>行程加载失败</h2>
            <p className="state-detail">{detail}</p>
            <div className="state-actions">
              <Button type="primary" onClick={() => tripQuery.refetch()}>
                重试
              </Button>
              <Button onClick={() => navigate("/")}>返回行程列表</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 界面上不暴露内部版本号，只在保存过程中给一个状态
  const saveText = busy ? "保存中…" : lastSaved ? "已保存" : "";
  const layerPanelProps = {
    layers: trip.map_layers ?? [],
    busy,
    mapCenter,
    onCreate: async (payload: { name: string; kind: "mine" | "system"; category?: string; icon?: string; color?: string }) => {
      try {
        await mutateLayer(() => api.createLayer(trip.id, payload));
        notify.success("已新建图层");
      } catch (error) {
        notify.error(errorText(error));
      }
    },
    onPatch: (layerId: string, payload: { name?: string; visible?: boolean; opacity?: number }) =>
      mutateLayer(() => api.patchLayer(trip.id, layerId, payload)).catch((error) => notify.error(errorText(error))),
    onDelete: async (layerId: string) => {
      try {
        await mutateLayer(() => api.deleteLayer(trip.id, layerId));
        notify.success("已删除图层");
      } catch (error) {
        notify.error(errorText(error));
      }
    },
    onAddFeature: (layerId: string) => {
      setPickLayerId(layerId);
      setPickMode(true);
    },
    onCollect: async (layerId: string) => {
      if (!mapCenter) return;
      try {
        await mutateLayer(() => api.collectLayerPois(trip.id, layerId, { lon: mapCenter.lon, lat: mapCenter.lat, radius_m: 2000, limit: 40 }));
        notify.success("已采集周边点位入库");
      } catch (error) {
        notify.error(errorText(error));
      }
    },
    onExport: async (layer: { id: string; name: string }) => {
      const data = await api.exportLayer(trip.id, layer.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${layer.name}.geojson`;
      link.click();
      URL.revokeObjectURL(url);
    },
  };

  const searchPanel = (
    <SearchPanel
      trip={trip}
      config={configQuery.data}
      activeDayId={activeDayId}
      busy={busy}
      selectedPlaceId={selectedPlaceId}
      onAddFromResult={addFromResult}
      onAddManual={addManual}
      onImport={importPlaces}
      onMoveToDay={moveToDay}
      onAddLocalPlace={addLocalPlace}
      onAddPlaceOnly={createPlaceOnly}
      lonLatHint={mapCenter}
      onPickFromMap={() => setPickMode(true)}
      pickedPoint={pickedPoint}
      onConsumePickedPoint={() => setPickedPoint(null)}
      onPreview={(point: { lon: number; lat: number; name: string; crs: string }) => setPreview(point)}
      onSelectStop={(stopId) => {
        const stop = trip.stops.find((item) => item.id === stopId);
        selectStop(stopId, stop?.place_id ?? null);
        if (stop?.day_id) setActiveDay(stop.day_id);
      }}
      onSelectPlace={(placeId) => selectPlace(placeId)}
    />
  );
  const dayPanel = (
    <DayPanel
      trip={trip}
      weatherByDate={weatherByDate}
      weatherNote={weatherQuery.data?.reason}
      timeline={timelineQuery.data}
      activeDayId={activeDayId}
      selectedStopId={selectedStopId}
      numberByStop={order.byStop}
      busy={busy}
      onSelectDay={setActiveDay}
      onSelectStop={(stopId) => {
        const stop = trip.stops.find((item) => item.id === stopId);
        selectStop(stopId, stop?.place_id ?? null);
        setFocusStop({ stopId, token: Date.now() });
      }}
      onReorder={reorder}
      onMoveToDay={moveToDay}
      onDeleteStop={deleteStop}
      onPatchStop={patchStop}
      onPatchDay={patchDay}
      onAddStop={(dayId) => {
        setAddStopDay(dayId);
        setNewStop({ kind: "attraction", minutes: 60, priority: "preferred" });
      }}
      onOptimize={optimize}
      onPlanRoute={(from, to) => {
        setRouteOpen({ from, to });
        setRouteResult(null);
        setRouteError(null);
        setRouteNotes([]);
      }}
    />
  );

  const mobileSwitch =
    narrow && (
      <Segmented
        size="small"
        value={mobileTab}
        onChange={(value) => setMobileTab(value as MobileTab)}
        options={[
          { value: "day", label: "行程" },
          { value: "search", label: "地点" },
        ]}
      />
    );

  return (
    <div className="workspace">
      <TopBar
        showBack
        backTo="/"
        actions={
          <>
            {saveText ? <span className="save-state">{saveText}</span> : null}
            <Tooltip title="版本历史">
              <button type="button" className="icon-btn" onClick={() => navigate(`/trips/${trip.id}/history`)}>
                <IconHistory />
              </button>
            </Tooltip>
            <Tooltip title="攻略预览与导出">
              <button type="button" className="icon-btn" onClick={() => navigate(`/trips/${trip.id}/guide`)}>
                <IconBook />
              </button>
            </Tooltip>
            <Tooltip title="分享">
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setShareOpen(true);
                  setShareLink(null);
                }}
              >
                <IconShare />
              </button>
            </Tooltip>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "dates", label: "调整日期范围" },
                  { key: "provider", label: `优化矩阵：${optimizeProvider === "estimate" ? "直线估算" : "高德路网"}` },
                  { key: "reload", label: "重新加载" },
                ],
                onClick: ({ key }) => {
                  if (key === "dates") {
                    setDateRange([dayjs(trip.start_date), dayjs(trip.end_date)]);
                    setDatesOpen(true);
                  }
                  if (key === "provider") setOptimizeProvider(optimizeProvider === "estimate" ? "amap" : "estimate");
                  if (key === "reload") tripQuery.refetch();
                },
              }}
            >
              <button type="button" className="icon-btn hide-sm" aria-label="更多">
                <IconMore />
              </button>
            </Dropdown>
          </>
        }
      >
        {mobileSwitch}
        {/* 标题是可直接编辑的输入框；日期范围放到下一行，避免看起来像面包屑或统计信息 */}
        <div className="trip-heading">
          <Input
            ref={titleRef}
            size="small"
            variant="borderless"
            value={titleDraft ?? trip.title}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={patchTitle}
            onPressEnter={patchTitle}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitleDraft(trip.title);
                event.currentTarget.blur();
              }
            }}
            className="title-input"
            maxLength={120}
            aria-label="行程名称"
            title="点击修改行程名称，Enter 保存，Esc 取消"
            suffix={
              <Tooltip title="重命名行程">
                <button
                  type="button"
                  className="title-edit-btn"
                  aria-label="重命名行程"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    titleRef.current?.focus();
                    titleRef.current?.select();
                  }}
                >
                  <IconEdit width={13} height={13} />
                </button>
              </Tooltip>
            }
          />
          <span className="trip-date-range">{dayLabel}</span>
        </div>
      </TopBar>

      <div
        className={`ws-body${leftCollapsed && !narrow ? " left-collapsed" : ""}${rightCollapsed && !narrow ? " right-collapsed" : ""}`}
      >
        <SidePanel
          side="left"
          title="地点"
          count={`${trip.places.length} 个`}
          collapsed={leftCollapsed && !narrow}
          onToggle={toggleLeft}
          mobileHidden={narrow && mobileTab !== "search"}
        >
          {searchPanel}
        </SidePanel>

        <MapCanvas
          trip={trip}
          preview={preview}
          timeline={timelineQuery.data}
          config={configQuery.data}
          basemapId={basemapId}
          selectedStopId={selectedStopId}
          selectedPlaceId={selectedPlaceId}
          placeStops={order.byPlace}
          focusStop={focusStop}
          displayRoutes={displayRoutes}
          onClearRoutes={() => setDisplayRoutes({ type: "FeatureCollection", features: [] })}
          layers={trip.map_layers ?? []}
          layerPanel={layerPanelProps}
          onViewportChange={(center) => setMapCenter(center)}
          pickMode={pickMode}
          onPickPoint={(lon, lat) => {
            setPickMode(false);
            if (pickLayerId) {
              const layer = (trip.map_layers ?? []).find((item) => item.id === pickLayerId);
              const name = `点 ${(layer?.features?.length ?? 0) + 1}`;
              void mutateLayer(() => api.addLayerFeature(trip.id, pickLayerId, { name, lon, lat }))
                .then(() => notify.success(`已打点：${name}`))
                .catch((error) => notify.error(errorText(error)));
              setPickLayerId(null);
              return;
            }
            setPickedPoint({ lon, lat });
          }}
          onPickCancel={() => setPickMode(false)}
          onSelectStop={(stopId, placeId) => {
            selectStop(stopId, placeId);
            if (stopId) {
              const stop = trip.stops.find((item) => item.id === stopId);
              if (stop?.day_id) setActiveDay(stop.day_id);
            }
          }}
          onSelectPlace={selectPlace}
          onBasemapChange={chooseBasemap}
          onAddAtPoint={async (payload) => {
            await addManual(payload, activeDayId);
            notify.success(`已添加：${payload.name}`);
          }}
          onAddToCandidate={addToCandidate}
          onUpdatePlace={updatePlace}
          onDeletePlace={deletePlace}
        />

        <SidePanel
          side="right"
          title="行程"
          count={`${trip.stops.filter((stop) => stop.day_id).length} 项`}
          collapsed={rightCollapsed && !narrow}
          onToggle={toggleRight}
          mobileHidden={narrow && mobileTab !== "day"}
        >
          {dayPanel}
        </SidePanel>
      </div>

      <DragModal centered title="添加事项" open={!!addStopDay} onCancel={() => setAddStopDay(null)} footer={[
        <Button key="ok" type="primary" loading={busy} onClick={() => void addStop()}>
          添加
        </Button>,
      ]} destroyOnHidden>
        <div className="modal-form">
          <Field label="标题">
            <Input
              placeholder="例如：滕王阁"
              value={String(newStop.title ?? "")}
              onChange={(event) => setNewStop({ ...newStop, title: event.target.value })}
            />
          </Field>
          <div className="modal-row">
            <Field label="经度" hint="WGS84 经度，可留空。不填就没有位置，规划路线时用不上这一项。">
              <Input
                placeholder={mapCenter ? mapCenter.lon.toFixed(5) : "115.85868"}
                value={String(newStop.lon ?? "")}
                onChange={(event) => setNewStop({ ...newStop, lon: event.target.value })}
              />
            </Field>
            <Field label="纬度" hint="WGS84 纬度，可留空。不填就没有位置，规划路线时用不上这一项。">
              <Input
                placeholder={mapCenter ? mapCenter.lat.toFixed(5) : "28.64321"}
                value={String(newStop.lat ?? "")}
                onChange={(event) => setNewStop({ ...newStop, lat: event.target.value })}
              />
            </Field>
          </div>
          <Field
            label="固定开始时间"
            hint="指这一项必须在指定时刻开始（如预约、演出、班车）。排期会把它钉在该时刻，其余事项围绕它顺推。留空则按顺序顺推。"
          >
            <TimePicker
              format="HH:mm"
              minuteStep={5}
              allowClear
              placeholder="可留空"
              value={(newStop.fixedStart as Dayjs | null) ?? null}
              onChange={(value) => setNewStop({ ...newStop, fixedStart: value })}
              style={{ width: "100%" }}
            />
          </Field>
          <div className="modal-row">
            <Field label="类型">
              <AppSelect
                value={String(newStop.kind ?? "attraction")}
                onChange={(value) => setNewStop({ ...newStop, kind: value })}
                options={Object.entries({ attraction: "景点", meal: "餐饮", lodging: "住宿", transport: "交通", free: "自由活动" }).map(
                  ([value, label]) => ({ value, label }),
                )}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="优先级">
              <AppSelect
                value={String(newStop.priority ?? "preferred")}
                onChange={(value) => setNewStop({ ...newStop, priority: value })}
                options={[
                  { value: "required", label: "必去" },
                  { value: "preferred", label: "优先" },
                  { value: "optional", label: "可选" },
                ]}
                style={{ width: "100%" }}
              />
            </Field>
          </div>
          <div className="modal-row">
            <Field label="停留时长">
              <AppNumber
                after="分钟"
                min={0}
                max={1440}
                value={newStop.minutes as number}
                onChange={(value) => setNewStop({ ...newStop, minutes: value ?? 60 })}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="费用">
              <AppNumber
                before="¥"
                min={0}
                placeholder="可留空"
                value={newStop.cost as number | undefined}
                onChange={(value) => setNewStop({ ...newStop, cost: value })}
                style={{ width: "100%" }}
              />
            </Field>
          </div>
          <Field label="备注">
            <Input.TextArea
              rows={2}
              placeholder="可留空"
              value={String(newStop.notes ?? "")}
              onChange={(event) => setNewStop({ ...newStop, notes: event.target.value })}
            />
          </Field>
        </div>
      </DragModal>

      <DragModal centered title="分享行程" open={shareOpen} onCancel={() => setShareOpen(false)} footer={null} destroyOnHidden>
        <div className="modal-form">
          <div className="hint-line">分享的是当前内容；之后再编辑，已分享的页面不会变。</div>
          <div className="modal-row">
            <AppSelect
              value={shareForm.days}
              onChange={(value) => setShareForm({ ...shareForm, days: value })}
              options={[
                { value: 1, label: "1 天有效" },
                { value: 7, label: "7 天有效" },
                { value: 30, label: "30 天有效" },
              ]}
              style={{ flex: 1 }}
            />
            <Input.Password
              placeholder="访问密码（可选）"
              value={shareForm.password}
              onChange={(event) => setShareForm({ ...shareForm, password: event.target.value })}
              style={{ flex: 1 }}
            />
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shareForm.allowClone}
              onChange={(event) => setShareForm({ ...shareForm, allowClone: event.target.checked })}
            />
            <span className="tiny">允许登录用户复制该行程</span>
          </label>
          <Button type="primary" onClick={createShare} loading={busy}>
            生成链接
          </Button>
          {shareLink ? (
            <div>
              <Input value={shareLink} readOnly />
              <Button
                size="small"
                style={{ marginTop: 6 }}
                onClick={() => {
                  navigator.clipboard?.writeText(shareLink);
                  notify.success("已复制");
                }}
              >
                复制链接
              </Button>
            </div>
          ) : null}
        </div>
      </DragModal>

      <DragModal centered title="路线与交通耗时" open={!!routeOpen} onCancel={() => setRouteOpen(null)} footer={null} width={460} destroyOnHidden>
        <div className="modal-form">
          <Field label="路段">
            <Input value={`${routeFrom} → ${routeTo}`} disabled />
          </Field>
          <Field label="交通方式">
            <AppSelect
              value={routeMode}
              onChange={(value) => { setRouteMode(value as RouteMode); setRouteResult(null); setRouteNotes([]); }}
              options={ROUTE_MODES}
              style={{ width: "100%" }}
            />
          </Field>
          {routeMode === "transit" ? (
            <Field label="换乘策略">
              <AppSelect
                value={String(routeStrategy)}
                onChange={(value) => { setRouteStrategy(Number(value)); setRouteResult(null); setRouteNotes([]); }}
                options={TRANSIT_STRATEGIES.map((item) => ({ value: String(item.value), label: item.label }))}
                style={{ width: "100%" }}
              />
            </Field>
          ) : null}
          <Button type="primary" onClick={queryRoute} loading={busy}>
            查询路线
          </Button>
          <div className="muted tiny">
            查询结果会显示在地图上；保存后会把耗时和距离写入右栏行程。
          </div>
          {routeError ? <div className="hint-box">{routeError}</div> : null}
          {routeResult ? (
            <div className="route-result">
              <div className="route-result-main">
                <b>{routeResult.duration_seconds > 0 ? Math.round(routeResult.duration_seconds / 60) : "—"}</b>
                <span>分钟</span>
              </div>
              <div className="route-result-cells">
                <div><span>距离</span><b>{formatDistance(routeResult.distance_m)}</b></div>
                <div><span>方式</span><b>{ROUTE_MODE_LABEL[routeMode]}</b></div>
                <div><span>来源</span><b>{providerLabel(routeResult.provider)}</b></div>
              </div>
            </div>
          ) : null}
          <Field label="交通耗时">
            <div className="field-inline">
              <AppNumber
                after="分钟"
                min={0}
                max={1440}
                value={manualMinutes}
                onChange={(value) => setManualMinutes(value ?? 0)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button type="primary" onClick={saveManualLeg} loading={busy}>
                保存
              </Button>
            </div>
          </Field>
          {routeNotes.length ? (
            <div className="route-foot">
              <ul>
                {routeNotes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </DragModal>

      <DragModal centered
        title="优化建议（预览）"
        open={!!optimizeOpen}
        onCancel={() => setOptimizeOpen(null)}
        footer={[
          <Button key="ok" type="primary" loading={busy} onClick={() => void applyOptimization()}>
            应用顺序
          </Button>,
        ]}
        width={560}
      >
        {optimizeOpen ? (
          <div className="modal-form">
            <div className="hint-box">{optimizeOpen.result.assumptions.join(" ")}</div>
            {optimizeOpen.result.conflicts.length > 0 ? (
              <div className="hint-box">
                存在冲突：{optimizeOpen.result.conflicts.map((item) => String(item.code)).join("、")}
              </div>
            ) : null}
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: 4 }}>顺序</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: 4 }}>事项</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: 4 }}>预计开始</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--line)", padding: 4 }}>交通</th>
                </tr>
              </thead>
              <tbody>
                {optimizeOpen.result.days[0]?.stops.map((row) => (
                  <tr key={row.stop_id}>
                    <td style={{ padding: 4 }}>{row.position + 1}</td>
                    <td style={{ padding: 4 }}>{row.title}</td>
                    <td style={{ padding: 4 }}>{row.start ? dayjs(row.start).format("MM-DD HH:mm") : "—"}</td>
                    <td style={{ padding: 4 }}>
                      {row.travel_seconds === null || row.travel_seconds === undefined
                        ? "未设置"
                        : `${Math.round(row.travel_seconds / 60)} 分`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DragModal>

      <DragModal centered title="调整日期范围" open={datesOpen} onCancel={() => setDatesOpen(false)} footer={[
        <Button key="ok" type="primary" loading={busy} onClick={() => void changeDates()}>
          预览影响
        </Button>,
      ]} destroyOnHidden>
        <div className="modal-form">
          <Field label="行程日期">
            <DatePicker.RangePicker
              value={dateRange}
              onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)}
              style={{ width: "100%" }}
            />
          </Field>
        </div>
        <div className="muted tiny" style={{ marginTop: 8 }}>
          缩短日期时，越界事项退回候选池，已存在的日期不平移；固定预约会被清除并写入备注。
        </div>
      </DragModal>

      {/* 日期调整确认：标题只在标题行出现一次，正文只写影响说明 */}
      <DragModal
        centered
        title="调整行程日期"
        open={!!datesPreview}
        onCancel={() => setDatesPreview(null)}
        footer={[
          <Button key="ok" type="primary" loading={busy} onClick={() => void applyDates()}>
            确认调整
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="hint-line">
          {datesPreview
            ? `将移除 ${datesPreview.removed_days.length} 天、新增 ${datesPreview.added_days.length} 天，${datesPreview.affected_stop_count} 个事项会退回候选池（固定预约会被清除）。`
            : ""}
        </div>
      </DragModal>

      <DragModal centered
        title="版本冲突"
        open={!!conflict}
        onCancel={() => setConflict(null)}
        onOk={() => {
          setConflict(null);
          tripQuery.refetch();
        }}
        okText="加载最新版本"
        cancelText="保留当前编辑"
      >
        <div>{conflict}</div>
        <div className="muted tiny" style={{ marginTop: 8 }}>
          加载最新版本会放弃尚未提交的修改；已提交的修改不受影响。
        </div>
      </DragModal>
    </div>
  );
}

/**
 * 全行程访问顺序：按日期、再按当天 position 排序，候选项排在最后。
 * 事项卡片和地图针形标注共用这一份编号，避免两处各算一套、数字对不上。
 * 同一个地点被多个事项引用时，标注显示它第一次出现的编号。
 */
function buildOrder(trip: TripDetail) {
  const dayOrder = new Map(trip.days.map((item, index) => [item.id, index]));
  const rankOf = (stop: TripDetail["stops"][number]) =>
    stop.day_id === null ? Number.MAX_SAFE_INTEGER : (dayOrder.get(stop.day_id) ?? Number.MAX_SAFE_INTEGER);
  const ordered = [...trip.stops].sort((a, b) =>
    rankOf(a) !== rankOf(b) ? rankOf(a) - rankOf(b) : a.position - b.position,
  );
  const byStop = new Map<string, number>();
  const byPlace = new Map<string, { number: number; stopId: string; title?: string }>();
  ordered.forEach((stop, index) => {
    const number = index + 1;
    byStop.set(stop.id, number);
    // 同一个地点被多个事项引用时，标注显示第一次出现的编号和标题。
    if (stop.place_id && !byPlace.has(stop.place_id)) {
      byPlace.set(stop.place_id, { number, stopId: stop.id, title: stop.title });
    }
  });
  return { byStop, byPlace };
}

function kindOf(result: GeoResult): string {
  const text = `${result.category ?? ""}${result.name}`;
  if (/餐|food|restaurant|咖啡|茶/.test(text)) return "meal";
  if (/酒店|宾馆|民宿|hotel/.test(text)) return "lodging";
  if (/机场|车站|地铁|公交/.test(text)) return "transport";
  return "attraction";
}

function categoryOf(result: GeoResult): string {
  const kind = kindOf(result);
  return kind === "meal" ? "meal" : kind === "lodging" ? "lodging" : kind === "transport" ? "transport" : "attraction";
}
