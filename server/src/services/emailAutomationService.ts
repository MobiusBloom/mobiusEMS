import { createHash, randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { EmailDelivery } from "../models/EmailDelivery.js";
import { EmailEnrollment } from "../models/EmailEnrollment.js";
import { EmailWorkflow, type EmailWorkflowDocument } from "../models/EmailWorkflow.js";
import { VendorContact, type VendorContactDocument } from "../models/VendorContact.js";
import { AppError } from "../utils/AppError.js";
import { decryptSecret, encryptSecret } from "../utils/secretCipher.js";
import { writeAudit } from "./auditService.js";
import { Tenant } from "../models/Tenant.js";
import { GmailConnection } from "../models/GmailConnection.js";
import { gmailAccessToken, googleReady, sendGmailEmail } from "./gmailService.js";
import { requireTenantId, currentTenantId, runAsSystem, runWithTenant } from "../tenancy/tenantContext.js";
import { deliveryState, normalizeDeliveryEvent, type DeliveryEvent } from "../utils/emailDeliveryState.js";

type WorkflowInput = Pick<EmailWorkflowDocument, "name" | "audience" | "subject" | "message" | "followUp" | "delayDays" | "followUpSubject" | "followUpMessage">;
type ContactInput = Pick<VendorContactDocument, "name" | "companyName" | "email" | "source" | "consentAt">;
type BroadcastInput = { clientRequestId: string; name: string; subject: string; message: string; source?: string; scheduledAt?: Date };
type BrevoResponse = { messageId?: string; code?: string; message?: string };
type WebhookInput = { event?: string; email?: string; reason?: string; ts_event?: number; ts?: number; "message-id"?: string };
type BrevoEmailEvent = { date?: string; email?: string; event?: string; messageId?: string; reason?: string };
type SenderConfiguration = { senderName: string; senderEmail: string; replyToEmail: string; apiKey: string; provider?: "BREVO" | "GMAIL" };
type ConfigurationInput = Omit<SenderConfiguration, "apiKey"> & { apiKey?: string };
type BrevoAccount = { email?: string; companyName?: string; relay?: { enabled?: boolean } };

const tenantConfiguration = async (): Promise<SenderConfiguration | null> => {
  const tenant = await Tenant.findById(requireTenantId()).select("+emailAutomation.apiKeyEncrypted").lean();
  if (tenant?.emailSendingProvider === "NONE") return null;
  if (tenant?.emailSendingProvider === "GMAIL") {
    const gmail = await GmailConnection.findOne({ key: "gmail" }).lean();
    if (!gmail) return null;
    return { provider: "GMAIL", senderName: tenant.name, senderEmail: gmail.email, replyToEmail: gmail.email, apiKey: "" };
  }
  const stored = tenant?.emailAutomation;
  if (!stored?.apiKeyEncrypted || !stored.senderEmail) return null;
  return { senderName: stored.senderName, senderEmail: stored.senderEmail, replyToEmail: stored.replyToEmail, apiKey: decryptSecret(stored.apiKeyEncrypted) };
};
const webhookToken = env.BREVO_WEBHOOK_TOKEN || createHash("sha256").update(`brevo-webhook:${env.JWT_ACCESS_SECRET}`).digest("hex");
const requireConfiguration = async () => {
  if (!env.EMAIL_AUTOMATION_ENABLED) throw new AppError("Email automation is disabled", 503, "EMAIL_AUTOMATION_DISABLED");
  const configuration = await tenantConfiguration();
  if (!configuration) throw new AppError("Connect an email account for this organization before using automation", 409, "EMAIL_NOT_CONNECTED");
  return configuration;
};
const brevoRequest = async <T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as BrevoResponse;
  if (!response.ok) throw new AppError(payload.message || "Brevo rejected the request", 502, payload.code || "BREVO_ERROR");
  return payload as T;
};
const accountStatus = (apiKey: string) => brevoRequest<BrevoAccount>(apiKey, "/account");
const requireSendingEnabled = async (sender: SenderConfiguration) => {
  if (sender.provider === "GMAIL") { await gmailAccessToken(); return {}; }
  const account = await accountStatus(sender.apiKey);
  if (account.relay?.enabled === false) {
    throw new AppError("Brevo has disabled transactional sending for this account. Available credits do not enable sending. Contact Brevo Support to activate the transactional platform.", 409, "BREVO_SENDING_DISABLED");
  }
  return account;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const personalize = (value: string, contact: Pick<VendorContactDocument, "name" | "companyName">, senderName: string) => value
  .replaceAll("{{vendor_name}}", contact.name)
  .replaceAll("{{company_name}}", contact.companyName)
  .replaceAll("{{our_company}}", senderName);
const messageHtml = (text: string, unsubscribeUrl?: string) => `${text.split(/\r?\n/).map((line) => line ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : "<br>").join("")}${unsubscribeUrl ? `<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px"><p style="font-size:12px;color:#64748b">You are receiving this business email because your contact was provided for vendor communication. <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>` : ""}`;

const sendBrevoEmail = async (input: { to: string; toName?: string; subject: string; text: string; unsubscribeUrl?: string; enrollmentId?: string }, sender: SenderConfiguration) => {
  const current = await tenantConfiguration();
  if (!current || current.provider !== sender.provider || current.senderEmail !== sender.senderEmail || current.apiKey !== sender.apiKey) throw new AppError("The organization sender changed. Review the connection before sending.", 409, "EMAIL_SENDER_CHANGED");
  if (sender.provider === "GMAIL") return sendGmailEmail(input, sender.senderEmail);
  const payload = await brevoRequest<BrevoResponse>(sender.apiKey, "/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender: { name: sender.senderName, email: sender.senderEmail },
      to: [{ email: input.to, ...(input.toName && { name: input.toName }) }],
      replyTo: { email: sender.replyToEmail, name: sender.senderName },
      subject: input.subject,
      textContent: `${input.text}${input.unsubscribeUrl ? `\n\nUnsubscribe: ${input.unsubscribeUrl}` : ""}`,
      htmlContent: messageHtml(input.text, input.unsubscribeUrl),
      tags: ["mobius-automation"],
      ...(input.enrollmentId && { headers: { "X-Mailin-custom": `enrollment:${input.enrollmentId}`, ...(input.unsubscribeUrl && { "List-Unsubscribe": `<${input.unsubscribeUrl}>` }) } }),
    }),
  });
  if (!payload.messageId) throw new AppError("Brevo did not return a message identifier", 502, "BREVO_INVALID_RESPONSE");
  return payload.messageId;
};

