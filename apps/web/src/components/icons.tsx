/** 统一的一套线性图标，避免为几个图标引入整套图标库，也便于跟随主题变色。 */

import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function base(props: Props) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 16,
    height: 16,
    ...props,
  };
}

export const IconCompass = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.2 8.8l-2 5.4-5.4 2 2-5.4z" />
  </svg>
);

export const IconChevronLeft = (p: Props) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

export const IconChevronRight = (p: Props) => (
  <svg {...base(p)}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </svg>
);

export const IconPlus = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = (p: Props) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconFit = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 10.8L12 4l8 6.8" />
    <path d="M6.2 9.4V20h11.6V9.4" />
    <path d="M10 20v-5.2h4V20" />
  </svg>
);

export const IconEye = (p: Props) => (
  <svg {...base(p)}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconEyeOff = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 4l16 16" />
    <path d="M9.6 5.3A10.7 10.7 0 0112 5c6 0 9.5 6 9.5 6a17 17 0 01-3.2 3.7" />
    <path d="M6.3 7.6A16.6 16.6 0 002.5 12S6 18 12 18c1 0 2-.2 2.9-.5" />
    <path d="M9.9 10.2a2.9 2.9 0 004 4" />
  </svg>
);

export const IconGrip = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </svg>
);

export const IconSun = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </svg>
);

export const IconMoon = (p: Props) => (
  <svg {...base(p)}>
    <path d="M20 13.5A8 8 0 1110.5 4a6.5 6.5 0 009.5 9.5z" />
  </svg>
);

export const IconSettings = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.2a1.7 1.7 0 00-1.4 1z" />
  </svg>
);

export const IconShare = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18.5" r="2.5" />
    <path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4" />
  </svg>
);

export const IconHistory = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3.5 12a8.5 8.5 0 108.5-8.5 8.6 8.6 0 00-6 2.4L3.5 8.3" />
    <path d="M3.5 4.5v4h4" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);

export const IconBook = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" />
    <path d="M4 5.5v15" />
  </svg>
);

export const IconSearch = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </svg>
);

export const IconImport = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3.5v11M8 10.5l4 4 4-4" />
    <path d="M4 16.5V19a2 2 0 002 2h12a2 2 0 002-2v-2.5" />
  </svg>
);

export const IconRoute = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="5.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
    <path d="M8 5.5h5a3.5 3.5 0 013.5 3.5v6a3.5 3.5 0 01-3.5 3.5H8" />
  </svg>
);

export const IconBolt = (p: Props) => (
  <svg {...base(p)}>
    <path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z" />
  </svg>
);

export const IconClose = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconMore = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
);

export const IconStack = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 12l9 5 9-5" />
    <path d="M3 16l9 5 9-5" />
  </svg>
);

export const IconLayers = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3.5l8 4.2-8 4.2-8-4.2z" />
    <path d="M4.5 12l7.5 4 7.5-4" />
    <path d="M4.5 16l7.5 4 7.5-4" />
  </svg>
);

export const IconChevronDown = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 9.5l6 6 6-6" />
  </svg>
);

export const IconAlert = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.3v5.6" />
    <circle cx="12" cy="16.3" r="0.95" fill="currentColor" stroke="none" />
  </svg>
);

export const IconAttraction = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3.5 18l5.5-9 4 6 2.5-4 5 7z" />
  </svg>
);

export const IconMeal = (p: Props) => (
  <svg {...base(p)}>
    <path d="M7 3.5v7M5 3.5v4a2 2 0 002 2h0a2 2 0 002-2v-4M7 10.5V20.5" />
    <path d="M16.5 3.5c-2 2-2.5 4.5-2.5 6.5h3v10" />
  </svg>
);

export const IconLodging = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3.5 18v-11M3.5 14h17v4" />
    <path d="M7 10.5h3.5a1.5 1.5 0 011.5 1.5v2H7z" />
  </svg>
);

export const IconTransport = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 15.5V8a2 2 0 012-2h12a2 2 0 012 2v7.5" />
    <path d="M4 15.5h16M7 15.5v2M17 15.5v2" />
    <path d="M6.5 11h11" />
  </svg>
);

export const IconShopping = (p: Props) => (
  <svg {...base(p)}>
    <path d="M5 8h14l-1.2 11a1.5 1.5 0 01-1.5 1.3H7.7A1.5 1.5 0 016.2 19z" />
    <path d="M9 8V6.5a3 3 0 016 0V8" />
  </svg>
);

export const IconViewpoint = (p: Props) => (
  <svg {...base(p)}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.4" />
  </svg>
);

export const IconOther = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconInfo = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.95" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRuler = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3.6 14.4l10.8-10.8 5.9 5.9L9.5 20.3z" />
    <path d="M6.8 11.2l2 2M9.6 8.4l2 2M12.4 5.6l2 2" />
  </svg>
);

export const IconPitch = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 15h8" />
    <path d="M3 15L10 6" />
  </svg>
);

export const IconRotate = (p: Props) => (
  <svg {...base(p)}>
    <path d="M19 11a7 7 0 1 1-2-4.9" />
    <path d="M15.6 2.6l2.6 3.8-3.9 1.3" />
  </svg>
);

export const IconLogout = (p: Props) => (
  <svg {...base(p)}>
    <path d="M14 4.5H6.5A1.5 1.5 0 005 6v12a1.5 1.5 0 001.5 1.5H14" />
    <path d="M10 12h9M16 8.5l3.5 3.5-3.5 3.5" />
  </svg>
);

export const IconUser = (p: Props) => (
  <svg viewBox="0 0 24 24" width={p.width ?? 16} height={p.height ?? 16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={p.className} aria-hidden>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.8 20c.7-3.5 3.7-5.6 7.2-5.6s6.5 2.1 7.2 5.6" />
  </svg>
);

/** 天气图标：够用即可，不引第三方图标包 */
export const IconWeather = ({ kind, size = 14 }: { kind: string; size?: number }) => {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "sun") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </svg>
    );
  }
  if (kind === "rain" || kind === "storm") {
    return (
      <svg {...common}>
        <path d="M7 15a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.3 1.4A3.6 3.6 0 0 1 17.5 15" />
        <path d={kind === "storm" ? "M13 14l-2.5 4h3L11 22" : "M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5"} />
      </svg>
    );
  }
  if (kind === "snow") {
    return (
      <svg {...common}>
        <path d="M7 15a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.3 1.4A3.6 3.6 0 0 1 17.5 15" />
        <path d="M9 18.5h.01M13 20h.01M17 18.5h.01" />
      </svg>
    );
  }
  if (kind === "fog") {
    return (
      <svg {...common}>
        <path d="M5 10h11M7 14h12M5 18h9" />
      </svg>
    );
  }
  if (kind === "unknown") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.7-.7 1.2v.4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M7 17a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.3 1.4A3.6 3.6 0 0 1 17.5 17z" />
    </svg>
  );
};
