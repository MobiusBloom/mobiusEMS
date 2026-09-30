import type { ApiResponse } from "@mobius-ems/shared";
export class ApiError extends Error { constructor(message: string, public status: number, public errors?: Record<string, string[]>) { super(message); } }
let refreshPromise: Promise<boolean> | null = null;

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/welcome",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/platform/login",
  "/terms",
  "/privacy",
];

const isPublicPath = (pathname: string) => {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith("/solutions"));
};

const handleUnauthorized = () => {
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname;
    if (!isPublicPath(pathname)) {
      window.location.replace("/login");
    }
  }
};

const request = async <T>(path: string, init: RequestInit = {}, canRefresh = true): Promise<T> => {
  const response = await fetch(path, { ...init, credentials: "include", headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers } });
  if (response.status === 401 && canRefresh && path !== "/api/v1/auth/refresh") {
    refreshPromise ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" }).then((r) => r.ok).finally(() => { refreshPromise = null; });
    // Even when our refresh loses a race, another tab may already have set
    // fresh cookies, so retry once before treating the session as gone.
    await refreshPromise;
    return request<T>(path, init, false);
  }
  if (response.status === 401 && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/forgot-password" && path !== "/api/v1/auth/reset-password") {
    handleUnauthorized();
  }
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    const details = Object.entries(payload.errors ?? {}).flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`));
    throw new ApiError(details.length ? details.join(". ") : payload.message, response.status, payload.errors);
  }
  return payload.data as T;
};
export const api = { get: <T>(path: string) => request<T>(path), post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }), put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }), delete: <T>(path: string) => request<T>(path, { method: "DELETE" }), upload: <T>(path: string, body: FormData) => request<T>(path, { method: "POST", body }) };