export const configuration = async () => {
  const sender = await tenantConfiguration();
  let sendingEnabled: boolean | null = null;
  let sendingStatusError: string | null = null;
  if (sender?.provider === "GMAIL") {
    const gmail = await GmailConnection.findOne({ key: "gmail" }).lean();
    sendingEnabled = googleReady() && Boolean(gmail && !gmail.needsReconnect);
    if (!sendingEnabled) sendingStatusError = "Gmail needs reconnection or platform OAuth setup.";
  } else if (sender) {
    try { sendingEnabled = (await accountStatus(sender.apiKey)).relay?.enabled ?? null; }
    catch { sendingStatusError = "Unable to verify Brevo sending status. Use Check account to retry."; }
  }
  return ({
  configured: env.EMAIL_AUTOMATION_ENABLED && Boolean(sender),
  providerConfigured: Boolean(sender),
  provider: sender ? sender.provider || "BREVO" : null,
  googleAvailable: googleReady(),
  sendingEnabled,
  sendingStatusError,
  senderEmail: sender?.senderEmail || null,
  senderName: sender?.senderName || null,
  replyToEmail: sender?.replyToEmail || null,
  webhookConfigured: Boolean(sender) && sender?.provider !== "GMAIL",
  webhookUrl: `${env.CLIENT_URL}/api/v1/email-automation/webhooks/brevo`,
  dailyLimit: sender?.provider === "GMAIL" ? Math.min(env.GMAIL_DAILY_LIMIT, env.EMAIL_AUTOMATION_DAILY_LIMIT) : env.EMAIL_AUTOMATION_DAILY_LIMIT,
  });
};
export const updateConfiguration = async (input: ConfigurationInput, actor: string) => {
  const oldValue = await tenantConfiguration();
  const apiKey = input.apiKey || oldValue?.apiKey;
  if (!apiKey) throw new AppError("Enter this organization's Brevo API key", 409, "BREVO_API_KEY_REQUIRED");
  await accountStatus(apiKey);
  const result = await brevoRequest<{ senders?: { email?: string; active?: boolean }[] }>(apiKey, "/senders?ipAndEmails=true");
  const sender = result.senders?.find((item) => item.email?.toLowerCase() === input.senderEmail && item.active !== false);
  if (!sender) throw new AppError("Verify this sender email in the connected Brevo account first", 409, "BREVO_SENDER_NOT_VERIFIED");
  const stored = { provider: "BREVO" as const, apiKeyEncrypted: encryptSecret(apiKey), senderName: input.senderName, senderEmail: input.senderEmail, replyToEmail: input.replyToEmail, updatedAt: new Date(), updatedBy: actor };
  await EmailWorkflow.updateMany({ status: "ACTIVE" }, { $set: { status: "PAUSED" } });
  await Tenant.updateOne({ _id: requireTenantId() }, { $set: { emailAutomation: stored, emailSendingProvider: "BREVO" } });
  await writeAudit({ user: actor as never, action: "EMAIL_CONFIGURATION_UPDATED", entityType: "Tenant", entityId: requireTenantId().toString(), oldValue: oldValue && { senderName: oldValue.senderName, senderEmail: oldValue.senderEmail, replyToEmail: oldValue.replyToEmail }, newValue: { provider: "BREVO", senderName: input.senderName, senderEmail: input.senderEmail, replyToEmail: input.replyToEmail } });
  return configuration();
};
export const testConnection = async () => {
  const configuration = await requireConfiguration();
  if (configuration.provider === "GMAIL") { const gmail = await gmailAccessToken(); return { connected: true, sendingEnabled: true, accountEmail: gmail.email, companyName: null }; }
  const account = await accountStatus(configuration.apiKey);
  return { connected: true, sendingEnabled: account.relay?.enabled ?? null, accountEmail: account.email || null, companyName: account.companyName || null };
};
export const registerWebhook = async () => {
  const configuration = await requireConfiguration();
  if (configuration.provider === "GMAIL") throw new AppError("Gmail send-only connections do not provide delivery or open tracking", 409, "GMAIL_TRACKING_UNAVAILABLE");
  const baseUrl = `${env.CLIENT_URL}/api/v1/email-automation/webhooks/brevo`;
  const url = `${baseUrl}?token=${encodeURIComponent(webhookToken)}`;
  try {
    const existing = await brevoRequest<{ webhooks?: { id: number; url: string; type: string }[] }>(configuration.apiKey, "/webhooks?type=transactional&sort=desc");
    const match = existing.webhooks?.find((webhook) => webhook.url === url && webhook.type === "transactional");
    if (match) return { id: match.id, created: false };
  } catch (error) {
    console.warn("Could not read existing Brevo webhooks; attempting a fresh registration", error);
  }
  const created = await brevoRequest<{ id: number }>(configuration.apiKey, "/webhooks", { method: "POST", body: JSON.stringify({
    url, type: "transactional", description: "MobiusEMS email automation events", batched: false,
    events: ["request", "delivered", "hardBounce", "softBounce", "blocked", "spam", "invalid", "deferred", "click", "opened", "uniqueOpened", "unsubscribed"],
  }) });
  return { id: created.id, created: true };
};
export const sendTest = async (recipient: string) => {
  const sender = await requireConfiguration();
  await requireSendingEnabled(sender);
  if (sender.provider !== "GMAIL") await registerWebhook();
  const subject = "MobiusEMS email connection test";
  const messageId = await sendBrevoEmail({ to: recipient, subject, text: "This is your requested MobiusEMS email connection test." }, sender);
  await EmailDelivery.create({ provider: sender.provider || "BREVO", recipientEmail: recipient, providerMessageId: messageId, step: -1, subject, status: sender.provider === "GMAIL" ? "SENT" : "REQUESTED", events: [{ type: sender.provider === "GMAIL" ? "sent" : "request", occurredAt: new Date() }] });
  return { messageId };
};

