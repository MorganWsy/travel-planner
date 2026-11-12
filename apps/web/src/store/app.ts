import { create } from "zustand";
import type { UserOut } from "../api/api";

interface AuthState {
  user: UserOut | null;
  status: "loading" | "anonymous" | "authenticated";
  setUser: (user: UserOut) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  setUser: (user) => set({ user, status: "authenticated" }),
  clear: () => set({ user: null, status: "anonymous" }),
}));

interface WorkspaceState {
  selectedStopId: string | null;
  selectedPlaceId: string | null;
  activeDayId: string | null;
  basemapId: string;
  selectStop: (stopId: string | null, placeId?: string | null) => void;
  selectPlace: (placeId: string | null) => void;
  setActiveDay: (dayId: string | null) => void;
  setBasemap: (basemapId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedStopId: null,
  selectedPlaceId: null,
  activeDayId: null,
  basemapId: "blank",
  selectStop: (stopId, placeId = null) => set({ selectedStopId: stopId, selectedPlaceId: placeId }),
  selectPlace: (placeId) => set({ selectedPlaceId: placeId, selectedStopId: null }),
  setActiveDay: (dayId) => set({ activeDayId: dayId }),
  setBasemap: (basemapId) => set({ basemapId }),
}));

/** 行程示意连线的显示偏好：设置页里改，浏览器本地留存，不写入行程数据 */
export type LineDash = "solid" | "dashed" | "dotted";

interface MapLineStyle {
  lineVisible: boolean;
  lineColor: string;
  lineDash: LineDash;
  lineWidth: number;
  setLineStyle: (patch: Partial<Pick<MapLineStyle, "lineVisible" | "lineColor" | "lineDash" | "lineWidth">>) => void;
}

const LINE_KEY = "tp-sketch-line";
const LINE_DEFAULT: Pick<MapLineStyle, "lineVisible" | "lineColor" | "lineDash" | "lineWidth"> = {
  lineVisible: true,
  lineColor: "#8c8c8c",
  lineDash: "dashed",
  lineWidth: 2,
};

function loadLineStyle() {
  try {
    const raw = localStorage.getItem(LINE_KEY);
    if (!raw) return LINE_DEFAULT;
    const saved = JSON.parse(raw) as Partial<typeof LINE_DEFAULT>;
    return {
      lineVisible: typeof saved.lineVisible === "boolean" ? saved.lineVisible : LINE_DEFAULT.lineVisible,
      lineColor: typeof saved.lineColor === "string" ? saved.lineColor : LINE_DEFAULT.lineColor,
      lineDash: ["solid", "dashed", "dotted"].includes(String(saved.lineDash))
        ? (saved.lineDash as LineDash)
        : LINE_DEFAULT.lineDash,
      lineWidth:
        typeof saved.lineWidth === "number" && saved.lineWidth >= 1 && saved.lineWidth <= 6
          ? saved.lineWidth
          : LINE_DEFAULT.lineWidth,
    };
  } catch {
    return LINE_DEFAULT;
  }
}

export const useMapLineStyle = create<MapLineStyle>((set) => ({
  ...loadLineStyle(),
  setLineStyle: (patch) =>
    set((state) => {
      const next = {
        lineVisible: state.lineVisible,
        lineColor: state.lineColor,
        lineDash: state.lineDash,
        lineWidth: state.lineWidth,
        ...patch,
      };
      try {
        localStorage.setItem(LINE_KEY, JSON.stringify(next));
      } catch {
        // 隐私模式下写不进去也不影响当次使用
      }
      return next;
    }),
}));
