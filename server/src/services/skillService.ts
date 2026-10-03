import { Types } from "mongoose";
import type { SPOFItem } from "@mobius-ems/shared";
import { Employee } from "../models/Employee.js"; import { EmployeeSkill, type EmployeeSkillDocument } from "../models/EmployeeSkill.js"; import { Skill } from "../models/Skill.js"; import { SkillVerification, type SkillVerificationDocument } from "../models/SkillVerification.js"; import { Designation, type DesignationSkillItem } from "../models/Designation.js"; import { AppError } from "../utils/AppError.js"; import { writeAudit } from "./auditService.js";
import { Assessment, type AssessmentDocument } from "../models/Assessment.js"; import { AssessmentResult } from "../models/AssessmentResult.js";
import { recalculateProfileCompletion } from "./profileCompletionService.js";
import { roleSkillCatalog } from "../data/roleSkillCatalog.js";
import { RoleSkillAssessment, type RoleSkillAssessmentDocument } from "../models/RoleSkillAssessment.js";
import { Task } from "../models/Task.js";
import { buildSkillEvidence } from "./skillEvidence.js";
import { recalculateAllRanks } from "./skillCredibilityService.js";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { AssessmentCandidate } from "../models/AssessmentCandidate.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
const catalogRoles: string[] = [...new Set(roleSkillCatalog.map((item) => item.role))];
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const legacyDesignationRole = (name: string, code: string) => {
  const exact = catalogRoles.find((role) => normalized(role) === normalized(name));
  if (exact) return exact;
  const combined = `${name} ${code}`.toLowerCase();
  if (combined.includes("data") && (combined.includes("analyst") || combined.includes("scientist") || combined.includes("science") || combined.includes("eng"))) return "Data Analyst";
  if (combined.includes("scientist") || combined.includes("science")) return "Data Analyst";
  if (/(software|engineer|developer|ai|ml|backend|frontend|fullstack)/.test(combined)) return "AI/ML Developer";
  if (combined.includes("field") && combined.includes("sales")) return "Field Sales Executive";
  if (combined.includes("sales")) return "SaaS Sales (AE)";
  if (combined.includes("bde")) return "BDE";
  if (combined.includes("bdm")) return "BDM";
  if (combined.includes("sdr")) return "SDR";
  if (combined.includes("executive assistant") || normalized(code) === "ea" || normalized(code) === "execa") return "Executive Assistant";
  if (combined.includes("hr")) return "HR";
  if (combined.includes("admin") || combined.includes("operation")) return "Admin";
  return undefined;
};
export const listSkills = async () => Skill.find({ isActive: true }).sort({ category: 1, name: 1 }).lean();
export const createSkill = async (input: { name: string; category: string; description?: string }) => Skill.create(input);
export const claimSkill = async (userId: string, input: { skill: string; selfRating: number; yearsOfExperience: number; lastUsed?: Date; description?: string; evidence: EmployeeSkillDocument["evidence"] }) => { const employee = await Employee.findOne({ user: userId, isActive: true }); if (!employee) throw new AppError("Employee profile not found", 404); if (!await Skill.exists({ _id: input.skill, isActive: true })) throw new AppError("Skill not found", 404); const claim = await EmployeeSkill.findOneAndUpdate({ employee: employee._id, skill: input.skill }, { $set: { ...input, verificationStatus: "PENDING", verifiedRating: undefined, latestVerification: undefined, isActive: true } }, { upsert: true, new: true, runValidators: true }).populate("skill", "name category"); await recalculateProfileCompletion(employee.id); return claim; };
export const mySkills = async (userId: string) => { const employee = await Employee.findOne({ user: userId }).select("_id designation"); if (!employee) throw new AppError("Employee profile not found", 404); const items = await EmployeeSkill.find({ employee: employee._id, isActive: true }).populate("skill", "name category").sort({ updatedAt: -1 }).lean(); return { items, gap: await roleGap(employee._id.toString(), employee.designation.toString()) }; };

type PopulatedDesignation = { _id?: unknown; name: string; code: string; catalogRole?: string; customSkills?: DesignationSkillItem[] };

export const roleCatalogAssessment = async (userId: string) => {
  const employee = await Employee.findOne({ user: userId, isActive: true })
    .select("_id designation")
    .populate<{ designation: PopulatedDesignation }>("designation", "name code catalogRole customSkills")
    .lean();
  if (!employee) throw new AppError("Employee profile not found", 404);
  if (!employee.designation) throw new AppError("No designation assigned to your profile. Please contact your administrator.", 422, "NO_DESIGNATION_ASSIGNED");

  const assessment = await RoleSkillAssessment.findOne({ employee: employee._id }).lean();
  let catalogItems: (DesignationSkillItem & { role?: string })[] = [];
  let assignedRole = employee.designation.name;

  if (employee.designation.customSkills && employee.designation.customSkills.length > 0) {
    catalogItems = employee.designation.customSkills.map((skill: DesignationSkillItem & { toObject?: () => DesignationSkillItem }) => ({
      ...(typeof skill.toObject === "function" ? skill.toObject() : skill),
      role: employee.designation.name,
    }));
    assignedRole = employee.designation.catalogRole || employee.designation.name;
  } else {
    const role = employee.designation.catalogRole ?? legacyDesignationRole(employee.designation.name, employee.designation.code);
    if (role && catalogRoles.includes(role)) {
      catalogItems = roleSkillCatalog.filter((item) => item.role === role);
      assignedRole = role;
      if (!employee.designation.catalogRole && employee.designation._id) {
        await Designation.updateOne({ _id: employee.designation._id }, { $set: { catalogRole: role } });
      }
    }
  }

  const taskEvidence = assessment ? await Task.find({ assignedEmployee: employee._id, isActive: true }).select("taskId name description completionNote skillId skillName status estimatedHours actualHours deadline completionDate qualityRating reopenCount").sort({ updatedAt: -1 }).lean() : [];
  const assessmentWithEvidence = assessment ? { ...assessment, evidenceAnalytics: assessment.scores.map((score) => ({ skillId: score.skillId, ...buildSkillEvidence(score, taskEvidence) })) } : null;
  return {
    catalog: assessment ? [] : catalogItems,
    assessment: assessmentWithEvidence,
    designation: employee.designation,
    assignedRole,
    pendingConfiguration: catalogItems.length === 0 && !assessment
  };
};

