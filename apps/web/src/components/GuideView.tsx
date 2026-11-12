import { Tag } from "antd";
import type { GuideSnapshot } from "../api/api";

function hhmm(iso: string | null) {
  if (!iso) return "—";
  return iso.slice(11, 16);
}

function money(minor: number | null, currency: string) {
  if (minor === null || minor === undefined) return "未知";
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

const CONFLICT_TEXT: Record<string, string> = {
  LATE_FIXED_START: "固定预约时间晚于预计到达",
  WINDOW_MISSED: "开放时间窗口已错过",
  DAY_OVERFLOW: "超出当天结束时间",
  MISSING_TRAVEL: "缺少交通耗时",
  MISSING_RETURN_TRAVEL: "缺少返回终点的交通耗时",
};

export default function GuideView({ guide }: { guide: GuideSnapshot }) {
  const currency = guide.currency || "CNY";
  return (
    <div className="guide">
      <h1>{guide.title}</h1>
      <ul className="meta-list">
        <li>行程日期：{guide.date_range}</li>
        <li>货币：{currency === "CNY" ? "人民币" : currency}</li>
        <li>
          预算：{money(guide.budget.budget_minor, currency)}　已知费用：{money(guide.budget.known_minor, currency)}　未记费用：
          {guide.budget.unknown_cost_count} 项
        </li>
        <li>生成时间：{guide.generated_at}</li>
      </ul>

      {guide.days.map((day) => (
        <section key={day.day_id}>
          <h2>
            {day.date}（{day.start_local_time}–{day.end_local_time}）
          </h2>
          {day.blocks.length === 0 ? (
            <p className="muted">当天没有安排。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>时间</th>
                  <th>事项</th>
                  <th style={{ width: 110 }}>地点</th>
                  <th style={{ width: 72 }}>交通</th>
                  <th style={{ width: 78 }}>费用</th>
                  <th style={{ width: 150 }}>备注</th>
                </tr>
              </thead>
              <tbody>
                {day.blocks.map((block) => (
                  <tr key={block.stop_id}>
                    <td>
                      {hhmm(block.start)}–{hhmm(block.end)}
                    </td>
                    <td>{block.title}</td>
                    <td>{block.place_name || "—"}</td>
                    <td>{block.travel_seconds === null ? "未设置" : `${Math.round(block.travel_seconds / 60)} 分`}</td>
                    <td>{money(block.cost_minor, currency)}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{block.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="tiny muted">
            交通 {Math.round(day.totals.travel_seconds / 60)} 分钟，停留 {Math.round(day.totals.visit_seconds / 60)} 分钟，已知费用{" "}
            {money(day.totals.cost_known_minor, currency)}，未记费用 {day.totals.unknown_cost_count} 项。
          </p>
          {day.conflicts.length > 0 ? (
            <p>
              <Tag color="orange">需注意</Tag>
              {day.conflicts.map((code) => CONFLICT_TEXT[code] ?? code).join("、")}
            </p>
          ) : null}
        </section>
      ))}

      <h2>数据来源</h2>
      <ul className="meta-list">
        {guide.sources.map((source) => (
          <li key={source}>{source}</li>
        ))}
      </ul>
      <p className="muted tiny">地点为自建或用户从搜索结果复制，未保存供应商原始记录。</p>
    </div>
  );
}