const normalizeMessageId = (value: string) => value.replace(/^<|>$/g, "");
const recordDeliveryEvent = async (id: Types.ObjectId, event: DeliveryEvent) => {
  const updated = await EmailDelivery.findOneAndUpdate(
    { _id: id, events: { $not: { $elemMatch: { type: event.type, occurredAt: event.occurredAt } } } },
    { $push: { events: event } }, { new: true },
  ).select("events recipientEmail");
  // Recompute even on duplicate events to repair previously regressed statuses.
  const delivery = updated || await EmailDelivery.findById(id).select("events recipientEmail");
  if (!delivery) return false;
  const state = deliveryState(delivery.events);
  if (state) {
    // Another webhook may append an event concurrently. Only update the exact
    // history we reduced; its newer writer will compute from the newer history.
    await EmailDelivery.updateOne({ _id: id, events: delivery.events }, { $set: { status: state.status, lastEventAt: state.lastEventAt } });
  }
  if (["hard_bounce", "blocked", "invalid", "invalid_email", "spam", "unsubscribed"].includes(event.type)) {
    await suppressContact(delivery.recipientEmail, event.type);
  }
  return Boolean(updated);
};
export const syncDeliveryEvents = async () => {
  const configuration = await requireConfiguration();
  if (configuration.provider === "GMAIL") return { updated: 0 };
  const report = await brevoRequest<{ events?: BrevoEmailEvent[] }>(configuration.apiKey, "/smtp/statistics/events?days=30&limit=500&sort=desc");
  let updated = 0;
  for (const item of report.events ?? []) {
    if (!item.messageId || !item.event) continue;
    const rawId = normalizeMessageId(item.messageId);
    const event = normalizeDeliveryEvent(item.event);
    const occurredAt = item.date && !Number.isNaN(Date.parse(item.date)) ? new Date(item.date) : new Date();
    const delivery = await EmailDelivery.findOne({ providerMessageId: { $in: [rawId, `<${rawId}>`] } }).select("_id");
    if (!delivery) continue;
    if (await recordDeliveryEvent(delivery._id, { type: event, occurredAt, ...(item.reason && { reason: item.reason }) })) updated += 1;
  }
  return { updated };
};
export const summary = async () => {
  if (await tenantConfiguration()) await syncDeliveryEvents().catch((error: unknown) => console.warn("Brevo delivery activity sync failed", error));
  const [workflows, active, contacts, accepted, delivered, opened, clicked, bounced, replies] = await Promise.all([
    EmailWorkflow.countDocuments(), EmailWorkflow.countDocuments({ status: "ACTIVE" }), VendorContact.countDocuments(),
    EmailDelivery.countDocuments({ step: { $gte: 0 }, "events.type": { $in: ["request", "requests", "sent", "delivered", "opened", "click"] } }), EmailDelivery.countDocuments({ "events.type": "delivered" }),
    EmailDelivery.countDocuments({ "events.type": "opened" }), EmailDelivery.countDocuments({ "events.type": "click" }),
    EmailDelivery.countDocuments({ status: { $in: ["ERROR", "BOUNCED", "BLOCKED", "INVALID", "SPAM"] } }),
    VendorContact.countDocuments({ status: "REPLIED" }),
  ]);
  return { workflows, active, contacts, accepted, sent: accepted, delivered, opened, clicked, bounced, replies };
};
export const listDeliveries = async () => {
  const items = await EmailDelivery.find().select("provider recipientEmail subject status lastEventAt createdAt step events").sort({ createdAt: -1 }).limit(50).lean();
  return items.map((item) => ({ ...item, lastError: null, ...deliveryState(item.events), events: undefined }));
};
export const listWorkflows = () => EmailWorkflow.find().sort({ createdAt: -1 }).lean();
const broadcastAudienceFilter = (source?: string) => ({ status: "ACTIVE" as const, consentAt: { $lte: new Date() }, ...(source ? { source } : {}) });
export const previewBroadcastAudience = async (source?: string) => { const filter = broadcastAudienceFilter(source); const [count, sample] = await Promise.all([VendorContact.countDocuments(filter), VendorContact.find(filter).select("name companyName email source").sort({ createdAt: -1 }).limit(5).lean()]); return { count, sample }; };
export const listBroadcasts = async () => {
  const items = await EmailWorkflow.find({ kind: "BROADCAST" }).sort({ createdAt: -1 }).limit(100).lean();
  return Promise.all(items.map(async (item) => { const [pending, accepted, delivered, failed, stopped] = await Promise.all([EmailEnrollment.countDocuments({ workflow: item._id, status: { $in: ["PENDING", "PROCESSING"] } }), EmailDelivery.countDocuments({ workflow: item._id }), EmailDelivery.countDocuments({ workflow: item._id, "events.type": "delivered" }), EmailEnrollment.countDocuments({ workflow: item._id, status: "FAILED" }), EmailEnrollment.countDocuments({ workflow: item._id, status: "STOPPED" })]); return { ...item, progress: { pending, accepted, delivered, failed, stopped } }; }));
};
export const createBroadcast = async (input: BroadcastInput, actor: string) => {
  const existing = await EmailWorkflow.findOne({ clientRequestId: input.clientRequestId });
  if (existing?.status === "ACTIVE") return { item: existing, recipientCount: existing.recipientCount ?? 0 };
  if (existing?.status === "PAUSED") throw new AppError("This broadcast was cancelled and cannot be requeued", 409, "BROADCAST_CANCELLED");
  if (existing && (existing.kind !== "BROADCAST" || existing.subject !== input.subject || existing.message !== input.message || existing.audienceSource !== input.source)) throw new AppError("This broadcast request has already been used", 409, "BROADCAST_REQUEST_CONFLICT");
  const sender = await requireConfiguration(); await requireSendingEnabled(sender);
  const contacts = await VendorContact.find(broadcastAudienceFilter(input.source)).select("_id").lean();
  if (!contacts.length) throw new AppError("No active, consented contacts match this audience", 409, "NO_BROADCAST_RECIPIENTS");
  const scheduledAt = input.scheduledAt && input.scheduledAt > new Date() ? input.scheduledAt : new Date();
  const item = existing ?? await EmailWorkflow.create({ kind: "BROADCAST", clientRequestId: input.clientRequestId, name: input.name, audience: input.source ? `Source: ${input.source}` : "All active contacts", audienceSource: input.source, subject: input.subject, message: input.message, followUp: false, delayDays: 1, recipientCount: contacts.length, scheduledAt, status: "DRAFT", createdBy: actor });
  await EmailEnrollment.bulkWrite(contacts.map((contact) => ({ updateOne: { filter: { workflow: item._id, contact: contact._id }, update: { $setOnInsert: { step: 0, status: "PENDING", nextRunAt: scheduledAt, attempts: 0 } }, upsert: true } })));
  item.status = "ACTIVE"; item.recipientCount = contacts.length; item.scheduledAt = scheduledAt; item.activatedAt = new Date(); await item.save();
  await writeAudit({ user: actor as never, action: "EMAIL_BROADCAST_QUEUED", entityType: "EmailWorkflow", entityId: item.id, newValue: { recipientCount: contacts.length, source: input.source ?? "ALL", scheduledAt } });
  void runEmailAutomationCycle(); return { item, recipientCount: contacts.length };
};
export const cancelBroadcast = async (id: string, actor: string) => { const item = await EmailWorkflow.findOne({ _id: id, kind: "BROADCAST" }); if (!item) throw new AppError("Broadcast not found", 404); item.status = "PAUSED"; await item.save(); const result = await EmailEnrollment.updateMany({ workflow: item._id, status: "PENDING" }, { $set: { status: "STOPPED" } }); await writeAudit({ user: actor as never, action: "EMAIL_BROADCAST_CANCELLED", entityType: "EmailWorkflow", entityId: item.id, newValue: { stopped: result.modifiedCount } }); return { item, stopped: result.modifiedCount }; };
export const createWorkflow = async (input: WorkflowInput, actor: string) => {
  const item = await EmailWorkflow.create({ ...input, createdBy: actor });
  await writeAudit({ user: actor as never, action: "EMAIL_WORKFLOW_CREATED", entityType: "EmailWorkflow", entityId: item.id, newValue: input });
  return item;
};
export const updateWorkflow = async (id: string, input: Partial<WorkflowInput>, actor: string) => {
  const item = await EmailWorkflow.findById(id);
  if (!item) throw new AppError("Email workflow not found", 404);
  if (item.kind === "BROADCAST") throw new AppError("Broadcasts are queued from the broadcast composer", 409, "BROADCAST_REACTIVATION_BLOCKED");
  if (item.status === "ACTIVE") throw new AppError("Pause the workflow before editing it", 409, "WORKFLOW_ACTIVE");
  const oldValue = item.toObject(); Object.assign(item, input); await item.save();
  await writeAudit({ user: actor as never, action: "EMAIL_WORKFLOW_UPDATED", entityType: "EmailWorkflow", entityId: item.id, oldValue, newValue: input });
  return item;
};
export const deleteWorkflow = async (id: string, actor: string) => {
  const item = await EmailWorkflow.findById(id);
  if (!item) throw new AppError("Email workflow not found", 404);
  if (item.status === "ACTIVE") throw new AppError("Pause the workflow before deleting it", 409, "WORKFLOW_ACTIVE");
  await Promise.all([item.deleteOne(), EmailEnrollment.deleteMany({ workflow: item._id })]);
  await writeAudit({ user: actor as never, action: "EMAIL_WORKFLOW_DELETED", entityType: "EmailWorkflow", entityId: id });
};
export const activateWorkflow = async (id: string, actor: string) => {
  const sender = await requireConfiguration();
  await requireSendingEnabled(sender);
  if (sender.provider !== "GMAIL") await registerWebhook();
  const item = await EmailWorkflow.findById(id);
  if (!item) throw new AppError("Email workflow not found", 404);
  const contacts = await VendorContact.find({ status: "ACTIVE" }).select("_id").lean();
  if (!contacts.length) throw new AppError("Add at least one active, consented vendor contact before activation", 409, "NO_VENDOR_CONTACTS");
  const nextRunAt = new Date();
  await EmailEnrollment.updateMany({ workflow: item._id, contact: { $in: contacts.map(({ _id }) => _id) }, status: "FAILED" }, { $set: { step: 0, status: "PENDING", nextRunAt, attempts: 0 }, $unset: { lockedAt: 1, lastError: 1 } });
  await EmailEnrollment.bulkWrite(contacts.map((contact) => ({ updateOne: { filter: { workflow: item._id, contact: contact._id }, update: { $setOnInsert: { step: 0, status: "PENDING", nextRunAt, attempts: 0 } }, upsert: true } })));
  item.status = "ACTIVE"; item.activatedAt = new Date(); await item.save();
  await writeAudit({ user: actor as never, action: "EMAIL_WORKFLOW_ACTIVATED", entityType: "EmailWorkflow", entityId: item.id, newValue: { contacts: contacts.length } });
  void runEmailAutomationCycle();
  return item;
};
export const pauseWorkflow = async (id: string, actor: string) => {
  const item = await EmailWorkflow.findByIdAndUpdate(id, { $set: { status: "PAUSED" } }, { new: true });
  if (!item) throw new AppError("Email workflow not found", 404);
  await writeAudit({ user: actor as never, action: "EMAIL_WORKFLOW_PAUSED", entityType: "EmailWorkflow", entityId: item.id });
  return item;
};

