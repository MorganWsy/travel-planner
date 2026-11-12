import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Input, Spin } from "antd";
import { api, type GuideSnapshot } from "../api/api";
import { errorText } from "../api/client";
import { notify } from "../lib/notify";
import { ThemeToggle } from "../components/TopBar";
import Logo from "../components/Logo";
import GuideView from "../components/GuideView";
import { useAuthStore } from "../store/app";

export default function SharePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState<GuideSnapshot | null>(null);
  const [allowClone, setAllowClone] = useState(false);

  const share = useQuery({
    queryKey: ["share", token],
    queryFn: () => api.readShare(token),
    enabled: !!token,
  });

  const unlock = useMutation({
    mutationFn: () => api.unlockShare(token, password),
    onSuccess: (data) => {
      if (data.snapshot) {
        setUnlocked(data.snapshot as unknown as GuideSnapshot);
        setAllowClone(data.allow_clone);
      }
    },
    onError: (error) => notify.error(errorText(error)),
  });

  const guide = unlocked ?? ((share.data?.snapshot as unknown as GuideSnapshot | null) ?? null);

  const clone = async () => {
    if (status !== "authenticated") {
      navigate("/login", { state: { from: `/s/${token}` } });
      return;
    }
    try {
      const trip = await api.cloneShare(token);
      notify.success("已复制到我的行程");
      navigate(`/trips/${trip.id}`);
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  if (share.isLoading) {
    return (
      <div className="centered">
        <Spin />
      </div>
    );
  }

  if (share.isError) {
    return (
      <div className="centered">
        <Card style={{ width: 360 }}>
          <div style={{ marginBottom: 8 }}>分享链接不可用</div>
          <div className="muted tiny">{errorText(share.error)}</div>
        </Card>
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="centered">
        <Card style={{ width: 340 }} title="需要访问密码">
          <Input.Password
            placeholder="请输入分享密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => unlock.mutate()}
          />
          <Button type="primary" block style={{ marginTop: 8 }} loading={unlock.isPending} onClick={() => unlock.mutate()}>
            解锁查看
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">
          <Logo size={22} className="brand-logo" />
          行迹
          <span className="brand-sub">只读分享</span>
        </span>
        <span className="spacer" />
        {allowClone || share.data?.allow_clone ? (
          <Button size="small" type="primary" onClick={clone}>
            复制到我的行程
          </Button>
        ) : null}
        <ThemeToggle />
      </div>
      <div className="page-wrap" style={{ padding: "12px 12px 40px" }}>
        <GuideView guide={guide} />
        <div className="hint-line" style={{ maxWidth: 860, margin: "8px auto 0" }}>
          只读快照，链接过期或被撤销后无法再访问。
        </div>
      </div>
    </div>
  );
}
