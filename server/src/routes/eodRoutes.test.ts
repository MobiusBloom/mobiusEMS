import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Request, Response } from "express";
import { ROLE_PERMISSIONS, type RoleName } from "@mobius-ems/shared";
import { listEod, saveEod, reviewEod, detailEod } from "./eodRoutes.js";
import { Employee } from "../models/Employee.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { EodTemplate } from "../models/EodTemplate.js";
import { Task } from "../models/Task.js";
import { TaskActivity } from "../models/TaskActivity.js";
import { DailyTodo } from "../models/DailyTodo.js";
import { AuditLog } from "../models/AuditLog.js";
const employee = { _id: "employee-a", id: "employee-a", user: "user-a", department: { _id: "dept-a", name: "Engineering" }, designation: { _id: "designation-a", name: "Developer" }, firstName: "Alex", lastName: "A", employeeId: "EMP-A" };
const request = (role: RoleName = "EMPLOYEE") => ({ user: { id: "user-a", role, permissions: [...ROLE_PERMISSIONS[role]] }, query: { date: "2026-01-01" }, params: { id: "report-a" }, body: { date: "2026-01-01", status: "SUBMITTED", accomplishments: "Delivered", nextPlan: "Verify", responses: {}, priorities: [] } }) as unknown as Request;
const response = () => { let data: unknown; return { response: { json: (value: unknown) => { data = value; } } as Response, data: () => data }; };
const chain = (value: unknown) => { const q = { select: () => q, populate: () => q, sort: () => q, lean: async () => value }; return q; };
const saveSources = (context: TestContext) => {
  context.mock.method(Employee, "findOne", async () => employee);
  context.mock.method(Employee, "find", () => chain([employee]));
  context.mock.method(EodTemplate, "find", () => chain([]));
  context.mock.method(Task, "find", () => chain([]));
  context.mock.method(TaskActivity, "find", () => chain([]));
  context.mock.method(DailyTodo, "find", () => chain([]));
  context.mock.method(AuditLog, "create", async () => ({}));
};
test("employees can only read and write their own employee report", async context => {
  saveSources(context);
  context.mock.method(Employee, "findOne", async (filter: unknown) => { assert.deepEqual(filter, { user: "user-a", isActive: true }); return employee; });
  context.mock.method(EodUpdate, "find", (filter: unknown) => { assert.deepEqual(filter, { employee: "employee-a", date: "2026-01-01" }); return chain([]); });
  context.mock.method(EodUpdate, "findOne", () => { const q = { sort: () => q, lean: async () => null, then: (resolve: (v: null) => unknown) => Promise.resolve(resolve(null)) }; return q; });
  context.mock.method(EodUpdate, "findOneAndUpdate", async (filter: unknown, changes: { $set: { employee: string; departmentSnapshot: { id: string }; systemSummary: unknown }; $unset: unknown }) => {
    assert.deepEqual(filter, { employee: "employee-a", date: "2026-01-01" }); assert.equal(changes.$set.employee, "employee-a"); assert.equal(changes.$set.departmentSnapshot.id, "dept-a"); assert.ok(changes.$set.systemSummary);
    assert.deepEqual(changes.$unset, { acknowledgedAt: 1, acknowledgedBy: 1, managerComment: 1, review: 1 }); return { id: "report-a" };
  });
  await listEod(request(), response().response); await saveEod(request(), response().response);
});
test("admin overview excludes private drafts and remains backward compatible", async context => {
  context.mock.method(Employee, "find", () => chain([]));
  const legacy = { employee: "employee-a", date: "2026-01-01", accomplishments: "Legacy work", nextPlan: "Legacy plan", status: "SUBMITTED" };
  context.mock.method(EodUpdate, "find", (filter: unknown) => { assert.deepEqual(filter, { date: "2026-01-01", status: "SUBMITTED" }); return chain([legacy]); });
  const captured = response(); await listEod(request("SUPER_ADMIN"), captured.response);
  assert.deepEqual(captured.data(), { success: true, data: { employees: [], updates: [legacy], scope: "all" } });
});
test("review requires explicit permission and submitted reports cannot revert to draft", async context => {
  await assert.rejects(reviewEod(request(), response().response), /EOD access is not permitted/);
  context.mock.method(Employee, "findOne", async () => employee);
  context.mock.method(EodUpdate, "findOne", async () => ({ status: "SUBMITTED" }));
  const draft = request(); draft.body.status = "DRAFT";
  await assert.rejects(saveEod(draft, response().response), /cannot be changed back/);
});
test("updating a submitted report preserves historical organization and template", async context => {
  saveSources(context);
  const template = { name: "Old engineering", version: 3, adapter: "ENGINEERING", sections: [] };
  const existing = { status: "SUBMITTED", departmentSnapshot: { id: "old-dept", name: "Old department" }, templateSnapshot: template };
  context.mock.method(EodUpdate, "findOne", () => { const q = { sort: () => q, lean: async () => existing, then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(existing)) }; return q; });
  context.mock.method(EodUpdate, "findOneAndUpdate", async (_filter: unknown, changes: { $set: Record<string, unknown> }) => {
    for (const key of ["departmentSnapshot", "designationSnapshot", "teamSnapshot", "reportingManagerSnapshot", "templateSnapshot", "templateVersion"]) assert.equal(key in changes.$set, false);
    return { id: "report-a" };
  });
  await saveEod(request(), response().response);
});
test("linked priorities cannot reference another employee's tasks", async context => {
  saveSources(context);
  context.mock.method(EodUpdate, "findOne", async () => null);
  context.mock.method(Task, "find", (filter: { assignedEmployee: string }) => { assert.equal(filter.assignedEmployee, "employee-a"); return { distinct: async () => [] }; });
  const req = request(); req.body.priorities = [{ task: "task-other", priority: "HIGH", expectedOutcome: "Ship" }];
  await assert.rejects(saveEod(req, response().response), /must belong to your work/);
});
test("review only updates submitted in-scope records, audits feedback, and detects changed reports", async context => {
  context.mock.method(EodUpdate, "findOne", async (filter: { status: string }) => { assert.equal(filter.status, "SUBMITTED"); return { _id: "report-a", employee: "employee-b", submittedAt: new Date("2026-01-01T13:00:00Z") }; });
  context.mock.method(Employee, "findOne", async () => employee);
  context.mock.method(AuditLog, "create", async () => ({}));
  context.mock.method(EodUpdate, "findOneAndUpdate", async (filter: { status: string; submittedAt: Date }, change: { $set: { review: { state: string }; managerComment: string } }) => { assert.equal(filter.status, "SUBMITTED"); assert.ok(filter.submittedAt); assert.equal(change.$set.review.state, "SUPPORT_REQUIRED"); return { id: "report-a" }; });
  const req = request("SUPER_ADMIN"); req.body = { state: "SUPPORT_REQUIRED", managerComment: "Provision access" };
  await reviewEod(req, response().response);
  context.mock.method(EodUpdate, "findOneAndUpdate", async () => null);
  await assert.rejects(reviewEod(req, response().response), /report changed/);
});
test("self-review and out-of-scope review are rejected", async context => {
  context.mock.method(Employee, "findOne", async () => employee);
  context.mock.method(EodUpdate, "findOne", async () => ({ _id: "report-a", employee: "employee-a" }));
  await assert.rejects(reviewEod(request("SUPER_ADMIN"), response().response), /cannot review your own/);
  context.mock.method(EodUpdate, "findOne", async () => null);
  await assert.rejects(reviewEod(request("SUPER_ADMIN"), response().response), /not found/);
});
test("direct report lookup exposes another employee only when submitted", async context => {
  context.mock.method(Employee, "findOne", async () => employee);
  context.mock.method(EodUpdate, "findOne", (filter: { $or: Array<{ employee?: string; status?: string }> }) => {
    assert.deepEqual(filter.$or[0], { employee: "employee-a", status: "SUBMITTED" });
    assert.deepEqual(filter.$or[1], { employee: "employee-a" }); return chain(null);
  });
  await assert.rejects(detailEod(request(), response().response), /not found/);
});
