import { Types } from "mongoose";
import type { RoleName } from "@mobius-ems/shared";
import { Employee } from "../models/Employee.js";
import { AppError } from "../utils/AppError.js";

export interface ViewerHierarchyScope {
  scopeType: "ALL" | "DEPARTMENT" | "SUBTREE" | "SELF";
  ownEmployeeId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  allowedEmployeeIds: Types.ObjectId[];
  subordinateEmployeeIds: Types.ObjectId[];
}

export const getRecursiveSubordinateIds = async (rootEmployeeId: Types.ObjectId): Promise<Types.ObjectId[]> => {
  const seen = new Set<string>();
  let frontier: Types.ObjectId[] = [rootEmployeeId];
  const results: Types.ObjectId[] = [];

  while (frontier.length > 0) {
    const children = (await Employee.find({
      reportingManager: { $in: frontier },
      isActive: true,
    }).distinct("_id")) as Types.ObjectId[];

    frontier = [];
    for (const childId of children) {
      const idStr = childId.toString();
      if (!seen.has(idStr) && idStr !== rootEmployeeId.toString()) {
        seen.add(idStr);
        results.push(childId);
        frontier.push(childId);
      }
    }
  }

  return results;
};

export const getViewerHierarchyScope = async (viewer: { id: string; role: RoleName }): Promise<ViewerHierarchyScope> => {
  if (viewer.role === "SUPER_ADMIN" || viewer.role === "HR_ADMIN") {
    const allEmployees = (await Employee.find({ isActive: true }).distinct("_id")) as Types.ObjectId[];
    const own = await Employee.findOne({ user: viewer.id, isActive: true }).select("_id");
    return {
      scopeType: "ALL",
      ownEmployeeId: own?._id,
      allowedEmployeeIds: allEmployees,
      subordinateEmployeeIds: own ? allEmployees.filter((id) => !id.equals(own._id)) : allEmployees,
    };
  }

  const own = await Employee.findOne({ user: viewer.id, isActive: true }).select("_id department team");

  if (!own) {
    return {
      scopeType: viewer.role === "EMPLOYEE" ? "SELF" : "SUBTREE",
      allowedEmployeeIds: [],
      subordinateEmployeeIds: [],
    };
  }

  if (viewer.role === "DEPARTMENT_HEAD") {
    const deptEmployees = (await Employee.find({
      department: own.department,
      isActive: true,
    }).distinct("_id")) as Types.ObjectId[];

    return {
      scopeType: "DEPARTMENT",
      ownEmployeeId: own._id,
      departmentId: own.department,
      allowedEmployeeIds: deptEmployees,
      subordinateEmployeeIds: deptEmployees.filter((id) => !id.equals(own._id)),
    };
  }

  if (viewer.role === "MANAGER") {
    const subordinates = await getRecursiveSubordinateIds(own._id);
    return {
      scopeType: "SUBTREE",
      ownEmployeeId: own._id,
      departmentId: own.department,
      allowedEmployeeIds: [own._id, ...subordinates],
      subordinateEmployeeIds: subordinates,
    };
  }

  if (viewer.role === "TEAM_LEAD") {
    const directConditions: Record<string, unknown>[] = [{ reportingManager: own._id }];
    if (own.team) {
      directConditions.push({ team: own.team, _id: { $ne: own._id } });
    }

    const directReports = (await Employee.find({
      $or: directConditions,
      isActive: true,
    }).distinct("_id")) as Types.ObjectId[];

    const seen = new Set<string>();
    const subordinates: Types.ObjectId[] = [];
    let frontier: Types.ObjectId[] = [];

    for (const reportId of directReports) {
      const idStr = reportId.toString();
      if (!seen.has(idStr) && idStr !== own._id.toString()) {
        seen.add(idStr);
        subordinates.push(reportId);
        frontier.push(reportId);
      }
    }

    while (frontier.length > 0) {
      const children = (await Employee.find({
        reportingManager: { $in: frontier },
        isActive: true,
      }).distinct("_id")) as Types.ObjectId[];

      frontier = [];
      for (const childId of children) {
        const idStr = childId.toString();
        if (!seen.has(idStr) && idStr !== own._id.toString()) {
          seen.add(idStr);
          subordinates.push(childId);
          frontier.push(childId);
        }
      }
    }

    return {
      scopeType: "SUBTREE",
      ownEmployeeId: own._id,
      departmentId: own.department,
      allowedEmployeeIds: [own._id, ...subordinates],
      subordinateEmployeeIds: subordinates,
    };
  }

  return {
    scopeType: "SELF",
    ownEmployeeId: own._id,
    departmentId: own.department,
    allowedEmployeeIds: [own._id],
    subordinateEmployeeIds: [],
  };
};

