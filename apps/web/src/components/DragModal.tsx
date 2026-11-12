import { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import type { ModalProps } from "antd";

/**
 * 可拖动弹窗：按住标题栏任意位置拖动，整个弹窗跟着走。
 *
 * 地图工作台里弹窗常盖住地图（例如算完耗时想看真实路线），拖开即可看全。
 * 位移用 transform 实现，不改 Modal 的居中布局；Select 下拉按触发元素的
 * 视口位置定位，会跟着弹窗一起移动，不会留在原地。
 * 拖动范围夹在视口内：不允许把弹窗任何一边拖出屏幕。
 */
export default function DragModal({ title, children, ...rest }: ModalProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; left: number; top: number; w: number; h: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // 每次打开都回到原位，避免上次拖走后又弹出在别处
  const openRef = useRef(rest.open);
  useEffect(() => {
    if (rest.open && !openRef.current) setOffset({ x: 0, y: 0 });
    openRef.current = rest.open;
  }, [rest.open]);

  // 拖动区是整条标题栏；按下处是按钮（关闭钮等）时不启动拖动
  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest(".ant-modal-header")) return;
    if (target.closest("button")) return;
    // 标题文字本身不参与拖动，这样还能选中/复制标题文本；标题栏其余空白处都能拖
    if (target.closest(".drag-title-text")) return;
    event.preventDefault();
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 基准矩形 = 当前位置去掉已有位移，之后统一用「基准 + 新位移」算边界
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
      left: rect.left - offset.x,
      top: rect.top - offset.y,
      w: rect.width,
      h: rect.height,
    };
    const onMove = (event: MouseEvent) => {
      const start = drag.current;
      if (!start) return;
      // 夹取：四条边都不许越过视口（左边最小位移 -left，右边最大位移 vw-w-left）；
      // 弹窗比视口还大时取同一侧贴边，不做随机抖动
      const minX = Math.min(-start.left, window.innerWidth - start.w - start.left);
      const maxX = Math.max(-start.left, window.innerWidth - start.w - start.left);
      const minY = Math.min(-start.top, window.innerHeight - start.h - start.top);
      const maxY = Math.max(-start.top, window.innerHeight - start.h - start.top);
      const ox = Math.min(maxX, Math.max(minX, start.ox + event.clientX - start.x));
      const oy = Math.min(maxY, Math.max(minY, start.oy + event.clientY - start.y));
      setOffset({ x: ox, y: oy });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <Modal
      {...rest}
      title={<span className="drag-title-text">{title}</span>}
      modalRender={(node) => (
        <div ref={wrapperRef} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} onMouseDown={onMouseDown}>
          {node}
        </div>
      )}
    >
      {children}
    </Modal>
  );
}