export const listContacts = () => VendorContact.find().select("name companyName email source consentAt status repliedAt createdAt").sort({ createdAt: -1 }).lean();
export const addContacts = async (inputs: ContactInput[], actor: string) => {
  const results = { created: 0, updated: 0 };
  for (const input of inputs) {
    const existing = await VendorContact.findOne({ email: input.email });
    let contact;
    if (existing) { existing.name = input.name; existing.companyName = input.companyName; existing.source = input.source; existing.consentAt = input.consentAt; if (existing.status === "BOUNCED") existing.status = "ACTIVE"; contact = await existing.save(); results.updated += 1; }
    else { contact = await VendorContact.create({ ...input, createdBy: actor }); results.created += 1; }
    if (contact.status === "ACTIVE") {
      const activeWorkflows = await EmailWorkflow.find({ status: "ACTIVE", kind: { $ne: "BROADCAST" } }).select("_id").lean();
      if (activeWorkflows.length) await EmailEnrollment.bulkWrite(activeWorkflows.map((workflow) => ({ updateOne: { filter: { workflow: workflow._id, contact: contact._id }, update: { $setOnInsert: { step: 0, status: "PENDING", nextRunAt: new Date(), attempts: 0 } }, upsert: true } })));
    }
  }
  await writeAudit({ user: actor as never, action: "VENDOR_CONTACTS_IMPORTED", entityType: "VendorContact", newValue: results });
  return results;
};
export const updateContactStatus = async (id: string, status: VendorContactDocument["status"], actor: string) => {
  const update = status === "REPLIED" ? { $set: { status, repliedAt: new Date() } } : { $set: { status }, $unset: { repliedAt: 1 } };
  const item = await VendorContact.findByIdAndUpdate(id, update, { new: true }).select("name companyName email source consentAt status repliedAt createdAt");
  if (!item) throw new AppError("Vendor contact not found", 404);
  if (status !== "ACTIVE") await EmailEnrollment.updateMany({ contact: item._id, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "STOPPED" } });
  await writeAudit({ user: actor as never, action: "VENDOR_CONTACT_STATUS_UPDATED", entityType: "VendorContact", entityId: item.id, newValue: { status } });
  return item;
};

