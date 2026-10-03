import test from "node:test";
import assert from "node:assert/strict";
import { SALES_EOD_SECTIONS, isReferenceSalesReport, type EodContext, type EodResponseValue } from "@mobius-ems/shared";
import { defaultEodTemplate, validateEodResponses } from "./eodTemplateService.js";
import { eodTemplateInput } from "../validators/eodValidators.js";

const employee = { _id: "e1", employeeId: "EMP1", firstName: "Sales", lastName: "User", department: { _id: "d1", name: "Sales" } } satisfies EodContext;
const template = defaultEodTemplate(employee);
test("Sales fallback matches the seven reference sections and supports saved templates", () => {
  assert.equal(template.adapter, "SALES");
  assert.equal(template.version, 2);
  assert.equal(template.sections.length, 7);
  assert.equal(isReferenceSalesReport(template.sections), true);
  assert.equal(eodTemplateInput.safeParse({ name: "Sales report", adapter: "SALES", sections: SALES_EOD_SECTIONS }).success, true);
  assert.equal(isReferenceSalesReport([{ key: "salesRevenue", title: "Custom", fields: [] }]), false);
  assert.equal(defaultEodTemplate({ ...employee, department: { _id: "d1", name: "IT" } }).adapter, "ENGINEERING");
});
test("Sales report accepts valid follow-ups and preserves fractional monetary amounts", () => {
  validateEodResponses(template, { dealsClosed: 1, salesClosed: 250.5, customerNames: "Acme", products: ["Whalexy"], expectedClosingDate: "2026-10-04", importantFollowups: JSON.stringify([{ name: "Acme", status: "Hot", nextAction: "Confirm purchase", expectedValue: 250.5, expectedDate: "2026-10-04" }]) }, true);
});
test("Sales reports validate counts, revenue and customer context", () => {
  const invalid: Record<string, EodResponseValue>[] = [{ callsMade: -1 }, { demosCompleted: 1.5 }, { dealsClosed: 1, revenueBooked: 20 }, { dealsClosed: 1, customerNames: "Acme" }, { products: ["Unsupported product"] }, { expectedClosingDate: "2026-02-30" }];
  for (const responses of invalid) assert.throws(() => validateEodResponses(template, responses, true));
  validateEodResponses(template, { dealsClosed: 1 }, false);
});
test("Sales follow-ups reject malformed payloads, unknown statuses and invalid dates", () => {
  const row = { name: "Acme", status: "Hot", nextAction: "Call", expectedValue: 20, expectedDate: "2026-10-04" };
  for (const value of ["not JSON", "{}", JSON.stringify([{ ...row, expectedValue: -1 }]), JSON.stringify([{ ...row, status: "UNKNOWN" }]), JSON.stringify([{ ...row, expectedDate: "2026-02-30" }]), JSON.stringify(Array.from({ length: 13 }, () => row))]) assert.throws(() => validateEodResponses(template, { importantFollowups: value }, true));
});
