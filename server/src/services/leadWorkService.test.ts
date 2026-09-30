import assert from "node:assert/strict";
import test from "node:test";
import { markLeadTaskTypes } from "./leadWorkService.js";

test("lead tasks remain visible when imported work items exist without a batch", () => {
  const tasks = [{ _id: "lead-task" }, { _id: "standard-task" }];
  assert.deepEqual(markLeadTaskTypes(tasks, [{ task: "lead-task" }]).map((task) => task.taskType), ["LEAD_LIST", "STANDARD"]);
});
