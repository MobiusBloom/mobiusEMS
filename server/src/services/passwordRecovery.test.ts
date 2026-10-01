import assert from "node:assert/strict";
import test from "node:test";
import { Schema, Types } from "mongoose";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Tenant } from "../models/Tenant.js";
import { isSystemContext, currentTenantId, runWithTenant } from "../tenancy/tenantContext.js";
import { postgresModel } from "../persistence/postgresModel.js";
import { postgres } from "../persistence/postgres.js";
import { requestSuperAdminPasswordReset } from "./authService.js";

test("email-only recovery sends to a tenant Super Admin and rejects employee recovery", async (context) => {
  const id = new Types.ObjectId();
  let role = "SUPER_ADMIN";
  let saves = 0;
  let sends = 0;
  let closed = 0;
  const user = { email: "tenant-admin@example.com", role: { name: role }, save: async () => { saves += 1; } };
  context.mock.method(User.collection, "find", () => {
    assert.equal(isSystemContext(), true);
    return { limit: () => ({ toArray: async () => [{ tenantId: id }] }) };
  });
  context.mock.method(Tenant, "findOne", () => ({ lean: async () => ({ _id: id, slug: "test-workspace" }) }));
  context.mock.method(User, "findOne", () => {
    assert.equal(currentTenantId()?.toString(), id.toString());
    user.role.name = role;
    return { select: (fields: string) => {
      assert.equal(fields, "+passwordHash");
      return { populate: async () => user };
    } };
  });
  context.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (mail: { to: string; text: string }) => {
      assert.equal(mail.to, user.email);
      assert.match(mail.text, /token=[a-f0-9]{64}/);
      assert.match(mail.text, /tenant=test-workspace/);
      sends += 1;
    }, close: () => { closed += 1; },
  }));
  const original = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD };
  Object.assign(env, { SMTP_HOST: "smtp.example.com", SMTP_PORT: 587, SMTP_USER: "sender@example.com", SMTP_PASSWORD: "test-only-password" });
  try {
    const message = await requestSuperAdminPasswordReset(user.email);
    assert.equal(saves, 1);
    assert.equal(sends, 1);
    assert.equal(closed, 1);
    role = "EMPLOYEE";
    assert.equal(await requestSuperAdminPasswordReset(user.email), message);
    assert.equal(saves, 1);
    assert.equal(sends, 1);
    assert.equal(currentTenantId(), undefined);
  } finally {
    Object.assign(env, { SMTP_HOST: original.host, SMTP_PORT: original.port, SMTP_USER: original.user, SMTP_PASSWORD: original.password });
  }
});

test("saving a reset token preserves the existing required hidden password hash", async (context) => {
  const tenantId = new Types.ObjectId();
  const document = { _id: new Types.ObjectId().toString(), tenantId: tenantId.toString(), email: "admin@example.com", passwordHash: "existing-password-hash" };
  const Account = postgresModel("RecoverySaveRegression", new Schema({ tenantId: Schema.Types.ObjectId, email: String, passwordHash: { type: String, required: true, select: false }, passwordResetTokenHash: String }), true);
  let writes = 0;
  context.mock.method(postgres, "query", async (sql: string, params: unknown[]) => {
    if (sql.startsWith("INSERT")) {
      const saved = JSON.parse(params[2] as string);
      assert.equal(saved.passwordHash, document.passwordHash);
      assert.equal(saved.passwordResetTokenHash, "reset-token-hash");
      writes += 1;
      return { rows: [] };
    }
    return { rows: [{ document }] };
  });
  await runWithTenant(tenantId, async () => {
    const incomplete = await Account.findOne({ email: document.email }).orFail();
    await assert.rejects(incomplete.save(), /passwordHash/);
    const account = await Account.findOne({ email: document.email }).select("+passwordHash").orFail();
    account.passwordResetTokenHash = "reset-token-hash";
    await account.save();
  });
  assert.equal(writes, 1);
});
