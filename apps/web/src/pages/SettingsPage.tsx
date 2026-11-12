import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Form, Input, Popconfirm, Segmented, Table, Tag, Tooltip } from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import AvatarPickerModal from "../components/AvatarPickerModal";
import ColorPicker from "../components/ColorPicker";
import { avatarUrl } from "../lib/avatars";
import { api, type ProviderSettings } from "../api/api";
import { apiRequest, errorText } from "../api/client";
import { notify } from "../lib/notify";
import { useAuthStore, useMapLineStyle, type LineDash } from "../store/app";
import { useThemeStore, type ThemeMode } from "../store/theme";
import TopBar from "../components/TopBar";
import { IconInfo } from "../components/icons";

interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  current: boolean;
}

type Pane = "datasource" | "appearance" | "account" | "sessions" | "about";
type KeyField = "amap_key" | "tianditu_key" | "tianditu_browser_key";

const PANES: Array<{ key: Pane; label: string }> = [
  { key: "datasource", label: "地图数据源" },
  { key: "appearance", label: "外观" },
  { key: "account", label: "账号" },
  { key: "sessions", label: "登录会话" },
  { key: "about", label: "关于" },
];

const AVATAR_COLORS = ["#1668dc", "#0f766e", "#c76a15", "#7c3aed", "#c2255c", "#2b8a3e", "#0891b2", "#475569"];
const TOLERANCE_OPTIONS = [0, 5, 15, 30, 50].map((value) => ({ value: String(value), label: `${value} m` }));

