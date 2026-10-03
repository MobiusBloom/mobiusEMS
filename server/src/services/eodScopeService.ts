import type { SessionUser, PermissionName } from "@mobius-ems/shared";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Team } from "../models/Team.js";
import { getViewerHierarchyScope } from "./hierarchyService.js";
import { AppError } from "../utils/AppError.js";
export const eodScopeLevel = (permissions: readonly PermissionName[], action: "view" | "review" | "analytics") => {
  for (const level of ["all", "department", "team", "self"] as const) {
    if (permissions.includes(`eod.${action}.${level}` as PermissionName)) return level;
  }
  throw new AppError("EOD access is not permitted", 403);
};
export const resolveEodScope = async (viewer: SessionUser, action: "view" | "review" | "analytics") => {
  const level = eodScopeLevel(viewer.permissions, action);
  if (level === "all") return { level, employeeFilter: {}, reportFilter: {}, ownId: undefined as string | undefined };
  const own = await Employee.findOne({ user: viewer.id, isActive: true });
  if (!own) throw new AppError("An active employee profile is required", 403);
  if (level === "self") return { level, ownId: own.id, employeeFilter: { _id: own._id }, reportFilter: { employee: own._id } };
  if (level === "department") {
    const departments = await Department.find({ $or: [{ _id: own.department }, { head: own._id }], isActive: true }).distinct("_id");
    const employees = await Employee.find({ department: { $in: departments } }).distinct("_id");
    return { level, ownId: own.id, employeeFilter: { department: { $in: departments } }, reportFilter: { $or: [{ "departmentSnapshot.id": { $in: departments.map(String) } }, { departmentSnapshot: { $exists: false }, employee: { $in: employees } }] } };
  }
  // Reuse the existing hierarchy without inheriting HR's organization-wide scope.
  const hierarchy = await getViewerHierarchyScope({ id: viewer.id, role: viewer.role === "TEAM_LEAD" ? "TEAM_LEAD" : "MANAGER" });
  const teams = await Team.find({ lead: own._id, isActive: true }).distinct("_id");
  const members = teams.length ? await Employee.find({ team: { $in: teams }, isActive: true }).distinct("_id") : [];
  const ids = [...new Set([...hierarchy.allowedEmployeeIds, ...members].map(String))];
  return { level, ownId: own.id, employeeFilter: { _id: { $in: ids } }, reportFilter: { employee: { $in: ids } } };
};
