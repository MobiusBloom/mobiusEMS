import { createServer } from "node:http";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { seedOrganization, seedTenantGeography, seedTenantRoles } from "./jobs/seedSuperAdmin.js";
import { initializeEmailAutomation, runEmailAutomationCycle } from "./services/emailAutomationService.js";
import { runTargetReminderCycle } from "./services/targetReminderService.js";
import { runDocumentExpiryCycle } from "./services/documentExpiryService.js";
import { Tenant } from "./models/Tenant.js";
import { runWithTenant } from "./tenancy/tenantContext.js";

const start = async (): Promise<void> => {
  // Do not accept traffic until tenant migration, indexes and baseline roles are ready.
  const { defaultTenantId } = await connectDatabase();
  console.log("PostgreSQL connected and schema verified");
  await seedOrganization(defaultTenantId);
  const tenantIds = await Tenant.find({ _id: { $ne: defaultTenantId } }).distinct("_id");
  for (const tenantId of tenantIds) await runWithTenant(tenantId, async () => { await seedTenantRoles(); await seedTenantGeography(); });

  const server = createServer(createApp());
  server.listen(env.PORT, () => console.log(`MobiusEMS listening on port ${env.PORT}`));
  void initializeEmailAutomation().catch((error: unknown) => console.error("Brevo email automation initialization failed", error));
  const automationTimer = setInterval(() => void runEmailAutomationCycle(), 60_000); automationTimer.unref();
  const reminderTimer = setInterval(() => void runTargetReminderCycle(), 300_000); reminderTimer.unref();
  void runDocumentExpiryCycle().catch((error: unknown) => console.error("Document expiry check failed", error));
  const documentExpiryTimer = setInterval(() => void runDocumentExpiryCycle().catch((error: unknown) => console.error("Document expiry check failed", error)), 3_600_000); documentExpiryTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down`);
    clearInterval(automationTimer);
    clearInterval(reminderTimer);
    clearInterval(documentExpiryTimer);
    server.close(() => { void disconnectDatabase().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

void start().catch((error: unknown) => {
  console.error("MobiusEMS failed to start", error);
  void disconnectDatabase().finally(() => process.exit(1));
});
