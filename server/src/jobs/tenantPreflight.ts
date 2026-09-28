import mongoose from "mongoose";
import { inspectPendingTenantMigration, inspectUnsafeTenantIndexes } from "../tenancy/migrateTenants.js";

const run = async (): Promise<void> => {
  if (!process.env.MONGODB_MIGRATION_URI) throw new Error("Set MONGODB_MIGRATION_URI to the source MongoDB database");
  await mongoose.connect(process.env.MONGODB_MIGRATION_URI, { autoIndex: false, serverSelectionTimeoutMS: 10_000 });
  try {
    const [pending, unsafeIndexes] = await Promise.all([inspectPendingTenantMigration(), inspectUnsafeTenantIndexes()]);
    const total = pending.reduce((sum, collection) => sum + collection.records, 0);
    console.log(JSON.stringify({ migrationRequired: total > 0 || unsafeIndexes.length > 0, records: total, collections: pending, unsafeIndexes }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

void run().catch((error: unknown) => { console.error("Tenant preflight failed", error); process.exit(1); });
