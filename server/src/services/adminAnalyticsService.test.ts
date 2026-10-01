import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { Task } from "../models/Task.js";
import { runWithTenant } from "../tenancy/tenantContext.js";
import { adminAnalytics } from "./adminAnalyticsService.js";

test("admin analytics groups PostgreSQL string identifiers by employee", async (context) => {
  const id = new Types.ObjectId().toString();
  context.mock.method(Employee, "find", () => ({ select: () => ({ sort: () => ({ lean: async () => [{ _id: id, firstName: "Test", lastName: "Employee", employeeId: "E001", status: "ACTIVE" }] }) }) }));
  context.mock.method(Task, "find", () => ({ select: () => ({ sort: () => ({ lean: async () => [{ _id: new Types.ObjectId().toString(), assignedEmployee: id, name: "Example", isActive: true, status: "COMPLETED", deadline: new Date(), completionDate: new Date(), estimatedHours: 1, actualHours: 1 }] }) }) }));
  const result = await runWithTenant(new Types.ObjectId(), adminAnalytics);
  assert.equal(result.people.length, 1);
  assert.equal(result.people[0]!.id, id);
  assert.equal(result.people[0]!.completed, 1);
});
