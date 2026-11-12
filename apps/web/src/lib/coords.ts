/**
 * WGS84 ↔ GCJ-02。
 *
 * 库里一律存 WGS84；只有在高德底图（GCJ-02 基准）上绘制、或在高德底图上取点时，
 * 才在渲染层做一次换算，避免点位整体偏出几百米。落库前会反向转回 WGS84。
 */

const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lon + dLon, lat + dLat];
}

export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat];
  let wgsLon = lon;
  let wgsLat = lat;
  for (let i = 0; i < 6; i += 1) {
    const [gLon, gLat] = wgs84ToGcj02(wgsLon, wgsLat);
    const dLon = lon - gLon;
    const dLat = lat - gLat;
    wgsLon += dLon;
    wgsLat += dLat;
    if (Math.abs(dLon) < 1e-9 && Math.abs(dLat) < 1e-9) break;
  }
  return [wgsLon, wgsLat];
}

/** 两点间球面距离（米）。 */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 2)} 公里`;
  return `${Math.round(meters)} 米`;
}

export function formatArea(squareMeters: number): string {
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(2)} 平方公里`;
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(2)} 万㎡`;
  return `${Math.round(squareMeters)} ㎡`;
}
