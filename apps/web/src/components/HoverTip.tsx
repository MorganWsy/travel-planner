import { useEffect, useState } from "react";
import { Tooltip } from "antd";
import type { ReactElement } from "react";

/**
 * 悬停提示气泡，可临时禁用。
 *
 * antd 的 Tooltip 在 title 变成 undefined 时不会收起已显示的气泡，
 * 于是「浮层打开时把 title 置空」这类写法会让气泡一直挂在屏幕上。
 * 这里改成受控 open：禁用时强制收起，时机就确定了。
 * 另外禁用瞬间要把 open 一起复位——否则浮层关掉、disabled 回到 false 时，
 * 残留的 open=true 会让气泡在没有悬停的情况下凭空弹出（实测复现）。
 */
export default function HoverTip({
  title,
  disabled,
  placement,
  children,
}: {
  title: string;
  disabled?: boolean;
  placement?: "top" | "right" | "left" | "bottom";
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Tooltip title={title} placement={placement} open={open && !disabled} onOpenChange={setOpen}>
      {/* 鼠标离开兜底收起：元素被浮层盖住时 antd 未必发 onOpenChange(false) */}
      <span
        style={{ display: "inline-flex" }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </span>
    </Tooltip>
  );
}
