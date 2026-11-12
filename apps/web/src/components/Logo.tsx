import { useId } from "react";

interface Props {
  size?: number;
  className?: string;
}

/**
 * 山水日出标志（design/logo-concepts 的 c-mountain-sunrise）。
 * 山峰用 currentColor 跟随主题，太阳固定暖橙；河流是负空间留白。
 */
export default function Logo({ size = 24, className }: Props) {
  const raw = useId();
  const maskId = `logo-river-${raw.replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId}>
          <rect width="256" height="256" fill="white" />
          <path
            d="M107 211C159 195 162 178 141 163C123 150 116 143 130 130L143 118"
            fill="none"
            stroke="black"
            strokeWidth="17"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <circle cx="180" cy="67" r="25" fill="#F3A340" />
      <path
        d="M28 181L98 64Q106 51 115 66L159 137L178 108Q186 96 194 110L232 180Q241 196 223 196H37Q19 196 28 181Z"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
