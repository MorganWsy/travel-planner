import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";

interface Props {
  side: "left" | "right";
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  mobileHidden?: boolean;
}

/**
 * 侧栏容器：标题 + 分隔线 + 收起按钮。
 * 收起态只留一个贴边的竖排按钮，不再包 aside，避免多出一整列空白。
 */
export default function SidePanel({
  side,
  title,
  count,
  actions,
  collapsed,
  onToggle,
  children,
  mobileHidden = false,
}: Props) {
  const label = typeof title === "string" ? title : "面板";

  if (collapsed) {
    return (
      <Tooltip title={`展开${label}`} placement={side === "left" ? "right" : "left"}>
        <button
          type="button"
          className={`rail-tab ${side}`}
          onClick={onToggle}
          aria-label={`展开${label}`}
        >
          <span className="rail-tab-text">{label}</span>
          <PlusOutlined />
        </button>
      </Tooltip>
    );
  }

  return (
    <aside className={`side-panel ${side}${mobileHidden ? " mobile-hidden" : ""}`}>
      <div className="panel-head">
        <span className="panel-title">
          {title}
          {count !== undefined ? <span className="count">{count}</span> : null}
        </span>
        <div className="panel-actions">
          {actions}
          <Tooltip title={`收起${label}`}>
            <button type="button" className="icon-btn" onClick={onToggle} aria-label={`收起${label}`}>
              <MinusOutlined />
            </button>
          </Tooltip>
        </div>
      </div>
      {/* 内层再包一层：右内边距放在内容侧，滚动条仍贴面板边，不会出现「滚动条右侧多一条空白」 */}
      <div className="panel-body">
        <div className="panel-body-inner">{children}</div>
      </div>
    </aside>
  );
}
