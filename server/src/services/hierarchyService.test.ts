import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { ROLES, ROLE_PERMISSIONS } from "@mobius-ems/shared";
import { Employee } from "../models/Employee.js";
import {
  assertEmployeeInScope,
  autoStructureTenantHierarchy,
  assertSubordinateInScope,
  type ViewerHierarchyScope,
} from "./hierarchyService.js";

const newId = () => new Types.ObjectId();

test("automatic reporting hierarchy supports PostgreSQL string identifiers", async (context) => {
  const executive = newId().toString();
  const employee = newId().toString();
  const rows = [
    { _id: executive, firstName: "Test", lastName: "CEO", designation: { name: "CEO" }, department: { _id: "sales", name: "Sales" } },
    { _id: employee, firstName: "Test", lastName: "Employee", designation: { name: "Sales Executive" }, department: { _id: "sales", name: "Sales" } },
  ];
  const query = { populate: () => query, lean: async () => rows };
  context.mock.method(Employee, "find", () => query);
  let assignments = 0;
  context.mock.method(Employee, "updateOne", async (filter: { _id: string }, update: { $set: { reportingManager: string } }) => {
    assert.equal(String(filter._id), employee);
    assert.equal(String(update.$set.reportingManager), executive);
    assignments += 1;
  });
  const result = await autoStructureTenantHierarchy();
  assert.equal(result.topExecutiveId, executive);
  assert.equal(assignments, 1);
});

test("ROLES catalog contains required enterprise hierarchy roles", () => {
  assert.ok(ROLES.includes("SUPER_ADMIN"));
  assert.ok(ROLES.includes("HR_ADMIN"));
  assert.ok(ROLES.includes("DEPARTMENT_HEAD"));
  assert.ok(ROLES.includes("MANAGER"));
  assert.ok(ROLES.includes("TEAM_LEAD"));
  assert.ok(ROLES.includes("EMPLOYEE"));
});

test("TEAM_LEAD has team delivery and work oversight permissions", () => {
  const perms = ROLE_PERMISSIONS.TEAM_LEAD;
  assert.ok(perms.includes("task.create"));
  assert.ok(perms.includes("task.assign"));
  assert.ok(perms.includes("task.update"));
  assert.ok(perms.includes("task.review"));
  assert.ok(perms.includes("employee.view"));
  // Team leads cannot manage company-wide departments
  assert.ok(!perms.includes("department.create"));
});

test("APPLICANT can access assessments only", () => {
  assert.deepEqual(ROLE_PERMISSIONS.APPLICANT, ["section.assessments"]);
});

test("SUPER_ADMIN / HR_ADMIN scope permits any target employee", () => {
  const superAdminScope: ViewerHierarchyScope = {
    scopeType: "ALL",
    ownEmployeeId: newId(),
    allowedEmployeeIds: [],
    subordinateEmployeeIds: [],
  };

  const anyTarget = newId();
  assert.doesNotThrow(() => assertEmployeeInScope(superAdminScope, anyTarget));
  assert.doesNotThrow(() => assertSubordinateInScope(superAdminScope, anyTarget));
});

test("DEPARTMENT_HEAD can access all members within department and rejects foreign departments", () => {
  const headId = newId();
  const deptId = newId();
  const manager1Id = newId();
  const tl1Id = newId();
  const dev1Id = newId();
  const otherDeptEmployeeId = newId();

  const deptHeadScope: ViewerHierarchyScope = {
    scopeType: "DEPARTMENT",
    ownEmployeeId: headId,
    departmentId: deptId,
    allowedEmployeeIds: [headId, manager1Id, tl1Id, dev1Id],
    subordinateEmployeeIds: [manager1Id, tl1Id, dev1Id],
  };

  // Permitted within department
  assert.doesNotThrow(() => assertEmployeeInScope(deptHeadScope, headId));
  assert.doesNotThrow(() => assertEmployeeInScope(deptHeadScope, manager1Id));
  assert.doesNotThrow(() => assertEmployeeInScope(deptHeadScope, dev1Id));
  assert.doesNotThrow(() => assertSubordinateInScope(deptHeadScope, manager1Id));
  assert.doesNotThrow(() => assertSubordinateInScope(deptHeadScope, dev1Id));

  // Rejected: outside department
  assert.throws(
    () => assertEmployeeInScope(deptHeadScope, otherDeptEmployeeId),
    /outside your permitted scope/
  );
  assert.throws(
    () => assertSubordinateInScope(deptHeadScope, otherDeptEmployeeId),
    /not a subordinate/
  );
  // Head is not a subordinate of themselves
  assert.throws(
    () => assertSubordinateInScope(deptHeadScope, headId),
    /not a subordinate/
  );
});

