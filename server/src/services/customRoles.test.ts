import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { createRoleSchema, roleAssignmentSchema } from "../validators/peopleOpsValidators.js";
import { assignRole, createRole, updateRolePermissions } from "./peopleOpsService.js";

test("custom role input normalizes names and rejects unknown authority and Super Admin scope", () => {
  const input = { name: "Sales reviewer", baseRole: "MANAGER", permissions: ["section.sales", "sales.view.team"] };
  assert.equal(createRoleSchema.parse({ body: input }).body.name, "SALES_REVIEWER");
  assert.equal(createRoleSchema.safeParse({ body: { ...input, name: "super admin" } }).success, false);
  assert.equal(createRoleSchema.safeParse({ body: { ...input, baseRole: "SUPER_ADMIN" } }).success, false);
  assert.equal(createRoleSchema.safeParse({ body: { ...input, permissions: ["unknown.manage"] } }).success, false);
  assert.equal(roleAssignmentSchema.safeParse({ params: { id: "invalid" }, body: { email: "a@example.com" } }).success, false);
});

test("custom role creation rejects duplicate names", async t => {
  t.mock.method(Role, "exists", async () => ({ _id: "existing" }));
  await assert.rejects(createRole({ name: "REVIEWER", description: "Reviewer", baseRole: "MANAGER", permissions: [] }, "actor"), /already exists/);
});

test("Super Admin permissions and account assignments stay protected", async t => {
  t.mock.method(Role, "findById", async () => ({ name: "SUPER_ADMIN" }));
  await assert.rejects(updateRolePermissions("role", [], "actor"), /always has full access/);
  await assert.rejects(assignRole("role", "admin@example.com", "actor"), /Super Admin/);
  t.mock.method(Role, "findById", async () => ({ name: "REVIEWER" }));
  t.mock.method(User, "findOne", () => ({ populate: async () => ({ role: { name: "SUPER_ADMIN" } }) }) as never);
  await assert.rejects(assignRole("role", "admin@example.com", "actor"), /protected/);
});