export const assertEmployeeInScope = (
  scope: ViewerHierarchyScope,
  targetEmployeeId: string | Types.ObjectId,
  errorMessage = "Employee is outside your permitted scope",
): void => {
  if (scope.scopeType === "ALL") return;
  const targetStr = targetEmployeeId.toString();
  const allowed = scope.allowedEmployeeIds.some((id) => id.toString() === targetStr);
  if (!allowed) {
    throw new AppError(errorMessage, 403, "FORBIDDEN");
  }
};

export const assertSubordinateInScope = (
  scope: ViewerHierarchyScope,
  targetEmployeeId: string | Types.ObjectId,
  errorMessage = "Target employee is not a subordinate in your reporting hierarchy",
): void => {
  if (scope.scopeType === "ALL") return;
  const targetStr = targetEmployeeId.toString();
  const allowed = scope.subordinateEmployeeIds.some((id) => id.toString() === targetStr);
  if (!allowed) {
    throw new AppError(errorMessage, 403, "FORBIDDEN");
  }
};

export interface SeniorityInfo {
  rank: number; // 1 (highest) to 6 (lowest)
  tierName: string;
}

export const calculateSeniorityRank = (item: {
  role?: string;
  designationTitle?: string;
  designationLevel?: string;
}): SeniorityInfo => {
  const title = (item.designationTitle || "").toLowerCase().trim();
  const userRole = (item.role || "").toUpperCase().trim();
  const levelStr = (item.designationLevel || "").toLowerCase().trim();

  // Tier 1: Chief Executive Officer / Founder / President / Managing Director
  if (
    title === "ceo" ||
    title.includes("chief executive") ||
    title.includes("managing director") ||
    title.includes("founder") ||
    (title.includes("president") && !title.includes("vice")) ||
    (userRole === "SUPER_ADMIN" && !title.includes("cto") && !title.includes("engineer"))
  ) {
    return { rank: 1, tierName: "Executive Leadership (Tier 1)" };
  }

  // Tier 2: C-Suite / VP / Department Head
  if (
    title === "cto" ||
    title === "cfo" ||
    title === "coo" ||
    title === "cmo" ||
    title === "cpo" ||
    title === "cio" ||
    title.includes("chief ") ||
    title.includes("vice president") ||
    title.startsWith("vp ") ||
    title.includes("head of") ||
    title.includes("director") ||
    userRole === "DEPARTMENT_HEAD" ||
    userRole === "HR_ADMIN" ||
    levelStr.includes("manager / head")
  ) {
    return { rank: 2, tierName: "Senior Leadership / C-Suite (Tier 2)" };
  }

  // Tier 3: Managers & Leads
  if (
    title.includes("manager") ||
    title.includes("lead") ||
    title.includes("principal") ||
    title.includes("architect") ||
    userRole === "MANAGER" ||
    userRole === "TEAM_LEAD" ||
    levelStr.includes("lead / principal")
  ) {
    return { rank: 3, tierName: "Management & Leads (Tier 3)" };
  }

  // Tier 4: Senior ICs
  if (
    title.includes("senior") ||
    title.includes("sr.") ||
    title.includes("sr ") ||
    levelStr.includes("senior")
  ) {
    return { rank: 4, tierName: "Senior Staff & Specialists (Tier 4)" };
  }

  // Tier 6: Junior / Intern / Trainee / Apprentice
  if (
    title.includes("intern") ||
    title.includes("trainee") ||
    title.includes("apprentice") ||
    levelStr.includes("entry") ||
    levelStr.includes("intern")
  ) {
    return { rank: 6, tierName: "Associate & Entry Level (Tier 6)" };
  }

  // Tier 5: Individual Contributors / Engineers / Analysts / Associates
  if (
    title.includes("engineer") ||
    title.includes("developer") ||
    title.includes("analyst") ||
    title.includes("specialist") ||
    title.includes("executive") ||
    title.includes("associate") ||
    title.includes("consultant") ||
    levelStr.includes("intermediate") ||
    levelStr.includes("basic")
  ) {
    return { rank: 5, tierName: "Individual Contributors (Tier 5)" };
  }

  // Default: Associate & Entry Level
  return { rank: 6, tierName: "Associate & Entry Level (Tier 6)" };
};