test("MANAGER enforces horizontal peer isolation and recursive subordinate access", () => {
  const managerA = newId();
  const tlA = newId();
  const devA1 = newId();
  const devA2 = newId();

  // Peer manager and their team in the same department
  const managerB = newId();
  const tlB = newId();
  const devB1 = newId();

  const managerAScope: ViewerHierarchyScope = {
    scopeType: "SUBTREE",
    ownEmployeeId: managerA,
    allowedEmployeeIds: [managerA, tlA, devA1, devA2],
    subordinateEmployeeIds: [tlA, devA1, devA2],
  };

  // Manager A can view self and all recursive subordinates
  assert.doesNotThrow(() => assertEmployeeInScope(managerAScope, managerA));
  assert.doesNotThrow(() => assertEmployeeInScope(managerAScope, tlA));
  assert.doesNotThrow(() => assertEmployeeInScope(managerAScope, devA1));
  assert.doesNotThrow(() => assertEmployeeInScope(managerAScope, devA2));

  assert.doesNotThrow(() => assertSubordinateInScope(managerAScope, tlA));
  assert.doesNotThrow(() => assertSubordinateInScope(managerAScope, devA2));

  // Horizontal Isolation: Manager A cannot see Manager B or Manager B's subordinates
  assert.throws(
    () => assertEmployeeInScope(managerAScope, managerB),
    /outside your permitted scope/
  );
  assert.throws(
    () => assertEmployeeInScope(managerAScope, tlB),
    /outside your permitted scope/
  );
  assert.throws(
    () => assertEmployeeInScope(managerAScope, devB1),
    /outside your permitted scope/
  );

  assert.throws(
    () => assertSubordinateInScope(managerAScope, managerB),
    /not a subordinate/
  );
  assert.throws(
    () => assertSubordinateInScope(managerAScope, devB1),
    /not a subordinate/
  );
});

test("TEAM_LEAD can oversee team subordinates but is isolated from peer teams", () => {
  const lead1 = newId();
  const engineer1 = newId();
  const engineer2 = newId();

  const peerLead = newId();
  const peerEngineer = newId();

  const teamLeadScope: ViewerHierarchyScope = {
    scopeType: "SUBTREE",
    ownEmployeeId: lead1,
    allowedEmployeeIds: [lead1, engineer1, engineer2],
    subordinateEmployeeIds: [engineer1, engineer2],
  };

  assert.doesNotThrow(() => assertEmployeeInScope(teamLeadScope, lead1));
  assert.doesNotThrow(() => assertEmployeeInScope(teamLeadScope, engineer1));
  assert.doesNotThrow(() => assertSubordinateInScope(teamLeadScope, engineer1));

  // Isolated from peer lead and peer lead's engineers
  assert.throws(
    () => assertEmployeeInScope(teamLeadScope, peerLead),
    /outside your permitted scope/
  );
  assert.throws(
    () => assertEmployeeInScope(teamLeadScope, peerEngineer),
    /outside your permitted scope/
  );
});

test("EMPLOYEE is restricted to SELF only with zero subordinates", () => {
  const employeeId = newId();
  const colleagueId = newId();

  const employeeScope: ViewerHierarchyScope = {
    scopeType: "SELF",
    ownEmployeeId: employeeId,
    allowedEmployeeIds: [employeeId],
    subordinateEmployeeIds: [],
  };

  // Self is allowed in general scope
  assert.doesNotThrow(() => assertEmployeeInScope(employeeScope, employeeId));

  // Colleague is forbidden
  assert.throws(
    () => assertEmployeeInScope(employeeScope, colleagueId),
    /outside your permitted scope/
  );

  // Subordinate checks must fail for everyone including self
  assert.throws(
    () => assertSubordinateInScope(employeeScope, employeeId),
    /not a subordinate/
  );
  assert.throws(
    () => assertSubordinateInScope(employeeScope, colleagueId),
    /not a subordinate/
  );
});

test("calculateSeniorityRank assigns correct industry-standard executive tiers", async () => {
  const { calculateSeniorityRank } = await import("./hierarchyService.js");

  const ceo = calculateSeniorityRank({ designationTitle: "Chief Executive Officer" });
  assert.equal(ceo.rank, 1);
  assert.equal(ceo.tierName, "Executive Leadership (Tier 1)");

  const founder = calculateSeniorityRank({ designationTitle: "Founder & CEO" });
  assert.equal(founder.rank, 1);

  const cto = calculateSeniorityRank({ designationTitle: "Chief Technology Officer (CTO)" });
  assert.equal(cto.rank, 2);
  assert.equal(cto.tierName, "Senior Leadership / C-Suite (Tier 2)");

  const vpSales = calculateSeniorityRank({ designationTitle: "Vice President of Sales" });
  assert.equal(vpSales.rank, 2);

  const engManager = calculateSeniorityRank({ designationTitle: "Engineering Manager", role: "MANAGER" });
  assert.equal(engManager.rank, 3);
  assert.equal(engManager.tierName, "Management & Leads (Tier 3)");

  const teamLead = calculateSeniorityRank({ designationTitle: "Team Lead", role: "TEAM_LEAD" });
  assert.equal(teamLead.rank, 3);

  const srDev = calculateSeniorityRank({ designationTitle: "Senior Software Engineer" });
  assert.equal(srDev.rank, 4);
  assert.equal(srDev.tierName, "Senior Staff & Specialists (Tier 4)");

  const aimlEngineer = calculateSeniorityRank({ designationTitle: "AI/ML Engineer" });
  assert.equal(aimlEngineer.rank, 5);
  assert.equal(aimlEngineer.tierName, "Individual Contributors (Tier 5)");

  const intern = calculateSeniorityRank({ designationTitle: "Software Engineering Intern" });
  assert.equal(intern.rank, 6);
  assert.equal(intern.tierName, "Associate & Entry Level (Tier 6)");

  // CEO must be strictly more senior than CTO and AI/ML Engineer
  assert.ok(ceo.rank < cto.rank, "CEO (Tier 1) must be strictly higher seniority than CTO (Tier 2)");
  assert.ok(cto.rank < aimlEngineer.rank, "CTO (Tier 2) must be strictly higher seniority than AI/ML Engineer (Tier 5)");
});
