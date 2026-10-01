import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env.js";
import * as authService from "../services/authService.js";

const baseCookie: CookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) };
const setCookies = (response: Response, accessToken: string, refreshToken: string): void => {
  response.cookie("access_token", accessToken, { ...baseCookie, path: "/", maxAge: 15 * 60 * 1000 });
  response.cookie("refresh_token", refreshToken, { ...baseCookie, path: "/api/v1/auth", maxAge: 7 * 24 * 60 * 60 * 1000 });
};
const clearCookies = (response: Response): void => {
  response.clearCookie("access_token", { ...baseCookie, path: "/" });
  response.clearCookie("refresh_token", { ...baseCookie, path: "/api/v1/auth" });
};

export const login = async (request: Request, response: Response): Promise<void> => {
  const { email, password, tenantSlug } = request.body as { email: string; password: string; tenantSlug?: string };
  const result = await authService.login(email, password, tenantSlug, request); setCookies(response, result.accessToken, result.refreshToken);
  response.json({ success: true, message: "Signed in successfully", data: { user: result.user } });
};
export const refresh = async (request: Request, response: Response): Promise<void> => {
  const token = request.cookies.refresh_token as string | undefined;
  if (!token) { response.status(401).json({ success: false, message: "Session expired" }); return; }
  const result = await authService.rotateRefreshToken(token, request); setCookies(response, result.accessToken, result.refreshToken);
  response.json({ success: true, message: "Session refreshed", data: { user: result.user } });
};
export const logout = async (request: Request, response: Response): Promise<void> => {
  await authService.revokeRefreshToken(request.cookies.refresh_token as string | undefined);
  clearCookies(response);
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Clear-Site-Data", '"cache"');
  response.json({ success: true, message: "Signed out successfully" });
};
export const me = async (request: Request, response: Response): Promise<void> => { response.json({ success: true, message: "Session retrieved", data: { user: request.user } }); };
export const changePassword = async (request: Request, response: Response): Promise<void> => {
  const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
  const user = await authService.changePassword(request.user!.id, currentPassword, newPassword, request); clearCookies(response);
  response.json({ success: true, message: "Password changed. Please sign in again", data: { user } });
};
export const requestPasswordReset = async (request: Request, response: Response): Promise<void> => { const result = await authService.requestSuperAdminPasswordReset(request.body.email, request.body.tenantSlug); response.json({ success: true, message: result, data: { message: result } }); };
export const resetPassword = async (request: Request, response: Response): Promise<void> => { await authService.resetSuperAdminPassword(request.body.email, request.body.token, request.body.newPassword, request.body.tenantSlug, request); response.json({ success: true, message: "Password reset successfully" }); };
