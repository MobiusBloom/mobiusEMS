import bcrypt from "bcrypt";
import type { Request } from "express";
import type { SessionUser } from "@mobius-ems/shared";
import { User } from "../models/User.js";
import { RefreshSession } from "../models/RefreshSession.js";
import { AppError } from "../utils/AppError.js";
import { createAccessToken, createRefreshToken, hashToken, verifyRefreshToken } from "./tokenService.js";
import { writeAudit } from "./auditService.js";
import type { RoleDocument } from "../models/Role.js";
import { requireTenantId, runWithTenant } from "../tenancy/tenantContext.js";
import { requireActiveTenant, resolveTenantForLogin, tenantIdForRefreshTokenHash, type ActiveTenant } from "../tenancy/tenantResolver.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import type { CapabilityName } from "@mobius-ems/shared";
import { randomBytes, createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { isPlatformAdminEmail } from "../middleware/platformAdmin.js";

import { DEFAULT_PLAN_CONFIGS } from "@mobius-ems/shared";

const REFRESH_REUSE_GRACE_MS = 30_000;
type PopulatedUser = Awaited<ReturnType<typeof getPopulatedUser>>;
const getPopulatedUser = async (id: string) => User.findById(id).populate<{ role: RoleDocument }>("role").exec();
const sessionUser = async (user: NonNullable<PopulatedUser>, tenant: ActiveTenant): Promise<SessionUser> => {
  const plan = tenant.plan ?? "STANDARD";
  const planConfig = DEFAULT_PLAN_CONFIGS[plan] ?? DEFAULT_PLAN_CONFIGS.STANDARD;
  const features = tenant.features ?? planConfig.features;

  const departmentCapabilities = (user.role.permissions.includes("sales.view.all")
    ? (await Department.exists({ capabilities: "SALES_MODULE", isActive: true }) ? ["SALES_MODULE" as CapabilityName] : [])
    : ((await Employee.findOne({ user: user._id, isActive: true }).populate<{ department?: { capabilities?: CapabilityName[] } | null }>("department", "capabilities").select("department").lean())?.department?.capabilities ?? []))
    .filter((cap) => cap !== "SALES_MODULE" || features.salesModuleEnabled);

  return ({
    id: user.id,
    name: user.name,
    email: user.email,
    tenantId: tenant._id.toString(),
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    isPlatformAdmin: user.role.name === "SUPER_ADMIN" && isPlatformAdminEmail(user.email),
    role: user.role.name,
    permissions: user.role.permissions,
    capabilities: departmentCapabilities,
    forcePasswordChange: user.forcePasswordChange,
    onboardingComplete: user.onboardingComplete,
    plan,
    subscriptionStatus: tenant.subscriptionStatus ?? "ACTIVE",
    maxEmployees: tenant.maxEmployees ?? planConfig.maxEmployees,
    subscriptionEndsAt: tenant.subscriptionEndsAt?.toISOString(),
    features,
  });
};

const requestMeta = (request: Request) => ({ ip: request.ip, userAgent: request.get("user-agent")?.slice(0, 500) });
const resetHash = (token: string) => createHash("sha256").update(token).digest("hex");
const resetMessage = "If the account is an eligible Super Admin, a password reset link has been sent.";

export const requestSuperAdminPasswordReset = async (email: string, tenantSlug?: string) => {
  let tenant: ActiveTenant;
  try { tenant = await resolveTenantForLogin(email, tenantSlug); } catch { return resetMessage; }
  await runWithTenant(tenant._id, async () => {
    const user = await User.findOne({ email, isActive: true }).populate<{ role: RoleDocument }>("role");
    if (!user || user.role.name !== "SUPER_ADMIN" || !isPlatformAdminEmail(user.email)) return;
    const token = randomBytes(32).toString("hex");
    user.passwordResetTokenHash = resetHash(token); user.passwordResetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000); await user.save();
    if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD) {
      const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } });
      const link = `${env.CLIENT_URL}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}&tenant=${tenant.slug}`;
      await transport.sendMail({ from: env.SMTP_USER, to: user.email, subject: "MobiusEMS Super Admin password reset", text: `Reset your password within 30 minutes: ${link}` });
    }
  });
  return resetMessage;
};

