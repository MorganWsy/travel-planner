import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import "dayjs/locale/zh-cn";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { NotifyBridge } from "./lib/notify";
import { useThemeStore } from "./store/theme";
import { antdTheme } from "./theme/antd";

dayjs.extend(customParseFormat);
dayjs.locale("zh-cn");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

function Root() {
  const resolved = useThemeStore((state) => state.resolved);
  return (
    <ConfigProvider locale={zhCN} theme={antdTheme(resolved)}>
      <AntApp>
        <NotifyBridge />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
