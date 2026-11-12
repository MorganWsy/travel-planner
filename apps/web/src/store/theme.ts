import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "tp-theme";

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

function apply(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  return resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const initialMode = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system";

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: apply(initialMode),
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    set({ mode, resolved: apply(mode) });
  },
  toggle: () => {
    const next: ThemeMode = get().resolved === "dark" ? "light" : "dark";
    get().setMode(next);
  },
}));

// 跟随系统切换：仅在 mode=system 时生效
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { mode, setMode } = useThemeStore.getState();
  if (mode === "system") setMode("system");
});