const suppressContact = async (email: string, event: string) => {
  const status = ["hard_bounce", "invalid", "invalid_email"].includes(event) ? "BOUNCED" : event === "unsubscribed" ? "UNSUBSCRIBED" : "BLOCKED";
  const contact = await VendorContact.findOneAndUpdate({ email: email.toLowerCase() }, { $set: { status } }, { new: true });
  if (contact) await EmailEnrollment.updateMany({ contact: contact._id, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "STOPPED" } });
};
export const handleWebhook = async (input: WebhookInput, token?: string) => {
  if (token !== webhookToken) throw new AppError("Invalid webhook token", 401, "INVALID_WEBHOOK_TOKEN");
  const event = normalizeDeliveryEvent(String(input.event || "unknown"));
  const rawMessageId = String(input["message-id"] || "");
  if (!rawMessageId) return { matched: false };
  const messageIds = [rawMessageId, rawMessageId.replace(/^<|>$/g, ""), `<${rawMessageId.replace(/^<|>$/g, "")}>`];
  const occurredAt = new Date((input.ts_event || input.ts || Date.now() / 1000) * 1000);
  const match = await runAsSystem(() => EmailDelivery.collection.findOne({ providerMessageId: { $in: messageIds }, ...(input.email && { recipientEmail: String(input.email).toLowerCase() }) }, { projection: { tenantId: 1 } }));
  if (!match?.tenantId) return { matched: false };
  return runWithTenant(match.tenantId, async () => {
    await recordDeliveryEvent(match._id, { type: event, occurredAt, ...(input.reason && { reason: input.reason }) });
    return { matched: true };
  });
};
export const unsubscribe = async (token: string) => {
  const match = await runAsSystem(() => VendorContact.collection.findOne({ unsubscribeToken: token }, { projection: { tenantId: 1 } }));
  if (!match?.tenantId) throw new AppError("This unsubscribe link is invalid", 404);
  await runWithTenant(match.tenantId, async () => {
    const contact = await VendorContact.findOneAndUpdate({ _id: match._id }, { $set: { status: "UNSUBSCRIBED" } }, { new: true }).select("_id");
    if (!contact) throw new AppError("This unsubscribe link is invalid", 404);
    await EmailEnrollment.updateMany({ contact: contact._id, status: { $in: ["PENDING", "PROCESSING"] } }, { $set: { status: "STOPPED" } });
  });
};

