/**
 * 统一请求层。
 * - Cookie 会话，凭证随请求发送；CSRF 值只保存在内存（不进 localStorage）。
 * - 错误统一抛 ApiError，页面按 code 展示可行动提示。
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;
  requestId: string;

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}, requestId = "") {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

let csrfToken = "";

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = init.body instanceof FormData;
  if (init.body && !isForm) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

  const response = await fetch(path.startsWith("http") ? path : `/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      error.code || "NETWORK_ERROR",
      error.message || `请求失败（HTTP ${response.status}）`,
      response.status,
      error.details || {},
      error.request_id || response.headers.get("x-request-id") || "",
    );
  }
  return payload as T;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "未知错误";
}

export { JSON_HEADERS };
