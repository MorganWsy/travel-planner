import { useState, type ReactNode } from "react";
import { App, Avatar, Button, Dropdown, Tooltip } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/api";
import { useAuthStore } from "../store/app";
import { useThemeStore } from "../store/theme";
import Logo from "./Logo";
import AvatarPickerModal from "./AvatarPickerModal";
import DragModal from "./DragModal";
import { avatarUrl } from "../lib/avatars";
import {
  IconAlert,
  IconChevronDown,
  IconChevronLeft,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
  IconUser,
} from "./icons";

interface Props {
  /** 只有非根页面才显示返回按钮；不传时不显示 */
  showBack?: boolean;
  /** 指定回到哪一页；不传则回上一页 */
  backTo?: string;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export default function TopBar({ showBack = false, backTo, children, actions, compact = false }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = () => {
    if (typeof backTo === "string") {
      navigate(backTo);
      return;
    }
    // 直接打开（没有来源页）时退回行程列表，避免把用户甩出应用
    if (location.key !== "default") navigate(-1);
    else navigate("/");
  };
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clear = useAuthStore((state) => state.clear);
  const resolved = useThemeStore((state) => state.resolved);
  const toggle = useThemeStore((state) => state.toggle);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { message } = App.useApp();

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // 会话已失效时同样清理本地状态
    } finally {
      clear();
      navigate("/login", { replace: true });
    }
  };

  const pickAvatar = async (name: string) => {
    setAvatarBusy(true);
    try {
      const next = await api.updateMe({ avatar: name });
      setUser(next);
      setAvatarOpen(false);
      message.success("头像已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "头像更新失败");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <header className="topbar">
      {showBack ? (
        <Tooltip title="返回">
          <button type="button" className="icon-btn" onClick={goBack} aria-label="返回">
            <IconChevronLeft />
          </button>
        </Tooltip>
      ) : null}
      <span className="brand">
        <Logo size={30} className="brand-logo" />
        <span className="brand-name">行迹</span>
        {compact ? null : <span className="brand-sub">旅游规划</span>}
      </span>
      <span style={{ width: 1, height: 16, background: "var(--line)", flex: "none" }} />
      {children}
      <span className="spacer" />
      {actions}
      <Tooltip title={resolved === "dark" ? "切换为浅色" : "切换为深色"}>
        <button type="button" className="icon-btn" onClick={toggle} aria-label="切换主题">
          {/* 图标表示当前主题：浅色显示太阳、深色显示月亮 */}
          {resolved === "dark" ? <IconMoon /> : <IconSun />}
        </button>
      </Tooltip>
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        menu={{
          items: [
            {
              key: "identity",
              label: (
                <span className="user-menu-identity">
                  <b>{user?.display_name ?? "未登录"}</b>
                  <small>{user?.email ?? ""}</small>
                </span>
              ),
              disabled: true,
            },
            { type: "divider" },
            {
              key: "avatar",
              label: (
                <span className="user-menu-item">
                  <IconUser width={14} height={14} />
                  切换头像
                </span>
              ),
            },
            {
              key: "settings",
              label: (
                <span className="user-menu-item">
                  <IconSettings width={14} height={14} />
                  设置
                </span>
              ),
            },
            { type: "divider" },
            {
              key: "logout",
              label: (
                <span className="user-menu-item logout">
                  <IconLogout width={14} height={14} />
                  退出登录
                </span>
              ),
            },
          ],
          onClick: ({ key }) => {
            if (key === "logout") setLogoutOpen(true);
            if (key === "settings") navigate("/settings");
            if (key === "avatar") setAvatarOpen(true);
          },
        }}
      >
        <button type="button" className="user-chip" aria-label="账号菜单">
          <Avatar size={26} className="user-avatar" src={avatarUrl(user?.avatar)}>
            {(user?.display_name ?? "?").slice(0, 1).toUpperCase()}
          </Avatar>
          <span className="user-chip-name hide-sm">{user?.display_name ?? "未登录"}</span>
          <IconChevronDown width={12} height={12} className="user-chip-caret" />
        </button>
      </Dropdown>

      <AvatarPickerModal
        open={avatarOpen}
        current={user?.avatar}
        busy={avatarBusy}
        onPick={(name) => void pickAvatar(name)}
        onCancel={() => setAvatarOpen(false)}
      />

      {/* 退出二次确认：标题只在标题行出现一次，正文不重复；✕ 与「退出」都可取消 */}
      <DragModal
        centered
        title="退出登录"
        open={logoutOpen}
        onCancel={() => setLogoutOpen(false)}
        footer={[
          <Button key="ok" type="primary" danger onClick={() => void logout()}>
            退出
          </Button>,
        ]}
        destroyOnHidden
      >
        <div className="logout-confirm">
          <IconAlert width={18} height={18} className="logout-confirm-icon" />
          <span>退出后需要重新验证身份才能继续使用，您确定退出吗？</span>
        </div>
      </DragModal>
    </header>
  );
}

export function ThemeToggle() {
  const resolved = useThemeStore((state) => state.resolved);
  const toggle = useThemeStore((state) => state.toggle);
  return (
    <Tooltip title={resolved === "dark" ? "切换为浅色" : "切换为深色"}>
      <button type="button" className="icon-btn" onClick={toggle} aria-label="切换主题">
        {resolved === "dark" ? <IconMoon /> : <IconSun />}
      </button>
    </Tooltip>
  );
}
