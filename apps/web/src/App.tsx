import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { api } from "./api/api";
import { setCsrfToken } from "./api/client";
import { useAuthStore } from "./store/app";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import TripsPage from "./pages/TripsPage";

// 工作台与地图按路由拆分，首屏不加载 MapLibre。
const WorkspacePage = lazy(() => import("./pages/WorkspacePage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function Protected({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="centered">
        <Spin />
      </div>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  const setUser = useAuthStore((state) => state.setUser);
  const clear = useAuthStore((state) => state.clear);

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((session) => {
        if (cancelled) return;
        setCsrfToken(session.csrf_token);
        setUser(session.user);
      })
      .catch(() => {
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [setUser, clear]);

  return (
    <Suspense fallback={<div className="centered"><Spin /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route
        path="/"
        element={
          <Protected>
            <TripsPage />
          </Protected>
        }
      />
      <Route
        path="/trips/:tripId"
        element={
          <Protected>
            <WorkspacePage />
          </Protected>
        }
      />
      <Route
        path="/trips/:tripId/history"
        element={
          <Protected>
            <HistoryPage />
          </Protected>
        }
      />
      <Route
        path="/trips/:tripId/guide"
        element={
          <Protected>
            <GuidePage />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
