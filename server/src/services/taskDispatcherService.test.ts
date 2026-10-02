import assert from "node:assert/strict";
import test from "node:test";
import { parseDispatcherJson, resolveDirectoryEmployee } from "./taskDispatcherService.js";

const employees = [
  { id: "1", label: "Ayush Rajak", employeeId: "EMP-101" },
  { id: "2", label: "Vandana Thapa", employeeId: "EMP-102" }
];

test("dispatcher accepts fenced structured task output", () => {
  const tasks = parseDispatcherJson('```json\n{"tasks":[{"snippet":"Ayush prepares payroll","action":"Prepare payroll","assignee":"Ayush","assigneeId":"1","dueDate":"2026-10-03T17:00:00+05:30","priority":"HIGH","dependency":null,"confidence":0.91}]}\n```');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.action, "Prepare payroll");
  assert.equal(tasks[0]?.priority, "HIGH");
});

test("dispatcher resolves valid ids and fuzzy unique names", () => {
  assert.equal(resolveDirectoryEmployee("invented", "2", employees).employee?.id, "2");
  assert.equal(resolveDirectoryEmployee("Aayush", undefined, employees).employee?.id, "1");
});

test("dispatcher does not guess ambiguous first names", () => {
  const ambiguous = [...employees, { id: "3", label: "Ayush Sharma", employeeId: "EMP-103" }];
  assert.equal(resolveDirectoryEmployee("Ayush", undefined, ambiguous).employee, undefined);
});