export const submitRoleCatalogAssessment = async (userId: string, input: { ratings: { skillId: string; rating: number; implementationNote: string }[] }, meta: { ip?: string; userAgent?: string }) => {
  const employee = await Employee.findOne({ user: userId, isActive: true })
    .select("_id designation")
    .populate<{ designation: PopulatedDesignation }>("designation", "name code catalogRole customSkills")
    .lean();
  if (!employee) throw new AppError("Employee profile not found", 404);
  if (!employee.designation) throw new AppError("No designation assigned to your profile.", 422);
  if (await RoleSkillAssessment.exists({ employee: employee._id })) throw new AppError("This one-time skill assessment has already been submitted and cannot be edited", 409, "ASSESSMENT_LOCKED");

  let expected: (DesignationSkillItem & { role?: string })[] = [];
  let roleName = employee.designation.name;

  if (employee.designation.customSkills && employee.designation.customSkills.length > 0) {
    expected = employee.designation.customSkills.map((skill: DesignationSkillItem & { toObject?: () => DesignationSkillItem }) => ({
      ...(typeof skill.toObject === "function" ? skill.toObject() : skill),
      role: employee.designation.name,
    }));
    roleName = employee.designation.catalogRole || employee.designation.name;
  } else {
    const role = employee.designation.catalogRole ?? legacyDesignationRole(employee.designation.name, employee.designation.code);
    if (!role || !catalogRoles.includes(role)) {
      throw new AppError(`No skill assessment is configured for designation ${employee.designation.name}. Ask administrator to configure it.`, 422, "DESIGNATION_SKILL_CATALOG_MISSING");
    }
    expected = roleSkillCatalog.filter((item) => item.role === role);
    roleName = role;
    if (!employee.designation.catalogRole && employee.designation._id) {
      await Designation.updateOne({ _id: employee.designation._id }, { $set: { catalogRole: role } });
    }
  }

  if (expected.length === 0) {
    throw new AppError(`No skills are configured for designation ${employee.designation.name}. Ask administrator to configure it.`, 422, "NO_SKILLS_CONFIGURED");
  }

  const ratingMap = new Map(input.ratings.map((item) => [item.skillId, item]));

  const scores = expected.map((item) => {
    const response = ratingMap.get(item.id);
    return {
      skillId: item.id,
      level: item.level,
      category: item.category,
      name: item.name,
      tools: item.tools ?? "",
      description: item.description,
      assessmentQuestion: item.assessmentQuestion,
      rating: response ? response.rating : 5,
      implementationNote: response?.implementationNote?.trim() || "Baseline self-assessment"
    };
  });

  const averageRating = Math.round(scores.reduce((sum, item) => sum + item.rating, 0) / scores.length * 10) / 10;
  const assessment = await RoleSkillAssessment.create({ employee: employee._id, role: roleName, designation: employee.designation.name, scores, averageRating, submittedAt: new Date() });
  await recalculateAllRanks();
  await writeAudit({ user: userId, action: "ROLE_SKILL_ASSESSMENT_SUBMITTED", entityType: "RoleSkillAssessment", entityId: assessment.id, newValue: { role: roleName, skillCount: scores.length, averageRating }, ipAddress: meta.ip, userAgent: meta.userAgent });
  return assessment;
};