const processOne = async (sender: SenderConfiguration) => {
  const stale = new Date(Date.now() - 10 * 60_000);
  await EmailEnrollment.updateMany({ status: "PROCESSING", lockedAt: { $lt: stale } }, { $set: sender.provider === "GMAIL" ? { status: "FAILED", lastError: "Previous Gmail send outcome is unknown. Check Sent mail before retrying." } : { status: "PENDING" }, $unset: { lockedAt: 1 } });
  const enrollment = await EmailEnrollment.findOneAndUpdate({ status: "PENDING", nextRunAt: { $lte: new Date() } }, { $set: { status: "PROCESSING", lockedAt: new Date() } }, { new: true });
  if (!enrollment) return false;
  try {
    const [workflow, contact] = await Promise.all([EmailWorkflow.findById(enrollment.workflow), VendorContact.findById(enrollment.contact).select("+unsubscribeToken")]);
    if (!workflow || !contact || contact.status !== "ACTIVE") { enrollment.status = "STOPPED"; await enrollment.save(); return true; }
    if (workflow.status === "PAUSED") { enrollment.status = workflow.kind === "BROADCAST" ? "STOPPED" : "PENDING"; enrollment.nextRunAt = new Date(Date.now() + 5 * 60_000); enrollment.lockedAt = undefined; await enrollment.save(); return true; }
    if (workflow.status !== "ACTIVE") { enrollment.status = "STOPPED"; await enrollment.save(); return true; }
    const followUp = enrollment.step === 1;
    if (followUp && contact.repliedAt) { enrollment.status = "STOPPED"; await enrollment.save(); return true; }
    const subject = personalize(followUp ? workflow.followUpSubject || `Following up: ${workflow.subject}` : workflow.subject, contact, sender.senderName);
    const text = personalize(followUp ? workflow.followUpMessage || `Hi {{vendor_name}},\n\nI wanted to follow up on my previous message about a potential partnership with {{company_name}}. Please let me know if this is relevant for your team.` : workflow.message, contact, sender.senderName);
    const unsubscribeUrl = `${env.CLIENT_URL}/api/v1/email-automation/unsubscribe/${contact.unsubscribeToken}`;
    const messageId = await sendBrevoEmail({ to: contact.email, toName: contact.name, subject, text, unsubscribeUrl, enrollmentId: enrollment.id }, sender);
    await EmailDelivery.create({ provider: sender.provider || "BREVO", workflow: workflow._id, contact: contact._id, enrollment: enrollment._id, recipientEmail: contact.email, providerMessageId: messageId, step: enrollment.step, subject, status: sender.provider === "GMAIL" ? "SENT" : "REQUESTED", events: [{ type: sender.provider === "GMAIL" ? "sent" : "request", occurredAt: new Date() }] });
    if (!followUp && workflow.followUp) { enrollment.step = 1; enrollment.status = "PENDING"; enrollment.nextRunAt = new Date(Date.now() + workflow.delayDays * 86_400_000); }
    else enrollment.status = "COMPLETED";
    enrollment.attempts = 0; enrollment.lastError = undefined; enrollment.lockedAt = undefined; await enrollment.save();
  } catch (error) {
    enrollment.attempts += 1; enrollment.lastError = error instanceof Error ? error.message.slice(0, 1000) : "Unknown sending error"; enrollment.lockedAt = undefined;
    if (sender.provider === "GMAIL") {
      const contact = await VendorContact.findById(enrollment.contact).select("email").lean();
      if (contact) await EmailDelivery.create({ provider: "GMAIL", workflow: enrollment.workflow, enrollment: enrollment._id, contact: enrollment.contact, recipientEmail: contact.email, providerMessageId: `gmail-attempt:${randomUUID()}`, step: enrollment.step, subject: "Gmail automation needs attention", status: "ERROR", events: [{ type: "error", occurredAt: new Date(), reason: enrollment.lastError }] }).catch(() => console.warn("Could not record Gmail failure activity"));
    }
    const gmailQuota = error instanceof AppError && error.code === "GMAIL_DAILY_LIMIT";
    enrollment.status = gmailQuota ? "PENDING" : sender.provider === "GMAIL" || enrollment.attempts >= 3 ? "FAILED" : "PENDING";
    enrollment.nextRunAt = gmailQuota ? new Date(new Date().setUTCHours(24, 0, 0, 0)) : new Date(Date.now() + Math.min(60, 5 * 2 ** enrollment.attempts) * 60_000); await enrollment.save();
  }
  return true;
};
const runTenantEmailAutomationCycle = async () => {
    const sender = await tenantConfiguration();
    if (!sender || !(await EmailEnrollment.exists({ status: "PENDING", nextRunAt: { $lte: new Date() } }))) return;
    try { await requireSendingEnabled(sender); }
    catch (error) { console.warn("Tenant Brevo sending is unavailable", error instanceof Error ? error.message : "Account check failed"); return; }
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await EmailDelivery.countDocuments({ step: { $gte: 0 }, createdAt: { $gte: startOfDay } });
    let available = Math.max(0, env.EMAIL_AUTOMATION_DAILY_LIMIT - sentToday);
    if (sender.provider === "GMAIL") {
      const gmail = await GmailConnection.findOne({ key: "gmail" }).lean();
      const attempts = gmail?.sendDay === new Date().toISOString().slice(0, 10) ? gmail.sendCount : 0;
      available = Math.min(available, Math.max(0, env.GMAIL_DAILY_LIMIT - attempts));
    }
    for (let index = 0; index < Math.min(env.EMAIL_AUTOMATION_BATCH_SIZE, available); index += 1) if (!(await processOne(sender))) break;
};
let cycleRunning = false;
export const runEmailAutomationCycle = async () => {
  if (cycleRunning || !env.EMAIL_AUTOMATION_ENABLED) return;
  cycleRunning = true;
  try {
    const tenantId = currentTenantId();
    if (tenantId) await runTenantEmailAutomationCycle();
    else {
      const tenants = await Tenant.find({ status: "ACTIVE" }).select("_id").lean();
      for (const tenant of tenants) await runWithTenant(tenant._id, runTenantEmailAutomationCycle);
    }
  }
  finally { cycleRunning = false; }
};
export const initializeEmailAutomation = async () => {
  if (!env.EMAIL_AUTOMATION_ENABLED) { console.warn("Email automation is disabled"); return; }
  await runEmailAutomationCycle();
};

