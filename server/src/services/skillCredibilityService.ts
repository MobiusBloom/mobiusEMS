import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { Task } from "../models/Task.js";
import { RoleSkillAssessment } from "../models/RoleSkillAssessment.js";
import { buildSkillEvidence } from "./skillEvidence.js";
import type { EmployeeSkillRank } from "@mobius-ems/shared";

export const evaluateTaskSkillImpact = async (taskId: string | Types.ObjectId) => {
  const task = await Task.findById(taskId).lean();
  if (!task || !task.assignedEmployee) return null;

  const employee = await Employee.findById(task.assignedEmployee).select("_id department").lean();
  if (!employee) return null;

  const assessment = await RoleSkillAssessment.findOne({ employee: employee._id });
  if (!assessment) return null;

  const allTasks = await Task.find({ assignedEmployee: employee._id, isActive: true })
    .select("taskId name description completionNote skillId skillName status estimatedHours actualHours deadline completionDate qualityRating reopenCount")
    .sort({ updatedAt: -1 })
    .lean();

  let totalDemonstrated = 0;
  let testedCount = 0;

  for (const score of assessment.scores) {
    const evidence = buildSkillEvidence(
      {
        skillId: score.skillId,
        name: score.name,
        category: score.category,
        tools: score.tools,
        description: score.description,
        rating: score.rating,
      },
      allTasks
    );

    score.demonstratedRating = evidence.demonstratedRating;
    score.velocityRatio = evidence.velocityRatio;
    score.credibilityStatus = evidence.credibilityStatus;
    score.tasksEvaluatedCount = evidence.completedTasks;

    if (evidence.credibilityStatus !== "UNTESTED") {
      totalDemonstrated += evidence.demonstratedRating;
      testedCount += 1;
    } else {
      totalDemonstrated += score.rating;
    }
  }

  assessment.demonstratedAverage = Number((totalDemonstrated / assessment.scores.length).toFixed(1));
  
  if (testedCount > 0) {
    const testedScores = assessment.scores.filter((s) => s.credibilityStatus !== "UNTESTED");
    const credibilityRatio = testedScores.reduce((sum, s) => sum + ((s.demonstratedRating ?? s.rating) / s.rating), 0) / testedScores.length;
    assessment.overallCredibilityScore = Math.min(200, Math.round(credibilityRatio * 100));
  } else {
    assessment.overallCredibilityScore = 100;
  }

  await assessment.save();
  await recalculateAllRanks();

  return assessment;
};

export const recalculateAllRanks = async () => {
  const allAssessments = await RoleSkillAssessment.find({})
    .populate<{ employee: { _id: Types.ObjectId; department: Types.ObjectId; firstName: string; lastName: string; employeeId: string; designation?: Types.ObjectId } }>(
      "employee",
      "firstName lastName employeeId department designation"
    )
    .exec();

  if (allAssessments.length === 0) return;

  const sorted = [...allAssessments].sort((a, b) => {
    const credDiff = (b.overallCredibilityScore ?? 100) - (a.overallCredibilityScore ?? 100);
    if (credDiff !== 0) return credDiff;
    return (b.demonstratedAverage ?? b.averageRating) - (a.demonstratedAverage ?? a.averageRating);
  });

  const deptGroups = new Map<string, typeof sorted>();

  sorted.forEach((item, index) => {
    item.companyRank = index + 1;
    const deptId = item.employee?.department?.toString() || "unassigned";
    if (!deptGroups.has(deptId)) deptGroups.set(deptId, []);
    deptGroups.get(deptId)!.push(item);
  });

  for (const [, deptItems] of deptGroups.entries()) {
    deptItems.forEach((item, index) => {
      item.departmentRank = index + 1;
    });
  }

  await Promise.all(allAssessments.map((doc) => doc.save()));
};

export const getSkillCredibilityLeaderboard = async (limit = 20): Promise<EmployeeSkillRank[]> => {
  const assessments = await RoleSkillAssessment.find({})
    .populate<{ employee: { _id: Types.ObjectId; firstName: string; lastName: string; employeeId: string; department?: { name: string }; designation?: { name: string } } }>({
      path: "employee",
      select: "firstName lastName employeeId department designation",
      populate: [
        { path: "department", select: "name" },
        { path: "designation", select: "name" },
      ],
    })
    .sort({ companyRank: 1 })
    .limit(limit)
    .lean();

  return assessments.map((a) => {
    const tested = (a.scores || []).filter((s) => s.tasksEvaluatedCount && s.tasksEvaluatedCount > 0);
    const avgVelocity = tested.length > 0
      ? Number((tested.reduce((sum: number, s) => sum + (s.velocityRatio || 1), 0) / tested.length).toFixed(2))
      : 1.0;
    const completedTasks = tested.reduce((sum: number, s) => sum + (s.tasksEvaluatedCount || 0), 0);

    return {
      employeeId: a.employee?.employeeId || "N/A",
      employeeName: `${a.employee?.firstName || ""} ${a.employee?.lastName || ""}`.trim() || "Employee",
      designationName: a.employee?.designation?.name || a.designation || a.role,
      departmentName: a.employee?.department?.name || "General",
      departmentRank: a.departmentRank || 1,
      companyRank: a.companyRank || 1,
      overallCredibilityScore: a.overallCredibilityScore ?? 100,
      demonstratedAverage: a.demonstratedAverage ?? a.averageRating,
      claimedAverage: a.averageRating,
      completedTasksCount: completedTasks,
      velocityRatio: avgVelocity,
    };
  });
};
