import { useCallback, useEffect, useRef, useState } from "react";
import { CheckOutlined, DragOutlined } from "@ant-design/icons";
import { api } from "../api/api";

/** 滑钮宽度（px），须与 styles.css 中 .slider-knob 的 width 一致 */
const KNOB_W = 40;

interface Props {
  /**
   * 拖到阈值以上松手时回调。返回 false 或 reject 表示没通过，滑块自动回正。
   * challengeId 由后端生成，拖动百分比也在后端校验，前端不做答案判断。
   */
  onDone?: (challengeId: string, percent: number) => void | Promise<boolean | void> | false;
  threshold?: number;
  disabled?: boolean;
  /** 后端挑战的有效期；过了这段时间验证作废，滑块归位并通知外部 */
  ttlSeconds?: number;
  onExpire?: () => void;
}

/**
 * 自绘滑块验证。antd 的 Slider 是取值滑杆，不带验证语义，所以这里不用它。
 *
 * 滑钮中心从「轨道左缘 + 半钮宽」拖到「轨道右缘 - 半钮宽」对应 0→100%，
 * 拖到底恰好贴齐右缘，不会溢出容器。
 *
 * 取值挑战是异步的：按下就先把拖拽状态置位，松手时若挑战还没回来就等它。
 * 否则手快的人（或网络慢的时候）一松手什么都没发生。
 */
export default function SliderCaptcha({ onDone, threshold = 95, disabled = false, ttlSeconds, onExpire }: Props) {
  const [pct, setPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [passed, setPassed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  // move 里即时写入，end 读实时值，不受 React 批处理影响
  const pctRef = useRef(0);
  const draggingRef = useRef(false);
  const challengeRef = useRef<string>("");
  const pendingRef = useRef<Promise<string> | null>(null);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挑战到期自动作废：不清掉的话用户会拿着过期的 id 去提交，后端只会报「验证已失效」
  useEffect(() => {
    return () => {
      if (expireTimer.current) clearTimeout(expireTimer.current);
    };
  }, []);

  const begin = useCallback(() => {
    if (disabled || draggingRef.current) return;
    draggingRef.current = true;
    setDragging(true);
    setPassed(false);
    challengeRef.current = "";
    pendingRef.current = api
      .captcha()
      .then((result) => {
        challengeRef.current = result.challenge_id;
        return result.challenge_id;
      })
      .catch(() => "");
  }, [disabled]);

  const move = useCallback((pageX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const travel = Math.max(1, rect.width - KNOB_W);
    const ratio = Math.max(0, Math.min(100, ((pageX - rect.left - KNOB_W / 2) / travel) * 100));
    pctRef.current = ratio;
    setPct(ratio);
  }, []);

  const clearExpiry = useCallback(() => {
    if (expireTimer.current) {
      clearTimeout(expireTimer.current);
      expireTimer.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearExpiry();
    pctRef.current = 0;
    setPct(0);
    setPassed(false);
  }, [clearExpiry]);

  const startExpiry = useCallback(() => {
    clearExpiry();
    if (!ttlSeconds) return;
    expireTimer.current = setTimeout(() => {
      reset();
      onExpire?.();
    }, ttlSeconds * 1000);
  }, [clearExpiry, onExpire, reset, ttlSeconds]);

  const end = useCallback(async () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (pctRef.current < threshold) {
      reset();
      return;
    }
    const challengeId = challengeRef.current || (pendingRef.current ? await pendingRef.current : "");
    if (!challengeId) {
      reset();
      return;
    }
    const ret = onDone?.(challengeId, Math.round(pctRef.current));
    if (ret && typeof (ret as Promise<unknown>).then === "function") {
      try {
        const ok = await (ret as Promise<boolean | void>);
        if (ok === false) {
          reset();
        } else {
          setPassed(true);
          startExpiry();
        }
      } catch {
        reset();
      }
    } else if (ret === false) {
      reset();
    } else {
      setPassed(true);
      startExpiry();
    }
  }, [onDone, reset, threshold, startExpiry]);

  // document 级监听：鼠标移出滑块后拖拽不丢
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => move(event.pageX);
    const onUp = () => void end();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging, move, end]);

  return (
    <div className="slider-captcha">
      <div className="slider-track" ref={trackRef}>
        <div className="slider-bg" style={{ width: `calc((100% - ${KNOB_W}px) * ${pct / 100})` }} />
        <span className="slider-hint">
          {passed ? "验证通过" : dragging ? "松开滑块完成验证" : "拖动滑块到最右侧完成验证"}
        </span>
        <div
          className={`slider-knob${dragging ? " dragging" : ""}${passed ? " passed" : ""}${disabled ? " disabled" : ""}`}
          style={{ left: `calc((100% - ${KNOB_W}px) * ${pct / 100})` }}
          onMouseDown={begin}
        >
          {passed ? <CheckOutlined /> : <DragOutlined />}
        </div>
      </div>
    </div>
  );
}