export const resetSuperAdminPassword = async (email: string, token: string, newPassword: string, tenantSlug: string | undefined, request: Request) => {
  const tenant = await resolveTenantForLogin(email, tenantSlug);
  return runWithTenant(tenant._id, async () => {
    const user = await User.findOne({ email, isActive: true }).select("+passwordHash +passwordResetTokenHash").populate<{ role: RoleDocument }>("role");
    if (!user || user.role.name !== "SUPER_ADMIN" || !isPlatformAdminEmail(user.email) || !user.passwordResetTokenHash || !user.passwordResetTokenExpiresAt || user.passwordResetTokenExpiresAt < new Date() || user.passwordResetTokenHash !== resetHash(token)) throw new AppError("Reset link is invalid or expired", 400, "INVALID_RESET_TOKEN");
    user.passwordHash = await bcrypt.hash(newPassword, 12); user.passwordChangedAt = new Date(); user.forcePasswordChange = false; user.passwordResetTokenHash = undefined; user.passwordResetTokenExpiresAt = undefined; await user.save();
    await RefreshSession.updateMany({ user: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    await writeAudit({ user: user._id, action: "SUPER_ADMIN_PASSWORD_RESET", entityType: "User", entityId: user.id, ipAddress: request.ip, userAgent: request.get("user-agent") });
  });
};

export const login = async (email: string, password: string, tenantSlug: string | undefined, request: Request) => {
  const tenant = await resolveTenantForLogin(email, tenantSlug);
  return runWithTenant(tenant._id, async () => {
    const user = await User.findOne({ email, isActive: true }).select("+passwordHash").populate<{ role: RoleDocument }>("role");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError("Email, password or organization is incorrect", 401, "INVALID_CREDENTIALS");
    const tenantId = tenant._id.toString();
    const refresh = createRefreshToken(user.id, tenantId);
    await RefreshSession.create({ user: user._id, tokenHash: hashToken(refresh.token), family: refresh.family, expiresAt: refresh.expiresAt, ...requestMeta(request) });
    user.lastLoginAt = new Date(); await user.save();
    await writeAudit({ user: user._id, action: "AUTH_LOGIN", entityType: "User", entityId: user.id, ipAddress: request.ip, userAgent: request.get("user-agent") });
    return { user: await sessionUser(user, tenant), accessToken: createAccessToken(user.id, tenantId), refreshToken: refresh.token };
  });
};

export const rotateRefreshToken = async (token: string, request: Request) => {
  let payload;
  try { payload = verifyRefreshToken(token); } catch { throw new AppError("Session expired", 401, "INVALID_REFRESH_TOKEN"); }
  const tokenHash = hashToken(token);
  const tenantId = payload.tenantId ?? await tenantIdForRefreshTokenHash(tokenHash);
  if (!tenantId) throw new AppError("Session expired", 401, "INVALID_REFRESH_TOKEN");
  const tenant = await requireActiveTenant(tenantId);
  return runWithTenant(tenantId, async () => {
    const existing = await RefreshSession.findOne({ tokenHash });
    // A token rotated moments ago is a concurrent refresh (another tab or a
    // parallel request), not theft; fail it without revoking the family.
    if (existing?.revokedAt && existing.replacedByHash && Date.now() - existing.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
      throw new AppError("Session was just refreshed", 401, "INVALID_REFRESH_TOKEN");
    }
    if (!existing || existing.revokedAt) {
      await RefreshSession.updateMany({ family: payload.family, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
      throw new AppError("Session reuse detected. Please sign in again", 401, "REFRESH_REUSE_DETECTED");
    }
    const user = await getPopulatedUser(payload.sub);
    if (!user?.isActive) throw new AppError("Account is unavailable", 401, "ACCOUNT_UNAVAILABLE");
    const refresh = createRefreshToken(user.id, tenantId, payload.family);
    existing.revokedAt = new Date(); existing.replacedByHash = hashToken(refresh.token); await existing.save();
    await RefreshSession.create({ user: user._id, tokenHash: hashToken(refresh.token), family: refresh.family, expiresAt: refresh.expiresAt, ...requestMeta(request) });
    return { user: await sessionUser(user, tenant), accessToken: createAccessToken(user.id, tenantId), refreshToken: refresh.token };
  });
};

export const revokeRefreshToken = async (token: string | undefined): Promise<void> => {
  if (!token) return;
  const tokenHash = hashToken(token);
  const tenantId = await tenantIdForRefreshTokenHash(tokenHash);
  if (tenantId) await runWithTenant(tenantId, () => RefreshSession.updateOne({ tokenHash, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }).exec());
};

export const changePassword = async (userId: string, currentPassword: string, newPassword: string, request: Request): Promise<SessionUser> => {
  const user = await User.findById(userId).select("+passwordHash").populate<{ role: RoleDocument }>("role");
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError("Current password is incorrect", 400, "INVALID_CURRENT_PASSWORD");
  if (await bcrypt.compare(newPassword, user.passwordHash)) throw new AppError("New password must be different", 400, "PASSWORD_REUSED");
  user.passwordHash = await bcrypt.hash(newPassword, 12); user.forcePasswordChange = false; user.passwordChangedAt = new Date(); await user.save();
  await RefreshSession.updateMany({ user: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  await writeAudit({ user: user._id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, ipAddress: request.ip, userAgent: request.get("user-agent") });
  return sessionUser(user, await requireActiveTenant(requireTenantId().toString()));
};

export const getSessionUser = async (userId: string, tenant: ActiveTenant): Promise<SessionUser> => {
  const user = await getPopulatedUser(userId);
  if (!user?.isActive) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return sessionUser(user, tenant);
};

