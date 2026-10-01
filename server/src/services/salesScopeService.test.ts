import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import type { SessionUser } from "@mobius-ems/shared";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { EmployeeTerritoryAssignment } from "../models/EmployeeTerritoryAssignment.js";
import { GeoNode } from "../models/GeoNode.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { resolveSalesScope } from "./salesScopeService.js";

test("employee sales scope normalizes lean territory and geography string IDs", async (context) => {
  const department = new Types.ObjectId().toString();
  const employee = new Types.ObjectId().toString();
  const territory = new Types.ObjectId().toString();
  const geo = new Types.ObjectId().toString();
  const global = new Types.ObjectId().toString();
  context.mock.method(Department, "find", () => ({ distinct: async () => [department] }));
  context.mock.method(Employee, "findOne", () => ({ select: () => ({ lean: async () => ({ _id: employee, department }) }) }));
  context.mock.method(Employee, "find", () => ({ distinct: async () => [employee] }));
  context.mock.method(EmployeeTerritoryAssignment, "find", () => ({ lean: async () => [{ territory }], distinct: async () => [employee] }));
  context.mock.method(SalesTerritory, "find", () => ({ distinct: async () => [geo] }));
  context.mock.method(GeoNode, "find", (filter: Record<string, unknown>) => ({
    distinct: async () => filter.type === "GLOBAL" ? [global] : [],
    select: () => ({ lean: async () => [{ _id: geo, ancestors: [global] }] }),
  }));
  const viewer = { id: new Types.ObjectId().toString(), permissions: ["sales.view.self"] } as SessionUser;
  const scope = await resolveSalesScope(viewer);
  assert.equal(scope.level, "SELF");
  assert.equal(scope.employeeId, employee);
  assert.deepEqual(scope.allowedTerritoryIds.map(String), [territory]);
  assert.deepEqual(scope.allowedGeoIds.map(String).sort(), [geo, global].sort());
  for (const id of [...scope.allowedEmployeeIds, ...scope.allowedTerritoryIds, ...scope.allowedGeoIds]) {
    assert.ok(id instanceof Types.ObjectId);
    assert.equal(id.equals(id.toString()), true);
  }
});
