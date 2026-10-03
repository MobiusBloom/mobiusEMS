import assert from "node:assert/strict";
import test from "node:test";
import { eodInput } from "./eodValidators.js";
import { EodUpdate } from "../models/EodUpdate.js";

const input = { date: "2026-01-01", accomplishments: "Shipped the customer import", inProgress: "", nextPlan: "Verify imported records", blockers: "", health: "ON_TRACK", status: "SUBMITTED" };
test("EOD permits private incomplete drafts but requires meaningful submissions", () => {
  assert.equal(eodInput.safeParse(input).success, true);
  assert.equal(eodInput.safeParse({ ...input, accomplishments: " ", nextPlan: "", status: "DRAFT" }).success, true);
  assert.equal(eodInput.safeParse({ ...input, accomplishments: " " }).success, false);
  assert.equal(eodInput.safeParse({ ...input, accomplishments: "", inProgress: "Investigating the import failure" }).success, true);
  assert.equal(eodInput.safeParse({ ...input, nextPlan: " " }).success, false);
});
test("EOD requires an explanation for risk and blockers", () => {
  for (const health of ["AT_RISK", "BLOCKED"]) {
    assert.equal(eodInput.safeParse({ ...input, health }).success, false);
    assert.equal(eodInput.safeParse({ ...input, health, blockers: "Waiting for API access; need approval" }).success, true);
  }
});
test("EOD rejects invalid dates, future dates, oversized text, and strips spoofed ownership", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2099-01-01", "invalid"]) assert.equal(eodInput.safeParse({ ...input, date }).success, false);
  assert.equal(eodInput.safeParse({ ...input, accomplishments: "a".repeat(4001) }).success, false);
  const parsed = eodInput.parse({ ...input, employee: "someone-else", acknowledgedAt: "2026-01-01" });
  assert.equal("employee" in parsed, false);
  assert.equal("acknowledgedAt" in parsed, false);
});
test("EOD uniqueness includes tenant, employee and day", () => {
  assert.ok(EodUpdate.schema.indexes().some(([fields, options]) => options.unique && fields.tenantId === 1 && fields.employee === 1 && fields.date === 1));
});
