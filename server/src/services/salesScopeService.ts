import type { PermissionName, SessionUser } from "@mobius-ems/shared";
import { Types } from "mongoose";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { EmployeeTerritoryAssignment } from "../models/EmployeeTerritoryAssignment.js";
import { GeoNode } from "../models/GeoNode.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { AppError } from "../utils/AppError.js";

export type SalesScopeLevel = "SELF" | "TEAM" | "ALL";
export interface ResolvedSalesScope {
  level: SalesScopeLevel;
  employeeId?: string;
  allowedEmployeeIds: Types.ObjectId[];
  allowedTerritoryIds: Types.ObjectId[];
  allowedGeoIds: Types.ObjectId[];
}

const allPermissions: PermissionName[] = ["sales.view.all", "sales.analytics.all", "sales.map.all"];
const teamPermissions: PermissionName[] = ["sales.view.team", "sales.analytics.team", "sales.map.team"];
const selfPermissions: PermissionName[] = ["sales.view.self", "sales.analytics.self", "sales.map.self"];
const hasAny = (permissions: readonly PermissionName[], required: readonly PermissionName[]) => required.some((permission) => permissions.includes(permission));

export const salesScopeLevelForPermissions = (permissions: readonly PermissionName[]): SalesScopeLevel | null => {
  if (hasAny(permissions, allPermissions)) return "ALL";
  if (hasAny(permissions, teamPermissions)) return "TEAM";
  if (hasAny(permissions, selfPermissions)) return "SELF";
  return null;
};

const activeAt = (at: Date) => ({
  isActive: true,
  effectiveFrom: { $lte: at },
  $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: at } }],
});
// Lean PostgreSQL documents contain string IDs. Normalize at the scope boundary
// so analytics and territory services receive the ObjectIds promised by this type.
const uniqueIds = (ids: readonly (Types.ObjectId | string)[]): Types.ObjectId[] => [...new Map(ids.map((id) => [id.toString(), id instanceof Types.ObjectId ? id : new Types.ObjectId(id)])).values()];

const managedEmployeeIds = async (manager: Types.ObjectId): Promise<Types.ObjectId[]> => {
  const seen = new Map([[manager.toString(), manager]]);
  let frontier = [manager];
  while (frontier.length) {
    const children = await Employee.find({ reportingManager: { $in: frontier }, isActive: true }).distinct("_id");
    frontier = children.filter((id) => !seen.has(id.toString()));
    for (const id of frontier) seen.set(id.toString(), id);
  }
  return [...seen.values()];
};

const activeTerritoryIds = async (roots: Types.ObjectId[], at: Date): Promise<Types.ObjectId[]> => {
  if (!roots.length) return [];
  return SalesTerritory.find({
    $and: [
      { $or: [{ _id: { $in: roots } }, { ancestors: { $in: roots } }] },
      { status: "ACTIVE", effectiveFrom: { $lte: at } },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: at } }] },
    ],
  }).distinct("_id");
};

const geographyForTerritories = async (territoryIds: Types.ObjectId[]): Promise<Types.ObjectId[]> => {
  if (!territoryIds.length) return [];
  const territoryGeoIds = await SalesTerritory.find({ _id: { $in: territoryIds } }).distinct("coverageRules.geoNodeIds");
  if (!territoryGeoIds.length) return [];
  const roots = await GeoNode.find({ _id: { $in: territoryGeoIds }, isActive: true }).select("_id ancestors").lean();
  const pathIds = uniqueIds(roots.flatMap((node) => [node._id, ...node.ancestors]));
  const descendants = await GeoNode.find({ ancestors: { $in: territoryGeoIds }, isActive: true }).distinct("_id");
  return uniqueIds([...pathIds, ...descendants]);
};

