import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { listEod, saveEod, reviewEod } from "./eodRoutes.js";
import { Employee } from "../models/Employee.js";
import { EodUpdate } from "../models/EodUpdate.js";
import { AuditLog } from "../models/AuditLog.js";

const request = (role = "EMPLOYEE") => ({ user: { id: "user-a", role }, query: { date: "2026-01-01" }, params: { id: "report-a" }, body: { date: "2026-01-01", status: "SUBMITTED", accomplishments: "Delivered", nextPlan: "Verify" } }) as unknown as Request;
const response = () => {
  let data: unknown;
  return { response: { json: (value: unknown) => { data = value; } } as Response, data: () => data };
};
test("employees can only read and write their own employee report", async context => {
  context.mock.method(Employee, "findOne", async (filter: unknown) => { assert.deepEqual(filter, { user: "user-a", isActive: true }); return { _id: "employee-a" }; });
  context.mock.method(EodUpdate, "find", (filter: unknown) => { assert.deepEqual(filter, { employee: "employee-a", date: "2026-01-01" }); return { lean: async () => [] }; });
  context.mock.method(EodUpdate, "findOne", async () => null);
  context.mock.method(EodUpdate, "findOneAndUpdate", async (filter: unknown, changes: { $set: { employee: string }; $unset: unknown }) => {
    assert.deepEqual(filter, { employee: "employee-a", date: "2026-01-01" });
    assert.equal(changes.$set.employee, "employee-a");
    assert.deepEqual(changes.$unset, { acknowledgedAt: 1, acknowledgedBy: 1, managerComment: 1 });
    return { id: "report-a" };
  });
  context.mock.method(AuditLog, "create", async () => ({}));
  await listEod(request(), response().response);
  await saveEod(request(), response().response);
});
test("admin overview excludes private drafts", async context => {
  const chain = { select: () => chain, populate: () => chain, sort: () => chain, lean: async () => [] };
  context.mock.method(Employee, "find", () => chain);
  context.mock.method(EodUpdate, "find", (filter: unknown) => { assert.deepEqual(filter, { date: "2026-01-01", status: "SUBMITTED" }); return { lean: async () => [] }; });
  const captured = response();
  await listEod(request("SUPER_ADMIN"), captured.response);
  assert.deepEqual(captured.data(), { success: true, data: { employees: [], updates: [] } });
});
test("review is super-admin only and submitted reports cannot revert to draft", async context => {
  await assert.rejects(reviewEod(request(), response().response), /Only the super admin/);
  context.mock.method(Employee, "findOne", async () => ({ _id: "employee-a" }));
  context.mock.method(EodUpdate, "findOne", async () => ({ status: "SUBMITTED" }));
  const draft = request(); draft.body.status = "DRAFT";
  await assert.rejects(saveEod(draft, response().response), /cannot be changed back/);
});
