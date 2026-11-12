import { useState } from "react";
import { Button, Dropdown, Input } from "antd";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  AimOutlined,
} from "@ant-design/icons";
import type { MapLayerOut } from "../api/api";
import DragModal from "./DragModal";
import HoverTip from "./HoverTip";

/**
 * 图层面板（图层树）：底图 + 我的专题图层 + 系统专题图层 三层结构。
 *
 * 每个图层节点：眼睛显隐、名称（点击改名）、计数徽标；展开后调透明度、打点/采集、导出、删除。
 * 系统图层是地铁站/酒店这类 POI 专题，由「采集」按当前地图中心抓周边点位入库，不允许删除；
 * 我的图层是自己打点或以后导入的数据。坐标一律 WGS84，跟着行程保存、可分享。
 */
export interface LayerPanelProps {
  layers: MapLayerOut[];
  busy: boolean;
  mapCenter: { lon: number; lat: number } | null;
  onCreate: (payload: { name: string; kind: "mine" | "system"; category?: string; icon?: string; color?: string }) => Promise<unknown>;
  onPatch: (layerId: string, payload: { name?: string; visible?: boolean; opacity?: number }) => Promise<unknown>;
  onDelete: (layerId: string) => Promise<unknown>;
  onAddFeature: (layerId: string) => void;
  onCollect: (layerId: string) => Promise<unknown>;
  onExport: (layer: MapLayerOut) => Promise<unknown>;
  /** 底图区段：选项与开关由 MapCanvas 提供，这里只负责树里的排布 */
  basemap?: {
    options: Array<{ id: string; label: string }>;
    activeId: string;
    onChange: (id: string) => void;
    opacity: number;
    onOpacityChange: (value: number) => void;
    hasAnno: boolean;
    annoOn: boolean;
    onAnnoChange: (value: boolean) => void;
    lineVisible: boolean;
    onLineChange: (value: boolean) => void;
  };
}

