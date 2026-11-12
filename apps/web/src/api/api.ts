import type { components } from "./schema";
import { apiRequest } from "./client";

type S = components["schemas"];

export type UserOut = S["UserOut"];
export type SessionOut = S["SessionOut"];
export type TripSummary = S["TripSummary"];
export type TripDetail = S["TripDetail"];
export type MapLayerOut = S["MapLayerOut"];
export type MapLayerFeatureOut = S["MapLayerFeatureOut"];
export type DayOut = S["DayOut"];
export type PlaceOut = S["PlaceOut"];
export type StopOut = S["StopOut"];
export type TimelineOut = S["TimelineOut"];
export type DayTimeline = S["DayTimeline"];
export type TimelineBlock = S["TimelineBlock"];
export type SearchResponse = S["SearchResponse"];
export type GeoResult = S["GeoResult"];
export type RouteQueryResponse = S["RouteQueryResponse"];
export type RouteCandidate = S["RouteCandidate"];
export interface OptimizationStopPlan {
  stop_id: string;
  title: string;
  position: number;
  arrival: string | null;
  start: string | null;
  end: string | null;
  travel_seconds: number | null;
}

export interface OptimizationResult {
  input_revision: number;
  input_hash: string;
  solver_status: "feasible" | "infeasible" | "time_limit";
  matrix_source: string;
  days: Array<{ day_id: string; date: string; stops: OptimizationStopPlan[]; travel_seconds: number; finish: string | null }>;
  unassigned: Array<Record<string, unknown>>;
  conflicts: Array<{ code: string; day_id?: string }>;
  totals: Record<string, unknown>;
  assumptions: string[];
}
export type JobOut = S["JobOut"];
export type ShareCreated = S["ShareCreated"];
export type ShareSummary = S["ShareSummary"];
export type ShareAccess = S["ShareAccess"];
export type RevisionSummary = S["RevisionSummary"];
export type PublicConfig = S["PublicConfig"];
export type CapabilityOut = S["CapabilityOut"];
export type StopPatch = S["StopPatch"];
export type PlacePatch = S["PlacePatch"];
export type TripWarning = S["TripWarning"];

export type ProviderKeyInfo = S["ProviderKeyOut"];
export type ProviderSettings = S["ProviderSettingsOut"];
export type ProviderTestResult = S["ProviderTestOut"];

export interface GuideDay {
  day_id: string;
  date: string;
  start_local_time: string;
  end_local_time: string;
  start_time: string;
  finish_time: string;
  blocks: Array<{
    stop_id: string;
    title: string;
    kind: string;
    place_name: string | null;
    start: string | null;
    end: string | null;
    travel_seconds: number | null;
    wait_seconds: number;
    cost_minor: number | null;
    notes: string | null;
  }>;
  totals: { travel_seconds: number; visit_seconds: number; cost_known_minor: number; unknown_cost_count: number };
  conflicts: string[];
  notes: string | null;
}

export interface GuideSnapshot {
  schema_version: number;
  trip_id: string;
  revision: number;
  generated_at: string;
  title: string;
  date_range: string;
  timezone: string;
  currency: string;
  days: GuideDay[];
  budget: { budget_minor: number | null; known_minor: number; unknown_cost_count: number };
  place_count: number;
  sources: string[];
  warnings: string[];
  markdown: string;
}

const ifMatch = (revision: number) => ({ "If-Match": `"${revision}"` });

