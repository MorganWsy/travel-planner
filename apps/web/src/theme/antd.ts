import { theme, type ThemeConfig } from "antd";
import type { ResolvedTheme } from "../store/theme";

const shared: ThemeConfig = {
  token: {
    fontFamily:
      '"Noto Sans SC", "Source Han Sans SC", "Source Han Sans CN", "LXGW WenKai", "Microsoft YaHei", "PingFang SC", sans-serif',
    // 正文字号 14、控件高 32：24 英寸 1080p 下 13px 偏小，12px 只留给辅助信息
    fontSize: 14,
    borderRadius: 6,
    controlHeight: 32,
    wireframe: false,
  },
  components: {
    Card: { paddingLG: 12 },
    Tabs: { horizontalItemPadding: "7px 12px", horizontalMargin: "0" },
    Table: { cellPaddingBlockSM: 6, headerBorderRadius: 4 },
    Modal: { titleFontSize: 16 },
    Message: { contentPadding: "9px 14px" },
    Notification: { width: 340 },
    Button: { paddingInline: 12 },
    Input: { paddingInline: 10 },
    Select: { optionPadding: "6px 10px" },
    Tooltip: { fontSize: 12 },
  },
};

export function antdTheme(resolved: ResolvedTheme): ThemeConfig {
  if (resolved === "dark") {
    return {
      ...shared,
      algorithm: theme.darkAlgorithm,
      token: {
        ...shared.token,
        colorPrimary: "#4c9aff",
        colorInfo: "#4c9aff",
        colorBgBase: "#0d1117",
        colorBgContainer: "#141a22",
        colorBgElevated: "#19212b",
        colorBgLayout: "#0d1117",
        colorBorder: "#28323f",
        colorBorderSecondary: "#1e2733",
        colorText: "#e5edf6",
        colorTextSecondary: "#93a1b1",
        colorTextTertiary: "#6b7887",
      },
    };
  }
  return {
    ...shared,
    algorithm: theme.defaultAlgorithm,
    token: {
      ...shared.token,
      colorPrimary: "#1668dc",
      colorInfo: "#1668dc",
      colorBgBase: "#eef1f5",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorBgLayout: "#eef1f5",
      colorBorder: "#e1e6ec",
      colorBorderSecondary: "#edf1f5",
      colorText: "#1b2129",
      colorTextSecondary: "#67717e",
      colorTextTertiary: "#97a1ad",
    },
  };
}