export const SYSTEM_LAYER_OPTIONS: Array<{ category: string; name: string; icon: string; color: string }> = [
  { category: "metro_station", name: "地铁站", icon: "metro", color: "#1668dc" },
  { category: "bus_station", name: "公交站", icon: "bus", color: "#2b8a3e" },
  { category: "hotel", name: "酒店", icon: "hotel", color: "#7c3aed" },
  { category: "attraction", name: "景点", icon: "tower", color: "#c76a15" },
  { category: "mall", name: "商场", icon: "bag", color: "#c2255c" },
  { category: "restaurant", name: "饭店", icon: "fork", color: "#e8590c" },
  { category: "toilet", name: "公共厕所", icon: "toilet", color: "#67717e" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(SYSTEM_LAYER_OPTIONS.map((o) => [o.category, o.name]));

/** 点位信息弹窗里把系统图层类别翻成中文，翻不出就显示原始值 */
export function categoryLabelOf(category?: string | null): string {
  if (!category) return "";
  return CATEGORY_LABEL[category] ?? category;
}

export default function LayerPanel({
  layers,
  busy,
  mapCenter,
  onCreate,
  onPatch,
  onDelete,
  onAddFeature,
  onCollect,
  onExport,
  basemap,
}: LayerPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  // 树的展开状态：组折叠 + 单层详情展开
  const [groupOpen, setGroupOpen] = useState({ basemap: true, mine: true, system: true });
  const [openLayerId, setOpenLayerId] = useState<string | null>(null);
  // 透明度拖动过程先走本地，松手才提交，避免拖一下发一串请求
  const [opacityDraft, setOpacityDraft] = useState<{ id: string; value: number } | null>(null);

  const mine = layers.filter((layer) => layer.kind !== "system");
  const system = layers.filter((layer) => layer.kind === "system");

  const submitCreate = async () => {
    const name = draftName.trim() || "新图层";
    await onCreate({ name, kind: "mine", color: "#1668dc" });
    setCreateOpen(false);
    setDraftName("");
  };

  const commitOpacity = (layer: MapLayerOut, value: number) => {
    setOpacityDraft(null);
    if (Math.abs((layer.opacity ?? 1) - value) > 0.001) void onPatch(layer.id, { opacity: value });
  };

  const renderGroup = (
    key: "basemap" | "mine" | "system",
    title: string,
    add: React.ReactNode,
    body: React.ReactNode,
  ) => (
    <div className="tree-group" key={key}>
      <div className="tree-group-row">
        <button
          type="button"
          className="tree-caret"
          aria-label={groupOpen[key] ? `收起${title}` : `展开${title}`}
          onClick={() => setGroupOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
        >
          {groupOpen[key] ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </button>
        <span className="tree-group-name">{title}</span>
        {add}
      </div>
      {groupOpen[key] ? <div className="tree-children">{body}</div> : null}
    </div>
  );

  const renderLayer = (layer: MapLayerOut) => {
    const renaming = renamingId === layer.id;
    const expanded = openLayerId === layer.id;
    const opacity = opacityDraft?.id === layer.id ? opacityDraft.value : (layer.opacity ?? 1);
    return (
      <div key={layer.id} className={`tree-layer${expanded ? " open" : ""}`}>
        <div className="layer-row">
          <button
            type="button"
            className="tree-caret"
            aria-label={expanded ? "收起图层设置" : "展开图层设置"}
            onClick={() => setOpenLayerId(expanded ? null : layer.id)}
          >
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </button>
          <HoverTip title={layer.visible ? "隐藏" : "显示"} placement="top">
            <button
              type="button"
              className="layer-eye"
              aria-label={layer.visible ? "隐藏图层" : "显示图层"}
              onClick={() => void onPatch(layer.id, { visible: !layer.visible })}
            >
              {layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            </button>
          </HoverTip>
          <span className="layer-swatch" style={{ background: layer.color || "#1668dc" }} />
          {renaming ? (
            <Input
              size="small"
              autoFocus
              value={renameText}
              onChange={(event) => setRenameText(event.target.value)}
              onBlur={() => {
                if (renameText.trim() && renameText.trim() !== layer.name) void onPatch(layer.id, { name: renameText.trim() });
                setRenamingId(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <span
              className="layer-name"
              title="点击改名"
              onClick={() => {
                setRenamingId(layer.id);
                setRenameText(layer.name);
              }}
            >
              <span className="layer-name-text">{layer.name}</span>
              <i>{layer.features?.length ?? 0}</i>
            </span>
          )}
        </div>
        {expanded ? (
          <div className="layer-detail">
            <div className="layer-detail-opacity">
              <span>透明度</span>
              <input
                type="range"
                min={0}
                max={100}
                step={10}
                value={Math.round(opacity * 100)}
                aria-label="图层透明度"
                style={{ ["--fill" as string]: `${Math.round(opacity * 100)}%` }}
                onChange={(event) => setOpacityDraft({ id: layer.id, value: Number(event.target.value) / 100 })}
                onPointerUp={() => commitOpacity(layer, opacity)}
                onKeyUp={() => commitOpacity(layer, opacity)}
              />
              <b>{Math.round(opacity * 100)}%</b>
            </div>
            <div className="layer-detail-acts">
              {layer.kind === "system" ? (
                <HoverTip title="按当前地图位置抓周边点位入库" placement="top">
                  <button type="button" className="layer-act" disabled={busy || !mapCenter} onClick={() => void onCollect(layer.id)}>
                    <CloudDownloadOutlined />
                    采集
                  </button>
                </HoverTip>
              ) : (
                <HoverTip title="在地图上打一个点进这层" placement="top">
                  <button type="button" className="layer-act" onClick={() => onAddFeature(layer.id)}>
                    <AimOutlined />
                    打点
                  </button>
                </HoverTip>
              )}
              <HoverTip title="导出 GeoJSON" placement="top">
                <button type="button" className="layer-act" onClick={() => void onExport(layer)}>
                  <DownloadOutlined />
                  导出
                </button>
              </HoverTip>
              {layer.kind !== "system" ? (
                <HoverTip title="删除图层" placement="top">
                  <button type="button" className="layer-act danger" onClick={() => void onDelete(layer.id)}>
                    <DeleteOutlined />
                    删除
                  </button>
                </HoverTip>
              ) : (
                <span className="layer-detail-note">系统图层不可删除</span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="basemap-pop-title">图层</div>

      {basemap
        ? renderGroup(
            "basemap",
            "底图",
            null,
            <>
              {basemap.options.map((item) => (
                <button
                  type="button"
                  className={`basemap-opt${item.id === basemap.activeId ? " on" : ""}`}
                  key={item.id}
                  onClick={() => basemap.onChange(item.id)}
                >
                  <span className="basemap-opt-dot" />
                  <span className="basemap-opt-label">{item.label}</span>
                </button>
              ))}
              <div className="basemap-opacity">
                <div className="basemap-opacity-head">
                  <span>底图透明度</span>
                  <b>{Math.round(basemap.opacity * 100)}%</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(basemap.opacity * 100)}
                  onChange={(event) => basemap.onOpacityChange(Number(event.target.value) / 100)}
                  aria-label="底图透明度"
                  style={{ ["--fill" as string]: `${Math.round(basemap.opacity * 100)}%` }}
                />
              </div>
              <label
                className={`basemap-anno${basemap.hasAnno ? "" : " disabled"}`}
                title={basemap.hasAnno ? undefined : "当前底图不含独立注记层"}
              >
                <input
                  type="checkbox"
                  checked={basemap.annoOn}
                  disabled={!basemap.hasAnno}
                  onChange={(event) => basemap.onAnnoChange(event.target.checked)}
                />
                <span>显示地名注记</span>
              </label>
              <label className="basemap-anno">
                <input
                  type="checkbox"
                  checked={basemap.lineVisible}
                  onChange={(event) => basemap.onLineChange(event.target.checked)}
                />
                <span>显示行程连线</span>
              </label>
            </>,
          )
        : null}

      {renderGroup(
        "mine",
        "我的专题图层",
        <HoverTip title="新建图层" placement="top">
          <button type="button" className="tree-add" aria-label="新建图层" onClick={() => setCreateOpen(true)}>
            <PlusOutlined />
          </button>
        </HoverTip>,
        mine.length ? (
          mine.map(renderLayer)
        ) : (
          <div className="layer-empty">还没有自建图层</div>
        ),
      )}

      {renderGroup(
        "system",
        "系统专题图层",
        <HoverTip title="添加系统图层" placement="top">
          <Dropdown
            trigger={["click"]}
            menu={{
              items: SYSTEM_LAYER_OPTIONS.map((item) => ({ key: item.category, label: item.name })),
              onClick: ({ key }) => {
                const preset = SYSTEM_LAYER_OPTIONS.find((item) => item.category === key);
                if (preset) void onCreate({ name: preset.name, kind: "system", category: preset.category, icon: preset.icon, color: preset.color });
              },
            }}
          >
            <button type="button" className="tree-add" aria-label="添加系统图层">
              <PlusOutlined />
            </button>
          </Dropdown>
        </HoverTip>,
        system.length ? (
          system.map(renderLayer)
        ) : (
          <div className="layer-empty">还没有系统图层</div>
        ),
      )}

      <DragModal
        centered
        title="新建图层"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={[
          <Button key="ok" type="primary" loading={busy} onClick={() => void submitCreate()}>
            新建
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="modal-form">
          <div className="modal-field">
            <span className="modal-field-label">名称</span>
            <Input value={draftName} placeholder="例如：备选餐厅" onChange={(event) => setDraftName(event.target.value)} />
          </div>
        </div>
      </DragModal>
    </>
  );
}
