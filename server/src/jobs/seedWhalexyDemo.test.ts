import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_ACCESS_SECRET ??= "demo-test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET ??= "demo-test-refresh-secret-at-least-32-characters";

test("Whalexy fixtures pass model validation and include assigned lead-list tasks", async () => {
  const { seedWhalexyDemo } = await import("./seedWhalexyDemo.js");
  const result = await seedWhalexyDemo(true);
  assert.equal(result.tenantSlug, "whalexy-demo");
  assert.equal(result.counts.User, 10);
  assert.equal(result.counts.LeadImportBatch, 3);
  assert.equal(result.counts.SalesLead, 36);
  assert.equal(result.counts.LeadWorkItem, 36);
  assert.equal(result.counts.SalesOpportunity, 15);
  assert.equal(result.counts.Document, 18);
  assert.equal(result.counts.Payout, 3);
  assert.equal(result.counts.ContributionSnapshot, 9);
  assert.equal(new Set(result.accounts.map((a) => a.email)).size, 10);
});