export const resolveSalesScope = async (viewer: SessionUser, at = new Date()): Promise<ResolvedSalesScope> => {
  const level = salesScopeLevelForPermissions(viewer.permissions);
  if (!level) throw new AppError("Sales access is not permitted", 403, "FORBIDDEN");

  const salesDepartments = await Department.find({ capabilities: "SALES_MODULE", isActive: true }).distinct("_id");
  if (level === "ALL") {
    const [employees, territories, geography] = await Promise.all([
      Employee.find({ department: { $in: salesDepartments }, isActive: true }).distinct("_id"),
      SalesTerritory.find({
        status: "ACTIVE",
        effectiveFrom: { $lte: at },
        $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: at } }],
      }).distinct("_id"),
      GeoNode.find({ isActive: true }).distinct("_id"),
    ]);
    return { level, allowedEmployeeIds: uniqueIds(employees), allowedTerritoryIds: uniqueIds(territories), allowedGeoIds: uniqueIds(geography) };
  }

  const employee = await Employee.findOne({ user: viewer.id, isActive: true }).select("_id department").lean();
  if (!employee || !salesDepartments.some((id) => String(id) === String(employee.department))) {
    throw new AppError("Sales capability is not enabled for this employee", 403, "SALES_NOT_ENABLED");
  }

  const reportingScope = level === "TEAM" ? await managedEmployeeIds(employee._id) : [employee._id];
  const managerAssignments = await EmployeeTerritoryAssignment.find({
    employee: employee._id,
    ...(level === "TEAM" ? { assignmentRole: { $in: ["OWNER", "MANAGER"] } } : {}),
    ...activeAt(at),
  }).lean();
  let territories = level === "TEAM"
    ? await activeTerritoryIds(managerAssignments.map((item) => item.territory), at)
    : managerAssignments.map((item) => item.territory);

  const territoryEmployees = territories.length
    ? await EmployeeTerritoryAssignment.find({ territory: { $in: territories }, ...activeAt(at) }).distinct("employee")
    : [];
  const candidateEmployees = uniqueIds(level === "TEAM" ? [...reportingScope, ...territoryEmployees] : reportingScope);
  const employeeIds = await Employee.find({
    _id: { $in: candidateEmployees },
    department: { $in: salesDepartments },
    isActive: true,
  }).distinct("_id");
  if (!territories.length) {
    territories = await EmployeeTerritoryAssignment.find({ employee: { $in: employeeIds }, ...activeAt(at) }).distinct("territory");
  }

  const createdByUserIds = level === "SELF"
    ? [new Types.ObjectId(viewer.id)]
    : await Employee.find({ _id: { $in: employeeIds } }).distinct("user");
  const [globalGeoIds, createdGeoIds] = await Promise.all([
    GeoNode.find({ type: "GLOBAL", isActive: true }).distinct("_id"),
    GeoNode.find({ createdBy: { $in: createdByUserIds }, isActive: true }).distinct("_id"),
  ]);

  return {
    level,
    employeeId: employee._id.toString(),
    allowedEmployeeIds: uniqueIds(employeeIds),
    allowedTerritoryIds: uniqueIds(territories),
    allowedGeoIds: uniqueIds([...globalGeoIds, ...createdGeoIds, ...await geographyForTerritories(territories)]),
  };
};

const includesId = (ids: readonly Types.ObjectId[], id: string) => ids.some((candidate) => candidate.toString() === id);
export const assertSalesEmployeeScope = (scope: ResolvedSalesScope, employeeId: string): void => {
  if (!includesId(scope.allowedEmployeeIds, employeeId)) throw new AppError("Sales employee is outside your authorized scope", 403, "SALES_SCOPE_FORBIDDEN");
};
export const assertSalesTerritoryScope = (scope: ResolvedSalesScope, territoryId: string): void => {
  if (!includesId(scope.allowedTerritoryIds, territoryId)) throw new AppError("Sales territory is outside your authorized scope", 403, "SALES_SCOPE_FORBIDDEN");
};
export const assertSalesGeoScope = (scope: ResolvedSalesScope, geoId: string): void => {
  if (!includesId(scope.allowedGeoIds, geoId)) throw new AppError("Geography is outside your authorized scope", 403, "SALES_SCOPE_FORBIDDEN");
};
