import type { SessionUser } from "@mobius-ems/shared"; import { api } from "@/api/client";
export const authApi = {
  me: () => api.get<{ user: SessionUser }>("/api/v1/auth/me"),
  login: (body: { email: string; password: string; tenantSlug?: string }) => api.post<{ user: SessionUser }>("/api/v1/auth/login", body),
  logout: () => api.post<never>("/api/v1/auth/logout"),
  changePassword: (body: { currentPassword: string; newPassword: string }) => api.post<{ user: SessionUser }>("/api/v1/auth/change-password", body)
  , requestPasswordReset: (body: { email: string }) => api.post<{ message?: string }>("/api/v1/auth/forgot-password", body), resetPassword: (body: { email: string; token: string; newPassword: string; tenantSlug?: string }) => api.post("/api/v1/auth/reset-password", body)
};

