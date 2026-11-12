import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Space, Spin } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { api, type JobOut } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import TopBar from "../components/TopBar";
import GuideView from "../components/GuideView";

async function waitJob(job: JobOut): Promise<JobOut> {
  let current = job;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (current.status === "succeeded" || current.status === "failed" || current.status === "cancelled") return current;
    await new Promise((resolve) => setTimeout(resolve, 300));
    current = await api.job(job.id);
  }
  return current;
}

export default function GuidePage() {
  const { tripId = "" } = useParams();
  const [params] = useSearchParams();
  const revisionParam = params.get("revision");
  const revision = revisionParam ? Number(revisionParam) : undefined;
  const [exporting, setExporting] = useState<"md" | "docx" | null>(null);

  const guide = useQuery({
    queryKey: ["guide", tripId, revision],
    queryFn: () => api.guide(tripId, revision),
  });

  const doExport = async (format: "md" | "docx") => {
    setExporting(format);
    try {
      const job = await api.exportJob(tripId, format, revision);
      const done = await waitJob(job);
      if (done.status !== "succeeded") {
        notify.error(done.error?.message ? String(done.error.message) : "导出失败");
        return;
      }
      const result = await api.jobResult(done.id);
      const payload = result.result as unknown as { download_url: string; filename: string };
      const blob = await api.download(payload.download_url);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = payload.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      notify.success("导出完成，文件已开始下载");
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        showBack
        backTo={`/trips/${tripId}`}
        actions={
          <Space>
            <Button size="small" onClick={() => navigator.clipboard?.writeText(guide.data?.markdown ?? "")}>
              复制 Markdown
            </Button>
            <Button size="small" icon={<DownloadOutlined />} loading={exporting === "md"} onClick={() => doExport("md")}>
              导出 MD
            </Button>
            <Button size="small" type="primary" icon={<DownloadOutlined />} loading={exporting === "docx"} onClick={() => doExport("docx")}>
              导出 DOCX
            </Button>
          </Space>
        }
      >
        <span className="rev">攻略预览{revision ? " · 历史版本" : ""}</span>
      </TopBar>
      <div className="page-wrap" style={{ padding: "12px 12px 40px" }}>
        {guide.isLoading ? (
          <div className="centered" style={{ height: 240 }}>
            <Spin />
          </div>
        ) : guide.data ? (
          <GuideView guide={guide.data} />
        ) : (
          <div className="empty">{guide.isError ? errorText(guide.error) : "暂无内容"}</div>
        )}
      </div>
    </div>
  );
}