export const roleCatalogAssessmentByEmployee = async (employeeId: string) => {
  const employee = await Employee.findOne({ _id: employeeId, isActive: true })
    .select("_id user designation firstName lastName employeeId department")
    .populate<{ designation: PopulatedDesignation }>("designation", "name code catalogRole customSkills")
    .populate("department", "name code")
    .lean();
  if (!employee) throw new AppError("Employee profile not found", 404);
  if (!employee.designation) throw new AppError("No designation assigned to this employee.", 422, "NO_DESIGNATION_ASSIGNED");

  let assessment = await RoleSkillAssessment.findOne({ employee: employee._id }).lean();
  if (!assessment && employee.user) {
    assessment = await RoleSkillAssessment.findOne({ employee: employee.user }).lean();
  }

  const [employeeSkills, completedAssessments] = await Promise.all([
    EmployeeSkill.find({
      $or: [{ employee: employee._id }, ...(employee.user ? [{ employee: employee.user }] : [])],
      isActive: true
    }).populate<{ skill: { name: string; category: string } | null }>("skill", "name category").lean(),
    Assessment.find({
      assignedEmployee: employee._id,
      status: "COMPLETED"
    }).lean()
  ]);

  let catalogItems: (DesignationSkillItem & { role?: string })[] = [];
  let assignedRole = employee.designation.name;

  if (employee.designation.customSkills && employee.designation.customSkills.length > 0) {
    catalogItems = employee.designation.customSkills.map((skill: DesignationSkillItem & { toObject?: () => DesignationSkillItem }) => ({
      ...(typeof skill.toObject === "function" ? skill.toObject() : skill),
      role: employee.designation.name,
    }));
    assignedRole = employee.designation.catalogRole || employee.designation.name;
  } else {
    const role = employee.designation.catalogRole ?? legacyDesignationRole(employee.designation.name, employee.designation.code);
    if (role && catalogRoles.includes(role)) {
      catalogItems = roleSkillCatalog.filter((item) => item.role === role);
      assignedRole = role;
      if (!employee.designation.catalogRole && employee.designation._id) {
        await Designation.updateOne({ _id: employee.designation._id }, { $set: { catalogRole: role } });
      }
    }
  }

  const submittedSkills = employeeSkills.map((es) => ({
    skillId: String(es._id),
    name: es.skill?.name || "Capability Skill",
    category: es.skill?.category || "General",
    selfRating: es.selfRating,
    verifiedRating: es.verifiedRating,
    yearsOfExperience: es.yearsOfExperience,
    verificationStatus: es.verificationStatus,
    description: es.description || "",
    evidence: es.evidence || []
  }));

  let synthesizedAssessment: (RoleSkillAssessmentDocument & { _id: Types.ObjectId | string }) | null = assessment;
  if (!synthesizedAssessment && employeeSkills.length > 0 && catalogItems.length > 0) {
    const norm = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
    const empAvg = Math.round((employeeSkills.reduce((sum, s) => sum + s.selfRating, 0) / employeeSkills.length) * 10) / 10;
    
    const mappedScores = catalogItems.map((catSkill) => {
      const catNorm = norm(catSkill.name);
      const matched = employeeSkills.find((es) => {
        const esNorm = norm(es.skill?.name || "");
        return esNorm === catNorm || catNorm.includes(esNorm) || esNorm.includes(catNorm);
      });

      return {
        skillId: catSkill.id,
        name: catSkill.name,
        description: catSkill.description,
        category: catSkill.category,
        level: catSkill.level,
        rating: matched ? matched.selfRating : empAvg,
        demonstratedRating: matched?.verifiedRating ?? (matched ? matched.selfRating : empAvg),
        implementationNote: matched?.description || (matched?.evidence?.[0]?.url ? `Evidence URL: ${matched.evidence[0].url}` : "") || `Matched from employee capability profile (${empAvg}/10)`
      };
    });

    synthesizedAssessment = {
      _id: "synthesized-" + String(employee._id),
      employee: employee._id,
      role: assignedRole,
      designation: employee.designation.name,
      scores: mappedScores,
      averageRating: empAvg,
      demonstratedAverage: empAvg,
      overallCredibilityScore: 100,
      submittedAt: employeeSkills[0]?.updatedAt || new Date()
    };
  }

  const taskEvidence = synthesizedAssessment ? await Task.find({ assignedEmployee: employee._id, isActive: true }).select("taskId name description completionNote skillId skillName status estimatedHours actualHours deadline completionDate qualityRating reopenCount").sort({ updatedAt: -1 }).lean() : [];
  const assessmentWithEvidence = synthesizedAssessment ? { ...synthesizedAssessment, evidenceAnalytics: synthesizedAssessment.scores.map((score) => ({ skillId: score.skillId, ...buildSkillEvidence(score, taskEvidence) })) } : null;

  const submissionSource = assessment
    ? "ROLE_ASSESSMENT"
    : employeeSkills.length > 0
    ? "SKILL_CLAIMS"
    : completedAssessments.length > 0
    ? "ASSESSMENT_TEST"
    : null;

  return {
    catalog: catalogItems,
    assessment: assessmentWithEvidence,
    submittedSkills,
    submissionSource,
    employee: {
      _id: String(employee._id),
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeId: employee.employeeId,
      department: employee.department,
      designation: employee.designation,
    },
    designation: employee.designation,
    assignedRole,
    pendingConfiguration: catalogItems.length === 0 && !assessment
  };
};

