import mongoose from "mongoose";
import { Tenant, type TenantDocument } from "../models/Tenant.js";
import { User } from "../models/User.js";
import { RefreshSession } from "../models/RefreshSession.js";
import { AppError } from "../utils/AppError.js";
import { runAsSystem } from "./tenantContext.js";

export type ActiveTenant = TenantDocument & { _id: mongoose.Types.ObjectId };

export const requireActiveTenant = async (tenantId: string): Promise<ActiveTenant> => {
  if (!mongoose.isValidObjectId(tenantId)) throw new AppError("Organization is unavailable", 401, "TENANT_UNAVAILABLE");
  const tenant = await Tenant.findOne({ _id: tenantId, status: "ACTIVE" }).lean<ActiveTenant>();
  if (!tenant) throw new AppError("Organization is unavailable", 401, "TENANT_UNAVAILABLE");
  return tenant;
};

export const resolveTenantForLogin = async (email: string, slug?: string): Promise<ActiveTenant> => {
  if (slug) {
    const tenant = await Tenant.findOne({ slug: slug.toLowerCase(), status: "ACTIVE" }).lean<ActiveTenant>();
    if (!tenant) throw new AppError("Email, password or organization is incorrect", 401, "INVALID_CREDENTIALS");
    return tenant;
  }
  const users = await runAsSystem(() => User.collection.find({ email: email.toLowerCase(), isActive: true }, { projection: { tenantId: 1 } }).limit(2).toArray());
  if (users.length > 1) throw new AppError("This email belongs to multiple organizations. Enter your Organization ID", 409, "DUPLICATE_LOGIN_EMAIL");
  const tenantId = users[0]?.tenantId;
  if (!tenantId) throw new AppError("Email or password is incorrect", 401, "INVALID_CREDENTIALS");
  return requireActiveTenant(tenantId.toString());
};

export const tenantIdForUser = async (userId: string): Promise<string | undefined> => {
  if (!mongoose.isValidObjectId(userId)) return undefined;
  const user = await runAsSystem(() => User.collection.findOne({ _id: new mongoose.Types.ObjectId(userId) }, { projection: { tenantId: 1 } }));
  return user?.tenantId?.toString();
};

export const tenantIdForRefreshTokenHash = async (tokenHash: string): Promise<string | undefined> => {
  const session = await runAsSystem(() => RefreshSession.collection.findOne({ tokenHash }, { projection: { tenantId: 1 } }));
  return session?.tenantId?.toString();
};
