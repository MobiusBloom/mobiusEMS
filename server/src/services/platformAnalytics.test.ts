import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { postgres } from "../persistence/postgres.js";
import { isSystemContext } from "../tenancy/tenantContext.js";
import { platformAnalytics } from "./tenantService.js";

test("platform analytics reads all workspaces within system scope", async (context) => {
  const first = new Types.ObjectId().toString();
  const second = new Types.ObjectId().toString();
  const role = new Types.ObjectId().toString();
  const createdAt = "2026-10-01T00:00:00.000Z";
  const tenants = [first, second].map((_id, index) => ({ _id, name: `Company ${index}`, slug: `company-${index}`, status: "ACTIVE", createdAt }));
  const users = [first, second].map((tenantId, index) => ({ _id: new Types.ObjectId().toString(), tenantId, name: `Admin ${index}`, email: `admin${index}@example.com`, isActive: true, role, createdAt }));
  context.mock.method(postgres, "query", async (sql: string) => {
    assert.equal(isSystemContext(), true);
    assert.ok(sql.startsWith("SELECT"));
    const documents = sql.includes('"tenants"') ? tenants : sql.includes('"roles"') ? [{ _id: role, name: "SUPER_ADMIN" }] : users;
    return { rows: documents.map((document) => ({ document })) };
  });
  const result = await platformAnalytics();
  assert.equal(result.summary.organizations, 2);
  assert.equal(result.summary.users, 2);
  assert.deepEqual(result.items.map((item) => item.userCount), [1, 1]);
  assert.equal(result.items[0]!.adminUsers[0]!.email, "admin0@example.com");
  assert.equal(result.items[1]!.adminUsers[0]!.email, "admin1@example.com");
  assert.equal(isSystemContext(), false);
});
