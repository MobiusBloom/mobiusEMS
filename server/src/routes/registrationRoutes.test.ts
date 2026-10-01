import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import { createHash, createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Tenant } from "../models/Tenant.js";
import { isSystemContext } from "../tenancy/tenantContext.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { registrationRouter } from "./registrationRoutes.js";

test("public registration checks email across tenants before sending verification", async (context) => {
  let emailExists = true;
  let sent = 0;
  let otp = "";
  context.mock.method(User.collection, "findOne", async (filter: { email: string }) => {
    assert.equal(isSystemContext(), true);
    assert.equal(filter.email, "new-admin@example.com");
    return emailExists ? { _id: "existing" } : null;
  });
  context.mock.method(Tenant, "exists", async () => null);
  context.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: { subject: string }) => { sent += 1; otp = message.subject.match(/\d{6}/)![0]; }, close: () => {},
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
    const payload = jwt.decode(body.data.registrationToken) as jwt.JwtPayload;
    assert.notEqual(payload.otpHash, createHash("sha256").update(otp).digest("hex"));
    assert.equal(payload.otpHash, createHmac("sha256", env.JWT_ACCESS_SECRET).update(`${payload.slug}:${payload.adminEmail}:${otp}`).digest("hex"));
    assert.equal(sent, 1);
    assert.equal(isSystemContext(), false);
  } finally {
    env.SMTP_HOST = original.host;
    env.SMTP_USER = original.user;
    env.SMTP_PASSWORD = original.password;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("failed production email dispatch does not disclose the verification code", async (context) => {
  const original = { NODE_ENV: env.NODE_ENV, SMTP_HOST: env.SMTP_HOST, SMTP_USER: env.SMTP_USER, SMTP_PASSWORD: env.SMTP_PASSWORD, EMAIL_AUTOMATION_ENABLED: env.EMAIL_AUTOMATION_ENABLED };
  Object.assign(env, { NODE_ENV: "production", SMTP_HOST: "smtp.example.com", SMTP_USER: "sender@example.com", SMTP_PASSWORD: "mock-only", EMAIL_AUTOMATION_ENABLED: false });
  context.mock.method(User.collection, "findOne", async () => null);
  context.mock.method(Tenant, "exists", async () => null);
  context.mock.method(console, "error", () => undefined);
  context.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => { throw new Error("Mock dispatch failure"); }, close: () => {} }));
  const app = express();
  app.use(express.json(), registrationRouter, errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/request`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Company", slug: "test-company", industry: "Software", companySize: "1-10", country: "India", referralSource: "Website", primaryUseCase: "HR management", adminName: "New Admin", adminEmail: "new-admin@example.com" }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "EMAIL_DELIVERY_UNAVAILABLE");
    assert.equal(body.data?.directOtp, undefined);
    assert.equal(body.data?.registrationToken, undefined);
  } finally {
    Object.assign(env, original);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("registration completion rejects an OTP token without verifying its code", async () => {
  const app = express();
  app.use(express.json(), registrationRouter, errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const token = jwt.sign({ purpose: "organization-registration-otp", name: "Test Company", slug: "test-company", industry: "Software", companySize: "1-10", country: "India", referralSource: "Website", primaryUseCase: "HR management", adminName: "New Admin", adminEmail: "new-admin@example.com", otpHash: "unverified" }, env.JWT_ACCESS_SECRET, {
    audience: "organization-registration-otp", issuer: "mobius-ems", expiresIn: "15m",
  });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/complete`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: "StrongTestPassword!2026" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
