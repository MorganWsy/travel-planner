import { InputNumber, Space } from "antd";
import type { InputNumberProps } from "antd";

/**
 * 项目统一使用的数字输入框。
 *
 * antd 5.29 起 InputNumber 的 addonBefore / addonAfter 已弃用，改用 Space.Compact。
 * 这里用等价的前后缀块替代，外观与原来的 addon 一致，也不再刷弃用警告。
 * 泛型透传保留 value/onChange 的数值类型，避免 onChange 被降级成 string | number。
 */
type Value = string | number;

interface Props<T extends Value = Value> extends InputNumberProps<T> {
  before?: string;
  after?: string;
}

export default function AppNumber<T extends Value = Value>({ before, after, style, ...rest }: Props<T>) {
  const field = <InputNumber<T> {...rest} style={{ width: "100%", ...style }} />;
  if (!before && !after) return field;
  return (
    <Space.Compact block>
      {before ? <span className="num-addon">{before}</span> : null}
      {field}
      {after ? <span className="num-addon">{after}</span> : null}
    </Space.Compact>
  );
}
