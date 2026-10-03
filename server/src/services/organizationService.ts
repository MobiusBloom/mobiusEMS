import { Department } from "../models/Department.js";
import { Team } from "../models/Team.js";
import { Designation, type DesignationSkillItem } from "../models/Designation.js";
import { Employee } from "../models/Employee.js";
import { AppError } from "../utils/AppError.js";
import { roleSkillCatalog } from "../data/roleSkillCatalog.js";
import { profilePhotoUrl } from "./storageService.js";

type OrganizationReference = { _id?: { toString(): string }; name?: string; code?: string; level?: string };
type ManagerReference = { _id?: { toString(): string }; firstName?: string; lastName?: string; employeeId?: string; profilePhotoKey?: string };
type UserReference = { _id?: { toString(): string }; role?: string; toString(): string };

type DepartmentInput = { name: string; code?: string; description?: string; capabilities?: ("SALES_MODULE")[] };
type TeamInput = Omit<DepartmentInput, "capabilities"> & { department: string };
type DesignationInput = Omit<DepartmentInput, "capabilities"> & { department?: string; level?: string; catalogRole?: string; customSkills?: DesignationSkillItem[] };

const generateUniqueOrgCode = async (model: { exists(filter: Record<string, unknown>): PromiseLike<unknown> }, name: string, departmentId?: string) => {
  const base = name.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 14) || "ORG";
  let candidate = base.slice(0, 20);
  const filter: Record<string, unknown> = { isActive: true, code: candidate };
  if (departmentId) filter.department = departmentId;
  const exists = await model.exists(filter);
  if (!exists) return candidate;

  for (let i = 0; i < 5; i++) {
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    candidate = `${base.slice(0, 14)}_${suffix}`.slice(0, 20);
    filter.code = candidate;
    if (!await model.exists(filter)) return candidate;
  }
  return `${base.slice(0, 10)}_${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
};

export const listOrganization = async () => {
  const [departments, teams, designations] = await Promise.all([
    Department.find({ isActive: true }).sort("name").lean(),
    Team.find({ isActive: true }).populate("department", "name code").sort("name").lean(),
    Designation.find({ isActive: true }).populate("department", "name code").sort("name").lean(),
  ]);
  const skillCatalogRoles = [...new Set(roleSkillCatalog.map((item) => item.role))].map((role) => ({
    role,
    skillCount: roleSkillCatalog.filter((item) => item.role === role).length,
  }));
  return { departments, teams, designations, skillCatalogRoles };
};

export const createDepartment = async (input: DepartmentInput) => {
  const code = input.code || await generateUniqueOrgCode(Department, input.name);
  return Department.create({ ...input, code });
};

export const createTeam = async (input: TeamInput) => {
  if (!await Department.exists({ _id: input.department, isActive: true })) throw new AppError("Department not found", 404, "DEPARTMENT_NOT_FOUND");
  const code = input.code || await generateUniqueOrgCode(Team, input.name, input.department);
  return Team.create({ ...input, code });
};

export const createDesignation = async (input: DesignationInput) => {
  if (input.department && !await Department.exists({ _id: input.department, isActive: true })) throw new AppError("Department not found", 404, "DEPARTMENT_NOT_FOUND");
  if (input.catalogRole && !roleSkillCatalog.some((item) => item.role === input.catalogRole)) throw new AppError("Select a valid skill catalogue for this designation", 422, "INVALID_SKILL_CATALOG");
  const code = input.code || await generateUniqueOrgCode(Designation, input.name);
  return Designation.create({ ...input, code });
};

export const updateDepartment = async (id: string, input: Partial<DepartmentInput>) => {
  const item = await Department.findOneAndUpdate({ _id: id, isActive: true }, { $set: input }, { new: true, runValidators: true });
  if (!item) throw new AppError("Department not found", 404, "DEPARTMENT_NOT_FOUND");
  return item;
};

export const updateTeam = async (id: string, input: Partial<TeamInput>) => {
  if (input.department && !await Department.exists({ _id: input.department, isActive: true })) throw new AppError("Department not found", 404, "DEPARTMENT_NOT_FOUND");
  const item = await Team.findOneAndUpdate({ _id: id, isActive: true }, { $set: input }, { new: true, runValidators: true }).populate("department", "name code");
  if (!item) throw new AppError("Team not found", 404, "TEAM_NOT_FOUND");
  return item;
};

export const updateDesignation = async (id: string, input: Partial<DesignationInput>) => {
  if (input.department && !await Department.exists({ _id: input.department, isActive: true })) throw new AppError("Department not found", 404, "DEPARTMENT_NOT_FOUND");
  if (input.catalogRole && !roleSkillCatalog.some((item) => item.role === input.catalogRole)) throw new AppError("Select a valid skill catalogue for this designation", 422, "INVALID_SKILL_CATALOG");
  const item = await Designation.findOneAndUpdate({ _id: id, isActive: true }, { $set: input }, { new: true, runValidators: true }).populate("department", "name code");
  if (!item) throw new AppError("Designation not found", 404, "DESIGNATION_NOT_FOUND");
  return item;
};

export const setDesignationAssessmentSkills = async (id: string, skills: DesignationSkillItem[], catalogRole?: string) => {
  const updateData: Record<string, unknown> = { customSkills: skills };
  if (catalogRole !== undefined) updateData.catalogRole = catalogRole;
  const item = await Designation.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: updateData },
    { new: true, runValidators: true }
  ).populate("department", "name code");
  if (!item) throw new AppError("Designation not found", 404, "DESIGNATION_NOT_FOUND");
  return item;
};

import { calculateSeniorityRank } from "./hierarchyService.js";

export const getRoleCatalogSkills = (role: string) => {
  return roleSkillCatalog.filter((item) => item.role.toLowerCase() === role.toLowerCase());
};

export const getOrganizationHierarchyFlow = async () => {
  const [departments, teams, designations, rawEmployees] = await Promise.all([
    Department.find({ isActive: true }).select("name code description").sort("name").lean(),
    Team.find({ isActive: true }).populate("department", "name code").select("name code department").sort("name").lean(),
    Designation.find({ isActive: true }).populate("department", "name code").select("name code department level").sort("name").lean(),
    Employee.find({ isActive: true })
      .populate("department", "name code")
      .populate("team", "name code")
      .populate("designation", "name code level")
      .populate("reportingManager", "firstName lastName employeeId profilePhotoKey")
      .select("employeeId firstName lastName officialEmail phone profilePhotoKey department team designation reportingManager status employmentType user dateOfJoining")
      .sort("firstName")
      .lean(),
  ]);

  const mappedEmployees = rawEmployees.map((emp) => {
    const seniority = calculateSeniorityRank({
      designationTitle: (emp.designation as unknown as OrganizationReference)?.name,
      designationLevel: (emp.designation as unknown as OrganizationReference)?.level,
    });

    return {
      _id: emp._id.toString(),
      employeeId: emp.employeeId,
      firstName: emp.firstName,
      lastName: emp.lastName,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      officialEmail: emp.officialEmail,
      phone: emp.phone,
      profilePhotoUrl: profilePhotoUrl(emp.profilePhotoKey),
      department: emp.department
        ? {
            _id: (emp.department as unknown as OrganizationReference)._id?.toString() || "",
            name: (emp.department as unknown as OrganizationReference).name || "",
            code: (emp.department as unknown as OrganizationReference).code || "",
          }
        : null,
      team: emp.team
        ? {
            _id: (emp.team as unknown as OrganizationReference)._id?.toString() || "",
            name: (emp.team as unknown as OrganizationReference).name || "",
            code: (emp.team as unknown as OrganizationReference).code || "",
          }
        : null,
      designation: emp.designation
        ? {
            _id: (emp.designation as unknown as OrganizationReference)._id?.toString() || "",
            name: (emp.designation as unknown as OrganizationReference).name || "",
            code: (emp.designation as unknown as OrganizationReference).code || "",
            level: (emp.designation as unknown as OrganizationReference).level || "",
          }
        : null,
      reportingManager: emp.reportingManager
        ? {
            _id: (emp.reportingManager as unknown as ManagerReference)._id?.toString() || "",
            firstName: (emp.reportingManager as unknown as ManagerReference).firstName || "",
            lastName: (emp.reportingManager as unknown as ManagerReference).lastName || "",
            name: `${(emp.reportingManager as unknown as ManagerReference).firstName || ""} ${(emp.reportingManager as unknown as ManagerReference).lastName || ""}`.trim(),
            employeeId: (emp.reportingManager as unknown as ManagerReference).employeeId || "",
            profilePhotoUrl: profilePhotoUrl((emp.reportingManager as unknown as ManagerReference).profilePhotoKey),
          }
        : null,
      seniorityRank: seniority.rank,
      seniorityTierName: seniority.tierName,
      role: (emp.user as unknown as UserReference)?.role || "EMPLOYEE",
      userId: (emp.user as unknown as UserReference)?._id?.toString() || (emp.user as unknown as UserReference)?.toString() || "",
      status: emp.status,
      employmentType: emp.employmentType,
      dateOfJoining: emp.dateOfJoining,
    };
  });

  // Sort employees by seniority rank ascending (Rank 1 CEO is top)
  const sortedBySeniority = [...mappedEmployees].sort((a, b) => a.seniorityRank - b.seniorityRank);
  const topExecutive = sortedBySeniority[0] || null;

  let unassignedManagersCount = 0;

  // Resolve effective hierarchy: infer reporting lines if reportingManager is null in DB
  const resolvedEmployees = mappedEmployees.map((emp) => {
    if (emp.reportingManager?._id) {
      return {
        ...emp,
        effectiveReportingManager: emp.reportingManager,
        isReportingManagerInferred: false,
      };
    }

    // Top executive has no reporting manager (root of organization)
    if (topExecutive && emp._id === topExecutive._id) {
      return {
        ...emp,
        effectiveReportingManager: null,
        isReportingManagerInferred: false,
      };
    }

    unassignedManagersCount++;

    // Tier 2 (C-Suite / VP) reports directly to top executive
    if (emp.seniorityRank <= 2 && topExecutive) {
      return {
        ...emp,
        effectiveReportingManager: {
          _id: topExecutive._id,
          firstName: topExecutive.firstName,
          lastName: topExecutive.lastName,
          name: topExecutive.name,
          employeeId: topExecutive.employeeId,
          profilePhotoUrl: topExecutive.profilePhotoUrl,
        },
        isReportingManagerInferred: true,
      };
    }

    // Tier 3-6: Look for departmental superior (same department, higher seniority rank)
    const deptSuperior = sortedBySeniority.find(
      (cand) =>
        cand._id !== emp._id &&
        cand.department?._id &&
        cand.department._id === emp.department?._id &&
        cand.seniorityRank < emp.seniorityRank
    );

    if (deptSuperior) {
      return {
        ...emp,
        effectiveReportingManager: {
          _id: deptSuperior._id,
          firstName: deptSuperior.firstName,
          lastName: deptSuperior.lastName,
          name: deptSuperior.name,
          employeeId: deptSuperior.employeeId,
          profilePhotoUrl: deptSuperior.profilePhotoUrl,
        },
        isReportingManagerInferred: true,
      };
    }

    // Fallback: Highest superior across the organization or top executive
    const fallbackSuperior =
      sortedBySeniority.find((cand) => cand._id !== emp._id && cand.seniorityRank < emp.seniorityRank) ||
      topExecutive;

    return {
      ...emp,
      effectiveReportingManager:
        fallbackSuperior && fallbackSuperior._id !== emp._id
          ? {
              _id: fallbackSuperior._id,
              firstName: fallbackSuperior.firstName,
              lastName: fallbackSuperior.lastName,
              name: fallbackSuperior.name,
              employeeId: fallbackSuperior.employeeId,
              profilePhotoUrl: fallbackSuperior.profilePhotoUrl,
            }
          : null,
      isReportingManagerInferred: Boolean(fallbackSuperior && fallbackSuperior._id !== emp._id),
    };
  });

  // Calculate direct reports count for each employee based on effective hierarchy
  const directReportsCountMap = new Map<string, number>();
  for (const emp of resolvedEmployees) {
    const mgrId = emp.effectiveReportingManager?._id;
    if (mgrId) {
      directReportsCountMap.set(
        mgrId,
        (directReportsCountMap.get(mgrId) || 0) + 1
      );
    }
  }

  const enrichedEmployees = resolvedEmployees.map((emp) => ({
    ...emp,
    directReportsCount: directReportsCountMap.get(emp._id) || 0,
  }));

  // Group into industry-standard seniority tiers
  const tierDefinitions = [
    { rank: 1, tierName: "Executive Leadership (Tier 1)", badgeColor: "amber" },
    { rank: 2, tierName: "Senior Leadership / C-Suite (Tier 2)", badgeColor: "indigo" },
    { rank: 3, tierName: "Management & Leads (Tier 3)", badgeColor: "teal" },
    { rank: 4, tierName: "Senior Staff & Specialists (Tier 4)", badgeColor: "emerald" },
    { rank: 5, tierName: "Individual Contributors (Tier 5)", badgeColor: "blue" },
    { rank: 6, tierName: "Associate & Entry Level (Tier 6)", badgeColor: "slate" },
  ];

  const seniorityTiers = tierDefinitions
    .map((def) => ({
      ...def,
      employees: enrichedEmployees.filter((e) => e.seniorityRank === def.rank),
    }))
    .filter((t) => t.employees.length > 0);

  return {
    departments,
    teams,
    designations,
    employees: enrichedEmployees,
    seniorityTiers,
    stats: {
      totalEmployees: enrichedEmployees.length,
      totalDepartments: departments.length,
      totalTeams: teams.length,
      totalDesignations: designations.length,
      totalManagers: directReportsCountMap.size,
      unassignedManagersCount,
    },
  };
};


