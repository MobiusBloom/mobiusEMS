import { randomBytes } from "node:crypto"; import bcrypt from "bcrypt"; import { ROLES, SECTION_PERMISSIONS, type PermissionName, type SectionPermissionName, type LeaveBalanceItem } from "@mobius-ems/shared"; import { Employee } from "../models/Employee.js"; import { LeaveRequest } from "../models/LeaveRequest.js"; import { LeavePolicy } from "../models/LeavePolicy.js"; import { Recognition, type RecognitionDocument } from "../models/Recognition.js"; import { Role } from "../models/Role.js"; import { User } from "../models/User.js"; import { AppError } from "../utils/AppError.js"; import { notify } from "./notificationService.js"; import { writeAudit } from "./auditService.js";
const scopedEmployees = async (viewer: { id: string; role: string }) => { if (!["EMPLOYEE","MANAGER"].includes(viewer.role)) return Employee.find({ isActive: true }).distinct("_id"); const own = await Employee.findOne({ user: viewer.id }).select("_id"); return viewer.role === "EMPLOYEE" ? own ? [own._id] : [] : Employee.find({ $or: [{ _id: own?._id }, { reportingManager: own?._id }] }).distinct("_id"); };
export const listLeaves = async (viewer: { id: string; role: string }) => LeaveRequest.find({ employee: { $in: await scopedEmployees(viewer) } }).populate("employee", "firstName lastName employeeId").populate("reviewedBy", "name").sort({ createdAt: -1 }).lean();

export const DEFAULT_LEAVE_POLICIES = [
  { name: "Casual Leave", code: "CASUAL_LEAVE", quotaDays: 12, isPaid: true, isSystem: true, description: "Short-term planned personal leave" },
  { name: "Sick Leave", code: "SICK_LEAVE", quotaDays: 10, isPaid: true, isSystem: true, description: "Medical and health-related leave" },
  { name: "Paid Leave", code: "PAID_LEAVE", quotaDays: 15, isPaid: true, isSystem: true, description: "Annual earned privilege leave" },
  { name: "Work From Home", code: "WORK_FROM_HOME", quotaDays: 24, isPaid: true, isSystem: true, description: "Remote work days quota" },
  { name: "Unpaid Leave", code: "UNPAID_LEAVE", quotaDays: 999, isPaid: false, isSystem: true, description: "Leave without pay (unlimited policy)" },
  { name: "Other", code: "OTHER", quotaDays: 10, isPaid: true, isSystem: true, description: "Special circumstance leave" }
];

export const ensureDefaultLeavePolicies = async () => {
  const count = await LeavePolicy.countDocuments({ isActive: true });
  if (count === 0) {
    for (const p of DEFAULT_LEAVE_POLICIES) {
      await LeavePolicy.create({ ...p, isActive: true });
    }
  }
};

export const LEAVE_QUOTAS: Record<string, number> = {
  CASUAL_LEAVE: 12,
  SICK_LEAVE: 10,
  PAID_LEAVE: 15,
  WORK_FROM_HOME: 24,
  UNPAID_LEAVE: 999,
  OTHER: 10
};

export const listLeavePolicies = async () => {
  await ensureDefaultLeavePolicies();
  return LeavePolicy.find({ isActive: true }).sort({ isSystem: -1, createdAt: 1 }).lean();
};

