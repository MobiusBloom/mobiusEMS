import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Tenant } from "../models/Tenant.js";
import { isSystemContext } from "../tenancy/tenantContext.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { registrationRouter } from "./registrationRoutes.js";

test("public registration checks email across tenants before sending verification", async (context) => {
  let emailExists = true;
  let sent = 0;
  context.mock.method(User.collection, "findOne", async (filter: { email: string }) => {
    assert.equal(isSystemContext(), true);
    assert.equal(filter.email, "new-admin@example.com");
    return emailExists ? { _id: "existing" } : null;
  });
  context.mock.method(Tenant, "exists", async () => null);
  context.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => { sent += 1; }, close: () => {},
  }));
  const original = { host: env.SMTP_HOST, user: env.SMTP_USER, password: env.SMTP_PASSWORD };
  env.SMTP_HOST = "smtp.example.com";
  env.SMTP_USER = "sender@example.com";
  env.SMTP_PASSWORD = "test-only-password";
  const app = express();
  app.use(express.json(), registrationRouter, errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = () => fetch(`http://127.0.0.1:${address.port}/request`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test Company", slug: "test-company", industry: "Software", companySize: "1-10", country: "India", referralSource: "Website", primaryUseCase: "HR management", adminName: "New Admin", adminEmail: "NEW-ADMIN@example.com" }),
  });
  try {
    assert.equal((await request()).status, 409);
    assert.equal(sent, 0);
    emailExists = false;
    const response = await request();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.emailSent, true);
    assert.equal(typeof body.data.registrationToken, "string");
    assert.equal(sent, 1);
    assert.equal(isSystemContext(), false);
  } finally {
    env.SMTP_HOST = original.host;
    env.SMTP_USER = original.user;
    env.SMTP_PASSWORD = original.password;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
