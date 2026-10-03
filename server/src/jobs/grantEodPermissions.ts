// Explicit rollout only. Never imported by startup or seed jobs.
import { Types } from "mongoose";
import { ROLES, ROLE_PERMISSIONS } from "@mobius-ems/shared";
import { Role } from "../models/Role.js";
import { Permission } from "../models/Permission.js";
import { runWithTenant } from "../tenancy/tenantContext.js";
import { connectPostgres, disconnectPostgres } from "../persistence/postgres.js";
import { writeAudit } from "../services/auditService.js";
const tenantId = process.argv.find(arg => arg.startsWith("--tenant="))?.slice(9);
const apply = process.argv.includes("--apply");
const actor = process.argv.find(arg => arg.startsWith("--actor="))?.slice(8);
if (!tenantId || !Types.ObjectId.isValid(tenantId) || (apply && (!actor || !Types.ObjectId.isValid(actor)))) throw new Error("Usage: npx tsx src/jobs/grantEodPermissions.ts --tenant=<id> [--apply --actor=<user-id>]. Defaults to dry run; use deployed schema.");
await connectPostgres();
try {
  await runWithTenant(tenantId, async () => {
    for (const role of await Role.find({ isSystem: true })) {
      const roleName = ROLES.find(name => name === role.name);
      if (!roleName) continue;
      const additions = ROLE_PERMISSIONS[roleName].filter(p => p === "section.eod" || p.startsWith("eod."));
      const missing = additions.filter(p => !role.permissions.includes(p));
      console.log(`${role.name}: ${missing.length ? missing.join(", ") : "no changes"}`);
      if (apply && missing.length) {
        await Permission.bulkWrite(missing.map(key => ({ updateOne: { filter: { key }, update: { $setOnInsert: { description: key.replaceAll(".", " ") } }, upsert: true } })));
        await Role.updateOne({ _id: role._id }, { $addToSet: { permissions: { $each: missing } } });
        await writeAudit({ user: actor!, action: "EOD_PERMISSIONS_GRANTED", entityType: "Role", entityId: role.id, newValue: { added: missing } });
      }
    }
  });
} finally { await disconnectPostgres(); }
