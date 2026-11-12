import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 取色器，移植自 D:\ICalendar 换算页的「颜色格式互转」取色面板：
 * 饱和度/明度方块 + 色相滑杆 + HEX 输入 + 10 档色阶。
 * 这里只取不透明色（连线用 line-opacity 单独控制），去掉了透明滑杆与吸管。
 */
interface Props {
  value: string;
  onChange: (hex: string) => void;
}

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };

function hexToRgb(hex: string): Rgb {
  const t = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    const h = t.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(t)) {
    return { r: parseInt(t.slice(0, 2), 16), g: parseInt(t.slice(2, 4), 16), b: parseInt(t.slice(4, 6), 16) };
  }
  return { r: 140, g: 140, b: 140 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const SHADE_MIX: Record<number, number> = { 50: 0.95, 100: 0.9, 200: 0.75, 300: 0.6, 400: 0.3, 500: 0, 600: 0.15, 700: 0.3, 800: 0.45, 900: 0.6 };

export default function ColorPicker({ value, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(value)));
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setHsv(rgbToHsv(hexToRgb(value)));
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const shades = useMemo(() => {
    const base = hexToRgb(value);
    return SHADES.map((step) => {
      const amount = SHADE_MIX[step];
      const target = step < 500 ? 255 : 0;
      return rgbToHex({
        r: base.r + (target - base.r) * amount,
        g: base.g + (target - base.g) * amount,
        b: base.b + (target - base.b) * amount,
      });
    });
  }, [value]);

  const commit = (next: Hsv) => {
    setHsv(next);
    onChange(rgbToHex(hsvToRgb(next)));
  };

  const setFromPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
    commit({ ...hsv, s, v });
  };

  const commitHex = (text: string) => {
    const t = text.trim();
    if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t)) {
      const rgb = hexToRgb(t);
      onChange(rgbToHex(rgb));
      setHsv(rgbToHsv(rgb));
    } else {
      setDraft(value);
    }
  };

  return (
    <div className="cp" ref={rootRef}>
      <button
        type="button"
        className={`cp-prev${open ? " on" : ""}`}
        style={{ background: value }}
        aria-label="打开取色面板"
        onClick={() => setOpen((v) => !v)}
      />
      <input
        className="cp-hex"
        value={draft}
        aria-label="颜色 HEX 值"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitHex(draft)}
        onKeyDown={(event) => { if (event.key === "Enter") commitHex(draft); }}
      />
      {open ? (
        <div className="cp-pop">
          <div
            className="cp-sv"
            ref={svRef}
            style={{ background: `linear-gradient(to top,#000,rgba(0,0,0,0)), linear-gradient(to right,#fff,hsl(${hsv.h},100%,50%))` }}
            onPointerDown={(event) => {
              event.preventDefault();
              dragging.current = true;
              try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕获失败不影响单击取色 */ }
              setFromPoint(event);
            }}
            onPointerMove={(event) => { if (dragging.current) setFromPoint(event); }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
          >
            <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <label className="cp-sl">
            <span>色相</span>
            <input
              className="cp-hue"
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(hsv.h)}
              aria-label="色相"
              onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })}
            />
          </label>
          <div className="cp-pal">
            {shades.map((hex, index) => (
              <button
                type="button"
                key={SHADES[index]}
                className={hex.toLowerCase() === value.toLowerCase() ? "on" : ""}
                style={{ background: hex }}
                title={`${SHADES[index]} · ${hex}`}
                aria-label={`色阶 ${SHADES[index]}`}
                onClick={() => { onChange(hex); setHsv(rgbToHsv(hexToRgb(hex))); }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
