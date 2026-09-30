import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { Types, type Model, type HydratedDocument } from "mongoose";
import { DEFAULT_PLAN_CONFIGS } from "@mobius-ems/shared";
import { env } from "../config/env.js";
import { postgres } from "../persistence/postgres.js";
import { runWithTenant } from "../tenancy/tenantContext.js";
import { seedPermissions, seedTenantRoles, seedTenantOrganizationPresets, seedTenantGeography } from "./seedSuperAdmin.js";
import { Tenant, type TenantDocument } from "../models/Tenant.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Department } from "../models/Department.js";
import { Designation } from "../models/Designation.js";
import { Team } from "../models/Team.js";
import { Employee } from "../models/Employee.js";
import { Project } from "../models/Project.js";
import { Task } from "../models/Task.js";
import { TaskActivity } from "../models/TaskActivity.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesCustomer } from "../models/SalesCustomer.js";
import { SalesOpportunity } from "../models/SalesOpportunity.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { EmployeeTerritoryAssignment } from "../models/EmployeeTerritoryAssignment.js";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { SalesConfiguration } from "../models/SalesConfiguration.js";
import { defaultSalesConfiguration } from "../services/salesConfigurationService.js";
import { LeadWorkItem } from "../models/LeadWorkItem.js";
import { LeadWorkActivity } from "../models/LeadWorkActivity.js";
import { GeoNode } from "../models/GeoNode.js";
import { Attendance } from "../models/Attendance.js";
import { AttendanceOffice } from "../models/AttendanceOffice.js";
import { LeavePolicy } from "../models/LeavePolicy.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Goal } from "../models/Goal.js";
import { KPI } from "../models/KPI.js";
import { EmployeeKPI } from "../models/EmployeeKPI.js";
import { Skill } from "../models/Skill.js";
import { EmployeeSkill } from "../models/EmployeeSkill.js";
import { SkillVerification } from "../models/SkillVerification.js";
import { Training } from "../models/Training.js";
import { EmployeeTraining } from "../models/EmployeeTraining.js";
import { Assessment } from "../models/Assessment.js";
import { AssessmentResult } from "../models/AssessmentResult.js";
import { Recognition } from "../models/Recognition.js";
import { PerformanceReview } from "../models/PerformanceReview.js";
import { PerformanceSnapshot } from "../models/PerformanceSnapshot.js";
import { ContributionReview } from "../models/ContributionReview.js";
import { WeeklyUpdate } from "../models/WeeklyUpdate.js";
import { OneToOne } from "../models/OneToOne.js";
import { EmployeeTimeline } from "../models/EmployeeTimeline.js";
import { EmployeeGamification } from "../models/EmployeeGamification.js";
import { DailyTodo } from "../models/DailyTodo.js";
import { Document } from "../models/Document.js";
import { Applicant } from "../models/Applicant.js";
import { JobDescription } from "../models/JobDescription.js";
import { Notification } from "../models/Notification.js";
import { AuditLog } from "../models/AuditLog.js";
import { CompensationRule } from "../models/CompensationRule.js";
import { EmailWorkflow } from "../models/EmailWorkflow.js";
import { VendorContact } from "../models/VendorContact.js";
import { LeadImportBatch } from "../models/LeadImportBatch.js";
import { SalesActivity } from "../models/SalesActivity.js";
import { ContributionSnapshot } from "../models/ContributionSnapshot.js";
import { PerformanceTemplate } from "../models/PerformanceTemplate.js";
import { CompensationPeriod, Payout } from "../models/Payout.js";
import { calculateCompensationPayout } from "../services/salesMath.js";

export const WHALEXY_DEMO_SLUG = "whalexy-demo";
const marker = "Whalexy synthetic demonstration v1";
export const WHALEXY_DEMO_ACCOUNTS = [
  { key: "admin", name: "Whalexy Admin", role: "SUPER_ADMIN", department: "Administration", designation: "Company Director" },
  { key: "manager", name: "Rohan Mehta", role: "MANAGER", department: "Sales", designation: "Sales Manager" },
  { key: "aarav", name: "Aarav Sharma", role: "EMPLOYEE", department: "Sales", designation: "Sales Executive" },
  { key: "priya", name: "Priya Verma", role: "EMPLOYEE", department: "Sales", designation: "Sales Executive" },
  { key: "kabir", name: "Kabir Shah", role: "EMPLOYEE", department: "Sales", designation: "Sales Executive" },
  { key: "hr", name: "Neha Gupta", role: "HR_ADMIN", department: "HR", designation: "HR Executive" },
  { key: "developer", name: "Ishaan Patel", role: "EMPLOYEE", department: "IT", designation: "Software Engineer" },
  { key: "marketing", name: "Ananya Rao", role: "EMPLOYEE", department: "Marketing", designation: "Marketing Specialist" },
  { key: "operations", name: "Vikram Singh", role: "EMPLOYEE", department: "Operations", designation: "Operations Analyst" },
  { key: "support", name: "Sneha Iyer", role: "EMPLOYEE", department: "Administration", designation: "Client Success Executive" },
] as const;

