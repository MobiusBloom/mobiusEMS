import assert from "node:assert/strict";
import test from "node:test";
import { generateScreeningAssessment, parseScreeningAssessment } from "./resumeScreeningService.js";

const assessment = {
  candidateName: "Test Candidate", city: null, state: null, score: 75, classification: "POTENTIAL_FIT",
  summary: "Relevant engineering experience demonstrated.", writtenReason: "The resume demonstrates relevant skills but some required experience is not demonstrated.",
  matchedRequirements: ["Python experience"], missingRequirements: ["Deployment experience"], evidence: ['Built a Python tool using {data} and "quoted" inputs.']
};

test("screening accepts complete JSON with fences, prose and unrelated objects", () => {
  for (const text of [JSON.stringify(assessment), `\`\`\`json\n${JSON.stringify(assessment)}\n\`\`\``, `Metadata: {}\nResult: ${JSON.stringify(assessment)}\nEnd: {}`]) {
    assert.deepEqual(parseScreeningAssessment(text), assessment);
  }
});

test("screening retries truncated or incomplete responses before returning a validated result", async () => {
  for (const invalid of ['{"candidateName": "Test', JSON.stringify({ candidateName: "Test Candidate" })]) {
    const calls: Array<{ maxTokens?: number; system: string; user: string }> = [];
    const result = await generateScreeningAssessment("resume and JD", async (input) => {
      calls.push(input);
      return { text: calls.length === 1 ? invalid : JSON.stringify(assessment), provider: "test", model: "test" };
    });
    assert.deepEqual(result.assessment, assessment);
    assert.equal(calls.length, 2);
    assert.ok(calls[1]!.maxTokens! > calls[0]!.maxTokens!);
    assert.equal(calls[1]!.user, "resume and JD");
  }
});

test("screening rejects invalid scores and stops after one retry", async () => {
  assert.throws(() => parseScreeningAssessment(JSON.stringify({ ...assessment, score: 120 })), /complete screening result/);
  let calls = 0;
  await assert.rejects(generateScreeningAssessment("resume", async () => {
    calls += 1;
    return { text: "invalid", provider: "test", model: "test" };
  }), /complete screening result/);
  assert.equal(calls, 2);
});

test("provider errors are preserved without a format retry", async () => {
  let calls = 0;
  await assert.rejects(generateScreeningAssessment("resume", async () => {
    calls += 1;
    throw new Error("provider unavailable");
  }), /provider unavailable/);
  assert.equal(calls, 1);
});
