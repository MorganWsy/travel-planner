import { useMemo, useState } from "react";
import { Button, Dropdown, Input, TimePicker, Tooltip } from "antd";
import DragModal from "./DragModal";
import { MoreOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import AppSelect from "./AppSelect";
import AppNumber from "./AppNumber";
import type { DayTimeline, StopOut, TimelineOut, TripDetail } from "../api/api";
import { notify } from "../lib/notify";
import { IconGrip } from "./icons";
import Field from "./Field";
import { IconWeather } from "./icons";

const KIND_LABEL: Record<string, string> = {
  attraction: "景点",
  meal: "餐饮",
  lodging: "住宿",
  transport: "交通",
  free: "自由活动",
};

const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const PRIORITY_LABEL: Record<string, string> = { required: "必去", preferred: "优先", optional: "可选" };
/* 与 MapCanvas 的类别色一一对应，卡片序号和地图标注看起来是同一套编号 */
const CATEGORY_COLOR: Record<string, string> = {
  attraction: "#1668dc",
  meal: "#c76a15",
  lodging: "#7c3aed",
  transport: "#0891b2",
  shopping: "#c2255c",
  viewpoint: "#2b8a3e",
  other: "#67717e",
};

interface Props {
  trip: TripDetail;
  timeline?: TimelineOut;
  /** 按日期索引的天气，用于日期条上显示天气与最高温 */
  weatherByDate?: Record<string, { label: string; icon: string; high: number | null; low: number | null; rain: number | null }>;
  weatherNote?: string;
  activeDayId: string | null;
  selectedStopId: string | null;
  /** 全行程访问顺序编号：与地图针形标注里的数字同源 */
  numberByStop: Map<string, number>;
  busy: boolean;
  onSelectDay: (dayId: string) => void;
  onSelectStop: (stopId: string) => void;
  onReorder: (dayId: string, orderedStopIds: string[]) => Promise<void>;
  onMoveToDay: (stopId: string, dayId: string | null) => Promise<void>;
  onDeleteStop: (stopId: string) => Promise<void>;
  onPatchStop: (stopId: string, payload: Record<string, unknown>) => Promise<void>;
  onPatchDay: (dayId: string, payload: Record<string, unknown>) => Promise<void>;
  onAddStop: (dayId: string) => void;
  onOptimize: (dayId: string) => void;
  onPlanRoute: (fromStopId: string, toStopId: string) => void;
}

export default function DayPanel({
  trip,
  timeline,
  weatherByDate,
  weatherNote,
  activeDayId,
  selectedStopId,
  numberByStop,
  busy,
  onSelectDay,
  onSelectStop,
  onReorder,
  onMoveToDay,
  onDeleteStop,
  onPatchStop,
  onPatchDay,
  onAddStop,
  onOptimize,
  onPlanRoute,
}: Props) {
  const [editing, setEditing] = useState<StopOut | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<"before" | "after">("before");

  const day = trip.days.find((item) => item.id === activeDayId) ?? trip.days[0];
  const dayStops = useMemo(
    () => trip.stops.filter((stop) => stop.day_id === day?.id).sort((a, b) => a.position - b.position),
    [trip.stops, day?.id],
  );
  const dayTimeline: DayTimeline | undefined = timeline?.days.find((item) => item.day_id === day?.id);
  const blockOf = (stopId: string) => dayTimeline?.blocks.find((block) => block.stop_id === stopId);

  const openEdit = (stop: StopOut) => {
    setEditing(stop);
    setForm({
      title: stop.title,
      kind: stop.kind,
      minutes: Math.round(stop.duration_seconds / 60),
      cost: stop.cost_minor === null ? undefined : stop.cost_minor / 100,
      priority: stop.priority,
      notes: stop.notes ?? "",
      travel_minutes: stop.transport?.duration_seconds ? Math.round(Number(stop.transport.duration_seconds) / 60) : undefined,
      fixed_start: stop.fixed_start ? dayjs(stop.fixed_start) : null,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      title: String(form.title ?? "").trim(),
      kind: form.kind,
      duration_seconds: Math.max(0, Number(form.minutes ?? 60)) * 60,
      cost_minor: form.cost === undefined || form.cost === null ? null : Math.round(Number(form.cost) * 100),
      priority: form.priority,
      notes: String(form.notes ?? ""),
      transport:
        form.travel_minutes === undefined || form.travel_minutes === null || Number(form.travel_minutes) <= 0
          ? {}
          : { duration_seconds: Math.round(Number(form.travel_minutes) * 60), mode: "manual" },
    };
    if (!payload.title) return notify.warning("标题不能为空");
    payload.clear_fixed_start = !form.fixed_start;
    if (form.fixed_start) {
      // 固定开始时间只取时分，日期跟着所在天走
      const picked = form.fixed_start as dayjs.Dayjs;
      payload.fixed_start = dayjs(`${day.date}T${picked.format("HH:mm")}:00`).toISOString();
    }
    try {
      await onPatchStop(editing.id, payload);
      setEditing(null);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const handleDragStart = (event: React.DragEvent, stopId: string) => {
    setDragId(stopId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stopId);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, stopId: string) => {
    if (!dragId || dragId === stopId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setOverId(stopId);
    setOverPos(event.clientY - rect.top < rect.height / 2 ? "before" : "after");
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>, stopId: string) => {
    event.preventDefault();
    const moving = dragId ?? event.dataTransfer.getData("text/plain");
    setDragId(null);
    setOverId(null);
    if (!moving || !day || moving === stopId) return;
    const ids = dayStops.map((stop) => stop.id);
    const remaining = ids.filter((id) => id !== moving);
    const targetIndex = remaining.indexOf(stopId) + (overPos === "after" ? 1 : 0);
    remaining.splice(Math.max(0, targetIndex), 0, moving);
    if (remaining.join(",") === ids.join(",")) return;
    try {
      await onReorder(day.id, remaining);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "排序失败，请重试");
    }
  };

  if (!day) return <div className="empty">该行程没有日期。</div>;

  const totalTravel = dayTimeline?.travel_seconds ?? 0;
  const totalVisit = dayTimeline?.visit_seconds ?? 0;

  return (
    <>
      <div className="day-tabs">
        {trip.days.map((item) => (
          <div
            key={item.id}
            className={`day-tab${item.id === day.id ? " active" : ""}`}
            onClick={() => onSelectDay(item.id)}
          >
            {item.date.slice(5)}
            <span className="dow">{dayjs(item.date).format("ddd")}</span>
            {weatherByDate?.[item.date] ? (
              <span className="day-wx" title={`${weatherByDate[item.date].label}${weatherByDate[item.date].rain !== null ? ` · 降水 ${weatherByDate[item.date].rain}%` : ""}`}>
                <IconWeather kind={weatherByDate[item.date].icon} size={13} />
                {weatherByDate[item.date].high !== null ? `${Math.round(weatherByDate[item.date].high as number)}°` : "—"}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {weatherNote ? <div className="day-wx-note">{weatherNote}</div> : null}

      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <TimePicker
          size="small"
          format="HH:mm"
          allowClear={false}
          minuteStep={10}
          value={dayjs(day.start_local_time, "HH:mm")}
          onChange={(value) =>
            value &&
            onPatchDay(day.id, { start_local_time: value.format("HH:mm") }).catch((error) => notify.error(error.message))
          }
          style={{ width: 74 }}
        />
        <span className="muted">–</span>
        <TimePicker
          size="small"
          format="HH:mm"
          allowClear={false}
          minuteStep={10}
          value={dayjs(day.end_local_time, "HH:mm")}
          onChange={(value) =>
            value &&
            onPatchDay(day.id, { end_local_time: value.format("HH:mm") }).catch((error) => notify.error(error.message))
          }
          style={{ width: 74 }}
        />
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <AppSelect
          size="small"
          allowClear
          placeholder="当天起点"
          value={day.start_place_id ?? undefined}
          onChange={(value) =>
            onPatchDay(day.id, { start_place_id: value ?? "" }).catch((error) => notify.error(error.message))
          }
          options={trip.places.map((place) => ({ value: place.id, label: place.name }))}
          style={{ flex: 1, minWidth: 0 }}
        />
        <AppSelect
          size="small"
          allowClear
          placeholder="当天终点"
          value={day.end_place_id ?? undefined}
          onChange={(value) =>
            onPatchDay(day.id, { end_place_id: value ?? "" }).catch((error) => notify.error(error.message))
          }
          options={trip.places.map((place) => ({ value: place.id, label: place.name }))}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>

      {dayStops.length === 0 ? (
        <div className="empty">
          当天还没有安排。
          <br />
          从左侧“候选池”或搜索结果加入，也可以直接新建事项。
        </div>
      ) : (
        <div className="stop-list">
          {dayStops.map((stop, index) => {
            const block = blockOf(stop.id);
            const hasTime = Boolean(block?.start && block?.end);
            const start = block?.start ? dayjs(block.start).format("HH:mm") : "";
            const end = block?.end ? dayjs(block.end).format("HH:mm") : "";
            const place = trip.places.find((item) => item.id === stop.place_id);
            const number = numberByStop.get(stop.id);
            const dropClass = overId === stop.id ? (overPos === "before" ? " drop-before" : " drop-after") : "";
            const conflicts = block?.conflicts ?? [];
            // 警示图标是「补记交通耗时」的唯一入口；第一个事项没有上一站，直接进编辑弹窗
            const fixTravel = (event: React.MouseEvent) => {
              event.stopPropagation();
              if (index > 0) onPlanRoute(dayStops[index - 1].id, stop.id);
              else openEdit(stop);
            };
            return (
              <div
                key={stop.id}
                className={`stop-card kind-${stop.kind}${selectedStopId === stop.id ? " selected" : ""}${
                  dragId === stop.id ? " dragging" : ""
                }${dropClass}`}
                onClick={() => onSelectStop(stop.id)}
                onDragOver={(event) => handleDragOver(event, stop.id)}
                onDragLeave={() => setOverId((current) => (current === stop.id ? null : current))}
                onDrop={(event) => void handleDrop(event, stop.id)}
              >
                <Tooltip title="拖动调整顺序" placement="left">
                  <span
                    className="drag-handle"
                    draggable
                    onDragStart={(event) => handleDragStart(event, stop.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                  >
                    <IconGrip width={12} height={12} />
                  </span>
                </Tooltip>
                <div className="body">
                  <div className="stop-row stop-row-title">
                    <span
                      className="stop-index"
                      style={{ background: CATEGORY_COLOR[place?.category ?? stop.kind] ?? CATEGORY_COLOR.other }}
                    >
                      {number ?? "–"}
                    </span>
                    <span className="txt" title={stop.title}>
                      {stop.title}
                    </span>
                    {(
                      <span className={stop.priority === "required" ? "tag-required" : stop.priority === "optional" ? "tag-optional" : "tag-preferred"}>
                        {PRIORITY_LABEL[stop.priority] ?? stop.priority}
                      </span>
                    )}
                    {stop.locked_position ? <span className="tag-optional">锁序</span> : null}
                    {!hasTime || conflicts.length > 0 ? (
                      <Tooltip title={conflicts.length ? conflicts.map(conflictText).join("、") : "缺少上一段交通耗时，点击补记"}>
                        <span
                          className="conflict-dot"
                          role="button"
                          aria-label="补记交通耗时"
                          onClick={fixTravel}
                        >
                          ⚠
                        </span>
                      </Tooltip>
                    ) : null}
                    <div className="actions">
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            { key: "up", label: "上移一位", disabled: index === 0 },
                            { key: "down", label: "下移一位", disabled: index === dayStops.length - 1 },
                            { key: "lock", label: stop.locked_position ? "解除顺序锁" : "锁定顺序" },
                            { type: "divider" as const },
                            ...trip.days
                              .filter((item) => item.id !== day.id)
                              .map((item) => ({ key: `day:${item.id}`, label: `移到 ${item.date.slice(5)}` })),
                            { key: "candidates", label: "移到候选池" },
                            { key: "route", label: index > 0 ? "查上一段路线" : "查路线（不可用）", disabled: index === 0 },
                            { type: "divider" as const },
                            { key: "edit", label: "编辑" },
                            { key: "delete", label: <span style={{ color: "var(--red)" }}>删除</span> },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            if (key === "up" && index > 0) {
                              const ids = dayStops.map((item) => item.id);
                              [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                              onReorder(day.id, ids).catch((error) => notify.error(error.message));
                            } else if (key === "down" && index < dayStops.length - 1) {
                              const ids = dayStops.map((item) => item.id);
                              [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
                              onReorder(day.id, ids).catch((error) => notify.error(error.message));
                            } else if (key === "lock") {
                              onPatchStop(stop.id, { locked_position: !stop.locked_position }).catch((error) =>
                                notify.error(error.message),
                              );
                            } else if (key.startsWith("day:")) {
                              onMoveToDay(stop.id, key.slice(4)).catch((error) => notify.error(error.message));
                            } else if (key === "candidates") {
                              onMoveToDay(stop.id, null).catch((error) => notify.error(error.message));
                            } else if (key === "route" && index > 0) {
                              onPlanRoute(dayStops[index - 1].id, stop.id);
                            } else if (key === "edit") {
                              openEdit(stop);
                            } else if (key === "delete") {
                              onDeleteStop(stop.id).catch((error) => notify.error(error.message));
                            }
                          },
                        }}
                      >
                        <Button size="small" type="text" icon={<MoreOutlined />} onClick={(event) => event.stopPropagation()} />
                      </Dropdown>
                    </div>
                  </div>
                  <div className="stop-row stop-row-time">
                    {hasTime ? (
                      <span className="time-text">{start} – {end}</span>
                    ) : (
                      <Tooltip title="上一站到本站还没有交通耗时，点标题右侧的警示图标补记">
                        <span className="time-pending">时间待排</span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="stop-row stop-row-meta">
                    <span>{KIND_LABEL[stop.kind] ?? stop.kind}</span>
                    <span>{Math.round(stop.duration_seconds / 60)} 分钟</span>
                    {stop.cost_minor === null ? null : <span>¥{(stop.cost_minor / 100).toFixed(0)}</span>}
                    {/* 第一个点没有「从上一站」这回事 */}
                    {index > 0 && block?.travel_seconds !== null && block?.travel_seconds !== undefined ? (
                      <span>{Math.round(block.travel_seconds / 60)} 分车程</span>
                    ) : null}
                    {place ? <span className="place-name" title={place.name}>{place.name}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="day-actions">
        <Button icon={<PlusOutlined />} onClick={() => onAddStop(day.id)} style={{ flex: 1 }}>
          添加事项
        </Button>
        <Button
          icon={<ThunderboltOutlined />}
          onClick={() => onOptimize(day.id)}
          disabled={busy || dayStops.length < 2}
        >
          优化当天
        </Button>
      </div>

      <div className="day-summary">
        <span>交通 {Math.round(totalTravel / 60)} 分</span>
        <span>停留 {Math.round(totalVisit / 60)} 分</span>
        <span>费用 ¥{((dayTimeline?.cost_known_minor ?? 0) / 100).toFixed(0)}</span>
        {dayTimeline?.unknown_cost_count ? <span>未记费用 {dayTimeline.unknown_cost_count} 项</span> : null}
        {dayTimeline?.uncertain ? <span style={{ color: "var(--amber)" }}>到达时间不确定</span> : null}
        {dayTimeline?.conflicts?.length ? <span style={{ color: "var(--amber)" }}>冲突 {dayTimeline.conflicts.length} 处</span> : null}
      </div>

      <DragModal centered
        title="编辑事项"
        open={!!editing}
        onCancel={() => setEditing(null)}
        footer={[
          <Button key="ok" type="primary" loading={busy} onClick={() => void saveEdit()}>
            保存
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="modal-form">
          <Field label="标题">
            <Input
              placeholder="例如：滕王阁"
              value={String(form.title ?? "")}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </Field>
          <div className="modal-row">
            <Field label="类型">
              <AppSelect
                value={String(form.kind ?? "attraction")}
                onChange={(value) => setForm({ ...form, kind: value })}
                options={KIND_OPTIONS}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="优先级">
              <AppSelect
                value={String(form.priority ?? "preferred")}
                onChange={(value) => setForm({ ...form, priority: value })}
                options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
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
                value={form.minutes as number}
                onChange={(value) => setForm({ ...form, minutes: value ?? 0 })}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="费用">
              <AppNumber
                before="¥"
                min={0}
                value={form.cost as number | undefined}
                placeholder="可留空"
                onChange={(value) => setForm({ ...form, cost: value })}
                style={{ width: "100%" }}
              />
            </Field>
          </div>
          <Field label="交通耗时">
            <AppNumber
              after="分钟"
              min={0}
              max={1440}
              value={form.travel_minutes as number | undefined}
              placeholder="可留空"
              onChange={(value) => setForm({ ...form, travel_minutes: value })}
              style={{ width: "100%" }}
            />
          </Field>
          <Field
            label="固定开始时间"
            hint="指这一项必须在指定时刻开始（如预约、演出、班车）。排期会把它钉在该时刻，其余事项围绕它顺推。留空则按顺序顺推。"
          >
            <TimePicker
              format="HH:mm"
              minuteStep={5}
              allowClear
              placeholder="可留空"
              value={(form.fixed_start as dayjs.Dayjs | null) ?? null}
              onChange={(value) => setForm({ ...form, fixed_start: value })}
              style={{ width: "100%" }}
            />
          </Field>
          <Field label="备注">
            <Input.TextArea
              rows={3}
              placeholder="可留空"
              value={String(form.notes ?? "")}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
      </DragModal>
    </>
  );
}

const CONFLICT_TEXT: Record<string, string> = {
  LATE_FIXED_START: "晚于固定预约时间",
  WINDOW_MISSED: "错过开放时间窗口",
  DAY_OVERFLOW: "超出当天结束时间",
  MISSING_TRAVEL: "缺少交通耗时",
  MISSING_RETURN_TRAVEL: "缺少返回终点的交通耗时",
};

function conflictText(code: string) {
  return CONFLICT_TEXT[code] ?? code;
}
