import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Types } from "mongoose";
import type { SessionUser } from "@mobius-ems/shared";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { GeoNode } from "../models/GeoNode.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesActivity } from "../models/SalesActivity.js";
import { AuditLog } from "../models/AuditLog.js";
import { createSalesData, updateSalesData } from "./salesDataService.js";
import { leadAttributionForUser } from "./leadAttributionService.js";

const creator = new Types.ObjectId();
const assignee = new Types.ObjectId();
const userId = new Types.ObjectId().toString();
const viewer = { id: userId, email: "sales@example.com", role: "MANAGER", permissions: ["sales.view.all"] } as SessionUser;
const mockScope = (t: TestContext) => {
  t.mock.method(Department, "find", () => ({ distinct: async () => [] }) as never);
  t.mock.method(Employee, "find", () => ({ distinct: async () => [creator, assignee] }) as never);
  t.mock.method(SalesTerritory, "find", () => ({ distinct: async () => [] }) as never);
  t.mock.method(GeoNode, "find", () => ({ distinct: async () => [] }) as never);
  t.mock.method(Employee, "exists", async () => ({ _id: assignee }));
  t.mock.method(AuditLog, "create", async () => ({}));
  t.mock.method(SalesActivity, "create", async () => ({}));
};

test("creating a lead records authenticated employee rather than assigned or supplied creator", async (t) => {
  mockScope(t);
  t.mock.method(Employee, "findOne", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { user: userId, isActive: true });
    return { select: () => ({ lean: async () => ({ _id: creator }) }) } as never;
  });
  let saved: Record<string, unknown> = {};
  t.mock.method(SalesLead, "create", async (input: Record<string, unknown>) => {
    saved = input;
    return { _id: new Types.ObjectId(), id: new Types.ObjectId().toString() };
  });
  await createSalesData(viewer, "leads", { name: "New prospect", ownerEmployee: assignee.toString(), createdBy: "spoofed", createdByEmployee: assignee.toString() });
  assert.equal(saved.ownerEmployee, assignee.toString());
  assert.equal(saved.createdBy, userId);
  assert.equal(String(saved.createdByEmployee), creator.toString());
});

test("reassigning a lead preserves its original creator despite attempted overwrite", async (t) => {
  mockScope(t);
  const data: Record<string, unknown> = { ownerEmployee: creator, createdBy: userId, createdByEmployee: creator, status: "NEW" };
  const record = { id: new Types.ObjectId().toString(), get: (key: string) => data[key], toObject: () => ({ ...data }), set: (input: Record<string, unknown>) => Object.assign(data, input), save: async () => undefined };
  t.mock.method(SalesLead, "findOne", async () => record);
  await updateSalesData(viewer, "leads", record.id, { ownerEmployee: assignee.toString(), createdBy: "spoofed", createdByEmployee: assignee.toString() });
  assert.equal(data.ownerEmployee, assignee.toString());
  assert.equal(data.createdBy, userId);
  assert.equal(String(data.createdByEmployee), creator.toString());
});

test("account without employee profile records user and does not credit assignee", async (t) => {
  t.mock.method(Employee, "findOne", () => ({ select: () => ({ lean: async () => null }) }) as never);
  const attribution = await leadAttributionForUser(userId);
  assert.equal(attribution.createdBy, userId);
  assert.equal(attribution.createdByEmployee, undefined);
});
