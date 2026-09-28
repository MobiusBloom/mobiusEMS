import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { seedOrganization } from "./seedSuperAdmin.js";

const run = async (): Promise<void> => {
  console.log("Connecting to PostgreSQL");
  const { defaultTenantId } = await connectDatabase();
  console.log("Tenant migration marker verified");
  try {
    await seedOrganization(defaultTenantId);
  } finally {
    await disconnectDatabase();
  }
};

void run().catch((error: unknown) => {
  console.error("Organization seed failed", error);
  process.exit(1);
});
