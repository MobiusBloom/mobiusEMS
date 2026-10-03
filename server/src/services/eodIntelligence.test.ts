import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { ROLE_PERMISSIONS, EOD_ADAPTERS, type EodContext, type EodResponseValue, type EodTemplateDefinition, type SessionUser } from "@mobius-ems/shared";
import { defaultEodTemplate, selectEodTemplate, validateEodResponses, refreshBuiltinDraftTemplate } from "./eodTemplateService.js";
import { commitmentStates, completedTaskIds, executionMetrics, istBounds, salesWorkSummary, type WorkTask } from "./eodWorkService.js";
import { blockerAnalytics, employeeContextQuery, getEodAnalytics } from "./eodAnalyticsService.js";
import { resolveEodScope, eodScopeLevel } from "./eodScopeService.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { Designation } from "../models/Designation.js";
import { Team } from "../models/Team.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { EodTemplate } from "../models/EodTemplate.js";
import { Task } from "../models/Task.js";
import { TaskActivity } from "../models/TaskActivity.js";
import { DailyTodo } from "../models/DailyTodo.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesOpportunity } from "../models/SalesOpportunity.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesActivity } from "../models/SalesActivity.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { LeadWorkActivity } from "../models/LeadWorkActivity.js";
import { LeadWorkItem } from "../models/LeadWorkItem.js";
import { eodTemplateInput } from "../validators/eodValidators.js";
import { runWithTenant } from "../tenancy/tenantContext.js";
const chain = (value: unknown, ids: unknown[] = []) => { const q = { select: () => q, populate: () => q, sort: () => q, lean: async () => value, distinct: async () => ids, then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(value)) }; return q; };
const employee: EodContext = { _id: "employee-a", employeeId: "A", firstName: "Alex", lastName: "A", department: { _id: "dept-a", name: "Engineering" }, designation: { _id: "des-a", name: "Developer" }, dateOfJoining: "2025-01-01T00:00:00Z" };
const task = (changes: Partial<WorkTask> = {}): WorkTask => ({ _id: "task-a", taskId: "TASK-A", name: "Ship", assignedEmployee: employee._id, department: "dept-a", project: { _id: "project-a", name: "Portal" }, createdAt: "2026-01-01T00:00:00Z", status: "COMPLETED", priority: "HIGH", deadline: "2026-01-01T14:00:00Z", completionDate: "2026-01-01T12:00:00Z", estimatedHours: 4, actualHours: 6, qualityRating: 4, reopenCount: 0, ...changes });
test("template resolution prefers designation then department then organization default", () => {
  const common: EodTemplateDefinition = { name: "Default", version: 8, adapter: "GENERAL", isDefault: true, sections: [] };
  const department = { ...common, name: "Department", department: "dept-a", version: 2 };
  const designation = { ...department, name: "Designation", designation: "des-a", version: 1 };
  assert.equal(selectEodTemplate([common, department, designation], employee).name, "Designation");
  assert.equal(selectEodTemplate([common, department, { ...designation, isActive: false }], employee).name, "Department");
  assert.equal(selectEodTemplate([common, { ...department, department: "other" }], employee).name, "Default");
});
test("every supported department resolves a distinct form with a valid saved-template schema", () => {
  const cases = [["Information Technology", "ENGINEERING"], ["AI/ML", "AI_ML"], ["Human Resources", "HR"], ["Marketing", "MARKETING"], ["Sales", "SALES"], ["Operations", "OPERATIONS"], ["Finance & Accounts", "FINANCE"], ["Administration", "ADMINISTRATION"], ["Customer Support", "SUPPORT"], ["UI UX Design", "DESIGN"], ["Other", "GENERAL"]] as const;
  const fieldSets = new Set<string>();
  for (const [name, adapter] of cases) {
    const template = defaultEodTemplate({ ...employee, department: { _id: "dept", name } });
    assert.equal(template.adapter, adapter);
    assert.ok(template.sections.length >= 3);
    assert.ok(eodTemplateInput.safeParse(template).success);
    validateEodResponses(template, {}, true);
    fieldSets.add(template.sections.flatMap(s => s.fields).map(f => f.key).join(","));
  }
  assert.equal(fieldSets.size, EOD_ADAPTERS.length);
  assert.equal(defaultEodTemplate({ ...employee, department: { _id: "sales", name: "Growth", capabilities: ["SALES_MODULE"] } }).adapter, "SALES");
});
test("built-in draft refresh retains every old response field and never changes custom or submitted schemas", () => {
  const fields = ["technicalSummary", "deliveryEvidence", "validationNotes", "implementationDecision", "technicalLearning", "dependency"].map(key => ({ key, label: key, type: "TEXTAREA" as const }));
  const old: EodTemplateDefinition = { name: "Engineering daily report", version: 2, adapter: "ENGINEERING", sections: [{ key: "department", title: "Technical delivery context", fields }] };
  const refreshed = refreshBuiltinDraftTemplate(employee, old, false);
  assert.equal(refreshed.version, 3);
  for (const field of fields) assert.ok(refreshed.sections.some(s => s.fields.some(f => f.key === field.key && f.type === field.type)));
  validateEodResponses(refreshed, { technicalSummary: "Saved text", dependency: "Saved support request" }, false);
  assert.equal(refreshBuiltinDraftTemplate(employee, old, true), old);
  const custom = { ...old, _id: "custom-template" };
  assert.equal(refreshBuiltinDraftTemplate(employee, custom, false), custom);
  const otherDepartment = { ...employee, department: { _id: "hr", name: "HR" } };
  assert.equal(refreshBuiltinDraftTemplate(otherDepartment, old, false), old);
  const general: EodTemplateDefinition = { ...old, adapter: "GENERAL", version: 1, sections: [{ key: "department", title: "Department update", fields: [{ key: "departmentContext", label: "Important department context", type: "TEXTAREA" }] }] };
  const upgraded = refreshBuiltinDraftTemplate(employee, general, false);
  assert.equal(upgraded.adapter, "ENGINEERING");
  validateEodResponses(upgraded, { departmentContext: "Earlier draft text", technicalSummary: "New context" }, false);
});
test("template responses enforce types, requirements, options, dates and immutable system metrics", () => {
  const template: EodTemplateDefinition = { name: "Test", version: 1, adapter: "GENERAL", sections: [{ key: "context", title: "Context", fields: [{ key: "result", label: "Result", type: "TEXT", required: true }, { key: "count", label: "Count", type: "NUMBER" }, { key: "rating", label: "Rating", type: "RATING" }, { key: "day", label: "Day", type: "DATE" }, { key: "outcome", label: "Outcome", type: "SELECT", options: ["SUCCESS"] }, { key: "source", label: "Completed", type: "NUMBER", source: "TASKS_COMPLETED_TODAY" }] }] };
  validateEodResponses(template, {}, false);
  assert.throws(() => validateEodResponses(template, {}, true), /required/);
  const invalid: Record<string, EodResponseValue>[] = [{ count: "5" }, { rating: 8 }, { day: "2026-02-30" }, { outcome: "UNKNOWN" }, { source: 999 }, { unknown: "x" }];
  for (const response of invalid) assert.throws(() => validateEodResponses(template, { result: "Outcome", ...response }, true));
  validateEodResponses(template, { result: "Delivered", count: 3, rating: 4, day: "2026-01-01", outcome: "SUCCESS" }, true);
});
test("task summary deduplicates completions and derives hours, quality, on-time and rework", () => {
  const activities = [{ task: "task-a", action: "TASK_COMPLETED", createdAt: "2026-01-01T12:00:00Z" }, { task: "task-a", action: "TASK_REOPENED", createdAt: "2026-01-01T13:00:00Z" }];
  assert.equal(completedTaskIds([task()], activities, "2026-01-01", "2026-01-01").size, 1);
  const metrics = executionMetrics([task()], activities, "2026-01-01", "2026-01-01");
  assert.equal(metrics.completed, 1); assert.equal(metrics.hoursVariance, 2); assert.equal(metrics.averageQuality, 4); assert.equal(metrics.onTimePercent, 100); assert.equal(metrics.rework, 1);
  assert.equal(executionMetrics([], [], "2026-01-01", "2026-01-01").averageQuality, null);
});
test("archived tasks preserve historical completions but cannot inflate the open backlog", () => {
  const tasks = [task({ isActive: false, status: "BLOCKED", blocker: { reason: "OTHER", startedAt: "2026-01-01T00:00:00Z" } })];
  const metrics = executionMetrics(tasks, [], "2026-01-01", "2026-01-01");
  assert.equal(metrics.completed, 1); assert.equal(metrics.blocked, 0); assert.equal(metrics.open, 0);
  assert.equal(blockerAnalytics(tasks, [], "2026-01-01", "2026-01-01").active, 0);
});
test("employee context joins use bulk lookups rather than queries for every employee", async context => {
  context.mock.method(Employee, "find", () => chain([{ ...employee, department: "dept-a", designation: "des-a" }, { ...employee, _id: "employee-b", department: "dept-a", designation: "des-a" }]));
  let departmentQueries = 0, designationQueries = 0;
  context.mock.method(Department, "find", (filter: unknown) => { departmentQueries++; assert.deepEqual(filter, { _id: { $in: ["dept-a"] } }); return chain([employee.department]); });
  context.mock.method(Designation, "find", (filter: unknown) => { designationQueries++; assert.deepEqual(filter, { _id: { $in: ["des-a"] } }); return chain([employee.designation]); });
  const contexts = await employeeContextQuery({ isActive: true });
  assert.equal(contexts.length, 2); assert.equal(contexts[1]!.department!.name, "Engineering");
  assert.equal(departmentQueries, 1); assert.equal(designationQueries, 1);
});
test("IST boundaries include evening UTC activity on the following local day", () => {
  assert.equal(istBounds("2026-01-02").start.toISOString(), "2026-01-01T18:30:00.000Z");
  assert.equal(completedTaskIds([task({ completionDate: "2026-01-01T19:00:00Z" })], [], "2026-01-02", "2026-01-02").size, 1);
});
test("blocker analytics distinguish unresolved source work and created/resolved events", () => {
  const tasks = [task({ status: "BLOCKED", blocker: { reason: "ACCESS_REQUIRED", startedAt: new Date(Date.now() - 3 * 86400000).toISOString() } }), task({ _id: "resolved", status: "IN_PROGRESS", blocker: { reason: "DEPENDENCY", startedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-01T12:00:00Z" } })];
  const result = blockerAnalytics(tasks, [{ task: "task-a", action: "TASK_BLOCKED", createdAt: "2026-01-01T01:00:00Z" }, { task: "resolved", action: "TASK_UNBLOCKED", createdAt: "2026-01-01T12:00:00Z" }], "2026-01-01", "2026-01-01");
  assert.equal(result.active, 1); assert.equal(result.created, 1); assert.equal(result.resolved, 1); assert.equal(result.byReason.ACCESS_REQUIRED, 1); assert.equal(result.byProject["project-a"], 1); assert.equal(result.longestAgeDays, 3);
});
test("commitments use task state and explicit carry-forward without judging unlinked work", () => {
  const priorities = ["completed", "blocked", "carry", undefined].map((id, i) => ({ task: id, priority: "HIGH" as const, expectedOutcome: `Outcome ${i}` }));
  const results = commitmentStates(priorities, [task({ _id: "completed" }), task({ _id: "blocked", status: "BLOCKED" }), task({ _id: "carry", status: "IN_PROGRESS" })], [priorities[2]!]);
  assert.deepEqual(results.map(p => p.state), ["COMPLETED", "NEWLY_BLOCKED", "CARRIED_FORWARD", "PENDING"]);
});
test("RBAC grants only appropriate EOD scopes and HR has no broad EOD grant by default", () => {
  assert.equal(eodScopeLevel(ROLE_PERMISSIONS.EMPLOYEE, "view"), "self"); assert.equal(eodScopeLevel(ROLE_PERMISSIONS.MANAGER, "review"), "team");
  assert.equal(eodScopeLevel(ROLE_PERMISSIONS.DEPARTMENT_HEAD, "analytics"), "department"); assert.equal(eodScopeLevel(ROLE_PERMISSIONS.SUPER_ADMIN, "analytics"), "all");
  assert.equal(eodScopeLevel(ROLE_PERMISSIONS.HR_ADMIN, "view"), "self"); assert.throws(() => eodScopeLevel(ROLE_PERMISSIONS.HR_ADMIN, "review")); assert.throws(() => eodScopeLevel(ROLE_PERMISSIONS.APPLICANT, "view"));
});
test("manager scope follows reporting hierarchy and managed teams without organization fallback", async context => {
  const own = new Types.ObjectId(), subordinate = new Types.ObjectId(), teamMember = new Types.ObjectId();
  context.mock.method(Employee, "findOne", () => chain({ _id: own, id: String(own), department: new Types.ObjectId() }));
  context.mock.method(Employee, "find", (filter: { reportingManager?: { $in: Types.ObjectId[] }; team?: unknown }) => chain([], filter.team ? [teamMember] : filter.reportingManager?.$in.some(id => id.equals(own)) ? [subordinate] : []));
  context.mock.method(Team, "find", () => chain([], [new Types.ObjectId()]));
  const result = await resolveEodScope({ id: "manager", role: "MANAGER", permissions: [...ROLE_PERMISSIONS.MANAGER] } as SessionUser, "view");
  assert.deepEqual(new Set(result.employeeFilter._id && "$in" in result.employeeFilter._id ? result.employeeFilter._id.$in : []), new Set([String(own), String(subordinate), String(teamMember)]));
});
test("department scope uses submission snapshot and a separate legacy fallback", async context => {
  const dept = new Types.ObjectId(), own = new Types.ObjectId(), colleague = new Types.ObjectId();
  context.mock.method(Employee, "findOne", async () => ({ _id: own, id: String(own), department: dept }));
  context.mock.method(Department, "find", () => chain([], [dept])); context.mock.method(Employee, "find", () => chain([], [own, colleague]));
  const scope = await resolveEodScope({ id: "head", permissions: [...ROLE_PERMISSIONS.DEPARTMENT_HEAD] } as SessionUser, "view");
  assert.deepEqual(scope.reportFilter, { $or: [{ "departmentSnapshot.id": { $in: [String(dept)] } }, { departmentSnapshot: { $exists: false }, employee: { $in: [own, colleague] } }] });
});
test("analytics applies department, project, health and date filters on the server and hides drafts", async context => {
  const employees = [employee, { ...employee, _id: "employee-b", department: { _id: "dept-b", name: "Marketing" } }];
  context.mock.method(Employee, "find", () => chain(employees));
  context.mock.method(EodUpdate, "find", (filter: { status: string; date: { $lte: string } }) => { assert.equal(filter.status, "SUBMITTED"); assert.equal(filter.date.$lte, "2026-01-01"); return chain([{ _id: "report-a", employee: "employee-a", date: "2026-01-01", status: "SUBMITTED", health: "AT_RISK", departmentSnapshot: { id: "dept-a", name: "Engineering" }, responses: {}, priorities: [] }, { _id: "report-b", employee: "employee-b", date: "2026-01-01", status: "SUBMITTED", health: "ON_TRACK" }]); });
  context.mock.method(Task, "find", (filter: { assignedEmployee: { $in: string[] }; project: string }) => { assert.deepEqual(filter.assignedEmployee.$in, ["employee-a"]); assert.equal(filter.project, "project-a"); return chain([task()]); });
  context.mock.method(TaskActivity, "find", () => chain([])); context.mock.method(DailyTodo, "find", () => chain([]));
  const data = await getEodAnalytics({ permissions: [...ROLE_PERMISSIONS.SUPER_ADMIN] } as SessionUser, { start: "2026-01-01", end: "2026-01-01", department: "dept-a", project: "project-a", health: "AT_RISK", blockerDays: 2, lowCoverage: 60 });
  assert.equal(data.overview.employees, 1); assert.equal(data.overview.submitted, 1); assert.equal(data.updates[0]!.employee, "employee-a"); assert.equal(data.trend.length, 1); assert.equal(data.trend[0]!.overdue, null);
});
test("sales summaries derive distinct contacts, follow-ups, meetings and separate currencies", async context => {
  const date = new Date("2026-01-01T10:00:00Z");
  context.mock.method(SalesLead, "find", () => chain([{ _id: "lead-a", qualifiedAt: date }]));
  context.mock.method(SalesOpportunity, "find", () => chain([{ _id: "op-a", name: "Contract", currency: "INR", status: "WON", estimatedValue: 1000, createdAt: date, actualCloseDate: date, probability: 100 }, { _id: "op-b", name: "US", currency: "USD", status: "OPEN", estimatedValue: 50, createdAt: date, probability: 80 }]));
  context.mock.method(SalesRevenueTransaction, "find", () => chain([{ employee: employee._id, currency: "INR", amount: 800, transactionDate: date }]));
  context.mock.method(LeadWorkActivity, "find", () => chain([{ lead: "lead-a", interactionType: "MEETING", fromStatus: "FOLLOW_UP" }, { lead: "lead-a", interactionType: "PHONE_CALL" }]));
  context.mock.method(SalesActivity, "find", () => chain([{ entityType: "leads", entityId: "lead-a" }, { entityType: "leads", entityId: "other-owner" }]));
  context.mock.method(LeadWorkItem, "find", () => chain([{}])); context.mock.method(SalesTarget, "find", () => chain([]));
  const data = await salesWorkSummary([{ ...employee, department: { ...employee.department!, capabilities: ["SALES_MODULE"] } }], "2026-01-01", "2026-01-01");
  assert.equal(data.metrics.leadsContacted, 1); assert.equal(data.metrics.meetings, 1); assert.equal(data.metrics.followupsCompleted, 1); assert.equal(data.metrics.qualifiedLeads, 1); assert.equal(data.metrics.revenueCollected, null);
  assert.equal(data.money.INR!.pipelineAdded, 1000); assert.equal(data.money.USD!.pipelineAdded, 50); assert.equal(data.money.INR!.revenueRecorded, 800); assert.equal(data.hotOpportunities.length, 1);
});
test("EOD and template operations reject cross-tenant access before database execution", () => {
  const tenant = new Types.ObjectId(), otherTenant = new Types.ObjectId();
  assert.throws(() => runWithTenant(tenant, () => EodUpdate.find({ tenantId: otherTenant })), /Cross-tenant/);
  assert.throws(() => runWithTenant(tenant, () => EodTemplate.find({ tenantId: otherTenant })), /Cross-tenant/);
  assert.throws(() => runWithTenant(tenant, () => EodUpdate.findOneAndUpdate({}, { $set: { tenantId: otherTenant } })), /Cross-tenant/);
  assert.throws(() => runWithTenant(tenant, () => EodTemplate.findOneAndUpdate({}, { $set: { tenantId: otherTenant } })), /Cross-tenant/);
});