export const autoStructureTenantHierarchy = async (forceAll = false) => {
  const employees = await Employee.find({ isActive: true })
    .populate<{ designation: { name: string; level?: string } | null }>("designation", "name level")
    .populate<{ department: { _id: Types.ObjectId; name: string; code: string } | null }>("department", "name code")
    .lean();

  if (employees.length === 0) {
    return { updatedCount: 0, topExecutiveId: "", topExecutiveTitle: "", topExecutiveName: "" };
  }

  const ranked = employees.map((emp) => {
    const seniority = calculateSeniorityRank({
      designationTitle: emp.designation?.name,
      designationLevel: emp.designation?.level,
    });
    return {
      _id: emp._id as Types.ObjectId,
      firstName: emp.firstName,
      lastName: emp.lastName,
      departmentId: emp.department?._id?.toString() || "",
      departmentName: emp.department?.name || "",
      designationTitle: emp.designation?.name || "",
      currentManagerId: emp.reportingManager ? emp.reportingManager.toString() : null,
      rank: seniority.rank,
      tierName: seniority.tierName,
    };
  });

  // Sort by seniority rank ascending (1 is highest)
  ranked.sort((a, b) => a.rank - b.rank);

  const topExecutive = ranked[0];
  if (!topExecutive) {
    return { updatedCount: 0, topExecutiveId: "", topExecutiveTitle: "", topExecutiveName: "" };
  }
  const updates: { employeeId: Types.ObjectId; managerId: Types.ObjectId | null }[] = [];

  for (const emp of ranked) {
    if (String(emp._id) === String(topExecutive._id)) {
      if (emp.currentManagerId !== null) {
        updates.push({ employeeId: emp._id, managerId: null });
      }
      continue;
    }

    if (!emp.currentManagerId || forceAll) {
      if (emp.rank === 2) {
        updates.push({ employeeId: emp._id, managerId: topExecutive._id });
      } else {
        const deptSuperior = ranked.find(
          (cand) =>
            String(cand._id) !== String(emp._id) &&
            cand.departmentId === emp.departmentId &&
            cand.rank < emp.rank
        );

        if (deptSuperior) {
          updates.push({ employeeId: emp._id, managerId: deptSuperior._id });
        } else {
          const orgSuperior = ranked.find(
            (cand) => String(cand._id) !== String(emp._id) && cand.rank < emp.rank
          );
          updates.push({ employeeId: emp._id, managerId: orgSuperior ? orgSuperior._id : topExecutive._id });
        }
      }
    }
  }

  for (const upd of updates) {
    if (upd.managerId) {
      await Employee.updateOne(
        { _id: upd.employeeId },
        { $set: { reportingManager: upd.managerId } }
      );
    } else {
      await Employee.updateOne(
        { _id: upd.employeeId },
        { $unset: { reportingManager: 1 } }
      );
    }
  }

  return {
    updatedCount: updates.length,
    topExecutiveId: topExecutive._id.toString(),
    topExecutiveTitle: topExecutive.designationTitle,
    topExecutiveName: `${topExecutive.firstName} ${topExecutive.lastName}`.trim(),
  };
};

export const updateEmployeeReportingManager = async (
  employeeId: string,
  managerId: string | null
) => {
  if (managerId && employeeId === managerId) {
    throw new AppError("An employee cannot report to themselves", 400);
  }
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("Employee not found", 404);

  if (managerId) {
    const manager = await Employee.findById(managerId);
    if (!manager) throw new AppError("Reporting manager not found", 404);
    const subordinates = await getRecursiveSubordinateIds(employee._id);
    if (subordinates.some((id) => id.toString() === managerId)) {
      throw new AppError("Cannot assign a subordinate as reporting manager (circular reporting)", 400);
    }
    employee.reportingManager = new Types.ObjectId(managerId);
  } else {
    employee.reportingManager = undefined;
  }

  await employee.save();
  return employee;
};


