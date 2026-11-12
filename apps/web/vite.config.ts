import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8007",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // Vite 8 改用 Rolldown 打包：旧的对象形式 manualChunks 已被移除，
    // 这里用 codeSplitting.groups 按依赖来源拆成稳定的 vendor chunk，
    // 既保留浏览器缓存收益，也避免 MapLibre 被重复打进业务 chunk。
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // React 及其路由依赖优先匹配，避免被后声明的 antd 组递归吸走。
              name: "react",
              priority: 30,
              test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|react-router|react-router-dom|scheduler|@remix-run[\\/]router)[\\/]/,
            },
            {
              // 地图引擎体积最大，单独成块，工作台路由懒加载时才下载。
              name: "maplibre",
              priority: 20,
              test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?maplibre-gl[\\/]/,
            },
            {
              // antd 与其图标、样式运行时一起成块；其余 rc-* 依赖由递归包含规则带入。
              name: "antd",
              priority: 10,
              test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:antd|@ant-design[\\/](?:icons|cssinjs))[\\/]/,
            },
          ],
        },
      },
    },
  },
});
