import { Select } from "antd";
import type { SelectProps } from "antd";

/**
 * 项目统一使用的下拉框。
 *
 * rc-select 会把选中文字和选项文字写进 title 属性，鼠标停留时浏览器会弹出原生气泡，
 * 与界面上的 Tooltip 重复。这里直接把 title 置空（含 options），
 * 不再靠全局 MutationObserver 事后删属性。
 */
export default function AppSelect(props: SelectProps) {
  const { options, ...rest } = props;
  const safeOptions = options?.map((item) =>
    typeof item === "object" && item !== null && "label" in item ? { ...item, title: "" } : item,
  );
  return <Select {...rest} title="" options={safeOptions} />;
}