export const api = {
  register: (payload: {
    email: string;
    code: string;
    password: string;
    password_confirm: string;
    display_name: string;
    phone?: string;
  }) =>
    apiRequest<{ status: string; message: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  captcha: () => apiRequest<{ challenge_id: string; threshold: number }>("/auth/captcha", { method: "POST" }),

  sendEmailCode: (payload: { email: string; scene: "login" | "register"; challenge_id: string; slider_percent: number }) =>
    apiRequest<{ ok: boolean; dev: boolean; message: string }>("/auth/email/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password?: string; code?: string; challenge_id?: string; slider_percent?: number }) =>
    apiRequest<SessionOut>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),

  session: () => apiRequest<SessionOut>("/auth/session"),

  updateMe: (payload: { display_name?: string; email?: string; avatar?: string }) =>
    apiRequest<UserOut>("/users/me", { method: "PATCH", body: JSON.stringify(payload) }),

  logout: () => apiRequest<{ status: string }>("/auth/logout", { method: "POST" }),

  tripWeather: (tripId: string) =>
    apiRequest<{
      available: boolean;
      reason?: string;
      days: { date: string; code: number | null; label: string; icon: string; high: number | null; low: number | null; rain: number | null }[];
    }>(`/trips/${tripId}/weather`),

  publicConfig: () => apiRequest<PublicConfig>("/config/public"),

  capabilities: () => apiRequest<CapabilityOut[]>("/providers/capabilities"),

  listTrips: () => apiRequest<TripSummary[]>("/trips"),

  createTrip: (payload: { title: string; start_date: string; end_date: string; timezone?: string; currency?: string }) =>
    apiRequest<TripDetail>("/trips", { method: "POST", body: JSON.stringify(payload) }),

  getTrip: (tripId: string) => apiRequest<TripDetail>(`/trips/${tripId}`),

  patchTrip: (tripId: string, revision: number, payload: Record<string, unknown>) =>
    apiRequest<TripDetail>(`/trips/${tripId}`, {
      method: "PATCH",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  deleteTrip: (tripId: string) => apiRequest<{ trip_id: string }>(`/trips/${tripId}`, { method: "DELETE" }),

  cloneTrip: (tripId: string) => apiRequest<TripDetail>(`/trips/${tripId}/clone`, { method: "POST" }),

  changeDates: (tripId: string, revision: number, start: string, end: string) =>
    apiRequest<TripDetail>(`/trips/${tripId}/change-dates`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify({ start_date: start, end_date: end, overflow: "to_candidates" }),
    }),

  previewDates: (tripId: string, start: string, end: string) =>
    apiRequest<{
      removed_days: string[];
      affected_stop_count: number;
      added_days: string[];
    }>(`/trips/${tripId}/date-change-preview`, {
      method: "POST",
      body: JSON.stringify({ start_date: start, end_date: end, overflow: "to_candidates" }),
    }),

  patchDay: (tripId: string, dayId: string, revision: number, payload: Record<string, unknown>) =>
    apiRequest<TripDetail>(`/trips/${tripId}/days/${dayId}`, {
      method: "PATCH",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  createPlace: (tripId: string, revision: number, payload: Record<string, unknown>) =>
    apiRequest<TripDetail>(`/trips/${tripId}/places`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  patchPlace: (tripId: string, placeId: string, revision: number, payload: PlacePatch) =>
    apiRequest<TripDetail>(`/trips/${tripId}/places/${placeId}`, {
      method: "PATCH",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  deletePlace: (tripId: string, placeId: string, revision: number, detach = false, cascade = false) =>
    apiRequest<TripDetail>(`/trips/${tripId}/places/${placeId}?detach=${detach}&cascade=${cascade}`, {
      method: "DELETE",
      headers: ifMatch(revision),
    }),

  createStop: (tripId: string, revision: number, payload: Record<string, unknown>) =>
    apiRequest<TripDetail>(`/trips/${tripId}/stops`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  patchStop: (tripId: string, stopId: string, revision: number, payload: StopPatch) =>
    apiRequest<TripDetail>(`/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      headers: ifMatch(revision),
      body: JSON.stringify(payload),
    }),

  deleteStop: (tripId: string, stopId: string, revision: number) =>
    apiRequest<TripDetail>(`/trips/${tripId}/stops/${stopId}`, {
      method: "DELETE",
      headers: ifMatch(revision),
    }),

  reorderStops: (tripId: string, revision: number, containers: Array<{ day_id: string | null; stop_ids: string[] }>) =>
    apiRequest<TripDetail>(`/trips/${tripId}/reorder-stops`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify({ containers }),
    }),

  timeline: (tripId: string) => apiRequest<TimelineOut>(`/trips/${tripId}/timeline`),

  search: (payload: { provider: string; q: string; city_code?: string; limit?: number }) =>
    apiRequest<SearchResponse>("/maps/search", { method: "POST", body: JSON.stringify(payload) }),

  suggest: (payload: { provider?: string; q: string; city_code?: string; limit?: number }) =>
    apiRequest<SearchResponse>("/maps/suggest", { method: "POST", body: JSON.stringify(payload) }),

  queryRoute: (
    tripId: string,
    payload: {
      from_stop_id?: string | null;
      to_stop_id?: string | null;
      mode: "driving" | "walking" | "bicycling" | "electrobike" | "transit" | "manual";
      provider?: "amap" | "manual" | "auto";
      city_code?: string;
      strategy?: number;
    },
  ) => apiRequest<RouteQueryResponse>(`/trips/${tripId}/routes/query`, { method: "POST", body: JSON.stringify(payload) }),

  manualLeg: (
    tripId: string,
    revision: number,
    payload: { from_stop_id: string; to_stop_id: string; duration_seconds: number; distance_m?: number; label?: string },
  ) =>
    apiRequest<TripDetail>(`/trips/${tripId}/routes/manual`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify({ ...payload, mode: "manual" }),
    }),

  deleteLeg: (tripId: string, legId: string, revision: number) =>
    apiRequest<TripDetail>(`/trips/${tripId}/routes/${legId}`, { method: "DELETE", headers: ifMatch(revision) }),

  // ---- 专题图层：GeoJSON 点图层，跟随行程保存，可导出/分享 ----
  createLayer: (tripId: string, payload: { name: string; kind?: "mine" | "system"; category?: string; icon?: string; color?: string }) =>
    apiRequest<MapLayerOut>(`/trips/${tripId}/layers`, { method: "POST", body: JSON.stringify(payload) }),

  patchLayer: (tripId: string, layerId: string, payload: { name?: string; icon?: string; color?: string; visible?: boolean; opacity?: number }) =>
    apiRequest<MapLayerOut>(`/trips/${tripId}/layers/${layerId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteLayer: (tripId: string, layerId: string) =>
    apiRequest<void>(`/trips/${tripId}/layers/${layerId}`, { method: "DELETE" }),

  addLayerFeature: (
    tripId: string,
    layerId: string,
    payload: { name: string; lon: number; lat: number; category?: string; properties?: Record<string, unknown> },
  ) => apiRequest<MapLayerOut>(`/trips/${tripId}/layers/${layerId}/features`, { method: "POST", body: JSON.stringify(payload) }),

  deleteLayerFeature: (tripId: string, layerId: string, featureId: string) =>
    apiRequest<MapLayerOut>(`/trips/${tripId}/layers/${layerId}/features/${featureId}`, { method: "DELETE" }),

  collectLayerPois: (
    tripId: string,
    layerId: string,
    payload: { lon: number; lat: number; radius_m?: number; keywords?: string; limit?: number },
  ) => apiRequest<MapLayerOut>(`/trips/${tripId}/layers/${layerId}/collect`, { method: "POST", body: JSON.stringify(payload) }),

  exportLayer: (tripId: string, layerId: string) =>
    apiRequest<GeoJSON.FeatureCollection>(`/trips/${tripId}/layers/${layerId}/export`),

  optimize: (tripId: string, revision: number, dayId: string, mode: "driving" | "walking", provider: "amap" | "estimate") =>
    apiRequest<JobOut>(`/trips/${tripId}/optimization-jobs`, {
      method: "POST",
      body: JSON.stringify({ input_revision: revision, scope: "day", day_ids: [dayId], mode, provider }),
    }),

  applyOptimization: (tripId: string, revision: number, jobId: string) =>
    apiRequest<TripDetail>(`/trips/${tripId}/apply-optimization`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify({ job_id: jobId }),
    }),

  job: (jobId: string) => apiRequest<JobOut>(`/jobs/${jobId}`),

  jobResult: (jobId: string) => apiRequest<{ result: OptimizationResult }>(`/jobs/${jobId}/result`),

  revisions: (tripId: string) => apiRequest<RevisionSummary[]>(`/trips/${tripId}/revisions`),

  revision: (tripId: string, revision: number) => apiRequest<{ revision: number; created_at: string; reason: string } & { snapshot: Record<string, unknown> }>(`/trips/${tripId}/revisions/${revision}`),

  restore: (tripId: string, revision: number, sourceRevision: number) =>
    apiRequest<TripDetail>(`/trips/${tripId}/restore`, {
      method: "POST",
      headers: ifMatch(revision),
      body: JSON.stringify({ source_revision: sourceRevision }),
    }),

  guide: (tripId: string, revision?: number) =>
    apiRequest<GuideSnapshot>(`/trips/${tripId}/guide${revision ? `?revision=${revision}` : ""}`),

  exportJob: (tripId: string, format: "md" | "docx", revision?: number) =>
    apiRequest<JobOut>(`/trips/${tripId}/export-jobs`, {
      method: "POST",
      body: JSON.stringify({ format, revision: revision ?? null }),
    }),

  exports: (tripId: string) =>
    apiRequest<Array<{ id: string; format: string; filename: string; bytes: number; revised_at?: string; expired: boolean; download_url: string }>>(
      `/trips/${tripId}/exports`,
    ),

  shares: (tripId: string) => apiRequest<ShareSummary[]>(`/trips/${tripId}/shares`),

  createShare: (tripId: string, payload: { expires_in_days: 1 | 7 | 30; password?: string | null; allow_clone: boolean }) =>
    apiRequest<ShareCreated>(`/trips/${tripId}/shares`, { method: "POST", body: JSON.stringify(payload) }),

  revokeShare: (tripId: string, shareId: string) =>
    apiRequest<{ status: string }>(`/trips/${tripId}/shares/${shareId}`, { method: "DELETE" }),

  readShare: (token: string) => apiRequest<ShareAccess>(`/shares/${token}`),

  unlockShare: (token: string, password: string) =>
    apiRequest<ShareAccess>(`/shares/${token}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),

  cloneShare: (token: string) => apiRequest<TripDetail>(`/shares/${token}/clone`, { method: "POST" }),

  importPlaces: (tripId: string, revision: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<{ created_place_ids: string[]; feature_count: number; warnings: string[] }>(`/trips/${tripId}/import`, {
      method: "POST",
      headers: ifMatch(revision),
      body: form,
    });
  },

  providerSettings: () => apiRequest<ProviderSettings>("/settings/providers"),

  updateProviderSettings: (payload: Partial<Record<"amap_key" | "tianditu_key" | "tianditu_browser_key", string | null>>) =>
    apiRequest<ProviderSettings>("/settings/providers", { method: "PUT", body: JSON.stringify(payload) }),

  testProvider: (provider: "amap" | "tianditu") =>
    apiRequest<ProviderTestResult>("/settings/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),

  egressIp: (refresh = false) =>
    apiRequest<S["EgressIPOut"]>(`/settings/egress-ip${refresh ? "?refresh=true" : ""}`),

  download: async (path: string) => {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    return response.blob();
  },
};
