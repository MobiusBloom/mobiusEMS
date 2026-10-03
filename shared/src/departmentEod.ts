import type { EodContext, EodField, EodSection, EodTemplateDefinition } from "./eod.js";
import { SALES_EOD_SECTIONS } from "./salesEod.js";

export const EOD_REPORT_LABELS: Record<EodTemplateDefinition["adapter"], string> = {
  GENERAL: "General", ENGINEERING: "IT & Engineering", SALES: "Sales", AI_ML: "AI / ML",
  HR: "HR", MARKETING: "Marketing", OPERATIONS: "Operations", FINANCE: "Finance",
  ADMINISTRATION: "Administration", SUPPORT: "Customer Support", DESIGN: "Design"
};
const field = (key: string, label: string, type: EodField["type"] = "TEXTAREA", options?: string[]): EodField => ({ key, label, type, ...(options ? { options } : {}) });
const section = (key: string, title: string, fields: EodField[]): EodSection => ({ key, title, fields });
export const DEPARTMENT_EOD_SECTIONS: Record<EodTemplateDefinition["adapter"], EodSection[]> = {
  SALES: SALES_EOD_SECTIONS,
  ENGINEERING: [
    section("delivery", "1. Development & Delivery (Today)", [field("project", "Project / Product", "TEXT"), field("technicalSummary", "Features / Technical Work Completed"), field("deliveryEvidence", "Release / PR / Ticket Links"), field("implementationDecision", "Important Implementation Decision")]),
    section("validation", "2. Testing & Release", [field("bugsFixed", "Bugs Fixed", "NUMBER"), field("pullRequests", "PRs Raised / Updated", "NUMBER"), field("releaseStatus", "Release Status", "SELECT", ["Not planned", "In development", "Ready for review", "Testing", "Deployed", "Rolled back"]), field("validationNotes", "Testing & Verification"), field("deploymentNotes", "Deployment / Release Notes")]),
    section("engineeringFollowups", "3. Reviews & Dependencies", [field("reviewFollowup", "Review / Handoff Follow-up"), field("dependency", "Dependency / Support Needed"), field("technicalLearning", "Technical Learning")])
  ],
  AI_ML: [
    section("research", "1. Research & Experiment (Today)", [field("experiment", "Experiment / Research Name", "TEXT"), field("model", "Model / Provider", "TEXT"), field("dataset", "Dataset / Source", "TEXT"), field("objective", "Experiment Objective")]),
    section("evaluation", "2. Evaluation & Results", [field("evaluationMetric", "Evaluation Metric (if relevant)", "TEXT"), field("previousResult", "Previous Result", "TEXT"), field("currentResult", "Current Result", "TEXT"), field("outcome", "Experiment Outcome", "SELECT", ["SUCCESSFUL", "NEEDS_ITERATION", "FAILED", "RESEARCH_ONLY"]), field("observation", "Observations"), field("keyFinding", "Key Finding")]),
    section("researchFollowups", "3. Research Follow-ups", [field("nextExperiment", "Next Experiment / Iteration"), field("researchDependency", "Data / Compute / Review Needed"), field("researchEvidence", "Notebook / Evaluation / Deliverable Links")])
  ],
  HR: [
    section("recruitment", "1. Recruitment (Today)", [field("candidatesScreened", "Candidates Screened", "NUMBER"), field("interviewsConducted", "Interviews Conducted", "NUMBER"), field("offersReleased", "Offers Released", "NUMBER"), field("hiringRoles", "Roles Worked On", "TEXT"), field("candidateMovement", "Candidate Stage Updates")]),
    section("peopleOperations", "2. People & Onboarding", [field("requestsHandled", "Employee Requests Handled", "NUMBER"), field("newJoiners", "Employees Onboarded", "NUMBER"), field("onboardingActivity", "Onboarding Activity"), field("importantHrAction", "Important HR Action")]),
    section("hrFollowups", "3. Important HR Follow-ups", [field("pendingHrActions", "Pending HR Actions"), field("pendingFollowup", "Candidate / Employee Follow-up"), field("hrSupport", "Approval / Support Needed")])
  ],
  MARKETING: [
    section("campaignDelivery", "1. Campaigns & Content (Today)", [field("campaigns", "Campaigns Worked On"), field("contentCompleted", "Content Completed", "NUMBER"), field("contentPublished", "Content Published", "NUMBER"), field("channels", "Channels / Platforms", "TEXT")]),
    section("campaignResults", "2. Reach & Results", [field("enquiriesGenerated", "Leads / Enquiries Generated", "NUMBER"), field("campaignSpend", "Campaign Spend (₹)", "CURRENCY"), field("campaignReach", "Reach / Impressions", "NUMBER"), field("keyResult", "Campaign Key Result")]),
    section("marketingFollowups", "3. Approvals & Follow-ups", [field("approvalsPending", "Approvals Pending", "NUMBER"), field("approvalFollowup", "Approval / Publishing Follow-up"), field("campaignBlockers", "Campaign Challenges / Support Needed")])
  ],
  OPERATIONS: [
    section("operationsDelivery", "1. Operations & Delivery (Today)", [field("processesHandled", "Processes / Workflows Handled", "NUMBER"), field("requestsClosed", "Requests Closed", "NUMBER"), field("operationsWork", "Work Delivered / Process Updates"), field("handoff", "Delivery / Handoff Details")]),
    section("operationsQuality", "2. Quality & Service", [field("exceptions", "Exceptions / Incidents", "NUMBER"), field("slaStatus", "SLA / Delivery Status", "SELECT", ["On track", "At risk", "Breached", "Not applicable"]), field("qualityChecks", "Quality Checks / Improvements"), field("incidentAction", "Incident Action Taken")]),
    section("operationsFollowups", "3. Vendor & Team Follow-ups", [field("vendorFollowup", "Vendor / Partner Follow-up"), field("pendingOperations", "Pending Operational Actions"), field("operationsSupport", "Approval / Resources Needed")])
  ],
  FINANCE: [
    section("financeActivity", "1. Accounts & Payments (Today)", [field("invoicesProcessed", "Invoices Processed", "NUMBER"), field("paymentsProcessed", "Payments Processed (₹)", "CURRENCY"), field("collectionsReceived", "Collections Received (₹)", "CURRENCY"), field("accountingWork", "Accounting Work Completed")]),
    section("financeControls", "2. Reconciliation & Compliance", [field("reconciliations", "Reconciliations Completed", "NUMBER"), field("reconciliationNotes", "Reconciliation Details"), field("complianceWork", "Tax / Compliance / Audit Work"), field("discrepancies", "Discrepancies / Exceptions")]),
    section("financeFollowups", "3. Important Finance Follow-ups", [field("pendingReceivables", "Pending Receivables / Payables"), field("financeApproval", "Approvals Required"), field("financeDeadline", "Next Compliance / Payment Date", "DATE")])
  ],
  ADMINISTRATION: [
    section("adminActivity", "1. Administration (Today)", [field("adminRequests", "Requests Handled", "NUMBER"), field("adminWork", "Administrative Work Completed"), field("documentation", "Documents / Records Updated")]),
    section("facilities", "2. Facilities & Resources", [field("procurement", "Procurement / Assets Updated"), field("facilitiesWork", "Facilities / Maintenance Activity"), field("adminSpend", "Expenses Recorded (₹)", "CURRENCY")]),
    section("adminFollowups", "3. Administrative Follow-ups", [field("vendorCoordination", "Vendor / Internal Coordination"), field("pendingAdmin", "Pending Administrative Actions"), field("adminApproval", "Approvals Required")])
  ],
  SUPPORT: [
    section("supportActivity", "1. Customer Support (Today)", [field("ticketsHandled", "Tickets Handled", "NUMBER"), field("ticketsResolved", "Tickets Resolved", "NUMBER"), field("escalations", "Tickets Escalated", "NUMBER"), field("customerIssues", "Key Customer Issues")]),
    section("resolution", "2. Resolution & Quality", [field("resolutionDetails", "Solutions / Fixes Provided"), field("customerFeedback", "Customer Feedback"), field("supportEvidence", "Ticket / Knowledge Base Links")]),
    section("supportFollowups", "3. Important Customer Follow-ups", [field("pendingTickets", "Pending Tickets / Next Action"), field("escalationFollowup", "Escalation Owner / Follow-up"), field("supportDependency", "Product / Engineering Support Needed")])
  ],
  DESIGN: [
    section("designDelivery", "1. Design & Creative Work (Today)", [field("designProject", "Project / Campaign", "TEXT"), field("assetsCompleted", "Assets / Screens Completed", "NUMBER"), field("designWork", "Design Work Completed"), field("designEvidence", "Figma / Asset / Deliverable Links")]),
    section("designReview", "2. Reviews & Iterations", [field("designReviews", "Reviews Completed", "NUMBER"), field("designFeedback", "Feedback / Changes Applied"), field("designDecision", "Important Design Decision")]),
    section("designFollowups", "3. Creative Follow-ups", [field("designApproval", "Pending Approvals"), field("designHandoff", "Developer / Team Handoff"), field("designResources", "Content / Assets / Support Needed")])
  ],
  GENERAL: [
    section("departmentWork", "1. Department Work (Today)", [field("departmentContext", "Department Work / Key Deliverables"), field("workEvidence", "Task / Document / Deliverable Links")]),
    section("coordination", "2. Coordination & Progress", [field("coordination", "Team / Stakeholder Coordination"), field("workDecision", "Important Decision / Learning")]),
    section("departmentFollowups", "3. Important Follow-ups", [field("pendingAction", "Pending Actions / Next Steps"), field("departmentSupport", "Approval / Support Needed")])
  ]
};

// Named fallback only; saved templates continue to bind exact department IDs.
export function departmentEodAdapter(employee: EodContext): EodTemplateDefinition["adapter"] {
  if (employee.department?.capabilities?.includes("SALES_MODULE")) return "SALES";
  const name = employee.department?.name.toLowerCase().replace(/[_-]/g, " ") ?? "";
  const rules: Array<[EodTemplateDefinition["adapter"], RegExp]> = [
    ["SALES", /sales|business development/], ["AI_ML", /\b(ai|ml)\b|artificial intelligence|machine learning|data science/],
    ["ENGINEERING", /engineering|development|software|\bit\b|information technology|technology/],
    ["HR", /\bhr\b|human resources?|human resource management|people operations|recruitment/],
    ["MARKETING", /marketing|digital growth/], ["FINANCE", /finance|accounting|accounts/],
    ["OPERATIONS", /operations?|logistics|delivery/], ["ADMINISTRATION", /administration|\badmin\b|facilities/],
    ["SUPPORT", /support|customer success|customer service/], ["DESIGN", /design|creative/]
  ];
  return rules.find(([, pattern]) => pattern.test(name))?.[0] ?? "GENERAL";
}
