import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Spin, Table, Tag, Tooltip } from "antd";
import dayjs from "dayjs";
import { api } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import TopBar from "../components/TopBar";

/** 内部写入原因转成用户能读的动作名，界面上不出现 stop-edit 这类英文键。 */
const REASON_LABEL: Record<string, string> = {
  create: "创建行程",
  edit: "修改行程",
  clone: "复制行程",
  "clone-share": "从分享复制",
  "date-change": "调整日期",
  "day-edit": "修改当天安排",
  "place-create": "新增地点",
  "place-edit": "修改地点",
  "place-delete": "删除地点",
  restore: "恢复版本",
  "stop-create": "新增事项",
  "stop-edit": "修改事项",
  "stop-delete": "删除事项",
  reorder: "调整顺序",
  "import-places": "导入地点",
  "manual-leg": "记录交通",
  "leg-delete": "删除交通",
  "apply-optimization": "应用优化建议",
};

const KIND_LABEL: Record<string, string> = {
  attraction: "景点",
  meal: "餐饮",
  lodging: "住宿",
  transport: "交通",
  free: "自由活动",
};

export default function HistoryPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(null);

  const trip = useQuery({ queryKey: ["trip", tripId], queryFn: () => api.getTrip(tripId) });
  const revisions = useQuery({ queryKey: ["revisions", tripId], queryFn: () => api.revisions(tripId) });
  const detail = useQuery({
    queryKey: ["revision", tripId, selected],
    queryFn: () => api.revision(tripId, selected as number),
    enabled: selected !== null,
  });

  useEffect(() => {
    if (!selected && revisions.data?.length) setSelected(revisions.data[0].revision);
  }, [revisions.data, selected]);

  const restore = async () => {
    if (!trip.data || selected === null) return;
    try {
      await api.restore(tripId, trip.data.revision, selected);
      await trip.refetch();
      await revisions.refetch();
      notify.success("已恢复为新版本");
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  const snapshot = detail.data?.snapshot as
    | { days?: unknown[]; places?: unknown[]; stops?: unknown[]; trip?: { title?: string } }
    | undefined;

  return (
    <div className="app-shell">
      <TopBar
        showBack
        backTo={`/trips/${tripId}`}
        actions={
          <Button
            onClick={() => {
              revisions.refetch();
              detail.refetch();
            }}
          >
            刷新
          </Button>
        }
      >
        <span className="page-title">{trip.data?.title ?? "版本历史"}</span>
        <span className="rev">版本历史</span>
      </TopBar>

      <div className="history-layout">
        <section className="history-list">
          <div className="panel-head">
            <span className="panel-title">
              版本<span className="count">{revisions.data?.length ?? 0} 个</span>
            </span>
          </div>
          <div className="panel-body history-scroll">
            {revisions.isLoading ? (
              <div className="empty">加载中…</div>
            ) : (
              (revisions.data ?? []).map((item) => (
                <button
                  type="button"
                  key={item.revision}
                  className={`history-item${item.revision === selected ? " on" : ""}`}
                  onClick={() => setSelected(item.revision)}
                >
                  <span className="history-rev">v{item.revision}</span>
                  <span className="history-reason">{REASON_LABEL[item.reason] ?? "修改"}</span>
                  <span className="history-time">{dayjs(item.created_at).format("MM-DD HH:mm")}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="history-detail">
          {selected === null ? (
            <div className="empty">选择左侧任一版本查看当时的内容。</div>
          ) : detail.isLoading ? (
            <div className="centered">
              <Spin />
            </div>
          ) : detail.data ? (
            <>
              <div className="panel-head">
                <span className="panel-title">
                  版本 {detail.data.revision}
                  <Tag style={{ marginInlineEnd: 0 }}>{REASON_LABEL[detail.data.reason] ?? "修改"}</Tag>
                  <span className="count">{dayjs(detail.data.created_at).format("YYYY-MM-DD HH:mm")}</span>
                </span>
                <div className="panel-actions">
                  <Button size="small" onClick={() => navigate(`/trips/${tripId}/guide?revision=${detail.data.revision}`)}>
                    查看攻略
                  </Button>
                  <Tooltip title="恢复会写成新的版本，历史版本不受影响">
                    <Button size="small" type="primary" onClick={restore} disabled={!trip.data}>
                      恢复为新版本
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <div className="panel-body history-scroll">
                <div className="history-meta">
                  {snapshot?.days?.length ?? 0} 天 · {snapshot?.places?.length ?? 0} 个地点 · {snapshot?.stops?.length ?? 0} 个事项
                </div>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row: { id: string }) => row.id}
                  dataSource={
                    (snapshot?.stops ?? []) as Array<{
                      id: string;
                      title: string;
                      kind: string;
                      day_id: string | null;
                      duration_seconds: number;
                    }>
                  }
                  columns={[
                    { title: "事项", dataIndex: "title" },
                    {
                      title: "类型",
                      dataIndex: "kind",
                      width: 90,
                      render: (value: string) => KIND_LABEL[value] ?? "其他",
                    },
                    {
                      title: "所属日期",
                      dataIndex: "day_id",
                      width: 110,
                      render: (value: string | null) => {
                        if (!value) return "候选池";
                        const days = (snapshot?.days ?? []) as Array<{ id: string; date: string }>;
                        return days.find((item) => item.id === value)?.date ?? "—";
                      },
                    },
                    {
                      title: "时长",
                      dataIndex: "duration_seconds",
                      width: 80,
                      render: (value: number) => `${Math.round(value / 60)} 分`,
                    },
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="empty">快照加载失败。</div>
          )}
        </section>
      </div>
    </div>
  );
}