export const submitRoleCatalogAssessmentByEmployee = async (
  employeeId: string,
  input: { ratings: { skillId: string; rating: number; implementationNote?: string }[] },
  actorId: string,
  meta: { ip?: string; userAgent?: string }
) => {
  const employee = await Employee.findOne({ _id: employeeId, isActive: true })
    .select("_id designation firstName lastName")
    .populate<{ designation: PopulatedDesignation }>("designation", "name code catalogRole customSkills")
    .lean();
  if (!employee) throw new AppError("Employee profile not found", 404);
  if (!employee.designation) throw new AppError("No designation assigned to this employee.", 422);

  let expected: (DesignationSkillItem & { role?: string })[] = [];
  let roleName = employee.designation.name;

  if (employee.designation.customSkills && employee.designation.customSkills.length > 0) {
    expected = employee.designation.customSkills.map((skill: DesignationSkillItem & { toObject?: () => DesignationSkillItem }) => ({
      ...(typeof skill.toObject === "function" ? skill.toObject() : skill),
      role: employee.designation.name,
    }));
    roleName = employee.designation.catalogRole || employee.designation.name;
  } else {
    const role = employee.designation.catalogRole ?? legacyDesignationRole(employee.designation.name, employee.designation.code);
    if (!role || !catalogRoles.includes(role)) {
      throw new AppError(`No skill assessment is configured for designation ${employee.designation.name}.`, 422, "DESIGNATION_SKILL_CATALOG_MISSING");
    }
    expected = roleSkillCatalog.filter((item) => item.role === role);
    roleName = role;
    if (!employee.designation.catalogRole && employee.designation._id) {
      await Designation.updateOne({ _id: employee.designation._id }, { $set: { catalogRole: role } });
    }
  }

  if (expected.length === 0) {
    throw new AppError(`No skills are configured for designation ${employee.designation.name}.`, 422, "NO_SKILLS_CONFIGURED");
  }

  const ratingMap = new Map(input.ratings.map((item) => [item.skillId, item]));

  const scores = expected.map((item) => {
    const response = ratingMap.get(item.id);
    return {
      skillId: item.id,
      level: item.level,
      category: item.category,
      name: item.name,
      tools: item.tools ?? "",
      description: item.description,
      assessmentQuestion: item.assessmentQuestion,
      rating: response ? response.rating : 5,
      implementationNote: response?.implementationNote?.trim() || "Calibrated via Super Admin skill manager."
    };
  });

  const averageRating = Math.round(scores.reduce((sum, item) => sum + item.rating, 0) / scores.length * 10) / 10;

  const assessment = await RoleSkillAssessment.findOneAndUpdate(
    { employee: employee._id },
    {
      $set: {
        role: roleName,
        designation: employee.designation.name,
        scores,
        averageRating,
        demonstratedAverage: averageRating,
        overallCredibilityScore: 100,
        submittedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await recalculateAllRanks();
  await writeAudit({
    user: actorId as never,
    action: "ROLE_SKILL_ASSESSMENT_SUBMITTED",
    entityType: "RoleSkillAssessment",
    entityId: assessment.id,
    newValue: { employeeId, role: roleName, skillCount: scores.length, averageRating, submittedByAdmin: true },
    ipAddress: meta.ip,
    userAgent: meta.userAgent
  });

  return assessment;
};

export const listRoleSkillSubmissions = async () => {
  const employees = await Employee.find({ isActive: true })
    .select("_id user firstName lastName employeeId department designation profilePhotoKey")
    .populate("department", "name code")
    .populate("designation", "name code catalogRole customSkills")
    .sort({ lastName: 1, firstName: 1 })
    .lean();

  const [assessments, allEmployeeSkills, completedAssessments] = await Promise.all([
    RoleSkillAssessment.find({}).populate("employee", "user employeeId firstName lastName").lean(),
    EmployeeSkill.find({ isActive: true }).populate<{ skill: { name: string; category: string } | null }>("skill", "name category").lean(),
    Assessment.find({ status: "COMPLETED" }).lean()
  ]);

  // Index assessments by multiple keys: String(employee._id), String(employee.user), id:employeeId
  const assessmentMap = new Map<string, typeof assessments[0]>();
  for (const a of assessments) {
    const empObj = a.employee as unknown as { _id?: Types.ObjectId; user?: Types.ObjectId; employeeId?: string };
    if (empObj && typeof empObj === "object" && empObj._id) {
      assessmentMap.set(String(empObj._id), a);
      if (empObj.user) assessmentMap.set(String(empObj.user), a);
      if (empObj.employeeId) assessmentMap.set(`id:${empObj.employeeId}`, a);
    } else if (a.employee) {
      assessmentMap.set(String(a.employee), a);
    }
  }

  // Index employeeSkills by employee ID and user ID
  const employeeSkillsMap = new Map<string, typeof allEmployeeSkills>();
  for (const es of allEmployeeSkills) {
    const key = String(es.employee);
    const list = employeeSkillsMap.get(key) || [];
    list.push(es);
    employeeSkillsMap.set(key, list);
  }

  // Index completed tests by assignedEmployee
  const completedTestsMap = new Map<string, typeof completedAssessments>();
  for (const ca of completedAssessments) {
    if (ca.assignedEmployee) {
      const key = String(ca.assignedEmployee);
      const list = completedTestsMap.get(key) || [];
      list.push(ca);
      completedTestsMap.set(key, list);
    }
  }

  const items = employees.map((emp) => {
    // 1. Check formal RoleSkillAssessment
    const assessment = assessmentMap.get(String(emp._id))
      || (emp.user ? assessmentMap.get(String(emp.user)) : undefined)
      || (emp.employeeId ? assessmentMap.get(`id:${emp.employeeId}`) : undefined);

    // 2. Check EmployeeSkill claims
    const empSkills = employeeSkillsMap.get(String(emp._id))
      || (emp.user ? employeeSkillsMap.get(String(emp.user)) : undefined)
      || [];

    // 3. Check completed test assessments
    const empTests = completedTestsMap.get(String(emp._id))
      || (emp.user ? completedTestsMap.get(String(emp.user)) : undefined)
      || [];

    if (assessment) {
      const scores = assessment.scores || [];
      const realityGapsCount = scores.filter((s) => s.credibilityStatus === "GAP_DETECTED").length;
      const masteryCount = scores.filter((s) => s.credibilityStatus === "EXCEEDED").length;
      const velocities = scores.filter((s) => s.velocityRatio !== undefined && s.velocityRatio > 0).map((s) => s.velocityRatio!);
      const avgVelocity = velocities.length > 0
        ? Number((velocities.reduce((sum, v) => sum + v, 0) / velocities.length).toFixed(2))
        : undefined;

      return {
        employee: {
          _id: String(emp._id),
          firstName: emp.firstName,
          lastName: emp.lastName,
          employeeId: emp.employeeId,
          department: emp.department as unknown as { _id: string; name: string; code: string } | undefined,
          designation: emp.designation as unknown as { _id: string; name: string; code: string } | undefined,
          profilePhotoKey: emp.profilePhotoKey,
        },
        isSubmitted: true,
        submissionType: "ROLE_ASSESSMENT" as const,
        assessmentId: assessment._id ? String(assessment._id) : undefined,
        claimedAverage: assessment.averageRating ?? null,
        demonstratedAverage: assessment.demonstratedAverage ?? assessment.averageRating ?? null,
        overallCredibilityScore: assessment.overallCredibilityScore ?? 100,
        companyRank: assessment.companyRank ?? null,
        departmentRank: assessment.departmentRank ?? null,
        submittedAt: assessment.submittedAt ?? null,
        skillsCount: scores.length,
        realityGapsCount,
        masteryCount,
        averageVelocity: avgVelocity,
        scores: scores.map((s) => ({
          skillId: s.skillId,
          name: s.name,
          category: s.category,
          level: s.level,
          rating: s.rating,
          demonstratedRating: s.demonstratedRating,
          velocityRatio: s.velocityRatio,
          credibilityStatus: s.credibilityStatus,
          tasksEvaluatedCount: s.tasksEvaluatedCount,
          implementationNote: s.implementationNote
        }))
      };
    }

    if (empSkills.length > 0) {
      const claimedAvg = Math.round((empSkills.reduce((sum, s) => sum + s.selfRating, 0) / empSkills.length) * 10) / 10;
      const verifiedList = empSkills.filter((s) => s.verifiedRating !== undefined);
      const verifiedAvg = verifiedList.length > 0
        ? Math.round((verifiedList.reduce((sum, s) => sum + (s.verifiedRating ?? s.selfRating), 0) / verifiedList.length) * 10) / 10
        : claimedAvg;
      const latestUpdate = empSkills.reduce((max, s) => {
        const d = s.updatedAt || s.createdAt || new Date();
        return d > max ? d : max;
      }, new Date(0));

      const scores = empSkills.map((s) => ({
        skillId: String(s._id),
        name: s.skill?.name || "Capability Skill",
        category: s.skill?.category || "General",
        level: s.yearsOfExperience >= 5 ? "Advanced" : s.yearsOfExperience >= 2 ? "Intermediate" : "Basic",
        rating: s.selfRating,
        demonstratedRating: s.verifiedRating ?? s.selfRating,
        velocityRatio: 1.0,
        credibilityStatus: (s.verificationStatus === "VERIFIED" || s.verificationStatus === "EXPERT_VERIFIED" ? "JUSTIFIED" : "UNTESTED") as "JUSTIFIED" | "UNTESTED",
        tasksEvaluatedCount: 0,
        implementationNote: s.description || (s.evidence?.[0]?.url ? `Evidence URL: ${s.evidence[0].url}` : "") || "Submitted via Capability Profile"
      }));

      return {
        employee: {
          _id: String(emp._id),
          firstName: emp.firstName,
          lastName: emp.lastName,
          employeeId: emp.employeeId,
          department: emp.department as unknown as { _id: string; name: string; code: string } | undefined,
          designation: emp.designation as unknown as { _id: string; name: string; code: string } | undefined,
          profilePhotoKey: emp.profilePhotoKey,
        },
        isSubmitted: true,
        submissionType: "SKILL_CLAIMS" as const,
        assessmentId: undefined,
        claimedAverage: claimedAvg,
        demonstratedAverage: verifiedAvg,
        overallCredibilityScore: 100,
        companyRank: null,
        departmentRank: null,
        submittedAt: latestUpdate.getTime() > 0 ? latestUpdate : new Date(),
        skillsCount: empSkills.length,
        realityGapsCount: 0,
        masteryCount: empSkills.filter((s) => s.verificationStatus === "EXPERT_VERIFIED").length,
        averageVelocity: 1.0,
        scores
      };
    }

    if (empTests.length > 0) {
      const avgScore = empTests.reduce((sum, t) => sum + (t.percentage ?? (t.score ? (t.score / (t.maximumScore || 100)) * 100 : 70)), 0) / empTests.length;
      const claimedAvg = Math.round((avgScore / 10) * 10) / 10;
      const latestDate = empTests.reduce((max, t) => {
        const d = t.completedAt || t.attemptDate || new Date();
        return d > max ? d : max;
      }, new Date(0));

      return {
        employee: {
          _id: String(emp._id),
          firstName: emp.firstName,
          lastName: emp.lastName,
          employeeId: emp.employeeId,
          department: emp.department as unknown as { _id: string; name: string; code: string } | undefined,
          designation: emp.designation as unknown as { _id: string; name: string; code: string } | undefined,
          profilePhotoKey: emp.profilePhotoKey,
        },
        isSubmitted: true,
        submissionType: "ASSESSMENT_TEST" as const,
        assessmentId: undefined,
        claimedAverage: claimedAvg,
        demonstratedAverage: claimedAvg,
        overallCredibilityScore: 100,
        companyRank: null,
        departmentRank: null,
        submittedAt: latestDate.getTime() > 0 ? latestDate : new Date(),
        skillsCount: empTests.length,
        realityGapsCount: 0,
        masteryCount: empTests.filter((t) => (t.percentage ?? 0) >= 85).length,
        averageVelocity: 1.0,
        scores: empTests.map((t) => ({
          skillId: String(t._id),
          name: t.name || t.skillName || "Assessment Test",
          category: "Online Test",
          level: (t.difficulty === "ADVANCED" || t.difficulty === "EXPERT" ? "Advanced" : t.difficulty === "INTERMEDIATE" ? "Intermediate" : "Basic") as string,
          rating: Math.round(((t.percentage ?? 70) / 10) * 10) / 10,
          demonstratedRating: Math.round(((t.percentage ?? 70) / 10) * 10) / 10,
          velocityRatio: 1.0,
          credibilityStatus: "JUSTIFIED" as const,
          tasksEvaluatedCount: 1,
          implementationNote: `Completed test with score ${t.score ?? 0}/${t.maximumScore ?? 100} (${t.percentage ?? 0}%)`
        }))
      };
    }

    return {
      employee: {
        _id: String(emp._id),
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeId: emp.employeeId,
        department: emp.department as unknown as { _id: string; name: string; code: string } | undefined,
        designation: emp.designation as unknown as { _id: string; name: string; code: string } | undefined,
        profilePhotoKey: emp.profilePhotoKey,
      },
      isSubmitted: false,
      submissionType: undefined,
      assessmentId: undefined,
      claimedAverage: null,
      demonstratedAverage: null,
      overallCredibilityScore: null,
      companyRank: null,
      departmentRank: null,
      submittedAt: null,
      skillsCount: 0,
      realityGapsCount: 0,
      masteryCount: 0,
      averageVelocity: undefined,
      scores: []
    };
  });

  const submittedCount = items.filter((i) => i.isSubmitted).length;
  const pendingCount = items.length - submittedCount;
  const totalRealityGaps = items.reduce((sum, i) => sum + i.realityGapsCount, 0);
  const totalMastery = items.reduce((sum, i) => sum + i.masteryCount, 0);
  const submittedItems = items.filter((i) => i.overallCredibilityScore !== null);
  const averageCredibility = submittedItems.length > 0
    ? Math.round(submittedItems.reduce((sum, i) => sum + (i.overallCredibilityScore ?? 100), 0) / submittedItems.length)
    : 100;

  return {
    items,
    stats: {
      totalEmployees: items.length,
      submittedCount,
      pendingCount,
      totalRealityGaps,
      totalMastery,
      averageCredibility
    }
  };
};

export const pendingVerifications = async () => EmployeeSkill.find({ verificationStatus: { $in: ["PENDING","REVIEW_REQUIRED"] }, isActive: true }).populate("skill", "name category").populate("employee", "firstName lastName employeeId department").sort({ updatedAt: 1 }).lean();
export const verify = async (employeeSkillId: string, verifierUserId: string, input: { status: SkillVerificationDocument["status"]; verifiedRating?: number; method: SkillVerificationDocument["method"]; justification: string; nextReviewDate?: Date }, meta: { ip?: string; userAgent?: string }) => { const claim = await EmployeeSkill.findById(employeeSkillId); if (!claim) throw new AppError("Skill claim not found", 404); const employee = await Employee.findById(claim.employee); if (!employee) throw new AppError("Employee not found", 404); if (employee.user.toString() === verifierUserId) throw new AppError("Employees cannot verify their own skills", 403, "SELF_VERIFICATION_FORBIDDEN"); const record = await SkillVerification.create({ employeeSkill: claim._id, employee: claim.employee, skill: claim.skill, selfRating: claim.selfRating, verifiedBy: verifierUserId, verificationDate: new Date(), ...input }); const oldValue = { status: claim.verificationStatus, rating: claim.verifiedRating }; claim.verificationStatus = input.status; claim.verifiedRating = ["VERIFIED","EXPERT_VERIFIED"].includes(input.status) ? input.verifiedRating : undefined; claim.latestVerification = record._id; await claim.save(); await writeAudit({ user: verifierUserId, action: "SKILL_VERIFICATION_CHANGED", entityType: "EmployeeSkill", entityId: claim.id, oldValue, newValue: { status: input.status, rating: input.verifiedRating, method: input.method }, ipAddress: meta.ip, userAgent: meta.userAgent }); return claim.populate(["skill", "employee"]); };
export const setDesignationSkills = async (id: string, requiredSkills: { skill: string; minimumRating: number; isCritical: boolean }[]) => { const designation = await Designation.findByIdAndUpdate(id, { $set: { requiredSkills } }, { new: true, runValidators: true }).populate("requiredSkills.skill", "name category"); if (!designation) throw new AppError("Designation not found", 404); return designation; };
export const roleGap = async (employeeId: string, designationId: string) => { const designation = await Designation.findById(designationId).populate<{ requiredSkills: { skill: { _id: { toString(): string }; name: string }; minimumRating: number; isCritical: boolean }[] }>("requiredSkills.skill", "name").lean(); if (!designation) return { roleMatch: 0, items: [] }; const claims = await EmployeeSkill.find({ employee: employeeId, verificationStatus: { $in: ["VERIFIED","EXPERT_VERIFIED"] }, isActive: true }).lean(); const ratings = new Map(claims.map((claim) => [claim.skill.toString(), claim.verifiedRating ?? 0])); const items = designation.requiredSkills.map((requirement) => { const actual = ratings.get(requirement.skill._id.toString()) ?? 0; return { skill: requirement.skill.name, required: requirement.minimumRating, actual, gap: actual - requirement.minimumRating, isCritical: requirement.isCritical }; }); const possible = items.reduce((sum, item) => sum + item.required, 0); const achieved = items.reduce((sum, item) => sum + Math.min(item.actual, item.required), 0); return { roleMatch: possible ? Math.round(achieved / possible * 100) : 100, items }; };
export const heatmap = async () => {
  const activeEmployeeIds = await Employee.distinct("_id", { isActive: true });
  return EmployeeSkill.find({ employee: { $in: activeEmployeeIds }, verificationStatus: { $in: ["VERIFIED","EXPERT_VERIFIED"] }, isActive: true }).populate("employee", "firstName lastName employeeId department team").populate("skill", "name category").select("employee skill verifiedRating verificationStatus").lean();
};
export interface AssignAssessmentInput {
  name: string;
  skill?: string;
  skillName?: string;
  jobDescription?: string;
  difficulty: AssessmentDocument["difficulty"];
  maximumScore?: number;
  passingScore?: number;
  timeLimitMinutes?: number;
  assignedEmployee?: string;
  assignedEmployees?: string[];
  assignedCandidates?: string[];
  questions?: AssessmentDocument["questions"];
}

export const assignAssessment = async (input: AssignAssessmentInput, assignedBy: string) => {
  const employeeIds = input.assignedEmployees && input.assignedEmployees.length > 0
    ? input.assignedEmployees
    : input.assignedEmployee ? [input.assignedEmployee] : [];

  const candidateIds = input.assignedCandidates ?? [];
  if (employeeIds.length === 0 && candidateIds.length === 0) {
    throw new AppError("At least one employee or applicant must be selected for assignment", 400);
  }

  if (input.skill && !await Skill.exists({ _id: input.skill, isActive: true })) {
    throw new AppError("Skill not found", 404);
  }

  const questions = (input.questions || []).map((q, idx) => ({
    id: q.id || `q-${Date.now()}-${idx + 1}`,
    question: q.question,
    type: q.type || "MCQ",
    options: q.options || [],
    correctOptionIndex: typeof q.correctOptionIndex === "number" ? q.correctOptionIndex : 0,
    explanation: q.explanation || "",
    points: q.points || 10
  }));

  const calcMaxScore = questions.length > 0
    ? questions.reduce((sum, q) => sum + (q.points || 10), 0)
    : (input.maximumScore || 100);

  const passingScore = typeof input.passingScore === "number"
    ? input.passingScore
    : 70;

  const timeLimitMinutes = Number(input.timeLimitMinutes) || 30;

  const createFor = async (assignment: { employee?: string; candidate?: string }) => Assessment.create({
    name: input.name, skill: input.skill || undefined, skillName: input.skillName || undefined,
    jobDescription: input.jobDescription || undefined, difficulty: input.difficulty || "INTERMEDIATE",
    maximumScore: calcMaxScore, passingScore, timeLimitMinutes, assignedEmployee: assignment.employee,
    assignedCandidate: assignment.candidate, assignedBy, status: "PENDING", questions, result: "PENDING"
  });
  const employeeDocs = await Promise.all(employeeIds.map(async (empId) => {
      const exists = await Employee.exists({ _id: empId, isActive: true });
      if (!exists) throw new AppError(`Employee ${empId} not found`, 404);
      return createFor({ employee: empId });
    }));
  const candidateDocs = await Promise.all(candidateIds.map(async (candidateId) => {
    if (!await AssessmentCandidate.exists({ _id: candidateId, isActive: true })) throw new AppError(`Applicant ${candidateId} not found`, 404);
    return createFor({ candidate: candidateId });
  }));
  const createdDocs = [...employeeDocs, ...candidateDocs];

  return createdDocs.length === 1 ? createdDocs[0] : createdDocs;
};

export const listAssessments = async (viewer: { id: string; role: string }) => {
  const filter: Record<string, unknown> = {};
  const isEmployee = viewer.role === "EMPLOYEE";
  const isApplicant = viewer.role === "APPLICANT";

  if (isEmployee) {
    const employee = await Employee.findOne({ user: viewer.id }).select("_id");
    filter.assignedEmployee = employee?._id;
  }
  if (isApplicant) filter.assignedCandidate = (await AssessmentCandidate.findOne({ user: viewer.id, isActive: true }).select("_id"))?._id;

  const items = await Assessment.find(filter)
    .populate("skill", "name category")
    .populate({
      path: "assignedEmployee",
      select: "firstName lastName employeeId department designation",
      populate: [
        { path: "department", select: "name" },
        { path: "designation", select: "name" }
      ]
    })
    .populate("assignedCandidate", "name email position user")
    .sort({ createdAt: -1 })
    .lean();

  return items.map((item) => {
    const isCompleted = item.status === "COMPLETED";
    if ((isEmployee || isApplicant) && !isCompleted && item.questions) {
      return {
        ...item,
        questions: item.questions.map((q) => ({
          id: q.id,
          question: q.question,
          type: q.type,
          options: q.options,
          points: q.points
        }))
      };
    }
    return item;
  });
};

export const getAssessmentById = async (id: string, viewer: { id: string; role: string }) => {
  const assessment = await Assessment.findById(id)
    .populate("skill", "name category")
    .populate({
      path: "assignedEmployee",
      select: "firstName lastName employeeId department designation user",
      populate: [
        { path: "department", select: "name" },
        { path: "designation", select: "name" }
      ]
    })
    .populate("assignedCandidate", "name email position user")
    .lean();

  if (!assessment) throw new AppError("Assessment not found", 404);

  const assignedEmp = assessment.assignedEmployee as unknown as { user?: Types.ObjectId } | null;
  const assignedCandidate = assessment.assignedCandidate as unknown as { user?: Types.ObjectId } | null;
  const isOwner = assignedEmp?.user?.toString() === viewer.id || assignedCandidate?.user?.toString() === viewer.id;

  if (["EMPLOYEE", "APPLICANT"].includes(viewer.role) && !isOwner) {
    throw new AppError("Access denied to this assessment", 403);
  }

  if (["EMPLOYEE", "APPLICANT"].includes(viewer.role) && assessment.status !== "COMPLETED" && assessment.questions) {
    return {
      ...assessment,
      questions: assessment.questions.map((q) => ({
        id: q.id,
        question: q.question,
        type: q.type,
        options: q.options,
        points: q.points
      }))
    };
  }

  return assessment;
};

export const startAssessment = async (id: string, viewer: { id: string; role: string }) => {
  const assessment = await Assessment.findById(id).populate("assignedEmployee", "user").populate("assignedCandidate", "user");
  if (!assessment) throw new AppError("Assessment not found", 404);

  const assignedEmp = assessment.assignedEmployee as unknown as { user?: Types.ObjectId } | null;
  const assignedCandidate = assessment.assignedCandidate as unknown as { user?: Types.ObjectId } | null;
  if (["EMPLOYEE", "APPLICANT"].includes(viewer.role) && assignedEmp?.user?.toString() !== viewer.id && assignedCandidate?.user?.toString() !== viewer.id) {
    throw new AppError("Access denied to this assessment", 403);
  }

  if (assessment.status === "COMPLETED") {
    throw new AppError("This assessment has already been completed.", 400);
  }

  if (assessment.status === "PENDING") {
    assessment.status = "IN_PROGRESS";
    assessment.startedAt = new Date();
    await assessment.save();
  }

  return getAssessmentById(id, viewer);
};

export const submitAssessment = async (
  id: string,
  viewer: { id: string; role: string },
  input: { answers: { questionId: string; selectedOption?: number; textAnswer?: string }[] }
) => {
  const assessment = await Assessment.findById(id).populate("assignedEmployee", "user").populate("assignedCandidate", "user");
  if (!assessment) throw new AppError("Assessment not found", 404);

  const assignedEmp = assessment.assignedEmployee as unknown as { user?: Types.ObjectId } | null;
  const assignedCandidate = assessment.assignedCandidate as unknown as { user?: Types.ObjectId } | null;
  if (["EMPLOYEE", "APPLICANT"].includes(viewer.role) && assignedEmp?.user?.toString() !== viewer.id && assignedCandidate?.user?.toString() !== viewer.id) {
    throw new AppError("Access denied to this assessment", 403);
  }

  if (assessment.status === "COMPLETED") {
    throw new AppError("This assessment has already been submitted and completed.", 400);
  }
  if (assessment.status !== "IN_PROGRESS" || !assessment.startedAt) throw new AppError("Start the assessment before submitting answers", 409, "ASSESSMENT_NOT_STARTED");

  const answerMap = new Map((input.answers || []).map((a) => [a.questionId, a]));
  let totalEarnedPoints = 0;
  const questions = assessment.questions || [];
  const maxPoints = questions.length > 0
    ? questions.reduce((sum, q) => sum + (q.points || 10), 0)
    : (assessment.maximumScore || 100);

  const evaluatedAnswers = questions.map((q) => {
    const userAns = answerMap.get(q.id);
    const selectedOption = userAns?.selectedOption;
    const isCorrect = typeof q.correctOptionIndex === "number" && selectedOption === q.correctOptionIndex;
    const earnedPoints = isCorrect ? (q.points || 10) : 0;
    totalEarnedPoints += earnedPoints;

    return {
      questionId: q.id,
      selectedOption,
      textAnswer: userAns?.textAnswer,
      isCorrect,
      earnedPoints
    };
  });

  const percentage = maxPoints > 0 ? Math.round((totalEarnedPoints / maxPoints) * 100) : 0;
  const timedOut = Boolean(assessment.startedAt && Date.now() > assessment.startedAt.getTime() + assessment.timeLimitMinutes * 60_000 + 30_000);
  if (timedOut) { totalEarnedPoints = 0; for (const answer of evaluatedAnswers) { answer.isCorrect = false; answer.earnedPoints = 0; } }
  const finalPercentage = timedOut ? 0 : percentage;
  const passingScore = assessment.passingScore <= 100
    ? assessment.passingScore
    : Math.round((assessment.passingScore / (assessment.maximumScore || 100)) * 100);
  const result = finalPercentage >= passingScore ? "PASSED" : "FAILED";

  assessment.answers = evaluatedAnswers;
  assessment.score = totalEarnedPoints;
  assessment.maximumScore = maxPoints;
  assessment.percentage = finalPercentage;
  assessment.timedOut = timedOut;
  assessment.result = result;
  assessment.status = "COMPLETED";
  assessment.completedAt = new Date();
  assessment.attemptDate = new Date();
  await assessment.save();

  await AssessmentResult.create({
    assessment: assessment._id,
    employee: assessment.assignedEmployee,
    candidate: assessment.assignedCandidate,
    attemptDate: new Date(),
    score: totalEarnedPoints,
    result,
    evaluatedBy: viewer.id,
    notes: `Assessment submission: ${totalEarnedPoints}/${maxPoints} points (${finalPercentage}%). Status: ${result}.${timedOut ? " Submitted after the time limit." : ""} Focus changes: ${assessment.focusLossCount ?? 0}.`
  });

  return getAssessmentById(id, viewer);
};

export const recordAssessmentFocusLoss = async (id: string, viewer: { id: string; role: string }) => {
  const assessment = await Assessment.findById(id).populate("assignedEmployee", "user").populate("assignedCandidate", "user");
  if (!assessment) throw new AppError("Assessment not found", 404);
  const assignedEmp = assessment.assignedEmployee as unknown as { user?: { toString(): string } } | undefined;
  const assignedCandidate = assessment.assignedCandidate as unknown as { user?: { toString(): string } } | undefined;
  if (["EMPLOYEE", "APPLICANT"].includes(viewer.role) && assignedEmp?.user?.toString() !== viewer.id && assignedCandidate?.user?.toString() !== viewer.id) throw new AppError("Access denied to this assessment", 403);
  if (assessment.status !== "IN_PROGRESS") throw new AppError("Assessment is not in progress", 409);
  const updated = await Assessment.findOneAndUpdate({ _id: id, status: "IN_PROGRESS" }, { $inc: { focusLossCount: 1 } }, { new: true });
  return updated?.focusLossCount ?? 0;
};

export const listAssessmentCandidates = async () => AssessmentCandidate.find({ isActive: true }).select("name email position createdAt").sort({ createdAt: -1 }).lean();

export const createAssessmentCandidate = async (input: { name: string; email: string; position?: string; password?: string }, actorId: string) => {
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) throw new AppError("This email already has an account", 409, "EMAIL_EXISTS");
  const role = await Role.findOne({ name: "APPLICANT" });
  if (!role) throw new AppError("Applicant role is not initialized; restart the service and try again", 503);
  const password = input.password?.trim() || `Candidate-${randomBytes(6).toString("base64url")}!9`;
  const user = await User.create({ name: input.name, email, passwordHash: await bcrypt.hash(password, 12), role: role._id, isActive: true, forcePasswordChange: false, onboardingComplete: true });
  try {
    const candidate = await AssessmentCandidate.create({ name: input.name, email, position: input.position, user: user._id, createdBy: actorId });
    return { candidate, temporaryCredentials: { email, password } };
  } catch (error) { await User.deleteOne({ _id: user._id }); throw error; }
};

export const deleteAssessment = async (id: string) => {
  const assessment = await Assessment.findById(id);
  if (!assessment) throw new AppError("Assessment not found", 404);
  await AssessmentResult.deleteMany({ assessment: assessment._id });
  await Assessment.findByIdAndDelete(id);
  return { success: true, message: "Assessment deleted successfully" };
};

export const recordAssessmentResult = async (assessmentId: string, input: { attemptDate: Date; score: number; notes?: string }, evaluator: string) => {
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment) throw new AppError("Assessment not found", 404);
  if (input.score > assessment.maximumScore) throw new AppError("Score cannot exceed maximum score", 422);
  const result = input.score >= assessment.passingScore ? "PASSED" : "FAILED";
  assessment.attemptDate = input.attemptDate;
  assessment.score = input.score;
  assessment.percentage = Math.round((input.score / assessment.maximumScore) * 100);
  assessment.result = result;
  assessment.status = "COMPLETED";
  await assessment.save();
  return AssessmentResult.create({ assessment: assessment._id, employee: assessment.assignedEmployee, attemptDate: input.attemptDate, score: input.score, result, evaluatedBy: evaluator, notes: input.notes });
};

export const detectSinglePointOfFailures = async (): Promise<SPOFItem[]> => {
  const employeeSkills = await EmployeeSkill.find({
    isActive: true,
    $or: [
      { verificationStatus: "VERIFIED", verifiedRating: { $gte: 3 } },
      { selfRating: { $gte: 3 } }
    ]
  })
    .populate({
      path: "employee",
      match: { isActive: true },
      select: "firstName lastName employeeId department",
      populate: { path: "department", select: "name" }
    })
    .populate("skill", "name category isActive")
    .lean();

  const skillMap = new Map<string, typeof employeeSkills>();
  for (const es of employeeSkills) {
    if (!es.employee || !es.skill) continue;
    const skill = es.skill as unknown as { _id: Types.ObjectId; name: string; category: string; isActive: boolean };
    if (!skill.isActive) continue;
    const skillId = skill._id.toString();
    const list = skillMap.get(skillId) || [];
    list.push(es);
    skillMap.set(skillId, list);
  }

  const spofList: SPOFItem[] = [];
  for (const [skillId, holders] of skillMap.entries()) {
    if (holders.length === 1) {
      const holder = holders[0]!;
      const emp = holder.employee as unknown as { _id: Types.ObjectId; firstName: string; lastName: string; employeeId: string; department?: { name: string } };
      const skl = holder.skill as unknown as { name: string; category: string };
      spofList.push({
        skillId,
        skillName: skl.name,
        category: skl.category,
        employeeId: emp._id.toString(),
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeId,
        departmentName: emp.department?.name || "General",
        verifiedRating: holder.verifiedRating || holder.selfRating || 3
      });
    }
  }

  return spofList.sort((a, b) => a.category.localeCompare(b.category) || a.skillName.localeCompare(b.skillName));
};
