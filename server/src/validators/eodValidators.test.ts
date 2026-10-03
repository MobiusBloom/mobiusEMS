import assert from "node:assert/strict";
import test from "node:test";
import { eodInput, eodAnalyticsQuery, eodTemplateInput, eodReviewSchema } from "./eodValidators.js";
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
test("structured priorities support submission, cap commitments and validate linked task IDs", () => {
  const priority = { priority: "HIGH", expectedOutcome: "Ship the import", expectedCompletion: "2026-12-01" };
  assert.equal(eodInput.safeParse({ ...input, nextPlan: "", priorities: [priority] }).success, true);
  assert.equal(eodInput.safeParse({ ...input, priorities: [priority, priority, priority, priority] }).success, false);
  assert.equal(eodInput.safeParse({ ...input, priorities: [{ ...priority, task: "bad-id" }] }).success, false);
  assert.equal(eodInput.safeParse({ ...input, priorities: [{ ...priority, expectedOutcome: " " }] }).success, false);
});
test("analytics bounds ranges, validates filters and rejects future dates", () => {
  const range = { start: "2026-01-01", end: "2026-01-31" };
  assert.equal(eodAnalyticsQuery.safeParse(range).success, true);
  for (const invalid of [{ ...range, start: "2026-02-01" }, { ...range, end: "2099-01-01" }, { start: "2024-01-01", end: "2026-01-01" }, { ...range, project: "invalid" }, { ...range, status: "DRAFT" }, { ...range, blockerDays: 0 }]) assert.equal(eodAnalyticsQuery.safeParse(invalid).success, false);
});
test("templates only accept secure source IDs, unique fields and configured select options", () => {
  const base = { name: "Engineering", sections: [{ key: "work", title: "Work", fields: [{ key: "completed", label: "Completed", type: "NUMBER", source: "TASKS_COMPLETED_TODAY" }] }] };
  assert.equal(eodTemplateInput.safeParse(base).success, true);
  for (const fields of [[{ key: "query", label: "Query", type: "NUMBER", source: "SELECT * FROM employees" }], [{ key: "outcome", label: "Outcome", type: "SELECT" }], [base.sections[0]!.fields[0], base.sections[0]!.fields[0]], [{ key: "constructor", label: "Unsafe", type: "TEXT" }]]) assert.equal(eodTemplateInput.safeParse({ ...base, sections: [{ key: "work", title: "Work", fields }] }).success, false);
});
test("reviews use coordination states and strip spoofed reviewer identity", () => {
  const parsed = eodReviewSchema.parse({ params: { id: "a".repeat(24) }, body: { state: "NEEDS_CLARIFICATION", managerComment: "Please link evidence", reviewedBy: "another-user" } });
  assert.equal("reviewedBy" in parsed.body, false);
  assert.equal(eodReviewSchema.safeParse({ params: { id: "a".repeat(24) }, body: { state: "REJECTED" } }).success, false);
});
