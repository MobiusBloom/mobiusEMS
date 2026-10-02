import { randomBytes } from "node:crypto"; import { Types, type FilterQuery } from "mongoose"; import { Employee } from "../models/Employee.js"; import { Project, type ProjectDocument } from "../models/Project.js"; import { Task, type TaskDocument } from "../models/Task.js"; import { TaskActivity } from "../models/TaskActivity.js"; import { AppError } from "../utils/AppError.js"; import { writeAudit } from "./auditService.js";
import { notify } from "./notificationService.js"; import { canTransitionTask } from "./taskTransitions.js";
import { getViewerHierarchyScope, assertEmployeeInScope } from "./hierarchyService.js";
import type { RoleName } from "@mobius-ems/shared";
import { awardTaskXp, baseXpForComplexity, getGamificationForUser } from "./gamificationService.js";
import { evaluateTaskSkillImpact } from "./skillCredibilityService.js";

export const createProject = async (input: Omit<ProjectDocument, "isActive" | "progress">, actor: string) => { const code = input.code || `${(input.name.replace(/[^A-Z0-9]/gi, "").slice(0, 10) || "PRJ").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`; const project = await Project.create({ ...input, code }); await writeAudit({ user: actor, action: "PROJECT_CREATED", entityType: "Project", entityId: project.id, newValue: { code: project.code, name: project.name } }); return project; };
export const listProjects = async (viewer: { id: string; role: string }) => {
  const filter: FilterQuery<ProjectDocument> = { isActive: true };
  const scope = await getViewerHierarchyScope(viewer as { id: string; role: RoleName });
  if (scope.scopeType === "SELF") {
    filter.$or = [{ projectManager: scope.allowedEmployeeIds[0] }, { teamMembers: scope.allowedEmployeeIds[0] }];
  } else if (scope.scopeType === "DEPARTMENT") {
    filter.department = scope.departmentId;
  } else if (scope.scopeType === "SUBTREE") {
    filter.$or = [
      { projectManager: { $in: scope.allowedEmployeeIds } },
      { teamMembers: { $in: scope.allowedEmployeeIds } }
    ];
  }
  return Project.find(filter).populate("department", "name code").populate("projectManager teamMembers", "firstName lastName employeeId").sort({ createdAt: -1 }).lean();
};
export const createTask = async (input: { name: string; description?: string; project: string; assignedEmployee: string; skillId?: string; skillName?: string; priority: TaskDocument["priority"]; complexity: TaskDocument["complexity"]; estimatedHours: number; startDate?: Date; deadline: Date; reviewer?: string; assignmentSource?: TaskDocument["assignmentSource"]; sourceImport?: string; sourceSnippet?: string }, actor: string) => { const project = await Project.findOne({ _id: input.project, isActive: true }); if (!project) throw new AppError("Project not found", 404); const assignee = await Employee.findOne({ _id: input.assignedEmployee, isActive: true }); if (!assignee) throw new AppError("Assignee not found", 404); const task = await Task.create({ ...input, taskId: `TASK-${randomBytes(4).toString("hex").toUpperCase()}`, department: project.department, assignedBy: actor }); await TaskActivity.create({ task: task._id, action: "TASK_CREATED", newValue: { status: task.status, assignee: input.assignedEmployee, sourceImport: input.sourceImport }, performedBy: actor }); await notify({ recipient: assignee.user.toString(), type: "TASK_ASSIGNED", title: "New task assigned", body: `${task.name} is due ${task.deadline.toLocaleDateString()}.`, entityType: "Task", entityId: task.id }); return task; };
export const createManualTask = async (input: { name: string; description?: string; project: string; verbalAssigner: string; skillId?: string; skillName?: string; priority: TaskDocument["priority"]; complexity: TaskDocument["complexity"]; estimatedHours: number; deadline: Date }, actor: { id: string; role: string }) => { if (actor.role !== "EMPLOYEE") throw new AppError("Only employees can add verbally assigned tasks", 403); const employee = await Employee.findOne({ user: actor.id, isActive: true }); if (!employee) throw new AppError("Employee profile not found", 404); const project = await Project.findOne({ _id: input.project, isActive: true, $or: [{ projectManager: employee._id }, { teamMembers: employee._id }] }); if (!project) throw new AppError("Select a project you are assigned to", 403); const task = await Task.create({ ...input, taskId: `TASK-${randomBytes(4).toString("hex").toUpperCase()}`, department: project.department, assignedEmployee: employee._id, assignedBy: actor.id, reviewer: project.projectManager, assignmentSource: "SELF_REPORTED" }); await TaskActivity.create({ task: task._id, action: "SELF_REPORTED_TASK_CREATED", newValue: { status: task.status, verbalAssigner: input.verbalAssigner }, performedBy: actor.id }); await writeAudit({ user: actor.id, action: "SELF_REPORTED_TASK_CREATED", entityType: "Task", entityId: task.id, newValue: { name: task.name, project: project.id, verbalAssigner: input.verbalAssigner } }); return task; };
export const listTasks = async (query: { status?: string; project?: string; priority?: string }, viewer: { id: string; role: string }) => {
  const filter: FilterQuery<TaskDocument> = { isActive: true };
  if (query.status) filter.status = query.status;
  if (query.project) filter.project = query.project;
  if (query.priority) filter.priority = query.priority;
  const scope = await getViewerHierarchyScope(viewer as { id: string; role: RoleName });
  if (scope.scopeType === "SELF") {
    filter.assignedEmployee = scope.allowedEmployeeIds[0];
  } else if (scope.scopeType === "DEPARTMENT") {
    filter.department = scope.departmentId;
  } else if (scope.scopeType === "SUBTREE") {
    filter.assignedEmployee = { $in: scope.allowedEmployeeIds };
  }
  const tasks = await Task.find(filter).populate("project", "name code").populate("assignedEmployee reviewer", "firstName lastName employeeId").sort({ deadline: 1 }).lean();
  return tasks.map((task) => ({ ...task, potentialXp: baseXpForComplexity(task.complexity) }));
};
const assertTaskAccess = async (task: TaskDocument, actor: { id: string; role: string }, review = false) => {
  if (actor.role === "SUPER_ADMIN" || actor.role === "HR_ADMIN") return;
  const scope = await getViewerHierarchyScope(actor as { id: string; role: RoleName });
  const ownId = scope.ownEmployeeId?.toString();
  const own = task.assignedEmployee.toString() === ownId;
  const reviewer = review && task.reviewer?.toString() === ownId;
  const inScope = scope.allowedEmployeeIds.some((id) => id.toString() === task.assignedEmployee.toString());
  const inDept = scope.scopeType === "DEPARTMENT" && task.department?.toString() === scope.departmentId?.toString();
  if (!own && !reviewer && !inScope && !inDept) throw new AppError("Task is outside your permitted scope", 403, "FORBIDDEN");
};
export const reassignTask = async (id: string, assignedEmployee: string, actor: { id: string; role: string }) => {
  const task = await Task.findOne({ _id: id, isActive: true });
  if (!task) throw new AppError("Task not found", 404);
  await assertTaskAccess(task, actor);
  if (task.assignedEmployee.toString() === assignedEmployee) throw new AppError("Select a different employee", 409, "TASK_ALREADY_ASSIGNED");

  const [nextAssignee, previousAssignee] = await Promise.all([
    Employee.findOne({ _id: assignedEmployee, isActive: true }).select("user firstName lastName reportingManager"),
    Employee.findOne({ _id: task.assignedEmployee, isActive: true }).select("user firstName lastName")
  ]);
  if (!nextAssignee) throw new AppError("Assignee not found", 404);
  const scope = await getViewerHierarchyScope(actor as { id: string; role: RoleName });
  assertEmployeeInScope(scope, nextAssignee._id, "Employee is outside your permitted scope");

  const oldAssigneeId = task.assignedEmployee.toString();
  task.assignedEmployee = nextAssignee._id;
  task.assignedBy = new Types.ObjectId(actor.id);
  await task.save();
  const { LeadWorkItem } = await import("../models/LeadWorkItem.js");
  await LeadWorkItem.updateMany({ task: task._id, status: { $nin: ["CONVERTED", "NOT_INTERESTED", "INVALID"] } }, { $set: { assignedEmployee: nextAssignee._id }, $inc: { version: 1 } });
  await Promise.all([
    TaskActivity.create({ task: task._id, action: "TASK_REASSIGNED", oldValue: { assignee: oldAssigneeId }, newValue: { assignee: nextAssignee.id }, performedBy: actor.id }),
    writeAudit({ user: actor.id, action: "TASK_REASSIGNED", entityType: "Task", entityId: task.id, oldValue: { assignedEmployee: oldAssigneeId }, newValue: { assignedEmployee: nextAssignee.id } }),
    notify({ recipient: nextAssignee.user.toString(), type: "TASK_ASSIGNED", title: "Task reassigned to you", body: `${task.name} is due ${task.deadline.toLocaleDateString()}.`, entityType: "Task", entityId: task.id }),
    previousAssignee ? notify({ recipient: previousAssignee.user.toString(), type: "TASK_REASSIGNED", title: "Task reassigned", body: `${task.name} was reassigned to ${nextAssignee.firstName} ${nextAssignee.lastName}.`, entityType: "Task", entityId: task.id }) : Promise.resolve()
  ]);
  return task;
};
export const archiveTask = async (id: string, actor: { id: string; role: string }) => {
  const task = await Task.findOne({ _id: id, isActive: true });
  if (!task) throw new AppError("Task not found", 404);
  await assertTaskAccess(task, actor);
  const assignee = await Employee.findOne({ _id: task.assignedEmployee, isActive: true }).select("user");
  const archivedAt = new Date();
  task.isActive = false;
  task.archivedAt = archivedAt;
  await task.save();
  await Promise.all([
    TaskActivity.create({ task: task._id, action: "TASK_DELETED", oldValue: { isActive: true }, newValue: { isActive: false, archivedAt }, performedBy: actor.id }),
    writeAudit({ user: actor.id, action: "TASK_DELETED", entityType: "Task", entityId: task.id, oldValue: { isActive: true }, newValue: { isActive: false, archivedAt } }),
    assignee ? notify({ recipient: assignee.user.toString(), type: "TASK_DELETED", title: "Task removed", body: `${task.name} was removed from the active task board.`, entityType: "Task", entityId: task.id }) : Promise.resolve()
  ]);
  return task;
};
export const transitionTask = async (id: string, input: { status: TaskDocument["status"]; actualHours?: number; completionNote?: string; deliverableUrl?: string; businessImpact?: string; blockerReason?: NonNullable<TaskDocument["blocker"]>["reason"]; blockerComment?: string; blockerExternal?: boolean; resolutionComment?: string }, actor: { id: string; role: string }) => { const task = await Task.findOne({ _id: id, isActive: true }); if (!task) throw new AppError("Task not found", 404); await assertTaskAccess(task, actor); if (input.status === "COMPLETED" || (input.status === "REOPENED" && task.status === "IN_REVIEW")) throw new AppError("Complete or reject work through the quality review", 422, "TASK_REVIEW_REQUIRED"); if (!canTransitionTask(task.status, input.status)) throw new AppError(`Transition from ${task.status} to ${input.status} is not allowed`, 422, "INVALID_TASK_TRANSITION"); const oldStatus = task.status; if (input.actualHours !== undefined) task.actualHours = input.actualHours; if (input.completionNote !== undefined) task.completionNote = input.completionNote; if (input.deliverableUrl !== undefined) task.deliverableUrl = input.deliverableUrl || undefined; if (input.businessImpact !== undefined) task.businessImpact = input.businessImpact; if (input.status === "IN_PROGRESS" && !task.startDate) task.startDate = new Date(); if (input.status === "BLOCKED") task.blocker = { reason: input.blockerReason!, comment: input.blockerComment, startedAt: new Date(), external: input.blockerExternal ?? false }; if (oldStatus === "BLOCKED" && task.blocker) { task.blocker.resolvedAt = new Date(); task.blocker.resolutionComment = input.resolutionComment; } if (input.status === "REOPENED") { task.reopenCount += 1; task.completionDate = undefined; } task.status = input.status; await task.save(); await TaskActivity.create({ task: task._id, action: input.status === "BLOCKED" ? "TASK_BLOCKED" : oldStatus === "BLOCKED" ? "TASK_UNBLOCKED" : `STATUS_${input.status}`, oldValue: { status: oldStatus }, newValue: { status: input.status, blocker: task.blocker, completionNote: task.completionNote, deliverableUrl: task.deliverableUrl, businessImpact: task.businessImpact }, performedBy: actor.id }); if (input.status === "REOPENED") { void evaluateTaskSkillImpact(task._id); } return task; };
export const reviewTask = async (id: string, input: { qualityRating: number; reviewComment?: string; approve: boolean }, actor: { id: string; role: string }) => { const task = await Task.findOne({ _id: id, isActive: true }); if (!task) throw new AppError("Task not found", 404); if (actor.role === "EMPLOYEE") throw new AppError("A manager must review completed work", 403); const assignee = await Employee.findById(task.assignedEmployee).select("user"); if (assignee?.user.toString() === actor.id) throw new AppError("You cannot review your own work", 403); await assertTaskAccess(task, actor, true); if (task.status !== "IN_REVIEW") throw new AppError("Only tasks in review can be reviewed", 422); task.qualityRating = input.qualityRating; task.reviewComment = input.reviewComment; task.status = input.approve ? "COMPLETED" : "REOPENED"; if (input.approve) task.completionDate = new Date(); else task.reopenCount += 1; await task.save(); await TaskActivity.create({ task: task._id, action: input.approve ? "TASK_COMPLETED" : "TASK_REOPENED", newValue: input, performedBy: actor.id }); const reward = input.approve ? await awardTaskXp(task) : null; void evaluateTaskSkillImpact(task._id); return { task, reward }; };
export { getGamificationForUser };
export const taskActivity = async (id: string) => TaskActivity.find({ task: id }).populate("performedBy", "name").sort({ createdAt: -1 }).lean();
export const taskMetrics = async (viewer: { id: string; role: string }) => { const tasks = await listTasks({}, viewer); const completed = tasks.filter((task) => task.status === "COMPLETED"); const onTime = completed.filter((task) => task.completionDate && task.completionDate <= task.deadline).length; const overdue = tasks.filter((task) => !["COMPLETED","CANCELLED"].includes(task.status) && task.deadline < new Date()).length; const reviewed = completed.filter((task) => task.qualityRating); return { total: tasks.length, open: tasks.filter((task) => !["COMPLETED","CANCELLED"].includes(task.status)).length, overdue, onTimeRate: completed.length ? Math.round(onTime / completed.length * 100) : 0, reworkRate: completed.length ? Math.round(completed.reduce((sum, task) => sum + task.reopenCount, 0) / completed.length * 100) : 0, averageQuality: reviewed.length ? Number((reviewed.reduce((sum, task) => sum + (task.qualityRating ?? 0), 0) / reviewed.length).toFixed(1)) : 0 } };
