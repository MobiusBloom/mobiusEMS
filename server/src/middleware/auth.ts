import type { RequestHandler } from "express";
import type { PermissionName } from "@mobius-ems/shared";
import { verifyAccessToken } from "../services/tokenService.js";
import { getSessionUser } from "../services/authService.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { runWithTenant } from "../tenancy/tenantContext.js";
import { requireActiveTenant, tenantIdForUser } from "../tenancy/tenantResolver.js";

export const authenticate = asyncHandler(async (request, _response, next) => {
  const token = request.cookies.access_token as string | undefined;
  if (!token) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  let payload;
  try { payload = verifyAccessToken(token); }
  catch { throw new AppError("Authentication required", 401, "UNAUTHENTICATED"); }
  if (!payload.sub || payload.type !== "access") throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  // Database failures below must surface as 5xx, not 401: a 401 makes the
  // client drop the session and bounce the user to the login page.
  const tenantId = payload.tenantId ?? await tenantIdForUser(payload.sub);
  if (!tenantId) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  const tenant = await requireActiveTenant(tenantId);
  const subject = payload.sub;
  await runWithTenant(tenantId, async () => { request.user = await getSessionUser(subject, tenant); next(); });
});
export const requirePermission = (...permissions: PermissionName[]): RequestHandler => (request, _response, next) => {
  if (!request.user || !permissions.every((permission) => request.user?.permissions.includes(permission))) return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
  next();
};

export const requireAnyPermission = (...permissions: PermissionName[]): RequestHandler => (request, _response, next) => {
  if (!request.user || !permissions.some((permission) => request.user?.permissions.includes(permission))) {
    return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
  }
  next();
};