export const createLeavePolicy = async (input: { name: string; code?: string; quotaDays: number; isPaid?: boolean; description?: string }, actorId: string) => {
  await ensureDefaultLeavePolicies();
  const code = (input.code?.trim() || input.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")).replace(/^_+|_+$/g, "");
  if (!code) throw new AppError("Invalid policy code", 400);

  const existing = await LeavePolicy.findOne({ code, isActive: true });
  if (existing) throw new AppError(`A leave policy with code "${code}" already exists`, 409);

  const policy = await LeavePolicy.create({
    name: input.name.trim(),
    code,
    quotaDays: input.quotaDays,
    isPaid: input.isPaid ?? true,
    description: input.description?.trim(),
    isActive: true,
    isSystem: false
  });

  await writeAudit({
    user: actorId,
    action: "LEAVE_POLICY_CREATED",
    entityType: "LeavePolicy",
    entityId: policy.id,
    newValue: { name: policy.name, code: policy.code, quotaDays: policy.quotaDays, isPaid: policy.isPaid }
  });

  return policy;
};

export const updateLeavePolicy = async (id: string, input: { name?: string; quotaDays?: number; isPaid?: boolean; description?: string }, actorId: string) => {
  const policy = await LeavePolicy.findById(id);
  if (!policy || !policy.isActive) throw new AppError("Leave policy not found", 404);

  const oldValue = { name: policy.name, quotaDays: policy.quotaDays, isPaid: policy.isPaid, description: policy.description };

  if (input.name !== undefined) policy.name = input.name.trim();
  if (input.quotaDays !== undefined) policy.quotaDays = input.quotaDays;
  if (input.isPaid !== undefined) policy.isPaid = input.isPaid;
  if (input.description !== undefined) policy.description = input.description.trim();

  await policy.save();

  await writeAudit({
    user: actorId,
    action: "LEAVE_POLICY_UPDATED",
    entityType: "LeavePolicy",
    entityId: policy.id,
    oldValue,
    newValue: { name: policy.name, quotaDays: policy.quotaDays, isPaid: policy.isPaid, description: policy.description }
  });

  return policy;
};

export const deleteLeavePolicy = async (id: string, actorId: string) => {
  const policy = await LeavePolicy.findById(id);
  if (!policy || !policy.isActive) throw new AppError("Leave policy not found", 404);
  if (policy.isSystem) throw new AppError("System default leave policies cannot be deleted. You can edit their quota days instead.", 400);

  policy.isActive = false;
  await policy.save();

  await writeAudit({
    user: actorId,
    action: "LEAVE_POLICY_DELETED",
    entityType: "LeavePolicy",
    entityId: policy.id,
    oldValue: { name: policy.name, code: policy.code }
  });

  return policy;
};

export const getLeaveBalances = async (userId: string, year = new Date().getFullYear()): Promise<LeaveBalanceItem[]> => {
  const employee = await Employee.findOne({ user: userId, isActive: true });
  await ensureDefaultLeavePolicies();
  const policies = await LeavePolicy.find({ isActive: true }).sort({ isSystem: -1, createdAt: 1 }).lean();

  if (!employee) {
    return policies.map((policy) => ({
      id: policy._id.toString(),
      type: policy.code,
      name: policy.name,
      quotaDays: policy.quotaDays,
      usedDays: 0,
      remainingDays: policy.quotaDays,
      isPaid: policy.isPaid,
      isSystem: policy.isSystem,
      description: policy.description
    }));
  }

  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

  const leaves = await LeaveRequest.find({
    employee: employee._id,
    status: { $in: ["APPROVED", "PENDING"] },
    startDate: { $gte: startOfYear, $lte: endOfYear }
  }).lean();

  const usedMap: Record<string, number> = {};
  for (const l of leaves) {
    const days = Math.max(1, Math.round((new Date(l.endDate).getTime() - new Date(l.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1);
    usedMap[l.type] = (usedMap[l.type] || 0) + days;
  }

  return policies.map((policy) => {
    const quotaDays = policy.quotaDays;
    const usedDays = usedMap[policy.code] || 0;
    const remainingDays = !policy.isPaid || policy.quotaDays >= 999 ? 0 : Math.max(0, quotaDays - usedDays);
    return {
      id: policy._id.toString(),
      type: policy.code,
      name: policy.name,
      quotaDays,
      usedDays,
      remainingDays,
      isPaid: policy.isPaid,
      isSystem: policy.isSystem,
      description: policy.description
    };
  });
};

export const requestLeave = async (userId: string, input: { type: string; startDate: Date; endDate: Date; reason: string }) => {
  const employee = await Employee.findOne({ user: userId, isActive: true });
  if (!employee) throw new AppError("Employee profile not found", 404);

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (end < start) throw new AppError("End date must be on or after start date", 400);

  const daysRequested = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  const overlapping = await LeaveRequest.findOne({
    employee: employee._id,
    status: { $in: ["PENDING", "APPROVED"] },
    startDate: { $lte: end },
    endDate: { $gte: start }
  });
  if (overlapping) {
    throw new AppError("A leave request already exists or overlaps with the selected date range", 409, "LEAVE_OVERLAP_DETECTED");
  }

  const policy = await LeavePolicy.findOne({ code: input.type, isActive: true });
  if (policy && policy.isPaid && policy.quotaDays < 999) {
    const balances = await getLeaveBalances(userId, start.getFullYear());
    const balance = balances.find((b) => b.type === input.type);
    if (balance && balance.remainingDays < daysRequested) {
      throw new AppError(`Insufficient leave balance. You have ${balance.remainingDays} days remaining for ${policy.name}.`, 422, "INSUFFICIENT_LEAVE_BALANCE");
    }
  }

  return LeaveRequest.create({ ...input, employee: employee._id });
};

export const getTeamLeaveCalendar = async (viewer: { id: string; role: string }, month?: string) => {
  const targetDate = month ? new Date(`${month}-01T00:00:00Z`) : new Date();
  const monthStart = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const employeeIds = await scopedEmployees(viewer);
  return LeaveRequest.find({
    employee: { $in: employeeIds },
    status: "APPROVED",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart }
  })
    .populate("employee", "firstName lastName employeeId department")
    .populate("reviewedBy", "name")
    .sort({ startDate: 1 })
    .lean();
};

export const reviewLeave = async (id: string, input: { status: "APPROVED" | "REJECTED"; reviewComment?: string }, viewer: { id: string; role: string }) => { const leave = await LeaveRequest.findById(id); if (!leave) throw new AppError("Leave request not found", 404); if (["EMPLOYEE","MANAGER"].includes(viewer.role)) { const allowed = (await scopedEmployees(viewer)).some((employeeId) => employeeId.equals(leave.employee)); if (!allowed || viewer.role === "EMPLOYEE") throw new AppError("Leave request is outside your review scope", 403); } leave.status = input.status; leave.reviewComment = input.reviewComment; leave.reviewedBy = viewer.id as never; await leave.save(); const employee = await Employee.findById(leave.employee); if (employee) await notify({ recipient: employee.user.toString(), type: "LEAVE_REVIEWED", title: `Leave request ${input.status.toLowerCase()}`, body: input.reviewComment || `Your leave request was ${input.status.toLowerCase()}.`, entityType: "LeaveRequest", entityId: leave.id }); return leave; };
export const listRecognition = async (viewer: { id: string; role: string }) => Recognition.find({ employee: { $in: await scopedEmployees(viewer) } }).populate("employee", "firstName lastName employeeId").populate("awardedBy", "name").sort({ awardedAt: -1 }).lean();
export const awardRecognition = async (input: { employee: string; badge: RecognitionDocument["badge"]; explanation: string; evidence: string[] }, actor: string) => { const employee = await Employee.findById(input.employee); if (!employee) throw new AppError("Employee not found", 404); const item = await Recognition.create({ ...input, awardedBy: actor, awardedAt: new Date() }); await notify({ recipient: employee.user.toString(), type: "RECOGNITION_AWARDED", title: `Recognition: ${input.badge.replaceAll("_", " ")}`, body: input.explanation, entityType: "Recognition", entityId: item.id }); await writeAudit({ user: actor, action: "RECOGNITION_AWARDED", entityType: "Recognition", entityId: item.id, newValue: input }); return item; };
export const listRoles = async () => Role.find().sort("name").lean();
export const updateRolePermissions = async (id: string, permissions: string[], actor: string) => { const role = await Role.findById(id); if (!role) throw new AppError("Role not found", 404); if (role.name === "SUPER_ADMIN") throw new AppError("Super Admin always has full access", 422, "SUPER_ADMIN_ACCESS_LOCKED"); const oldValue = role.permissions; role.permissions = permissions as typeof role.permissions; role.eodPermissionsInitialized = true; await role.save(); await writeAudit({ user: actor, action: "ROLE_PERMISSIONS_CHANGED", entityType: "Role", entityId: role.id, oldValue, newValue: permissions }); return role; };
export const updateRoleSectionAccess = async (id: string, sections: SectionPermissionName[], actor: string) => {
  const role = await Role.findById(id);
  if (!role) throw new AppError("Role not found", 404);
  if (role.name === "SUPER_ADMIN") throw new AppError("Super Admin always has access to every section", 422, "SUPER_ADMIN_ACCESS_LOCKED");
  const oldValue = role.permissions.filter((permission) => SECTION_PERMISSIONS.includes(permission as SectionPermissionName));
  const operationalPermissions = role.permissions.filter((permission) => !SECTION_PERMISSIONS.includes(permission as SectionPermissionName));
  role.permissions = [...operationalPermissions, ...sections] as PermissionName[];
  role.eodPermissionsInitialized = true;
  await role.save();
  await writeAudit({ user: actor, action: "ROLE_SECTION_ACCESS_CHANGED", entityType: "Role", entityId: role.id, oldValue, newValue: sections });
  return role;
};
const administratorRoles = ["SUPER_ADMIN", "HR_ADMIN"] as const;
export const listAdministrators = async () => {
  const roles = await Role.find({ $or: [{ name: { $in: administratorRoles } }, { isSystem: false }] }).select("_id");
  return User.find({ role: { $in: roles.map((role) => role._id) } }).select("name email role isActive forcePasswordChange lastLoginAt createdAt").populate("role", "name").sort({ createdAt: -1 }).lean();
};
export const createAdministrator = async (input: { name: string; email: string; role: string }, actor: string, meta: { ip?: string; userAgent?: string }) => {
  if (await User.exists({ email: input.email })) throw new AppError("An account already uses this email", 409, "EMAIL_EXISTS");
  const role = await Role.findOne({ name: input.role });
  if (!role) throw new AppError("Administrator role was not found; run the seed command", 400, "ROLE_NOT_FOUND");
  if (role.isSystem && !administratorRoles.includes(role.name as typeof administratorRoles[number])) throw new AppError("Choose an administrator or custom role", 422);
  const password = `Mb!${randomBytes(9).toString("base64url")}7a`;
  const account = await User.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(password, 12), role: role._id, isActive: true, forcePasswordChange: true, onboardingComplete: true });
  await writeAudit({ user: actor, action: "ADMINISTRATOR_CREATED", entityType: "User", entityId: account.id, newValue: { name: account.name, email: account.email, role: input.role }, ipAddress: meta.ip, userAgent: meta.userAgent });
  const safeAccount = await User.findById(account._id).select("name email role isActive forcePasswordChange lastLoginAt createdAt").populate("role", "name").lean().orFail();
  return { account: safeAccount, temporaryCredentials: { email: account.email, password } };
};

export const createRole = async (input: { name: string; description: string; baseRole: import("@mobius-ems/shared").RoleName; permissions: PermissionName[] }, actor: string) => {
  if (ROLES.includes(input.name as typeof ROLES[number])) throw new AppError("Built-in role names are reserved", 422);
  if (input.baseRole === "SUPER_ADMIN") throw new AppError("Custom roles cannot inherit Super Admin", 422);
  if (await Role.exists({ name: input.name })) throw new AppError("A role with this name already exists", 409);
  const role = await Role.create({ ...input, description: input.description || "Custom role", permissions: [...new Set(input.permissions)], isSystem: false });
  await writeAudit({ user: actor, action: "ROLE_CREATED", entityType: "Role", entityId: role.id, newValue: input });
  return role;
};

export const assignRole = async (id: string, email: string, actor: string) => {
  const role = await Role.findById(id);
  if (!role) throw new AppError("Role not found", 404);
  if (role.name === "SUPER_ADMIN") throw new AppError("Create a Super Admin through administrator creation", 422);
  const account = await User.findOne({ email, isActive: true }).populate<{ role: { name: string; _id: { toString(): string } } }>("role");
  if (!account) throw new AppError("Active account not found", 404);
  if (account.role.name === "SUPER_ADMIN") throw new AppError("Super Admin accounts are protected", 422);
  const oldValue = account.role._id.toString();
  await User.updateOne({ _id: account._id }, { $set: { role: role._id } });
  await writeAudit({ user: actor, action: "ACCOUNT_ROLE_ASSIGNED", entityType: "User", entityId: account.id, oldValue, newValue: role.id });
};