export const demoEmail = (key: string) => `${key}@whalexy-demo.example`;
const stableId = (tenant: string, model: string, key: string) => new Types.ObjectId(createHash("sha256").update(`${tenant}:whalexy-v1:${model}:${key}`).digest("hex").slice(0, 24));
const day = (base: Date, offset: number, hour = 4) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset, hour));
const samplePdf = (text: string): Buffer => {
  const lines = text.split("\n").map((line) => line.replace(/[\\()]/g, "\\$&"));
  const stream = `BT /F1 12 Tf 50 780 Td 18 TL ${lines.map((line, index) => `${index ? "T* " : ""}(${line}) Tj`).join("\n")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
};

// Same fixture is validated offline and inserted with normal model validation on the server.
// Existing records are preserved so edits during a sales demonstration survive restarts.
const seedDemoRecords = async (validateOnly = false) => {
  const password = env.WHALEXY_DEMO_PASSWORD;
  if (!validateOnly && !password) throw new Error("Set WHALEXY_DEMO_PASSWORD (at least 16 characters) before enabling the Whalexy demo");
  const counts: Record<string, number> = {};
  let tenantId = stableId("offline", "Tenant", WHALEXY_DEMO_SLUG).toString();
  let anchor = new Date();
  let tenant: HydratedDocument<TenantDocument> | null = null;
  if (!validateOnly) {
    tenant = await Tenant.findOne({ slug: WHALEXY_DEMO_SLUG });
    if (tenant && tenant.primaryUseCase !== marker) throw new Error("whalexy-demo belongs to an existing company; refusing to seed it");
    if (tenant?.status === "ACTIVE" && await runWithTenant(tenant._id, () => AuditLog.exists({ action: "WHALEXY_DEMO_PROVISIONED" }))) {
      return { tenantSlug: WHALEXY_DEMO_SLUG, alreadySeeded: true, counts, accounts: WHALEXY_DEMO_ACCOUNTS.map((a) => ({ email: demoEmail(a.key), role: a.role })) };
    }
    if (!tenant) tenant = await Tenant.create({ name: "Whalexy", slug: WHALEXY_DEMO_SLUG, primaryUseCase: marker, industry: "Software and business services", companySize: "11-50", country: "India", status: "PROVISIONING", plan: "ENTERPRISE", subscriptionStatus: "ACTIVE", maxEmployees: 50, maxStorageMb: 10240, features: DEFAULT_PLAN_CONFIGS.ENTERPRISE.features });
    tenantId = tenant._id.toString();
    // Keep periods/IDs stable on reruns; this is a snapshot of a company on its creation date.
    anchor = (tenant as unknown as { createdAt: Date }).createdAt;
    await seedPermissions();
  }
  const localMonth = new Date(anchor.getTime() + 330 * 60_000);
  const period = `${localMonth.getUTCFullYear()}-${String(localMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(localMonth.getUTCFullYear(), localMonth.getUTCMonth(), 1) - 330 * 60_000);
  const monthEnd = new Date(Date.UTC(localMonth.getUTCFullYear(), localMonth.getUTCMonth() + 1, 1) - 330 * 60_000 - 1);
  const previousMonthStart = new Date(Date.UTC(localMonth.getUTCFullYear(), localMonth.getUTCMonth() - 1, 1) - 330 * 60_000);
  const previousMonthEnd = new Date(monthStart.getTime() - 1);
  const hash = await bcrypt.hash(password ?? "Offline-validation-only!42", 12);
  const id = (model: string, key: string) => stableId(tenantId, model, key);
  const put = async <T>(model: Model<T>, key: string, data: Partial<T>) => {
    counts[model.modelName] = (counts[model.modelName] ?? 0) + 1;
    const existing = validateOnly ? null : await model.findById(id(model.modelName, key));
    if (existing) return existing;
    const document = new model({ ...data, _id: id(model.modelName, key), tenantId });
    await document.validate();
    if (!validateOnly) await document.save();
    return document;
  };
  await runWithTenant(tenantId, async () => {
    if (!validateOnly) { await seedTenantRoles(); await seedTenantOrganizationPresets(); await seedTenantGeography(); }
    const adminId = id("User", "admin");
    const managerId = id("Employee", "manager");
    const departments = new Map<string, Types.ObjectId>();
    const designations = new Map<string, Types.ObjectId>();
    const roles = new Map<string, Types.ObjectId>();
    for (const account of WHALEXY_DEMO_ACCOUNTS) {
      if (!departments.has(account.department)) {
        const existing = validateOnly ? null : await Department.findOne({ name: account.department });
        const department = existing ?? await put(Department, account.department, { name: account.department, code: account.department.slice(0, 4).toUpperCase(), capabilities: account.department === "Sales" ? ["SALES_MODULE"] : [], isActive: true });
        departments.set(account.department, department._id);
      }
      if (!designations.has(account.designation)) {
        const existing = validateOnly ? null : await Designation.findOne({ name: account.designation });
        const designation = existing ?? await put(Designation, account.designation, { name: account.designation, code: `WX-${designations.size}`, department: departments.get(account.department), catalogRole: account.department === "Sales" ? "SaaS Sales (AE)" : undefined, isActive: true });
        designations.set(account.designation, designation._id);
      }
      if (!roles.has(account.role)) {
        const role = validateOnly ? { _id: id("Role", account.role) } : await Role.findOne({ name: account.role }).orFail();
        roles.set(account.role, role._id);
      }
    }
    const teams = new Map<string, Types.ObjectId>();
    for (const [name, department] of departments) {
      const team = await put(Team, name, { name: `${name} Team`, code: `WX-${teams.size}`, department, isActive: true, ...(name === "Sales" ? { lead: managerId } : {}) });
      teams.set(name, team._id);
    }
    const world = validateOnly ? await put(GeoNode, "world", { name: "World", code: "WORLD", type: "GLOBAL", depth: 0, ancestors: [], isActive: true }) : await GeoNode.findOne({ type: "GLOBAL" }).orFail();
    const country = await put(GeoNode, "india", { name: "India", code: "WX-IN", type: "COUNTRY", parent: world._id, depth: 1, ancestors: [world._id], createdBy: adminId, isActive: true });
    const regions = ["Delhi NCR", "Mumbai", "Bengaluru"];
    const cityIds: Types.ObjectId[] = [];
    for (let i = 0; i < regions.length; i++) {
      const state = await put(GeoNode, `state-${i}`, { name: ["Delhi", "Maharashtra", "Karnataka"][i]!, code: `WX-STATE-${i}`, type: "STATE", parent: country._id, ancestors: [world._id, country._id], depth: 2, isActive: true, createdBy: adminId });
      const city = await put(GeoNode, `city-${i}`, { name: regions[i], code: `WX-CITY-${i}`, type: "CITY", parent: state._id, ancestors: [world._id, country._id, state._id], depth: 3, location: { type: "Point", coordinates: [[77.21, 28.61], [72.88, 19.08], [77.59, 12.97]][i] as [number, number] }, isActive: true, createdBy: adminId });
      cityIds.push(city._id);
    }
    await put(SalesConfiguration, "default", defaultSalesConfiguration);
    await put(PerformanceTemplate, "default", { name: "Whalexy Balanced Performance", weights: { taskQuality: 25, onTimeDelivery: 20, kpiAchievement: 20, verifiedSkills: 15, goalAchievement: 10, learningGrowth: 10 }, thresholds: { exceptional: 90, strong: 80, consistent: 70, developing: 55 }, isDefault: true, isActive: true });
    await put(AttendanceOffice, "primary", { key: "PRIMARY", name: "Whalexy HQ", latitude: 28.61, longitude: 77.21, radiusMeters: 300, maxAccuracyMeters: 100, configuredBy: adminId });
    await put(LeavePolicy, "casual", { name: "Casual Leave", code: "CASUAL_LEAVE", quotaDays: 12, isPaid: true, isActive: true, isSystem: true });
    await put(LeavePolicy, "sick", { name: "Sick Leave", code: "SICK_LEAVE", quotaDays: 8, isPaid: true, isActive: true, isSystem: true });
    const salesEmployees = WHALEXY_DEMO_ACCOUNTS.filter((a) => ["aarav", "priya", "kabir"].includes(a.key));
    const employeeIds = WHALEXY_DEMO_ACCOUNTS.filter((a) => a.key !== "admin").map((a) => id("Employee", a.key));
    for (const account of WHALEXY_DEMO_ACCOUNTS) {
      const employeeId = id("Employee", account.key);
      const user = await put(User, account.key, { name: account.name, email: demoEmail(account.key), passwordHash: hash, role: roles.get(account.role), isActive: true, forcePasswordChange: false, onboardingComplete: true, ...(account.key !== "admin" ? { employee: employeeId } : {}) });
      if (account.key === "admin") continue;
      const [firstName, ...lastNames] = account.name.split(" ");
      const department = departments.get(account.department)!;
      await put(Employee, account.key, { employeeId: `WX-${account.key.toUpperCase()}`, user: user._id, firstName, lastName: lastNames.join(" "), officialEmail: user.email, department, team: teams.get(account.department), designation: designations.get(account.designation), ...(account.department === "Sales" && account.key !== "manager" ? { reportingManager: managerId } : {}), dateOfJoining: day(anchor, -120), employmentType: "FULL_TIME", officeLocation: "Whalexy HQ", status: "ACTIVE", professionalSummary: `${account.designation} supporting Whalexy's customer growth and delivery.`, onboardingStep: 8, profileCompletion: 100, previousExperience: [], isActive: true, workLocation: { country: country._id, geoNode: cityIds[0], city: cityIds[0] } });
    }
    const projectNames = ["India Sales Expansion", "CRM Platform Upgrade", "Customer Onboarding", "Growth Marketing", "People Development"];
    for (let p = 0; p < projectNames.length; p++) {
      await put(Project, `${p}`, { name: projectNames[p]!, code: `WX-PROJ-${p + 1}`, description: `Whalexy ${projectNames[p]!.toLowerCase()} initiative, with weekly milestones and accountable owners.`, department: departments.get(p === 1 ? "IT" : p === 3 ? "Marketing" : p === 4 ? "HR" : "Sales"), projectManager: managerId, teamMembers: employeeIds, startDate: day(anchor, -45), expectedEndDate: day(anchor, 30 + p * 7), status: p === 4 ? "COMPLETED" : "ACTIVE", progress: [64, 45, 72, 38, 100][p], priority: "HIGH", isActive: true });
    }
    const skillNames = ["Consultative Sales", "CRM Management", "Negotiation", "Client Communication", "Data Analysis", "React"];
    for (let s = 0; s < skillNames.length; s++) {
      const skill = await put(Skill, `${s}`, { name: skillNames[s]!, normalizedName: skillNames[s]!.toLowerCase(), category: s === 5 ? "Engineering" : "Business", description: `Practical proficiency in ${skillNames[s]!.toLowerCase()}`, isActive: true });
      await put(Training, `${s}`, { name: `${skillNames[s]} Masterclass`, skill: skill._id, provider: "Whalexy Learning Academy", description: "Hands-on workshop with practical assignments and peer feedback.", startDate: day(anchor, -14), isActive: true });
    }
    const kpi = await put(KPI, "revenue", { name: "Monthly Revenue", target: 500000, unit: "INR", weight: 100, period, department: departments.get("Sales"), isActive: true });
    for (let e = 0; e < employeeIds.length; e++) {
      const account = WHALEXY_DEMO_ACCOUNTS[e + 1]!;
      const employee = employeeIds[e]!;
      const department = departments.get(account.department)!;
      for (let t = 0; t < 6; t++) {
        const statuses = ["COMPLETED", "COMPLETED", "IN_REVIEW", "IN_PROGRESS", "BLOCKED", "NOT_STARTED"] as const;
        const task = await put(Task, `${account.key}-${t}`, { taskId: `WX-${account.key.toUpperCase()}-${t + 1}`, name: ["Complete weekly delivery milestone", "Review customer requirements", "Submit campaign results", "Contact assigned prospects", "Resolve customer approval", "Prepare next week plan"][t], description: "Track deliverables, document customer feedback, and update the manager before the deadline.", project: id("Project", `${e % 5}`), department, assignedEmployee: employee, assignedBy: id("User", "manager"), estimatedHours: 8 + t * 2, actualHours: t < 2 ? 7 + t * 2 : undefined, status: statuses[t], priority: t === 4 ? "HIGH" : "MEDIUM", complexity: "MEDIUM", startDate: day(anchor, -7), deadline: day(anchor, t === 4 ? -1 : t + 2), completionDate: t < 2 ? day(anchor, -3 + t) : undefined, completionNote: t < 2 ? "Deliverable reviewed and accepted by project owner." : undefined, qualityRating: t < 2 ? 4 : undefined, reviewer: managerId, blocker: t === 4 ? { reason: "WAITING_FOR_CLIENT", comment: "Awaiting purchase approval from the customer.", startedAt: day(anchor, -2), external: true } : undefined, isActive: true });
        await put(TaskActivity, `${account.key}-${t}`, { task: task._id, action: "TASK_ASSIGNED", newValue: { status: task.status }, performedBy: adminId });
      }
      for (let d = -21; d <= 0; d++) {
        const date = day(anchor, d);
        if ([0, 6].includes(date.getUTCDay())) continue;
        const checkIn = day(anchor, d, 4);
        const proof = { latitude: 28.61, longitude: 77.21, accuracy: 15, distanceMeters: 30, recordedAt: checkIn };
        await put(Attendance, `${account.key}-${d}`, { employee, department, dateKey: checkIn.toISOString().slice(0, 10), status: d === -3 ? "LATE" : "PRESENT", checkInAt: checkIn, checkInLocation: proof, checkOutAt: day(anchor, d, 13), checkOutLocation: { ...proof, recordedAt: day(anchor, d, 13) }, workedMinutes: 540, isActive: true });
      }
      await put(LeaveRequest, account.key, { employee, type: "CASUAL_LEAVE", startDate: day(anchor, 8 + e), endDate: day(anchor, 9 + e), reason: "Planned family commitment; delivery handover arranged with the team.", status: e % 2 ? "APPROVED" : "PENDING", ...(e % 2 ? { reviewedBy: adminId, reviewComment: "Approved after coverage review." } : {}) });
      await put(Goal, account.key, { name: account.department === "Sales" ? "Improve qualified pipeline coverage" : "Deliver quarterly team milestones", employee, period, weight: 100, startDate: monthStart, endDate: monthEnd, progress: 55 + e * 4, status: e === 2 ? "AT_RISK" : "ON_TRACK", createdBy: adminId, isActive: true, managerComment: "Good progress. Focus on completing the remaining milestones." });
      for (let s = 0; s < 3; s++) {
        const skill = id("Skill", `${account.department === "IT" ? 5 : s}`);
        if (account.department === "IT" && s > 0) continue;
        const claim = await put(EmployeeSkill, `${account.key}-${s}`, { employee, skill, selfRating: 7 + s, yearsOfExperience: 2 + s, lastUsed: day(anchor, -1), evidence: [{ type: "COMMENT", comment: "Demonstrated through customer conversations and reviewed project deliverables." }], verificationStatus: s === 2 ? "PENDING" : "VERIFIED", verifiedRating: s === 2 ? undefined : 7 + s, isActive: true });
        if (s < 2) {
          const verification = await put(SkillVerification, `${account.key}-${s}`, { employeeSkill: claim._id, employee, skill, selfRating: 7 + s, verifiedRating: 7 + s, status: "VERIFIED", verifiedBy: adminId, method: "WORK_PERFORMANCE", justification: "Reviewed completed deliverables and practical application.", verificationDate: day(anchor, -7) });
          if (!validateOnly && !claim.latestVerification) { claim.latestVerification = verification._id; await claim.save(); }
        }
      }
      await put(EmployeeTraining, account.key, { employee, training: id("Training", `${e % 6}`), assignedBy: adminId, status: e % 2 ? "IN_PROGRESS" : "COMPLETED", ...(e % 2 ? {} : { completedAt: day(anchor, -3), result: "Passed practical assignment" }) });
      const assessment = await put(Assessment, account.key, { name: "Customer discovery fundamentals", skill: id("Skill", "0"), assignedEmployee: employee, assignedBy: adminId, difficulty: "INTERMEDIATE", maximumScore: 20, passingScore: 12, timeLimitMinutes: 20, questions: [{ id: "discovery", question: "What should be established before proposing a solution?", type: "MCQ", options: ["Customer needs and buying process", "Discount amount"], correctOptionIndex: 0, points: 20 }], answers: [{ questionId: "discovery", selectedOption: 0, isCorrect: true, earnedPoints: 20 }], status: "COMPLETED", completedAt: day(anchor, -5), score: 20, percentage: 100, result: "PASSED" });
      await put(AssessmentResult, account.key, { assessment: assessment._id, employee, attemptDate: day(anchor, -5), score: 20, result: "PASSED", evaluatedBy: adminId, notes: "Customer discovery exercise completed." });
      const score = 76 + e * 2;
      await put(ContributionSnapshot, account.key, { employee, period, role: account.designation, totalScore: score, classification: "Strong Contributor", evidenceCoverage: 100, components: [{ key: "delivery", label: "Delivery", score, configuredWeight: 100, effectiveWeight: 100, contribution: score, available: true, explanation: "Synthetic demonstration of completed milestones and customer handovers." }], alerts: [], calculatedBy: adminId, calculatedAt: day(anchor, -1) });
      await put(PerformanceReview, account.key, { employee, reviewer: adminId, type: "MONTHLY", period, ratings: [{ category: "WORK_QUALITY", rating: 4, comment: "Reliable output with clear handovers." }, { category: "COMMUNICATION", rating: 4 }], finalRating: 4, comments: "Consistent delivery. Improve forecasting and milestone visibility.", reviewDate: day(anchor, -2) });
      await put(PerformanceSnapshot, account.key, { employee, period, periodType: "MONTHLY", totalScore: score, classification: "Strong Performer", components: [{ key: "delivery", label: "Delivery", rawScore: score, weight: 100, weightedScore: score, explanation: "Synthetic demonstration score based on delivery milestones." }], strengths: ["Customer ownership", "Clear communication"], developmentAreas: ["Forecast accuracy"], calculatedBy: adminId, calculatedAt: day(anchor, -1) });
      await put(ContributionReview, account.key, { employee, period, status: "MANAGER_REVIEWED", selfReview: { accomplishments: "Completed key milestones and improved customer handovers.", impact: "Reduced turnaround time for customer requests.", collaboration: "Supported team members with reviews and follow-ups.", growth: "Completed the discovery workshop.", evidenceLinks: [], submittedAt: day(anchor, -4) }, managerReview: { ratings: { delivery: 4, quality: 4, reliability: 4, impact: 4, collaboration: 4, growth: 4 }, comment: "Keep focusing on measurable outcomes.", reviewedBy: adminId, reviewedAt: day(anchor, -2) } });
      const weekStart = day(anchor, -((anchor.getUTCDay() + 6) % 7));
      await put(WeeklyUpdate, account.key, { employee, weekStart, accomplishments: ["Completed customer handovers", "Reviewed weekly pipeline"], currentPriorities: ["Complete open follow-ups", "Deliver upcoming milestones"], blockers: [{ description: "One client approval is pending", category: "CLIENT", external: true }], nextWeekPlan: "Close outstanding approvals and prepare the next campaign.", submittedAt: day(anchor, -1), managerComment: "Priorities reviewed.", acknowledgedBy: adminId });
      await put(OneToOne, account.key, { employee, manager: id("User", "manager"), meetingDate: day(anchor, -4), accomplishments: "Consistent weekly delivery and customer engagement.", challenges: "Customer approvals take longer than planned.", supportNeeded: "Manager support for a purchase approval.", careerGoals: "Develop account ownership and mentoring skills.", agreedActions: [{ text: "Prepare a weekly forecast with next actions", dueDate: day(anchor, 3), completed: false }], nextReviewDate: day(anchor, 10) });
      await put(EmployeeTimeline, account.key, { employee, type: "JOINED", title: "Joined Whalexy", description: `Joined as ${account.designation}.`, performedBy: adminId, occurredAt: day(anchor, -120) });
      await put(EmployeeGamification, account.key, { employeeId: employee, currentLevel: 3, currentLevelXp: 120, xpForNextLevel: 500, totalLifetimeXp: 920, streakDays: 5, completedTasksCount: 2, lastActiveDate: day(anchor, 0), earnedBadges: [{ badgeKey: "on_time", name: "On-time Delivery", description: "Completed milestones on schedule", icon: "trophy", awardedAt: day(anchor, -2) }], history: [{ taskId: id("Task", `${account.key}-0`), xpEarned: 50, reason: "Task completed", createdAt: day(anchor, -3) }] });
      await put(DailyTodo, account.key, { user: id("User", account.key), employee, date: day(anchor, 0).toISOString().slice(0, 10), title: "Review today's priorities and customer follow-ups", type: "WORK", priority: "HIGH", durationMinutes: 30, status: "TODO", completed: false });
      await put(Notification, account.key, { recipient: id("User", account.key), type: "TASK_ASSIGNED", title: "This week's work is ready", body: "Review your assigned tasks, customer follow-ups and goals.", channels: ["IN_APP"], entityType: "Task", entityId: id("Task", `${account.key}-3`).toString() });
      if (e < 3) await put(Recognition, account.key, { employee, badge: "CUSTOMER_CHAMPION", explanation: "Clear customer handovers and timely follow-ups during the growth campaign.", evidence: ["Customer onboarding milestone completed"], awardedBy: adminId, awardedAt: day(anchor, -2) });
    }
    const companyNames = ["Aurora Retail", "Summit Logistics", "BluePeak Healthcare", "Cedar Education", "Horizon Manufacturing", "Maple Hospitality", "Northstar Finance", "Silverline Foods", "Orion Media", "Riverbank Commerce", "Vertex Mobility", "Lighthouse Services"];
    const closedPeriod = await put(CompensationPeriod, "previous-month", { periodType: "MONTHLY", periodStart: previousMonthStart, periodEnd: previousMonthEnd, status: "CLOSED", closedBy: adminId, closedAt: monthStart });
    for (let e = 0; e < salesEmployees.length; e++) {
      const account = salesEmployees[e]!;
      const employee = id("Employee", account.key);
      const territory = await put(SalesTerritory, `${e}`, { name: regions[e]!, code: `WX-REGION-${e}`, ownerEmployee: managerId, effectiveFrom: day(anchor, -120), status: "ACTIVE", ancestors: [], coverageRules: { geoNodeIds: [cityIds[e]!], pincodes: [], productIds: [], channels: ["DIRECT"], industries: ["Software"], customerTypes: ["B2B"], namedAccountIds: [] } });
      await put(EmployeeTerritoryAssignment, account.key, { employee, territory: territory._id, assignmentRole: "MEMBER", primary: true, effectiveFrom: day(anchor, -120), leadCapacityPerMonth: 100, isActive: true });
      await put(EmployeeTerritoryAssignment, `manager-${e}`, { employee: managerId, territory: territory._id, assignmentRole: "MANAGER", primary: e === 0, effectiveFrom: day(anchor, -120), isActive: true });
      if (!validateOnly && tenant?.status === "PROVISIONING") await Employee.updateOne({ _id: employee }, { $set: { workLocation: { country: country._id, city: cityIds[e], geoNode: cityIds[e] } } });
      await put(LeadImportBatch, account.key, { task: id("Task", `${account.key}-3`), fileName: `${regions[e]}-prospects.csv`, fileHash: createHash("sha256").update(`synthetic-${account.key}`).digest("hex"), idempotencyKey: `whalexy-${account.key}-v1`, importedBy: adminId, assignedEmployee: employee, totalRows: 12, importedRows: 12, rejectedRows: 0, duplicateLinks: 0, columns: ["Name", "Company", "Email"], mapping: { name: "Name", companyName: "Company", email: "Email" }, createdAt: day(anchor, -20) });
      let achieved = 0;
      for (let l = 0; l < 12; l++) {
        const key = `${account.key}-${l}`;
        const value = 80000 + e * 20000 + l * 10000;
        const converted = l >= 9;
        const status = converted ? "CONVERTED" : l === 8 ? "LOST" : l < 3 ? "NEW" : l < 6 ? "CONTACTED" : "QUALIFIED";
        const createdAt = day(anchor, -20 + l);
        const contact = `${["Aditya", "Kavya", "Rahul"][e]} ${["Kapoor", "Menon", "Joshi"][l % 3]}`;
        const lead = await put(SalesLead, key, { name: contact, companyName: `${companyNames[l]} ${regions[e]}`, email: `contact-${e}-${l}@customer.example`, notes: converted ? "Proposal accepted; customer onboarding completed." : "Discuss workforce and CRM requirements; follow up with the decision maker.", market: "India", ownerEmployee: employee, territory: territory._id, geoNode: cityIds[e], status, source: ["Website", "Referral", "LinkedIn", "Trade Show"][l % 4], estimatedValue: value, currency: "INR", createdAt, ...(converted ? { customer: id("SalesCustomer", key), convertedAt: day(anchor, -2) } : {}), ...(status === "LOST" ? { lostReason: "Budget postponed to next quarter" } : {}), ...(l >= 3 ? { firstResponseAt: new Date(createdAt.getTime() + 90 * 60_000) } : {}), ...(status === "QUALIFIED" || converted ? { qualifiedAt: day(anchor, -5) } : {}) });
        const workStatus = converted ? "CONVERTED" : l === 8 ? "NOT_INTERESTED" : l < 3 ? "NOT_STARTED" : l < 6 ? "FOLLOW_UP" : "QUALIFIED";
        const task = id("Task", `${account.key}-3`);
        const workItem = await put(LeadWorkItem, key, { task, lead: lead._id, assignedEmployee: employee, status: workStatus, attemptCount: l < 3 ? 0 : 2, lastAttemptAt: l < 3 ? undefined : day(anchor, -1), lastActivityAt: l < 3 ? undefined : day(anchor, -1), nextFollowUpAt: workStatus === "FOLLOW_UP" ? day(anchor, l - 4, 7) : undefined, latestNote: lead.notes, sourceRow: l + 2, originalData: { Name: contact, Company: lead.companyName!, Email: lead.email! }, version: l < 3 ? 0 : 1 });
        if (l >= 3) await put(SalesActivity, key, { entityType: "leads", entityId: lead._id, type: converted ? "CONVERSION" : "CALL_LOG", content: lead.notes!, performedBy: id("User", account.key), performedByName: account.name, createdAt: day(anchor, -1) });
        if (l >= 3) await put(LeadWorkActivity, key, { task, workItem: workItem._id, lead: lead._id, assignedEmployee: employee, performedBy: id("User", account.key), interactionType: "PHONE_CALL", outcome: converted ? "CONVERTED" : l === 8 ? "NOT_INTERESTED" : l < 6 ? "REQUESTED_CALLBACK" : "QUALIFIED", fromStatus: "NOT_STARTED", toStatus: workStatus, note: lead.notes!, nextFollowUpAt: workItem.nextFollowUpAt, createdAt: day(anchor, -1) });
        if (l >= 6 && l !== 8) {
          const customer = await put(SalesCustomer, key, { name: `${companyNames[l]} ${regions[e]}`, primaryContactName: contact, email: lead.email, market: "India", ownerEmployee: employee, territory: territory._id, geoNode: cityIds[e], status: "ACTIVE", customerType: "B2B", lifetimeRevenue: converted ? value : 0, currency: "INR", ...(converted ? { sourceLead: lead._id, lastOrderDate: day(anchor, -2) } : {}) });
          const opportunity = await put(SalesOpportunity, key, { name: `${companyNames[l]} Annual Platform License`, lead: lead._id, customer: customer._id, ownerEmployee: employee, territory: territory._id, geoNode: cityIds[e], market: "India", stage: converted ? "Closed Won" : l === 6 ? "Proposal" : "Negotiation", estimatedValue: value, probability: converted ? 100 : 65, expectedCloseDate: day(anchor, 7), status: converted ? "WON" : "OPEN", ...(converted ? { actualCloseDate: day(anchor, -2) } : {}) });
          if (converted) {
            achieved += value;
            await put(SalesRevenueTransaction, key, { sourceOpportunity: opportunity._id, customer: customer._id, employee, territory: territory._id, geoNode: cityIds[e], amount: value, quantity: 1, currency: "INR", transactionDate: day(anchor, -2), source: "OPPORTUNITY_WON", reference: `WX-INVOICE-${e}-${l}` });
          }
        }
      }
      await put(SalesTarget, account.key, { employee, territory: territory._id, periodType: "MONTHLY", periodStart: monthStart, periodEnd: monthEnd, effectiveFrom: monthStart, revenueTarget: 750000, currency: "INR", leadTarget: 30, conversionTarget: 25, customerAcquisitionTarget: 6, status: "ACTIVE", justification: "Monthly regional growth target based on account coverage and pipeline.", createdBy: adminId, assignedBy: id("User", "manager"), approvedBy: adminId, approvedAt: day(anchor, -20), compensationRule: { ruleType: "FLAT_COMMISSION", commissionRate: 5, currency: "INR", ruleName: "Whalexy Sales Incentive" } });
      await put(EmployeeKPI, account.key, { employee, kpi: kpi._id, period, actual: achieved, achievement: achieved / 500000 * 100, evaluatedBy: adminId, comment: "Revenue reconciled against the won opportunities." });
      await put(ChannelPartner, account.key, { name: `${regions[e]} Solutions Partner`, code: `WX-PARTNER-${e}`, type: "RESELLER", contactName: "Partner Relations Team", email: `partner-${e}@partner.example`, market: "India", territory: territory._id, ownerEmployee: employee, geoNode: cityIds[e], status: "ACTIVE", effectiveFrom: day(anchor, -60) });
      const historicalCustomer = await put(SalesCustomer, `${account.key}-history`, { name: `Evergreen Enterprises ${regions[e]}`, primaryContactName: "Account Coordination", email: `evergreen-${e}@customer.example`, market: "India", ownerEmployee: employee, territory: territory._id, geoNode: cityIds[e], status: "ACTIVE", customerType: "B2B", lifetimeRevenue: 300000, currency: "INR", lastOrderDate: previousMonthEnd });
      await put(SalesRevenueTransaction, `${account.key}-history`, { customer: historicalCustomer._id, employee, territory: territory._id, geoNode: cityIds[e], amount: 300000, quantity: 1, currency: "INR", transactionDate: previousMonthEnd, source: "MANUAL", reference: `WX-PREV-INVOICE-${e}` });
      const historicalTarget = await put(SalesTarget, `${account.key}-history`, { employee, territory: territory._id, periodType: "MONTHLY", periodStart: previousMonthStart, periodEnd: previousMonthEnd, effectiveFrom: previousMonthStart, revenueTarget: 600000, currency: "INR", status: "CLOSED", justification: "Previous month's regional sales plan.", createdBy: adminId, approvedBy: adminId, compensationRule: { ruleType: "FLAT_COMMISSION", commissionRate: 5, currency: "INR" } });
      await put(Payout, account.key, { employeeId: employee, targetId: historicalTarget._id, periodId: closedPeriod._id, ruleVersion: 1, targetAmount: 600000, achievedAmount: 300000, achievementPercentage: 50, breakdown: calculateCompensationPayout({ ruleType: "FLAT_COMMISSION", commissionRate: 5 }, 300000, 600000).breakdown, isLocked: true });
    }
    await put(CompensationRule, "sales", { ruleCode: "WX-SALES", name: "Whalexy Sales Incentive", version: 1, effectiveFrom: monthStart, isLatest: true, status: "ACTIVE", commissionRate: 5, currency: "INR", ruleType: "FLAT_COMMISSION", description: "Five percent commission on realized sales revenue.", createdBy: adminId, approvedBy: adminId, approvedAt: day(anchor, -20) });
    await put(JobDescription, "sales", { title: "Sales Executive", description: "Whalexy is hiring a Sales Executive to manage inbound and outbound prospects, conduct discovery calls, maintain CRM records, coordinate customer demonstrations, prepare proposals and meet monthly revenue goals. Strong communication, follow-up discipline and consultative selling skills are required.", createdBy: adminId, updatedBy: adminId, isActive: true });
    // Store real downloadable sample files rather than pointing document rows at missing assets.
    const file = async (key: string, text: string) => {
      const storageKey = id("BinaryObject", key).toString();
      const content = samplePdf(`Whalexy\nSynthetic demonstration document\n\n${text}`);
      if (!validateOnly) await postgres.query("INSERT INTO binary_objects (id, tenant_id, file_name, mime_type, category, metadata, content, size_bytes) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (id) DO NOTHING", [storageKey, tenantId, `${key}.pdf`, "application/pdf", key.startsWith("cv") ? "APPLICANT_CV" : "EMPLOYEE_DOCUMENT", JSON.stringify({ synthetic: true }), content, content.length]);
      return { storageKey, storageProvider: "POSTGRESQL" as const, originalName: `${key}.pdf`, mimeType: "application/pdf", format: "pdf", size: content.length };
    };
    for (const account of WHALEXY_DEMO_ACCOUNTS.filter((a) => a.key !== "admin")) {
      await put(Document, account.key, { ...(await file(`joining-${account.key}`, `${account.name}\nRole: ${account.designation}\nWelcome to the Whalexy team. This is a sample joining letter.`)), employee: id("Employee", account.key), category: "JOINING_LETTER", uploadedBy: adminId, isActive: true });
      await put(Document, `${account.key}-resume`, { ...(await file(`resume-${account.key}`, `${account.name}\nRole: ${account.designation}\nExperience: 3 years\nSkills: communication, planning, customer ownership\nCareer summary: Experienced team member supporting company growth.`)), employee: id("Employee", account.key), category: "RESUME", uploadedBy: adminId, isActive: true });
    }
    for (let a = 0; a < 3; a++) await put(Applicant, `${a}`, { ...(await file(`cv-${a}`, `Candidate ${a + 1}\nSales and account management experience: ${a + 2} years\nSkills: discovery, CRM, negotiation.`)), name: ["Meera Nair", "Arjun Sethi", "Tanya Bose"][a], email: `candidate-${a}@applicant.example`, designation: "Sales Executive", jobCategory: "Sales", city: regions[a], matchScore: 76 + a * 7, stage: (["SOURCED", "SCREENED", "INTERVIEWING"] as const)[a], stageNotes: [], uploadedBy: adminId, isActive: true });
    // Drafts/blocked contacts demonstrate configuration without enrolling outbound mail.
    await put(EmailWorkflow, "welcome", { name: "Customer Welcome Sequence", kind: "SEQUENCE", audience: "New customers", subject: "Welcome to Whalexy", message: "Welcome! Your account owner will help you complete onboarding and plan your first milestones.", followUp: true, delayDays: 3, followUpSubject: "How is your onboarding going?", followUpMessage: "Let us know if you need help with your first milestones.", status: "DRAFT", createdBy: adminId });
    await put(VendorContact, "partner", { name: "Partner Coordination", companyName: "Aurora Solutions", email: "partner@vendor.example", source: "Synthetic demonstration", consentAt: day(anchor, -30), status: "BLOCKED", createdBy: adminId });
    await put(Notification, "admin", { recipient: adminId, type: "DEMO_READY", title: "Whalexy workspace is ready", body: "Review employees, sales pipeline, targets, work, attendance, skills and performance across the company.", channels: ["IN_APP"] });
    assert.equal(counts.User, 10);
    assert.equal(counts.Employee, 9);
    assert.equal(counts.SalesLead, 36);
    assert.equal(counts.LeadWorkItem, 36);
    assert.equal(counts.SalesRevenueTransaction, 12);
    if (!validateOnly) {
      for (const account of salesEmployees) {
        const owner = id("Employee", account.key);
        assert.equal(await SalesLead.countDocuments({ ownerEmployee: owner }), 12);
        assert.equal(await LeadWorkItem.countDocuments({ assignedEmployee: owner }), 12);
        const user = await User.findById(id("User", account.key)).select("+passwordHash").orFail();
        assert.equal(await bcrypt.compare(password!, user.passwordHash), true, `Configured password does not match ${user.email}; demo passwords are preserved on reruns`);
      }
      const admin = await User.findById(adminId).select("+passwordHash").orFail();
      assert.equal(await bcrypt.compare(password!, admin.passwordHash), true, "Configured demo admin password does not match the existing account");
    }
    await put(AuditLog, "seed", { user: adminId, action: "WHALEXY_DEMO_PROVISIONED", entityType: "Tenant", entityId: tenantId, newValue: { synthetic: true, fixtureVersion: 1 } });
  });
  if (tenant && tenant.status === "PROVISIONING") { tenant.status = "ACTIVE"; tenant.activatedAt = new Date(); await tenant.save(); }
  return { tenantSlug: WHALEXY_DEMO_SLUG, counts, accounts: WHALEXY_DEMO_ACCOUNTS.map((a) => ({ email: demoEmail(a.key), role: a.role })) };
};

export const seedWhalexyDemo = async (validateOnly = false) => {
  if (validateOnly) return seedDemoRecords(true);
  // Serialize provisioning across multiple application workers without a new table.
  const client = await postgres.connect();
  try {
    await client.query("SELECT pg_advisory_lock(42657, 1)");
    return await seedDemoRecords();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(42657, 1)"); }
    finally { client.release(); }
  }
};
