import { IconClose } from "./icons";

interface Props {
  onClick: () => void;
  /** 无障碍名称，默认「关闭」 */
  ariaLabel?: string;
  className?: string;
}

/**
 * 全站统一的关闭按钮。
 *
 * 地图浮层、选点提示、弹窗等位置共用同一套尺寸、图标粗细和悬停色：
 * 24×24 点击区域、15px 图标、2.2 描边，避免出现“有的地方几乎看不见”的情况。
 * AntD 自带的弹窗/通知关闭按钮由 styles.css 中的同名视觉规则对齐。
 */
export default function CloseButton({ onClick, ariaLabel = "关闭", className }: Props) {
  return (
    <button
      type="button"
      className={`app-close${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <IconClose />
    </button>
  );
}