import { env } from "./env.js";
import { connectPostgres, disconnectPostgres, ensureBinaryObjectTable, ensurePostgresExtensions } from "../persistence/postgres.js";
import { synchronizePostgresModels } from "../persistence/postgresModel.js";
import { ensureDefaultTenant } from "../tenancy/migrateTenants.js";
import { SystemMigration } from "../models/SystemMigration.js";

const POSTGRES_MIGRATION_KEY = "postgresql-persistence-v1";

export const connectDatabase = async (): Promise<{ defaultTenantId: string }> => {
  await connectPostgres();
  await import("../tenancy/modelRegistry.js");
  await ensurePostgresExtensions();
  await synchronizePostgresModels();
  await ensureBinaryObjectTable();
  const tenant = await ensureDefaultTenant();
  await SystemMigration.findOneAndUpdate(
    { key: POSTGRES_MIGRATION_KEY },
    { $setOnInsert: { key: POSTGRES_MIGRATION_KEY, appliedAt: new Date(), details: { engine: "postgresql", defaultTenantSlug: env.DEFAULT_TENANT_SLUG } } },
    { upsert: true, new: true },
  );
  return { defaultTenantId: tenant.id };
};

export const disconnectDatabase = disconnectPostgres;
