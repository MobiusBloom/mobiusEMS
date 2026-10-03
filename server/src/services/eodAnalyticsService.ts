import type { EodAnalytics, EodContext, EodRecord, SessionUser } from "@mobius-ems/shared";
import type { z } from "zod";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Designation } from "../models/Designation.js";
import { Team } from "../models/Team.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { eodAnalyticsQuery } from "../validators/eodValidators.js";
import { resolveEodScope } from "./eodScopeService.js";
import { asDto } from "./eodTemplateService.js";
import { completedTaskIds, executionMetrics, istBounds, istDay, loadEodWork, salesWorkSummary, type WorkActivity, type WorkTask } from "./eodWorkService.js";
export const employeeContextQuery = async (filter: Record<string, unknown>): Promise<EodContext[]> => {
  type Raw = Omit<EodContext, "department" | "designation" | "team" | "reportingManager"> & { user: string; department?: EodContext["department"] | string; designation?: EodContext["designation"] | string; team?: EodContext["team"] | string; reportingManager?: EodContext["reportingManager"] | string };
  const rows = asDto<Raw[]>(await Employee.find(filter).select("employeeId user firstName lastName department designation team reportingManager dateOfJoining status isActive").sort({ firstName: 1 }).lean());
  const ids = (key: "department" | "designation" | "team" | "reportingManager") => [...new Set(rows.map(row => row[key]).filter((value): value is string => typeof value === "string"))];
  const [departments, designations, teams, managers] = await Promise.all([
    ids("department").length ? Department.find({ _id: { $in: ids("department") } }).select("name capabilities").lean() : [],
    ids("designation").length ? Designation.find({ _id: { $in: ids("designation") } }).select("name").lean() : [],
    ids("team").length ? Team.find({ _id: { $in: ids("team") } }).select("name").lean() : [],
    ids("reportingManager").length ? Employee.find({ _id: { $in: ids("reportingManager") } }).select("firstName lastName").lean() : []
  ]);
  const map = <T extends { _id: string }>(items: T[]) => new Map(items.map(item => [item._id, item]));
  const deptMap = map(asDto<NonNullable<EodContext["department"]>[]>(departments));
  const designationMap = map(asDto<NonNullable<EodContext["designation"]>[]>(designations));
  const teamMap = map(asDto<NonNullable<EodContext["team"]>[]>(teams));
  const managerMap = map(asDto<NonNullable<EodContext["reportingManager"]>[]>(managers));
  return rows.map(row => ({ ...row, department: typeof row.department === "string" ? deptMap.get(row.department) : row.department, designation: typeof row.designation === "string" ? designationMap.get(row.designation) : row.designation, team: typeof row.team === "string" ? teamMap.get(row.team) : row.team, reportingManager: typeof row.reportingManager === "string" ? managerMap.get(row.reportingManager) : row.reportingManager }));
};
export const daysInRange = (start: string, end: string) => {
  const days: string[] = [];
  for (let at = Date.parse(start); at <= Date.parse(end); at += 86400000) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
};
export const blockerAnalytics = (tasks: WorkTask[], activities: WorkActivity[], start: string, end: string): EodAnalytics["blockers"] => {
  const active = tasks.filter(t => t.isActive !== false && t.status === "BLOCKED" && t.blocker && !t.blocker.resolvedAt);
  const now = Date.now();
  const ages = active.map(t => Math.max(0, (now - Date.parse(t.blocker!.startedAt)) / 86400000));
  const countBy = (key: (t: WorkTask) => string) => { const result: Record<string, number> = {}; for (const task of active) { const value = key(task); result[value] = (result[value] ?? 0) + 1; } return result; };
  const inRange = activities.filter(a => istDay(a.createdAt) >= start && istDay(a.createdAt) <= end);
  return { active: active.length, created: inRange.filter(a => a.action === "TASK_BLOCKED").length, resolved: inRange.filter(a => a.action === "TASK_UNBLOCKED").length,
    averageAgeDays: ages.length ? Number((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)) : 0, longestAgeDays: ages.length ? Number(Math.max(...ages).toFixed(1)) : 0,
    byReason: countBy(t => t.blocker!.reason), byDepartment: countBy(t => t.department), byProject: countBy(t => t.project?._id ?? "unknown") };
};
const coverage = (employees: EodContext[], updates: EodRecord[], days: string[]) => {
  const eligible = days.reduce((sum, day) => sum + employees.filter(e => !e.dateOfJoining || istDay(e.dateOfJoining) <= day).length, 0);
  return { eligible, submitted: updates.length, percent: eligible ? Math.round(updates.length / eligible * 100) : 0 };
};
export const getEodAnalytics = async (viewer: SessionUser, input: z.infer<typeof eodAnalyticsQuery>): Promise<EodAnalytics> => {
  const scope = await resolveEodScope(viewer, "analytics");
  const days = daysInRange(input.start, input.end);
  const duration = days.length * 86400000;
  const previousStart = new Date(Date.parse(input.start) - duration).toISOString().slice(0, 10);
  const previousEnd = new Date(Date.parse(input.start) - 86400000).toISOString().slice(0, 10);
  const [roster, allReports] = await Promise.all([
    employeeContextQuery({ ...scope.employeeFilter, isActive: true, dateOfJoining: { $lte: istBounds(input.end).end } }),
    EodUpdate.find({ ...scope.reportFilter, status: "SUBMITTED", date: { $gte: previousStart, $lte: input.end } }).lean()
  ]);
  let employees = asDto<EodContext[]>(roster);
  let updates = asDto<EodRecord[]>(allReports);
  // Historical reports use saved organization IDs; legacy records use the current roster.
  const extraIds = [...new Set(updates.map(r => r.employee).filter(id => !employees.some(e => e._id === id)))];
  if (extraIds.length) employees.push(...asDto<EodContext[]>(await employeeContextQuery({ _id: { $in: extraIds } })));
  const contextMatches = (employee: EodContext, report?: EodRecord) =>
    (!input.department || (report?.departmentSnapshot?.id ?? employee.department?._id) === input.department) &&
    (!input.team || (report?.teamSnapshot?.id ?? employee.team?._id) === input.team) &&
    (!input.manager || (report?.reportingManagerSnapshot?.id ?? employee.reportingManager?._id) === input.manager) &&
    (!input.employee || employee._id === input.employee);
  updates = updates.filter(r => { const employee = employees.find(e => e._id === r.employee); return employee && contextMatches(employee, r); });
  employees = employees.filter(e => contextMatches(e) || updates.some(r => r.employee === e._id));
  if (input.health) {
    const ids = new Set(updates.filter(r => r.date >= input.start && r.health === input.health).map(r => r.employee));
    employees = employees.filter(e => ids.has(e._id)); updates = updates.filter(r => ids.has(r.employee) && r.health === input.health);
  }
  if (input.status) {
    const current = updates.filter(r => r.date >= input.start);
    employees = employees.filter(e => input.status === "SUBMITTED" ? current.some(r => r.employee === e._id) : days.some(day => (!e.dateOfJoining || istDay(e.dateOfJoining) <= day) && !current.some(r => r.employee === e._id && r.date === day)));
    const ids = new Set(employees.map(e => e._id)); updates = updates.filter(r => ids.has(r.employee));
  }
  const currentRosterIds = new Set(roster.map(e => String(e._id)));
  const workEmployees = employees.filter(e => (scope.level !== "department" || currentRosterIds.has(e._id)) && (!input.department || e.department?._id === input.department));
  const work = await loadEodWork(workEmployees.map(e => e._id), previousStart, input.end, input.project);
  if (input.project) {
    const ids = new Set(work.tasks.map(t => t.assignedEmployee)); employees = employees.filter(e => ids.has(e._id)); updates = updates.filter(r => ids.has(r.employee));
  }
  const currentUpdates = updates.filter(r => r.date >= input.start);
  const previousUpdates = updates.filter(r => r.date <= previousEnd);
  const current = coverage(employees, currentUpdates, days);
  const previous = coverage(employees, previousUpdates, daysInRange(previousStart, previousEnd));
  const metrics = executionMetrics(work.tasks, work.activities, input.start, input.end);
  const previousMetrics = executionMetrics(work.tasks.filter(t => istDay(t.createdAt) <= previousEnd), work.activities, previousStart, previousEnd);
  const blockers = blockerAnalytics(work.tasks, work.activities, input.start, input.end);
  const trend = days.map(date => {
    const daily = currentUpdates.filter(r => r.date === date);
    const eligible = employees.filter(e => !e.dateOfJoining || istDay(e.dateOfJoining) <= date).length;
    // Backlog trends require snapshots; return unavailable for legacy days, never reconstruct from today's status.
    const snapshots = daily.map(r => r.systemSummary).filter(s => !!s);
    return { date, eligible, submitted: daily.length, submissionPercent: eligible ? Math.round(daily.length / eligible * 100) : 0,
      completed: completedTaskIds(work.tasks, work.activities, date, date).size, blocked: daily.filter(r => r.health === "BLOCKED").length, atRisk: daily.filter(r => r.health === "AT_RISK").length,
      blockersCreated: work.activities.filter(a => istDay(a.createdAt) === date && a.action === "TASK_BLOCKED").length,
      blockersResolved: work.activities.filter(a => istDay(a.createdAt) === date && a.action === "TASK_UNBLOCKED").length,
      overdue: snapshots.length ? snapshots.reduce((sum, s) => sum + (s!.metrics.overdue ?? 0), 0) : null,
      reviewBacklog: snapshots.length ? snapshots.reduce((sum, s) => sum + (s!.metrics.inReview ?? 0), 0) : null };
  });
  const departmentIds = [...new Set([...employees.map(e => e.department?._id), ...currentUpdates.map(r => r.departmentSnapshot?.id)].filter((id): id is string => !!id))];
  const departments = departmentIds.map(id => {
    const deptEmployees = employees.filter(e => e.department?._id === id);
    const reports = currentUpdates.filter(r => (r.departmentSnapshot?.id ?? employees.find(e => e._id === r.employee)?.department?._id) === id);
    // A historical snapshot contributes its employee-day to that department, not the new department.
    const submittedElsewhere = currentUpdates.filter(r => r.departmentSnapshot?.id && r.departmentSnapshot.id !== id && deptEmployees.some(e => e._id === r.employee)).length;
    const incoming = reports.filter(r => !deptEmployees.some(e => e._id === r.employee)).length;
    const eligible = Math.max(reports.length, coverage(deptEmployees, [], days).eligible - submittedElsewhere + incoming);
    const deptTasks = work.tasks.filter(t => t.department === id);
    const activity: Record<string, number> = {};
    for (const report of reports) for (const [key, value] of Object.entries(report.responses ?? {})) if (typeof value === "number") activity[key] = (activity[key] ?? 0) + value;
    for (const report of reports) {
      const outcome = report.responses?.outcome;
      if (typeof outcome === "string") activity[outcome] = (activity[outcome] ?? 0) + 1;
      if (typeof report.responses?.experiment === "string" && report.responses.experiment.trim()) activity.experimentsReported = (activity.experimentsReported ?? 0) + 1;
    }
    return { id, name: reports.find(r => r.departmentSnapshot)?.departmentSnapshot?.name ?? deptEmployees[0]?.department?.name ?? "Department", eligible, submitted: reports.length, submissionPercent: eligible ? Math.round(reports.length / eligible * 100) : 0,
      completed: completedTaskIds(deptTasks, work.activities.filter(a => deptTasks.some(t => t._id === a.task)), input.start, input.end).size,
      blocked: deptTasks.filter(t => t.isActive !== false && t.status === "BLOCKED").length, reviewsPending: reports.filter(r => !r.acknowledgedAt).length, activity };
  });
  const alerts: EodAnalytics["alerts"] = [];
  for (const task of work.tasks) {
    if (task.isActive === false) continue;
    if (task.status === "BLOCKED" && task.blocker && !task.blocker.resolvedAt && Date.now() - Date.parse(task.blocker.startedAt) > input.blockerDays * 86400000) alerts.push({ kind: "AGING_BLOCKER", employee: task.assignedEmployee, task: task._id, message: `${task.taskId}: ${task.blocker.reason.replaceAll("_", " ").toLowerCase()} for more than ${input.blockerDays} days` });
    if (["HIGH", "URGENT", "CRITICAL"].includes(task.priority) && !["COMPLETED", "CANCELLED"].includes(task.status) && Date.parse(task.deadline) < Date.now()) alerts.push({ kind: "OVERDUE", employee: task.assignedEmployee, task: task._id, message: `${task.taskId}: ${task.name} needs deadline coordination` });
  }
  for (const dept of departments) if (dept.submissionPercent < input.lowCoverage) alerts.push({ kind: "COVERAGE", message: `${dept.name}: ${dept.submissionPercent}% report coverage; check schedules and support needs` });
  const pending = currentUpdates.filter(r => !r.acknowledgedAt).length;
  if (pending) alerts.push({ kind: "REVIEWS", message: `${pending} daily reports awaiting review` });
  const carried = new Map<string, number>();
  for (const report of currentUpdates) for (const commitment of report.systemSummary?.commitments ?? []) if (commitment.state === "CARRIED_FORWARD" && commitment.task) carried.set(commitment.task, (carried.get(commitment.task) ?? 0) + 1);
  for (const [task, count] of carried) if (count >= 2) alerts.push({ kind: "CARRIED_FORWARD", task, message: `A linked task was carried forward ${count} times; clarify the next step` });
  const accessEvents = work.activities.filter(a => a.action === "TASK_BLOCKED" && a.newValue?.blocker?.reason === "ACCESS_REQUIRED" && istDay(a.createdAt) >= input.start);
  if (accessEvents.length >= 2) alerts.push({ kind: "ACCESS", message: `${accessEvents.length} access blockers recorded; coordinate access provisioning` });
  const sales = workEmployees.some(e => e.department?.capabilities?.includes("SALES_MODULE")) ? await salesWorkSummary(workEmployees, input.start, input.end) : undefined;
  if (sales?.metrics.overdueFollowups) alerts.push({ kind: "FOLLOWUPS", message: `${sales.metrics.overdueFollowups} sales follow-ups need attention` });
  return { scope: scope.level, period: { start: input.start, end: input.end },
    overview: { employees: employees.length, submitted: current.submitted, submissionPercent: current.percent, missing: Math.max(0, current.eligible - current.submitted), blockedEmployees: new Set(currentUpdates.filter(r => r.health === "BLOCKED").map(r => r.employee)).size, atRiskEmployees: new Set(currentUpdates.filter(r => r.health === "AT_RISK").map(r => r.employee)).size, tasksCompleted: metrics.completed, openTasks: metrics.open, overdueTasks: metrics.overdue, reviewsPending: pending, activeDepartments: departmentIds.length, eligibleEmployeeDays: current.eligible },
    comparison: { submissionPercentagePoints: current.percent - previous.percent, tasksCompleted: metrics.completed - previousMetrics.completed }, trend, departments, blockers, alerts,
    employees, updates: currentUpdates, tasks: work.tasks, execution: metrics, ...(sales ? { sales } : {}) };
};
