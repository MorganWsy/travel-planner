/// <reference types="vite/client" />

// TypeScript 7 不再自动把 @types/geojson 的全局命名空间带进项目，
// 而 MapCanvas 和 API 类型直接使用了 GeoJSON.Feature / GeoJSON.Geometry。
// 这里显式引用，避免依赖“所有 @types 包自动可见”的旧行为。
/// <reference types="geojson" />