/** 前端直接拉一张天地图瓦片，能真实验证浏览器端 Key 与域名白名单。 */
function testTile(key: string): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    const started = performance.now();
    const image = new Image();
    const timer = window.setTimeout(() => resolve({ ok: false, text: "请求超时，检查网络" }), 8000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve({ ok: true, text: `瓦片正常，${Math.round(performance.now() - started)} ms` });
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve({ ok: false, text: "瓦片被拒绝，检查 Key 与域名白名单" });
    };
    image.src = `https://t0.tianditu.gov.cn/DataServer?T=vec_w&x=1&y=0&l=1&tk=${encodeURIComponent(key)}`;
  });
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const [pane, setPane] = useState<Pane>("datasource");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<KeyField | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [sideInitial, setSideInitial] = useState(() => localStorage.getItem("tp-side-initial") ?? "open");
  const [avatarColor, setAvatarColor] = useState(() => user?.avatar ?? AVATAR_COLORS[0]);
  const [tolerance, setTolerance] = useState(() => localStorage.getItem("tp-marker-tolerance") ?? "15");
  const [egressRefresh, setEgressRefresh] = useState(0);
  const [pwdForm] = Form.useForm<{ current_password: string; new_password: string }>();
  const [profileForm] = Form.useForm<{ display_name: string; email: string }>();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const lineVisible = useMapLineStyle((state) => state.lineVisible);
  const lineColor = useMapLineStyle((state) => state.lineColor);
  const lineDash = useMapLineStyle((state) => state.lineDash);
  const lineWidth = useMapLineStyle((state) => state.lineWidth);
  const setLineStyle = useMapLineStyle((state) => state.setLineStyle);

  const isAdmin = user?.role === "admin";

  const providers = useQuery({ queryKey: ["provider-settings"], queryFn: api.providerSettings });
  const sessions = useQuery<SessionRow[]>({ queryKey: ["sessions"], queryFn: () => apiRequest<SessionRow[]>("/auth/sessions") });
  const egress = useQuery({
    queryKey: ["egress-ip", egressRefresh],
    queryFn: () => api.egressIp(egressRefresh > 0),
    enabled: isAdmin && pane === "datasource",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (pane !== "account" || !user) return;
    profileForm.setFieldsValue({ display_name: user.display_name, email: user.email });
    setAvatarColor(user.avatar ?? AVATAR_COLORS[0]);
  }, [user, profileForm, pane]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [pane]);

  const data: ProviderSettings | undefined = providers.data;
  const origin = window.location.origin;

  const KEY_FIELDS: Array<{ field: KeyField; hint: string }> = [
    { field: "amap_key", hint: "高德「Web 服务」类型 Key，用于地点搜索、路径规划与天气。" },
    {
      field: "tianditu_key",
      hint: "天地图「服务器端」类型 Key，用于地点搜索。IP 白名单要填下面显示的服务器出口 IP，回环地址 127.0.0.1 不算。",
    },
    {
      field: "tianditu_browser_key",
      hint: `天地图「浏览器端」类型 Key，用于底图。它按域名校验，且只接受已备案域名，localhost 和 127.0.0.1 填不进去。正式域名白名单配置完成前，请先使用高德底图。当前页面是 ${origin}。`,
    },
  ];

  const saveProviders = useMutation({
    mutationFn: (payload: Partial<Record<KeyField, string | null>>) => api.updateProviderSettings(payload),
    onSuccess: (next) => {
      queryClient.setQueryData(["provider-settings"], next);
      queryClient.invalidateQueries({ queryKey: ["public-config"] });
      setDrafts({});
      notify.success("已保存，立即生效");
    },
    onError: (error) => notify.error(errorText(error)),
  });

  /** 保存即验证：存下来之后立刻用这把 Key 探一次，结果直接告诉用户。
   *  失败时输入框保留原值，用户可以改完再点一次保存。 */
  const saveKey = async (field: KeyField) => {
    const value = drafts[field]?.trim() ?? "";
    if (!value) return;
    setTesting(field);
    try {
      await saveProviders.mutateAsync({ [field]: value });
      let result: { ok: boolean; text: string };
      if (field === "tianditu_browser_key") {
        result = await testTile(value);
      } else {
        const probe = await api.testProvider(field === "amap_key" ? "amap" : "tianditu");
        const text = probe.ok ? `${probe.message}（${probe.latency_ms} ms）` : probe.message;
        result = { ok: probe.ok, text };
      }
      setTestResults((prev) => ({ ...prev, [field]: result }));
      if (result.ok) {
        // 成功才清空输入框：占位符会变成「已保存：***，重新粘贴可替换」
        setDrafts((prev) => ({ ...prev, [field]: "" }));
        notify.success(result.text);
      } else {
        notify.error(result.text);
      }
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setTesting(null);
    }
  };

  const saveProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      await apiRequest("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ ...values, avatar: avatarColor }),
      });
      notify.success("注册信息已更新");
      queryClient.invalidateQueries({ queryKey: ["session"] });
      window.location.reload();
    } catch (error) {
      if (error instanceof Error && "errorFields" in error) return;
      notify.error(errorText(error));
    }
  };

  const changePassword = useMutation({
    mutationFn: (values: { current_password: string; new_password: string }) =>
      apiRequest<{ status: string }>("/auth/password", { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      notify.success("密码已更新，其他会话已撤销");
      pwdForm.resetFields();
      sessions.refetch();
    },
    onError: (error) => notify.error(errorText(error)),
  });

  const revoke = async (sessionId: string) => {
    try {
      await apiRequest(`/auth/sessions/${sessionId}`, { method: "DELETE" });
      notify.success("会话已撤销");
      sessions.refetch();
    } catch (error) {
      notify.error(errorText(error));
    }
  };

  const changeSideInitial = (value: string) => {
    setSideInitial(value);
    localStorage.setItem("tp-side-initial", value);
    localStorage.removeItem("tp-left-collapsed");
    localStorage.removeItem("tp-right-collapsed");
  };

  const changeTolerance = (value: string) => {
    setTolerance(value);
    localStorage.setItem("tp-marker-tolerance", value);
  };

  const copyEgress = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
      notify.success(`已复制 ${ip}`);
    } catch {
      notify.error("浏览器没给剪贴板权限，请手动选中复制");
    }
  };

  return (
    <div className="app-shell">
      <TopBar showBack>
        <span className="page-title">设置</span>
      </TopBar>

      <div className="settings-main">
        <nav className="set-nav">
          {PANES.map((item) => (
            <button
              type="button"
              key={item.key}
              className={pane === item.key ? "on" : undefined}
              onClick={() => setPane(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="set-body" ref={bodyRef}>
          {pane === "datasource" ? (
            <section className="set-pane">
              <div className="set-card">
                <div className="set-card-title">
                  地图数据源
                  <Tag
                    color={
                      data && (data.amap_key.configured || data.tianditu_key.configured || data.tianditu_browser_key.configured)
                        ? "green"
                        : "default"
                    }
                    style={{ marginInlineEnd: 0 }}
                  >
                    {data && (data.amap_key.configured || data.tianditu_key.configured || data.tianditu_browser_key.configured)
                      ? "已配置"
                      : "未配置"}
                  </Tag>
                </div>
                {!isAdmin ? <div className="hint-line" style={{ marginBottom: 8 }}>当前账号不是管理员，只能查看。</div> : null}

                {KEY_FIELDS.map(({ field, hint }) => {
                  const info = data?.[field];
                  const result = testResults[field];
                  return (
                    <div className="field" key={field}>
                      <label>
                        {info?.label ?? field}
                        <Tooltip title={hint}>
                          <span className="field-tip">
                            <IconInfo />
                          </span>
                        </Tooltip>
                        {info?.configured ? (
                          <Tag color="green" style={{ marginInlineEnd: 0 }}>已配置</Tag>
                        ) : (
                          <Tag style={{ marginInlineEnd: 0 }}>未配置</Tag>
                        )}
                      </label>
                      <div className="field-row">
                        <Input
                          className="secret-input"
                          allowClear
                          value={drafts[field] ?? ""}
                          onChange={(event) => setDrafts({ ...drafts, [field]: event.target.value })}
                          placeholder={info?.configured ? `已保存：${info.masked}，重新粘贴可替换` : "粘贴 Key"}
                          disabled={!isAdmin}
                          autoComplete="off"
                          name={`provider-key-${field}`}
                          spellCheck={false}
                          data-lpignore="true"
                        />
                        <Tooltip title={drafts[field]?.trim() ? "保存并立即验证这把 Key" : "粘贴 Key 后即可保存并验证"}>
                          <Button
                            type="primary"
                            disabled={!isAdmin || !drafts[field]?.trim()}
                            loading={testing === field}
                            onClick={() => void saveKey(field)}
                          >
                            保存
                          </Button>
                        </Tooltip>
                      </div>
                      {result ? <div className={`test-result ${result.ok ? "ok" : "bad"}`}>{result.text}</div> : null}
                      {field === "tianditu_key" ? (
                        <div className="egress-line">
                          <span>服务器出口 IP</span>
                          <span className="egress-ip">
                            {egress.data?.ip ?? (egress.isLoading ? "检测中…" : "未取到")}
                          </span>
                          {egress.data?.ip ? (
                            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => void copyEgress(egress.data.ip as string)}>
                              复制
                            </Button>
                          ) : null}
                          <Button
                            type="link"
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={egress.isFetching}
                            onClick={() => setEgressRefresh((n) => n + 1)}
                          >
                            重新检测
                          </Button>
                          <span className="egress-hint">白名单填这个，127.0.0.1 不算</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="set-card">
                <div className="set-card-title">
                  落点容差
                  <Tooltip title="新增标注时，与已有点位小于这个距离就拒绝落点，避免重复标注。">
                    <span className="field-tip">
                      <IconInfo />
                    </span>
                  </Tooltip>
                </div>
                <Segmented value={tolerance} onChange={(value) => changeTolerance(String(value))} options={TOLERANCE_OPTIONS} />
              </div>
            </section>
          ) : null}

          {pane === "appearance" ? (
            <section className="set-pane">
              <div className="set-card">
                <div className="set-card-title">主题</div>
                <Segmented
                  value={themeMode}
                  onChange={(value) => setThemeMode(value as ThemeMode)}
                  options={[
                    { value: "system", label: "跟随系统" },
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                  ]}
                />
              </div>
              <div className="set-card">
                <div className="set-card-title">
                  侧栏初始状态
                  <Tooltip title="下次进入行程规划页时生效；手动收起或展开后以手动为准。">
                    <span className="field-tip">
                      <IconInfo />
                    </span>
                  </Tooltip>
                </div>
                <Segmented
                  value={sideInitial}
                  onChange={(value) => changeSideInitial(String(value))}
                  options={[
                    { value: "open", label: "展开" },
                    { value: "closed", label: "收起" },
                  ]}
                />
              </div>
              <div className="set-card">
                <div className="set-card-title">行程连线</div>
                <div className="set-line-row">
                  <span className="set-line-label">颜色</span>
                  <span className="set-line-ctl">
                    <ColorPicker value={lineColor} onChange={(hex) => setLineStyle({ lineColor: hex })} />
                  </span>
                </div>
                <div className="set-line-row">
                  <span className="set-line-label">线型</span>
                  <span className="set-line-ctl">
                    <Segmented
                      size="small"
                      value={lineDash}
                      onChange={(value) => setLineStyle({ lineDash: value as LineDash })}
                      options={[
                        { value: "solid", label: "实线" },
                        { value: "dashed", label: "虚线" },
                        { value: "dotted", label: "点线" },
                      ]}
                    />
                  </span>
                </div>
                <div className="set-line-row">
                  <span className="set-line-label">粗细</span>
                  <span className="set-line-ctl">
                    <Segmented
                      size="small"
                      value={String(lineWidth)}
                      onChange={(value) => setLineStyle({ lineWidth: Number(value) })}
                      options={[
                        { value: "1", label: "1 px" },
                        { value: "1.5", label: "1.5 px" },
                        { value: "2", label: "2 px" },
                        { value: "2.5", label: "2.5 px" },
                        { value: "3", label: "3 px" },
                        { value: "3.5", label: "3.5 px" },
                        { value: "4", label: "4 px" },
                      ]}
                    />
                  </span>
                </div>
                <div className="set-line-preview">
                  <i
                    style={{
                      borderTopColor: lineColor,
                      borderTopWidth: `${lineWidth}px`,
                      borderTopStyle: lineDash === "dotted" ? "dotted" : lineDash === "dashed" ? "dashed" : "solid",
                      opacity: lineVisible ? 1 : 0.35,
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null}

          {pane === "account" ? (
            <section className="set-pane">
              <div className="set-card">
                <div className="set-card-title">注册信息</div>
                <div className="avatar-row">
                  <Avatar size={44} className="settings-avatar" src={avatarUrl(user?.avatar)}>
                    {(user?.display_name ?? "?").slice(0, 1).toUpperCase()}
                  </Avatar>
                  <div className="avatar-palette">
                    <Button size="small" onClick={() => setAvatarOpen(true)}>
                      更换头像
                    </Button>
                  </div>
                </div>
                <Form form={profileForm} layout="vertical" className="stack-form">
                  <Form.Item label="昵称" name="display_name" rules={[{ required: true, max: 40, message: "1–40 字" }]}>
                    <Input allowClear placeholder="昵称" />
                  </Form.Item>
                  <Form.Item label="邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                    <Input allowClear placeholder="you@example.com" />
                  </Form.Item>
                  <div className="info-row">
                    <span className="k">注册时间</span>
                    <span className="v">{user?.created_at ? dayjs(user.created_at).format("YYYY-MM-DD HH:mm") : "—"}</span>
                  </div>
                  <div className="info-row">
                    <span className="k">角色</span>
                    <span className="v">{user?.role === "admin" ? "管理员" : "普通用户"}</span>
                  </div>
                  <Button type="primary" block onClick={() => void saveProfile()}>
                    保存
                  </Button>
                </Form>
              </div>

              <div className="set-card">
                <div className="set-card-title">修改密码</div>
                <Form form={pwdForm} layout="vertical" className="stack-form" onFinish={(values) => changePassword.mutate(values)}>
                  <Form.Item label="当前密码" name="current_password" rules={[{ required: true, message: "请输入当前密码" }]}>
                    <Input.Password allowClear placeholder="当前密码" autoComplete="current-password" />
                  </Form.Item>
                  <Form.Item label="新密码" name="new_password" rules={[{ required: true, min: 10, message: "至少 10 位" }]}>
                    <Input.Password allowClear placeholder="新密码（至少 10 位）" autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={changePassword.isPending}>
                    确认
                  </Button>
                </Form>
              </div>
            </section>
          ) : null}

          {pane === "sessions" ? (
            <section className="set-pane">
              <div className="set-card">
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={sessions.data ?? []}
                  columns={[
                    {
                      title: "设备",
                      dataIndex: "user_agent",
                      ellipsis: true,
                      render: (value: string | null, row) => (row.current ? <Tag color="blue">当前</Tag> : value || "未知设备"),
                    },
                    {
                      title: "最近使用",
                      dataIndex: "last_seen_at",
                      width: 120,
                      render: (value: string) => dayjs(value).format("MM-DD HH:mm"),
                    },
                    {
                      title: "",
                      width: 62,
                      render: (_value, row) =>
                        row.current ? null : (
                          <Popconfirm title="撤销该会话？" onConfirm={() => revoke(row.id)}>
                            <Button size="small" type="link" danger>
                              撤销
                            </Button>
                          </Popconfirm>
                        ),
                    },
                  ]}
                />
              </div>
            </section>
          ) : null}

          {pane === "about" ? (
            <section className="set-pane">
              <div className="set-card">
                <div className="set-card-title">行迹 · 旅游规划</div>
                <ul className="about-list">
                  <li>版本 <b>0.2.0</b></li>
                  <li>
                    地图渲染 <b>MapLibre GL JS</b>　界面 <b>Ant Design</b>　服务端 <b>FastAPI + PostGIS</b>
                  </li>
                  <li>底图与地点数据版权归高德、天地图各自所有，页面上的来源标记不可移除。</li>
                  <li>开源许可：MapLibre（BSD-3-Clause）、Ant Design（MIT）、FastAPI（MIT）、PostgreSQL / PostGIS（PostgreSQL License）。</li>
                  <li>标题字体：马善政毛笔楷书（SIL Open Font License 1.1）。</li>
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <AvatarPickerModal
        open={avatarOpen}
        current={user?.avatar}
        onPick={(name) => {
          void api
            .updateMe({ avatar: name })
            .then((next) => {
              setUser(next);
              setAvatarOpen(false);
              notify.success("头像已更新");
            })
            .catch((error) => notify.error(errorText(error)));
        }}
        onCancel={() => setAvatarOpen(false)}
      />
    </div>
  );
}
