import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { Tenant } from "../models/Tenant.js";
import { EmailDelivery } from "../models/EmailDelivery.js";
import { EmailEnrollment } from "../models/EmailEnrollment.js";
import { VendorContact } from "../models/VendorContact.js";
import { isSystemContext, runWithTenant } from "../tenancy/tenantContext.js";
import { encryptSecret } from "../utils/secretCipher.js";
import { env } from "../config/env.js";
import { activateWorkflow, configuration, handleWebhook, runEmailAutomationCycle, sendTest, syncDeliveryEvents, testConnection, unsubscribe } from "./emailAutomationService.js";

const tenantId = new Types.ObjectId();
const tenant = () => ({ _id: tenantId, emailAutomation: { apiKeyEncrypted: encryptSecret("test-brevo-key-never-sent"), senderName: "Test tenant", senderEmail: "sender@example.com", replyToEmail: "sender@example.com" } });

test("public unsubscribe discovers the owner then scopes contact and enrollment writes", async (context) => {
  const id = new Types.ObjectId();
  context.mock.method(VendorContact.collection, "findOne", async (filter: Record<string, unknown>) => {
    assert.equal(isSystemContext(), true);
    return filter.unsubscribeToken === "valid-test-token" ? { _id: id, tenantId } : null;
  });
  let stopped = false;
  context.mock.method(VendorContact.collection, "findOneAndUpdate", async (filter: Record<string, unknown>) => {
    assert.equal(isSystemContext(), false);
    assert.equal(String(filter.tenantId), String(tenantId));
    return { _id: id, tenantId };
  });
  context.mock.method(EmailEnrollment.collection, "updateMany", async (filter: Record<string, unknown>) => {
    assert.equal(String(filter.tenantId), String(tenantId));
    assert.equal(String(filter.contact), String(id));
    stopped = true;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  await assert.rejects(unsubscribe("invalid-test-token"), { statusCode: 404 });
  assert.equal(stopped, false);
  await unsubscribe("valid-test-token");
  assert.equal(stopped, true);
  assert.equal(isSystemContext(), false);
});

test("disabled Brevo accounts cannot send tests, activate workflows, or consume queued jobs", async (t) => {
  t.mock.method(Tenant.collection, "findOne", async () => tenant());
  t.mock.method(EmailEnrollment.collection, "findOne", async () => ({ _id: new Types.ObjectId() }));
  t.mock.method(console, "warn", () => undefined);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    paths.push(new URL(url).pathname);
    assert.equal(new URL(url).pathname, "/v3/account", "No webhook or send request is permitted for a disabled account");
    return new Response(JSON.stringify({ relay: { enabled: false }, plan: [{ credits: 300 }] }), { status: 200 });
  });
  await runWithTenant(tenantId, async () => {
    assert.equal((await testConnection()).sendingEnabled, false);
    assert.equal((await configuration()).sendingEnabled, false);
    await assert.rejects(sendTest("recipient@example.com"), { code: "BREVO_SENDING_DISABLED" });
    await assert.rejects(activateWorkflow(new Types.ObjectId().toString(), new Types.ObjectId().toString()), { code: "BREVO_SENDING_DISABLED" });
    await runEmailAutomationCycle();
  });
  assert.equal(paths.length, 5);
});

test("account verification distinguishes enabled from an unknown sending status", async (t) => {
  t.mock.method(Tenant.collection, "findOne", async () => tenant());
  let payload: { relay?: { enabled: boolean } } = {};
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload), { status: 200 }));
  await runWithTenant(tenantId, async () => {
    assert.equal((await testConnection()).sendingEnabled, null);
    payload = { relay: { enabled: true } };
    assert.equal((await testConnection()).sendingEnabled, true);
  });
});

