import assert from "node:assert/strict";
import test from "node:test";
import { APPLICANT_STAGES, type ApplicantStage } from "@mobius-ems/shared";
import { jobDescriptionSchema, documentExpirationSchema } from "./governanceValidators.js";

test("APPLICANT_STAGES defines the complete recruitment funnel pipeline", () => {
  const expected: readonly ApplicantStage[] = [
    "SOURCED",
    "SCREENED",
    "INTERVIEWING",
    "OFFER_EXTENDED",
    "HIRED",
    "REJECTED"
  ];
  assert.deepEqual([...APPLICANT_STAGES], [...expected]);
});

test("jobDescriptionSchema validates title and substantive description bounds", () => {
  const validDesc = "This is a detailed job description that meets the 100 character minimum requirement for the recruitment and screening system to work effectively.".padEnd(120, ".");
  const valid = jobDescriptionSchema.safeParse({
    title: "Senior Full Stack Engineer",
    description: validDesc
  });
  assert.equal(valid.success, true);

  const shortDesc = jobDescriptionSchema.safeParse({
    title: "Developer",
    description: "Too short"
  });
  assert.equal(shortDesc.success, false);
});

test("documentExpirationSchema accepts ISO date string or null for removal", () => {
  assert.equal(documentExpirationSchema.safeParse({ body: { expiresAt: "2027-12-31" } }).success, true);
  assert.equal(documentExpirationSchema.safeParse({ body: { expiresAt: null } }).success, true);
  assert.equal(documentExpirationSchema.safeParse({ body: { expiresAt: "31-12-2027" } }).success, false);
});
