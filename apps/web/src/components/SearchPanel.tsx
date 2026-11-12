import { useEffect, useRef, useState } from "react";
import { Button, Input, Spin, Upload } from "antd";
import DragModal from "./DragModal";
import { ImportOutlined, InboxOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import AppSelect from "./AppSelect";
import { api, type GeoResult, type PublicConfig, type StopOut, type TripDetail } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import Field from "./Field";


const PROVIDERS = [
  { value: "auto", label: "自动" },
  { value: "amap", label: "高德" },
  { value: "tianditu", label: "天地图" },
  { value: "both", label: "全部来源" },
];

interface Props {
  trip: TripDetail;
  config?: PublicConfig;
  activeDayId: string | null;
  busy: boolean;
  selectedPlaceId: string | null;
  onAddFromResult: (result: GeoResult, dayId: string | null) => Promise<void>;
  onAddManual: (payload: { name: string; category: string; lon: number; lat: number; notes?: string }, dayId: string | null) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onMoveToDay: (stopId: string, dayId: string | null) => Promise<void>;
  onAddLocalPlace: (placeId: string, dayId: string | null) => Promise<void>;
  /** 视野中心：经纬度占位符按「规划所在地」取值 */
  lonLatHint: { lon: number; lat: number } | null;
  /** 只建地点，不进当天行程 */
  onAddPlaceOnly: (payload: { name: string; category: string; lon: number; lat: number; notes?: string }) => Promise<void>;
  /** 在地图上点一个位置回来填经纬度：用户通常只知道大概位置 */
  onPickFromMap: () => void;
  pickedPoint: { lon: number; lat: number } | null;
  onConsumePickedPoint: () => void;
  onSelectStop: (stopId: string) => void;
  onSelectPlace: (placeId: string) => void;
  /** 点搜索结果时让地图飞过去并临时标一下 */
  onPreview: (point: { lon: number; lat: number; name: string; crs: string }) => void;
}

export default function SearchPanel({
  trip,
  config,
  activeDayId,
  busy,
  selectedPlaceId,
  onAddFromResult,
  onAddManual,
  onImport,
  onMoveToDay,
  onAddLocalPlace,
  lonLatHint,
  onAddPlaceOnly,
  onPickFromMap,
  pickedPoint,
  onConsumePickedPoint,
  onSelectStop,
  onSelectPlace,
  onPreview,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState<string>("auto");
  const [city, setCity] = useState("");
  const [results, setResults] = useState<Record<string, GeoResult[]>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ name: "", category: "attraction", lon: "", lat: "", notes: "" });
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [tips, setTips] = useState<{ name: string; address: string }[]>([]);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const search = useMutation({
    mutationFn: () => api.search({ provider, q: keyword.trim(), city_code: city.trim() || undefined, limit: 20 }),
    onSuccess: (data) => {
      setResults(data.results_by_provider);
      setWarnings(data.warnings ?? []);
      const total = Object.values(data.results_by_provider).reduce((sum, list) => sum + list.length, 0);
      if (total === 0) notify.info("没有匹配结果，可换个关键词或用“手工新建”。");
    },
    onError: (error) => {
      setResults({});
      notify.error(errorText(error));
    },
  });

  /** 输入时防抖取建议：高德输入提示按关键字前缀匹配，比整词搜索更接近用户预期 */
  const loadTips = (value: string) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    const keyword = value.trim();
    if (keyword.length < 1) {
      setTips([]);
      return;
    }
    tipTimer.current = setTimeout(() => {
      api
        .suggest({ provider, q: keyword, city_code: city.trim() || undefined, limit: 8 })
        .then((data) => {
          const flat = Object.values(data.results_by_provider).flat().slice(0, 8);
          setTips(flat.map((item) => ({ name: item.name, address: item.address ?? "" })));
        })
        .catch(() => setTips([]));
    }, 120);
  };

  // 地图上点完位置回来：把坐标填进表单并重新打开弹窗
  useEffect(() => {
    if (!pickedPoint) return;
    setManual((prev) => ({
      ...prev,
      lon: pickedPoint.lon.toFixed(5),
      lat: pickedPoint.lat.toFixed(5),
    }));
    setManualOpen(true);
    onConsumePickedPoint();
  }, [pickedPoint, onConsumePickedPoint]);

  const providersConfigured = config ? Object.values(config.providers).some(Boolean) : false;
  const candidates = trip.stops.filter((stop) => !stop.day_id);
  const placeOf = (stop: StopOut) => trip.places.find((place) => place.id === stop.place_id);

  const handleAdd = async (result: GeoResult) => {
    const key = result.id;
    setAddingKey(key);
    try {
      await onAddFromResult(result, activeDayId);
      notify.success(`已添加：${result.name}`);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setAddingKey(null);
    }
  };

  const submitManual = async (joinDay: boolean) => {
    const lon = Number(manual.lon);
    const lat = Number(manual.lat);
    if (!manual.name.trim()) return notify.warning("请填写名称");
    // 空字符串 Number("") 是 0，会被当成几内亚湾的 (0,0) 点落库，必须先判空
    if (!manual.lon.trim() || !manual.lat.trim()) {
      return notify.warning("请填写经纬度，或点“在地图上选点”");
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      return notify.warning("经纬度无效");
    }
    const payload = { name: manual.name.trim(), category: manual.category, lon, lat, notes: manual.notes };
    try {
      if (joinDay) {
        await onAddManual(payload, activeDayId);
        notify.success(`已新建并加入当天：${payload.name}`);
      } else {
        await onAddPlaceOnly(payload);
        notify.success(`已存为地点：${payload.name}`);
      }
      setManualOpen(false);
      setManual({ name: "", category: "attraction", lon: "", lat: "", notes: "" });
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  // 经纬度占位符跟着规划所在地走，不再写死一个城市
  const hintLon = lonLatHint ? lonLatHint.lon.toFixed(5) : "115.85868";
  const hintLat = lonLatHint ? lonLatHint.lat.toFixed(5) : "28.64321";

  return (
    <>
      <div className="search-source-row">
        <AppSelect
          value={provider}
          onChange={setProvider}
          options={PROVIDERS}
          popupMatchSelectWidth={false}
          style={{ width: 112 }}
        />
        <Input
          className="search-city"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="城市（可选）"
          allowClear
        />
      </div>
      <div className="search-bar">
        <Input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            loadTips(event.target.value);
          }}
          onPressEnter={() => {
            setTips([]);
            if (keyword.trim()) search.mutate();
          }}
          placeholder="景点 / 地址关键词"
          allowClear
        />
        <Button
          type="primary"
          loading={search.isPending}
          onClick={() => {
            setTips([]);
            if (keyword.trim()) search.mutate();
          }}
        >
          查询
        </Button>
        {tips.length > 0 ? (
          <div className="suggest-pop">
            {tips.map((tip, index) => (
              <button
                type="button"
                key={`${tip.name}-${index}`}
                className="suggest-item"
                onClick={() => {
                  setKeyword(tip.name);
                  setTips([]);
                  search.mutate();
                }}
              >
                <span className="suggest-name">{tip.name}</span>
                <span className="suggest-addr">{tip.address}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!providersConfigured ? (
        <div className="hint-line">未配置地图 Key，搜索暂不可用。可在「设置 → 地图数据源」填写，或先手工新建、导入。</div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="hint-box">{warnings.join("；")}</div>
      ) : null}

      {search.isPending ? (
        <div style={{ padding: 12, textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : null}

      {(() => {
        // 自己建的地点搜得到：新建地点后在搜索框里就能找到，补上「搜不到自有地点」的断点
        const kw = keyword.trim();
        if (!kw) return null;
        const local = trip.places.filter((place) => place.name.includes(kw));
        if (!local.length) return null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="muted tiny">我的地点 · {local.length} 条</div>
            <div className="result-list">
              {local.map((place) => {
                const coords = place.geometry?.coordinates as [number, number] | undefined;
                return (
                  <div
                    key={place.id}
                    className={`result-item${selectedPlaceId === place.id ? " active" : ""}`}
                    onClick={() => {
                      if (coords) onPreview({ lon: coords[0], lat: coords[1], name: place.name, crs: "WGS84" });
                      onSelectPlace(place.id);
                    }}
                  >
                    <div className="row1">
                      <span className="name" title={place.name}>
                        {place.name}
                      </span>
                      <button
                        type="button"
                        className="tag-source"
                        style={{ cursor: "pointer" }}
                        disabled={busy}
                        onClick={async (event) => {
                          event.stopPropagation();
                          await onAddLocalPlace(place.id, activeDayId);
                        }}
                      >
                        加入当天
                      </button>
                    </div>
                    <div className="muted tiny">{place.notes || place.category || "自有地点"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {Object.entries(results).map(([name, list]) => (
        <div key={name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="muted tiny">
            {name === "amap" ? "高德" : name === "tianditu" ? "天地图" : name} · {list.length} 条
          </div>
          <div className="result-list result-list-5">
            {list.map((item) => (
              <div
                key={item.id}
                className={`result-item${selectedPlaceId && trip.places.some((p) => p.name === item.name) ? " active" : ""}`}
                onClick={() => {
                  const coords = (item.geometry as { coordinates?: [number, number] } | null)?.coordinates;
                  if (coords) onPreview({ lon: coords[0], lat: coords[1], name: item.name, crs: item.source_crs });
                  const existing = trip.places.find((place) => place.name === item.name);
                  if (existing) onSelectPlace(existing.id);
                }}
              >
                <div className="row1">
                  <span className="name" title={item.name}>
                    {item.name}
                  </span>
                  <button
                    type="button"
                    className="tag-source"
                    style={{ cursor: "pointer", background: "#fff" }}
                    disabled={busy || addingKey === item.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAdd(item);
                    }}
                  >
                    {addingKey === item.id ? "添加中" : "添加"}
                  </button>
                </div>
                <div className="result-sub">{item.address || item.category || "暂无地址"}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="panel-action-row">
        <Button icon={<PlusOutlined />} onClick={() => setManualOpen(true)} style={{ flex: 1 }}>
          新建地点
        </Button>
        <Upload
          accept=".csv,.geojson,.json"
          showUploadList={false}
          beforeUpload={(file) => {
            onImport(file)
              .then(() => notify.success(`已导入 ${file.name}`))
              .catch((error) => notify.error(errorText(error)));
            return false;
          }}
        >
          <Button icon={<ImportOutlined />} disabled={busy}>
            导入
          </Button>
        </Upload>
        <input ref={fileRef} type="file" hidden />
      </div>

      <div className="section-title">
        <InboxOutlined />
        候选池
        <span className="count">{candidates.length} 个</span>
      </div>
      {candidates.length === 0 ? (
        <div className="empty">还没有暂存的地点</div>
      ) : (
        <div className="result-list">
          {candidates.map((stop) => {
            const place = placeOf(stop);
            return (
              <div key={stop.id} className="result-item" onClick={() => onSelectStop(stop.id)}>
                <div className="row1">
                  <span className="name">{stop.title}</span>
                  {activeDayId ? (
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: 0, height: 18 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMoveToDay(stop.id, activeDayId).catch((error) => notify.error(errorText(error)));
                      }}
                    >
                      加入当天
                    </Button>
                  ) : null}
                </div>
                <div className="muted tiny">
                  {place?.name || "无关联地点"} · {Math.round(stop.duration_seconds / 60)} 分钟
                  {stop.priority === "required" ? " · 必去" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DragModal centered
        title="新建地点"
        open={manualOpen}
        onCancel={() => setManualOpen(false)}
        footer={[
          <Button key="only" onClick={() => void submitManual(false)}>
            仅存地点
          </Button>,
          <Button key="both" type="primary" loading={busy} onClick={() => void submitManual(true)}>
            加入当天行程
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="modal-form">
          <Field label="名称">
            <Input
              placeholder="例如：滕王阁"
              value={manual.name}
              onChange={(event) => setManual({ ...manual, name: event.target.value })}
            />
          </Field>
          <Field label="类别">
            <AppSelect
              value={manual.category}
              onChange={(value) => setManual({ ...manual, category: value })}
              options={[
                { value: "attraction", label: "景点" },
                { value: "meal", label: "餐饮" },
                { value: "lodging", label: "住宿" },
                { value: "transport", label: "交通" },
                { value: "shopping", label: "购物" },
                { value: "viewpoint", label: "观景" },
                { value: "other", label: "其他" },
              ]}
            />
          </Field>
          <div className="modal-row">
            <Field label="经度" hint="WGS84 经度，可保留 5 位小数。不确定就点下面的“在地图上选点”。">
              <Input placeholder={hintLon} value={manual.lon} onChange={(event) => setManual({ ...manual, lon: event.target.value })} />
            </Field>
            <Field label="纬度" hint="WGS84 纬度，可保留 5 位小数。不确定就点下面的“在地图上选点”。">
              <Input placeholder={hintLat} value={manual.lat} onChange={(event) => setManual({ ...manual, lat: event.target.value })} />
            </Field>
          </div>
          <Button block onClick={() => { setManualOpen(false); onPickFromMap(); }}>
            在地图上选点
          </Button>
          <Field label="备注">
            <Input.TextArea
              placeholder="可留空"
              rows={2}
              value={manual.notes}
              onChange={(event) => setManual({ ...manual, notes: event.target.value })}
            />
          </Field>
        </div>
      </DragModal>
    </>
  );
}
