import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { IconInfo } from "./icons";

/**
 * 弹窗里的字段：一行标签 + 一个控件。
 *
 * 弹窗内的输入原本只有 placeholder，用户读到的是「空框」，不知道这一栏要填什么。
 * 统一用这个包一层，标签常驻、控件语义清楚。
 * 用户可能不理解的输入态（如固定开始时间）配一个提示图标，悬停出说明气泡。
 */
export default function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="modal-field">
      <span className="modal-field-label">
        {label}
        {hint ? (
          <Tooltip title={hint}>
            <span className="field-tip">
              <IconInfo />
            </span>
          </Tooltip>
        ) : null}
      </span>
      {children}
    </label>
  );
}
