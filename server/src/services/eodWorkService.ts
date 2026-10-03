import type { EodContext, EodPriority, EodTask, EodWorkSummary } from "@mobius-ems/shared";
import { Task } from "../models/Task.js";
import { Project } from "../models/Project.js";
import { TaskActivity } from "../models/TaskActivity.js";
import { DailyTodo } from "../models/DailyTodo.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesOpportunity } from "../models/SalesOpportunity.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesActivity } from "../models/SalesActivity.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { LeadWorkActivity } from "../models/LeadWorkActivity.js";
import { LeadWorkItem } from "../models/LeadWorkItem.js";
import { asDto } from "./eodTemplateService.js";
export const istBounds = (start: string, end = start) => ({ start: new Date(`${start}T00:00:00+05:30`), end: new Date(`${end}T23:59:59.999+05:30`) });
export const istDay = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export interface WorkActivity { task: string; action: string; createdAt: string; oldValue?: { status?: string }; newValue?: { status?: string; blocker?: { reason?: string } } }
export type WorkTask = EodTask & { createdAt: string; isActive?: boolean };
export const loadEodWork = async (employeeIds: string[], start: string, end: string, project?: string) => {
  const bounds = istBounds(start, end);
  const rawTasks = asDto<Array<Omit<WorkTask, "project"> & { project: EodTask["project"] | string }>>(await Task.find({ assignedEmployee: { $in: employeeIds }, createdAt: { $lte: bounds.end }, ...(project ? { project } : {}) }).lean());
  const projectIds = [...new Set(rawTasks.map(t => t.project).filter((p): p is string => typeof p === "string"))];
  const projects = projectIds.length ? asDto<Array<EodTask["project"]>>(await Project.find({ _id: { $in: projectIds } }).select("name").lean()) : [];
  const projectMap = new Map(projects.map(p => [p._id, p]));
  const tasks: WorkTask[] = rawTasks.map(t => ({ ...t, project: typeof t.project === "string" ? projectMap.get(t.project) ?? { _id: t.project, name: "Project unavailable" } : t.project }));
  const [activities, todos] = await Promise.all([
    TaskActivity.find({ task: { $in: tasks.map(t => t._id) }, createdAt: { $gte: bounds.start, $lte: bounds.end } }).lean(),
    DailyTodo.find({ employee: { $in: employeeIds }, date: { $gte: start, $lte: end }, type: { $ne: "PERSONAL" } }).lean()
  ]);
  return { tasks, activities: asDto<WorkActivity[]>(activities), todos: asDto<Array<{ employee: string; date: string; completed: boolean; status: string }>>(todos) };
};
const inPeriod = (date: string | undefined, start: string, end: string) => !!date && istDay(date) >= start && istDay(date) <= end;
export const completedTaskIds = (tasks: WorkTask[], activities: WorkActivity[], start: string, end: string) => new Set([
  ...tasks.filter(t => inPeriod(t.completionDate, start, end)).map(t => t._id),
  ...activities.filter(a => inPeriod(a.createdAt, start, end) && (a.action === "TASK_COMPLETED" || a.newValue?.status === "COMPLETED")).map(a => a.task)
]);
export const executionMetrics = (tasks: WorkTask[], activities: WorkActivity[], start: string, end: string) => {
  const completedIds = completedTaskIds(tasks, activities, start, end);
  const completed = tasks.filter(t => completedIds.has(t._id));
  const reviewed = completed.filter(t => t.qualityRating != null);
  const measured = completed.filter(t => t.actualHours != null);
  const terminal = new Set(["COMPLETED", "CANCELLED"]);
  const active = tasks.filter(t => t.isActive !== false);
  const now = Math.min(Date.now(), istBounds(end).end.getTime());
  const estimated = measured.reduce((sum, t) => sum + t.estimatedHours, 0);
  const actual = measured.reduce((sum, t) => sum + (t.actualHours ?? 0), 0);
  const dated = completed.filter(t => t.completionDate);
  return {
    assigned: tasks.filter(t => inPeriod(t.createdAt, start, end)).length,
    totalAssigned: active.length, completed: completedIds.size,
    inProgress: active.filter(t => t.status === "IN_PROGRESS").length, blocked: active.filter(t => t.status === "BLOCKED").length,
    inReview: active.filter(t => t.status === "IN_REVIEW").length, reopened: active.filter(t => t.status === "REOPENED").length,
    overdue: active.filter(t => !terminal.has(t.status) && Date.parse(t.deadline) < now).length,
    open: active.filter(t => !terminal.has(t.status)).length,
    onTimePercent: dated.length ? Math.round(dated.filter(t => Date.parse(t.completionDate!) <= Date.parse(t.deadline)).length / dated.length * 100) : null,
    averageQuality: reviewed.length ? Number((reviewed.reduce((sum, t) => sum + t.qualityRating!, 0) / reviewed.length).toFixed(2)) : null,
    estimatedHours: estimated, actualHours: actual, hoursVariance: measured.length ? actual - estimated : null,
    deliveryVarianceDays: dated.length ? Number((dated.reduce((sum, t) => sum + (Date.parse(t.completionDate!) - Date.parse(t.deadline)) / 86400000, 0) / dated.length).toFixed(2)) : null,
    measuredTasks: measured.length, rework: activities.filter(a => ["TASK_REOPENED", "STATUS_REOPENED"].includes(a.action)).length
  };
};
export const commitmentStates = (priorities: EodPriority[], tasks: EodTask[], carried: EodPriority[] = []): EodWorkSummary["commitments"] => priorities.map(p => {
  const task = tasks.find(t => t._id === p.task);
  return { ...p, state: task?.status === "COMPLETED" ? "COMPLETED" : task?.status === "BLOCKED" ? "NEWLY_BLOCKED" : carried.some(next => (p.task && p.task === next.task) || p.expectedOutcome === next.expectedOutcome) ? "CARRIED_FORWARD" : "PENDING" };
});
export const salesWorkSummary = async (employees: EodContext[], start: string, end: string): Promise<NonNullable<EodWorkSummary["sales"]>> => {
  const ids = employees.filter(e => e.department?.capabilities?.includes("SALES_MODULE")).map(e => e._id);
  const bounds = istBounds(start, end);
  const [leads, opportunities, revenue, leadActivities, callActivities, workItems, targets] = await Promise.all([
    SalesLead.find({ ownerEmployee: { $in: ids } }).lean(),
    SalesOpportunity.find({ ownerEmployee: { $in: ids } }).lean(),
    SalesRevenueTransaction.find({ employee: { $in: ids }, transactionDate: { $gte: bounds.start, $lte: bounds.end } }).lean(),
    LeadWorkActivity.find({ assignedEmployee: { $in: ids }, createdAt: { $gte: bounds.start, $lte: bounds.end } }).lean(),
    SalesActivity.find({ performedBy: { $in: employees.filter(e => ids.includes(e._id)).map(e => (e as EodContext & { user: string }).user) }, type: "CALL_LOG", createdAt: { $gte: bounds.start, $lte: bounds.end } }).lean(),
    LeadWorkItem.find({ assignedEmployee: { $in: ids }, status: "FOLLOW_UP", nextFollowUpAt: { $lt: bounds.end } }).lean(),
    SalesTarget.find({ employee: { $in: ids }, isLatest: true, status: "ACTIVE", periodStart: { $lte: bounds.end }, periodEnd: { $gte: bounds.start } }).lean()
  ]);
  const money: NonNullable<EodWorkSummary["sales"]>["money"] = {};
  const bucket = (currency: string) => money[currency] ??= { pipelineAdded: 0, revenueBooked: 0, revenueRecorded: 0, target: 0, targetRevenueRecorded: 0 };
  const dateIn = (date?: Date) => !!date && date >= bounds.start && date <= bounds.end;
  const created = asDto<Array<{ _id: string; createdAt: string }>>(opportunities);
  for (const op of opportunities) {
    if (inPeriod(created.find(c => c._id === String(op._id))?.createdAt, start, end)) bucket(op.currency).pipelineAdded += op.estimatedValue;
    if (op.status === "WON" && dateIn(op.actualCloseDate)) bucket(op.currency).revenueBooked += op.estimatedValue;
  }
  for (const txn of revenue) bucket(txn.currency).revenueRecorded += txn.amount;
  // Target achievement uses the full target period, not the selected day's revenue.
  if (targets.length) {
    const targetRevenue = await SalesRevenueTransaction.find({ employee: { $in: ids }, transactionDate: { $gte: new Date(Math.min(...targets.map(t => t.periodStart.getTime()))), $lte: bounds.end } }).lean();
    for (const target of targets) {
      bucket(target.currency).target += target.revenueTarget;
      bucket(target.currency).targetRevenueRecorded += targetRevenue.filter(t => String(t.employee) === String(target.employee) && t.currency === target.currency && t.transactionDate >= target.periodStart && t.transactionDate <= target.periodEnd).reduce((sum, t) => sum + t.amount, 0);
    }
  }
  const allowedLeads = new Set(leads.map(l => String(l._id)));
  return {
    metrics: { leadsContacted: new Set([...leadActivities.map(a => String(a.lead)), ...callActivities.filter(a => a.entityType === "leads" && allowedLeads.has(String(a.entityId))).map(a => String(a.entityId))]).size,
      qualifiedLeads: leads.filter(l => dateIn(l.qualifiedAt)).length, convertedLeads: leads.filter(l => dateIn(l.convertedAt)).length,
      meetings: leadActivities.filter(a => ["MEETING", "VIDEO_CALL"].includes(a.interactionType)).length,
      followupsCompleted: leadActivities.filter(a => a.fromStatus === "FOLLOW_UP").length, overdueFollowups: workItems.length,
      opportunitiesCreated: created.filter(o => inPeriod(o.createdAt, start, end)).length,
      revenueCollected: null }, money,
    hotOpportunities: asDto<NonNullable<EodWorkSummary["sales"]>["hotOpportunities"]>(opportunities.filter(o => o.status === "OPEN" && o.probability >= 70).sort((a, b) => b.estimatedValue * b.probability - a.estimatedValue * a.probability).slice(0, 10).map(o => ({ _id: o._id, name: o.name, probability: o.probability, estimatedValue: o.estimatedValue, currency: o.currency })))
  };
};
export const ownEodSummary = async (employee: EodContext, date: string, currentPriorities?: EodPriority[]): Promise<EodWorkSummary> => {
  const work = await loadEodWork([employee._id], date, date);
  const previous = await EodUpdate.findOne({ employee: employee._id, date: { $lt: date }, status: "SUBMITTED" }).sort({ date: -1 }).lean();
  const today = currentPriorities ? null : await EodUpdate.findOne({ employee: employee._id, date }).lean();
  const metrics = executionMetrics(work.tasks, work.activities, date, date);
  const completedIds = completedTaskIds(work.tasks, work.activities, date, date);
  return { generatedAt: new Date().toISOString(), date,
    metrics: { ...metrics, todosCompleted: work.todos.filter(t => t.completed || t.status === "COMPLETED").length, todosPending: work.todos.filter(t => !t.completed && !["COMPLETED", "CANCELLED"].includes(t.status)).length },
    completedTaskIds: [...completedIds],
    tasks: work.tasks.filter(t => completedIds.has(t._id) || (t.isActive !== false && !["COMPLETED", "CANCELLED"].includes(t.status))),
    ...(employee.department?.capabilities?.includes("SALES_MODULE") ? { sales: await salesWorkSummary([employee], date, date) } : {}),
    commitments: commitmentStates(previous?.priorities ?? [], work.tasks, currentPriorities ?? today?.priorities)
  };
};
