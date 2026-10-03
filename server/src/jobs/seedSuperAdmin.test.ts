import assert from "node:assert/strict";
import test from "node:test";
import { ROLE_PERMISSIONS, ROLES, type PermissionName } from "@mobius-ems/shared";
import { Role, type RoleDocument } from "../models/Role.js";
import { AuditLog } from "../models/AuditLog.js";
import { seedTenantRoles } from "./seedSuperAdmin.js";
import { updateRolePermissions, updateRoleSectionAccess } from "../services/peopleOpsService.js";

const isEodPermission = (permission: PermissionName) => permission === "section.eod" || permission.startsWith("eod.");

test("startup grants legacy built-in roles only their EOD defaults once and leaves custom roles alone", async t => {
  const roles = new Map<string, RoleDocument & { save(): Promise<void> }>(ROLES.map(name => [name, {
    name, description: name, permissions: ROLE_PERMISSIONS[name].filter(permission => !isEodPermission(permission)), isSystem: true,
    save: async () => {}
  }]));
  const employee = roles.get("EMPLOYEE")!;
  employee.permissions = employee.permissions.filter(permission => permission !== "document.upload");
  const unrelatedPermissions = [...employee.permissions];
  const lead = roles.get("TEAM_LEAD")!;
  lead.permissions = lead.permissions.filter(permission => !permission.startsWith("section."));
  const custom = { name: "REVIEWER", description: "Custom reviewer", baseRole: "MANAGER" as const, isSystem: false, permissions: ["section.dashboard" as const] };
  const customBefore = structuredClone(custom);
  t.mock.method(Role, "findOne", async ({ name }: { name: string }) => roles.get(name) ?? custom);
  t.mock.method(Role, "create", async () => { throw new Error("Existing roles must not be recreated"); });

  await seedTenantRoles();
  assert.deepEqual(employee.permissions.filter(permission => !isEodPermission(permission)), unrelatedPermissions);
  for (const name of ROLES) {
    assert.deepEqual(new Set(roles.get(name)!.permissions.filter(isEodPermission)), new Set(ROLE_PERMISSIONS[name].filter(isEodPermission)));
    assert.equal(roles.get(name)!.eodPermissionsInitialized, true);
  }
  assert.deepEqual(custom, customBefore);
  assert.deepEqual(new Set(lead.permissions), new Set(ROLE_PERMISSIONS.TEAM_LEAD));
  employee.permissions = employee.permissions.filter(permission => !isEodPermission(permission));
  await seedTenantRoles();
  assert.deepEqual(employee.permissions, unrelatedPermissions);
  employee.permissions = ["document.view"];
  await seedTenantRoles();
  assert.equal(employee.permissions.some(isEodPermission), false);
});

test("startup preserves explicitly configured EOD grants and marks newly created roles initialized", async t => {
  const employee = { name: "EMPLOYEE", description: "Employee", isSystem: true, permissions: ["section.dashboard", "eod.view.self"] as PermissionName[], save: async () => {} };
  const created: Array<RoleDocument> = [];
  t.mock.method(Role, "findOne", async ({ name }: { name: string }) => name === "EMPLOYEE" ? employee : null);
  t.mock.method(Role, "create", async (input: RoleDocument) => { created.push(input); return input; });
  await seedTenantRoles();
  assert.deepEqual(employee.permissions, ["section.dashboard", "eod.view.self"]);
  assert.equal(created.length, ROLES.length - 1);
  assert.ok(created.every(role => role.eodPermissionsInitialized));
  assert.deepEqual(created.find(role => role.name === "APPLICANT")!.permissions, ["section.assessments"]);
});

test("admin permission and section edits prevent startup from restoring revoked EOD access", async t => {
  const employee: RoleDocument & { id: string; save(): Promise<void> } = { id: "employee-role", name: "EMPLOYEE", description: "Employee", isSystem: true, permissions: ["section.dashboard"], save: async () => {} };
  t.mock.method(Role, "findById", async () => employee);
  t.mock.method(AuditLog, "create", async () => ({}));
  await updateRolePermissions(employee.id, ["section.dashboard", "document.view"], "admin");
  assert.equal(employee.eodPermissionsInitialized, true);
  employee.eodPermissionsInitialized = undefined;
  await updateRoleSectionAccess(employee.id, ["section.dashboard"], "admin");
  assert.equal(employee.eodPermissionsInitialized, true);
  assert.deepEqual(employee.permissions, ["document.view", "section.dashboard"]);
});