test("polling repairs a regressed OPENED message, remains tenant scoped and idempotent", async (t) => {
  const id = new Types.ObjectId();
  const messageId = "<regression@example.com>";
  const events = [
    { type: "request", occurredAt: new Date("2026-09-06T08:33:29Z") },
    { type: "delivered", occurredAt: new Date("2026-09-06T08:33:32Z") },
    { type: "opened", occurredAt: new Date("2026-09-06T14:34:19Z") },
    { type: "requests", occurredAt: new Date("2026-09-06T08:33:29Z") },
  ];
  const stored = { _id: id, tenantId, recipientEmail: "recipient@example.com", status: "REQUESTED", lastEventAt: events[0]!.occurredAt, events };
  const assertScope = (filter: Record<string, unknown>) => assert.equal(String(filter.tenantId), String(tenantId));
  t.mock.method(Tenant.collection, "findOne", async () => tenant());
  t.mock.method(EmailDelivery.collection, "findOne", async (filter: Record<string, unknown>) => { assertScope(filter); return stored; });
  t.mock.method(EmailDelivery.collection, "findOneAndUpdate", async (filter: Record<string, unknown>) => { assertScope(filter); return null; });
  t.mock.method(EmailDelivery.collection, "updateOne", async (filter: Record<string, unknown>, update: { $set: { status: string; lastEventAt: Date } }) => {
    assertScope(filter);
    assert.equal((filter.events as unknown[]).length, events.length, "Status writes must match the reduced history to avoid concurrent regression");
    stored.status = update.$set.status; stored.lastEventAt = update.$set.lastEventAt;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ events: [...events].reverse().map(e => ({ event: e.type, date: e.occurredAt.toISOString(), messageId })) }), { status: 200 }));
  await runWithTenant(tenantId, async () => {
    await syncDeliveryEvents();
    await syncDeliveryEvents();
  });
  assert.equal(stored.status, "OPENED");
  assert.equal(stored.lastEventAt.toISOString(), "2026-09-06T14:34:19.000Z");
  assert.equal(stored.events.length, 4);
});

test("webhooks match the recipient, isolate writes, and ignore late duplicate request status", async (t) => {
  const id = new Types.ObjectId();
  const token = env.BREVO_WEBHOOK_TOKEN || createHash("sha256").update(`brevo-webhook:${env.JWT_ACCESS_SECRET}`).digest("hex");
  const stored = { _id: id, tenantId, recipientEmail: "recipient@example.com", status: "REQUESTED", lastEventAt: new Date(1000), events: [{ type: "request", occurredAt: new Date(1000) }] };
  t.mock.method(EmailDelivery.collection, "findOne", async (filter: Record<string, unknown>) => {
    if (filter.providerMessageId) {
      assert.equal(isSystemContext(), true);
      if (filter.recipientEmail !== stored.recipientEmail) return null;
    } else assert.equal(String(filter.tenantId), String(tenantId));
    return stored;
  });
  t.mock.method(EmailDelivery.collection, "findOneAndUpdate", async (filter: Record<string, unknown>, update: { $push: { events: { type: string; occurredAt: Date } } }) => {
    assert.equal(isSystemContext(), false);
    assert.equal(String(filter.tenantId), String(tenantId));
    const event = update.$push.events;
    if (stored.events.some(e => e.type === event.type && +e.occurredAt === +event.occurredAt)) return null;
    stored.events.push(event);
    return stored;
  });
  t.mock.method(EmailDelivery.collection, "updateOne", async (filter: Record<string, unknown>, update: { $set: { status: string; lastEventAt: Date } }) => {
    assert.equal(String(filter.tenantId), String(tenantId));
    assert.equal((filter.events as unknown[]).length, stored.events.length);
    Object.assign(stored, update.$set);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const input = { "message-id": "<webhook@example.com>", email: stored.recipientEmail };
  await assert.rejects(handleWebhook({ ...input, event: "delivered" }, "incorrect-token"), { code: "INVALID_WEBHOOK_TOKEN" });
  assert.deepEqual(await handleWebhook({ ...input, email: "someone-else@example.com", event: "delivered" }, token), { matched: false });
  await handleWebhook({ ...input, event: "delivered", ts_event: 10 }, token);
  await handleWebhook({ ...input, event: "request", ts_event: 1 }, token);
  await handleWebhook({ ...input, event: "delivered", ts_event: 10 }, token);
  assert.equal(stored.status, "DELIVERED");
  assert.equal(stored.lastEventAt.getTime(), 10000);
  assert.equal(stored.events.length, 2);
});
