export * from "./eod.js";
export const ROLES = ["SUPER_ADMIN", "HR_ADMIN", "DEPARTMENT_HEAD", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "APPLICANT"] as const;
export type RoleName = (typeof ROLES)[number];

export const SECTION_ACCESS = [
  { key: "section.dashboard", label: "Dashboard", group: "Overview" },
  { key: "section.ai_workspace", label: "AI Workspace", group: "Overview" },
  { key: "section.attendance", label: "Attendance", group: "People operations" },
  { key: "section.people_ops", label: "Leave & recognition", group: "People operations" },
  { key: "section.profile", label: "My profile", group: "People operations" },
  { key: "section.employees", label: "Employees", group: "People" },
  { key: "section.organization", label: "Organization", group: "People" },
  { key: "section.employee_map", label: "Employee map", group: "People" },
  { key: "section.sales", label: "Sales", group: "Sales" },
  { key: "section.skills", label: "Skills", group: "Capability" },
  { key: "section.assessments", label: "Assessments", group: "Capability" },
  { key: "section.work", label: "Tasks & projects", group: "Work" },
  { key: "section.eod", label: "EOD / Daily report", group: "Work" },
  { key: "section.task_tracker", label: "Task tracker", group: "Work" },
  { key: "section.performance", label: "Goals & performance", group: "Performance" },
  { key: "section.contribution", label: "Contribution", group: "Performance" },
  { key: "section.development", label: "Learning & training", group: "Development" },
  { key: "section.resumes", label: "Resume library", group: "Records" },
  { key: "section.applicants", label: "Applicants", group: "Records" },
  { key: "section.resume_screener", label: "Resume screener", group: "Records" },
  { key: "section.governance", label: "Documents & audit", group: "Records" },
  { key: "section.email_automation", label: "Email automation", group: "Administration" },
] as const;
export type SectionPermissionName = (typeof SECTION_ACCESS)[number]["key"];
export const SECTION_PERMISSIONS = SECTION_ACCESS.map((section) => section.key) as unknown as readonly [SectionPermissionName, ...SectionPermissionName[]];

export const PERMISSIONS = [
  "eod.submit", "eod.view.self", "eod.view.team", "eod.view.department", "eod.view.all",
  "eod.review.team", "eod.review.department", "eod.review.all",
  "eod.analytics.self", "eod.analytics.team", "eod.analytics.department", "eod.analytics.all", "eod.template.manage",
  "employee.view", "employee.create", "employee.update", "employee.deactivate",
  "department.view", "department.create", "department.update",
  "skill.create", "skill.update", "skill.verify", "skill.reject",
  "task.create", "task.assign", "task.update", "task.review",
  "performance.view", "performance.review", "goal.create", "goal.update",
  "kpi.create", "kpi.evaluate", "document.view", "document.upload",
  "report.view", "audit.view", "settings.manage",
  "sales.view.self", "sales.view.team", "sales.view.all",
  "sales.analytics.self", "sales.analytics.team", "sales.analytics.all",
  "sales.lead.manage.self", "sales.lead.manage.team", "sales.lead.manage.all",
  "sales.territory.view", "sales.territory.manage", "sales.territory.create.self", "sales.geography.create.self",
  "sales.target.view", "sales.target.manage", "sales.customer.view", "sales.customer.manage.self", "sales.customer.manage.team", "sales.customer.manage.all",
  "sales.pipeline.view", "sales.pipeline.manage", "sales.revenue.view",
  "sales.revenue.manage",
  "sales.channel_partner.view", "sales.channel_partner.manage", "sales.channel_partner.manage.self", "sales.configuration.manage",
  "employee_map.self", "employee_map.team", "employee_map.all",
  "sales.map.self", "sales.map.team", "sales.map.all",
  "section.skill_matrix", // Legacy database value; no longer exposed as a section.
  ...SECTION_PERMISSIONS,
] as const;
export type PermissionName = (typeof PERMISSIONS)[number];

export const CAPABILITIES = ["SALES_MODULE"] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];

const HR_SALES_PERMISSIONS: readonly PermissionName[] = [
  "sales.view.all", "sales.analytics.all", "sales.territory.view", "sales.target.view",
  "sales.customer.view", "sales.pipeline.view", "sales.revenue.view", "sales.channel_partner.view",
  "employee_map.all", "sales.map.all",
];
const TEAM_SALES_PERMISSIONS: readonly PermissionName[] = [
  "sales.view.self", "sales.view.team", "sales.analytics.self", "sales.analytics.team",
  "sales.lead.manage.self", "sales.lead.manage.team", "sales.territory.view", "sales.territory.manage", "sales.target.view", "sales.target.manage",
  "sales.customer.view", "sales.customer.manage.self", "sales.customer.manage.team", "sales.pipeline.view", "sales.pipeline.manage", "sales.revenue.view",
  "sales.channel_partner.view", "sales.channel_partner.manage.self", "employee_map.team", "sales.map.team",
];
const SELF_SALES_PERMISSIONS: readonly PermissionName[] = [
  "sales.view.self", "sales.analytics.self", "sales.lead.manage.self",
  "sales.target.view", "sales.customer.view", "sales.customer.manage.self", "sales.pipeline.view", "sales.pipeline.manage",
  "sales.revenue.view", "sales.channel_partner.view", "sales.channel_partner.manage.self", "employee_map.self", "sales.map.self",
];
const SELF_EOD_PERMISSIONS: readonly PermissionName[] = ["eod.submit", "eod.view.self", "eod.analytics.self"];
const TEAM_EOD_PERMISSIONS: readonly PermissionName[] = [...SELF_EOD_PERMISSIONS, "eod.view.team", "eod.review.team", "eod.analytics.team"];

export const ROLE_PERMISSIONS: Record<RoleName, readonly PermissionName[]> = {
  SUPER_ADMIN: PERMISSIONS,
  HR_ADMIN: [...PERMISSIONS.filter((permission) => !permission.startsWith("section.") && !["settings.manage", "skill.verify"].includes(permission) && !permission.startsWith("sales.") && !permission.startsWith("employee_map.") && !permission.startsWith("eod.")), ...SELF_EOD_PERMISSIONS, ...HR_SALES_PERMISSIONS, ...SECTION_PERMISSIONS.filter((permission) => !["section.attendance", "section.profile", "section.task_tracker", "section.resumes", "section.resume_screener", "section.email_automation"].includes(permission))],
  DEPARTMENT_HEAD: [...SELF_EOD_PERMISSIONS, "eod.view.department", "eod.review.department", "eod.analytics.department", "employee.view", "department.view", "skill.verify", "task.create", "task.assign", "task.update", "task.review", "performance.view", "performance.review", "goal.create", "goal.update", "kpi.evaluate", "document.view", "report.view", ...TEAM_SALES_PERMISSIONS, ...SECTION_PERMISSIONS.filter((permission) => !["section.attendance", "section.profile", "section.task_tracker", "section.resumes", "section.applicants", "section.resume_screener", "section.email_automation"].includes(permission))],
  MANAGER: [...TEAM_EOD_PERMISSIONS, "employee.view", "department.view", "task.create", "task.assign", "task.update", "task.review", "performance.view", "performance.review", "goal.create", "goal.update", "kpi.evaluate", "document.view", "report.view", ...TEAM_SALES_PERMISSIONS, ...SECTION_PERMISSIONS.filter((permission) => !["section.attendance", "section.profile", "section.task_tracker", "section.resumes", "section.applicants", "section.resume_screener", "section.email_automation"].includes(permission))],
  TEAM_LEAD: [...TEAM_EOD_PERMISSIONS, "employee.view", "department.view", "task.create", "task.assign", "task.update", "task.review", "performance.view", "performance.review", "goal.create", "goal.update", "document.view", "report.view", ...TEAM_SALES_PERMISSIONS, ...SECTION_PERMISSIONS.filter((permission) => !["section.attendance", "section.profile", "section.task_tracker", "section.resumes", "section.applicants", "section.resume_screener", "section.email_automation"].includes(permission))],
  EMPLOYEE: [...SELF_EOD_PERMISSIONS, "employee.view", "department.view", "task.update", "performance.view", "goal.update", "document.view", "document.upload", ...SELF_SALES_PERMISSIONS, ...SECTION_PERMISSIONS.filter((permission) => !["section.employees", "section.organization", "section.applicants", "section.resume_screener", "section.email_automation"].includes(permission))],
  APPLICANT: ["section.assessments"]
};

export const PLAN_TIERS = ["STARTER", "STANDARD", "PROFESSIONAL", "ENTERPRISE", "CUSTOM"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["MONTHLY", "ANNUAL", "LIFETIME", "CUSTOM"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface PlanFeatures {
  aiEnabled: boolean;
  salesModuleEnabled: boolean;
  emailAutomationEnabled: boolean;
  voiceTasksEnabled: boolean;
  advancedAnalyticsEnabled: boolean;
  customRolesEnabled: boolean;
}

export const DEFAULT_PLAN_CONFIGS: Record<PlanTier, { name: string; description: string; maxEmployees: number; maxStorageMb: number; features: PlanFeatures }> = {
  STARTER: {
    name: "Starter",
    description: "Core HR, attendance, task tracking, and goals for small teams.",
    maxEmployees: 15,
    maxStorageMb: 2048,
    features: {
      aiEnabled: false,
      salesModuleEnabled: false,
      emailAutomationEnabled: false,
      voiceTasksEnabled: true,
      advancedAnalyticsEnabled: false,
      customRolesEnabled: false,
    },
  },
  STANDARD: {
    name: "Standard",
    description: "Balanced employee management, AI assistant, skill builder, and evaluations for growing teams.",
    maxEmployees: 50,
    maxStorageMb: 10240,
    features: {
      aiEnabled: true,
      salesModuleEnabled: false,
      emailAutomationEnabled: false,
      voiceTasksEnabled: true,
      advancedAnalyticsEnabled: true,
      customRolesEnabled: false,
    },
  },
  PROFESSIONAL: {
    name: "Professional",
    description: "Full workforce intelligence including Sales CRM pipeline, commissions, and automated emails.",
    maxEmployees: 150,
    maxStorageMb: 51200,
    features: {
      aiEnabled: true,
      salesModuleEnabled: true,
      emailAutomationEnabled: true,
      voiceTasksEnabled: true,
      advancedAnalyticsEnabled: true,
      customRolesEnabled: true,
    },
  },
  ENTERPRISE: {
    name: "Enterprise",
    description: "Unlimited scalability, dedicated features, complete governance, GeoSales, and priority support.",
    maxEmployees: 0, // 0 = unlimited
    maxStorageMb: 0,
    features: {
      aiEnabled: true,
      salesModuleEnabled: true,
      emailAutomationEnabled: true,
      voiceTasksEnabled: true,
      advancedAnalyticsEnabled: true,
      customRolesEnabled: true,
    },
  },
  CUSTOM: {
    name: "Custom Contract",
    description: "Tailored seat limits and customized feature access.",
    maxEmployees: 50,
    maxStorageMb: 10240,
    features: {
      aiEnabled: true,
      salesModuleEnabled: true,
      emailAutomationEnabled: true,
      voiceTasksEnabled: true,
      advancedAnalyticsEnabled: true,
      customRolesEnabled: true,
    },
  },
};

export interface TenantSubscriptionDto {
  plan: PlanTier;
  planName: string;
  planDescription: string;
  subscriptionStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  maxEmployees: number;
  activeEmployeeCount: number;
  seatsRemaining: number;
  isUnlimited: boolean;
  trialEndsAt?: string;
  subscriptionEndsAt?: string;
  daysRemaining?: number;
  features: PlanFeatures;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  isPlatformAdmin: boolean;
  role: RoleName;
  permissions: PermissionName[];
  capabilities: CapabilityName[];
  forcePasswordChange: boolean;
  onboardingComplete: boolean;
  plan?: PlanTier;
  subscriptionStatus?: SubscriptionStatus;
  maxEmployees?: number;
  subscriptionEndsAt?: string;
  features?: PlanFeatures;
}

export interface ApiResponse<T> { success: boolean; message: string; data?: T; errors?: Record<string, string[]> }

export type SalesScopeLevel = "SELF" | "TEAM" | "ALL";
export type OpportunityBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SalesTrendPoint { _id: string; revenue: number }
export interface SalesAnalytics {
  generatedAt: string;
  scope: SalesScopeLevel;
  period: { start: string; end: string };
  currency: string;
  targetRevenue: number;
  actualRevenue: number;
  targetAchievement: number;
  leadCount: number;
  qualifiedLeadCount: number;
  convertedLeadCount: number;
  conversionRate: number;
  customerCount: number;
  pipelineValue: number;
  weightedPipeline: number;
  employeeCount: number;
  channelPartnerCount: number;
  avgFirstResponseMinutes: number;
  delayedLeadCount: number;
  currentLeadLoad: number;
  configuredLeadCapacity: number;
  requiredHeadcount: number;
  activeHeadcount: number;
  headcountGap: number;
  capacityUtilization: number;
  coveragePercentage: number;
  leadDemandScore: number;
  coverageGapScore: number;
  customerWhiteSpaceScore: number;
  pipelinePotentialScore: number;
  growthScore: number;
  conversionPotentialScore: number;
  opportunityScore: number;
  opportunityBand: OpportunityBand;
  estimatedLostConversions: number;
  estimatedOpportunityLost: number;
  isEstimate: true;
  trend?: SalesTrendPoint[];
}

export interface GeoNodeDto {
  _id: string;
  name: string;
  code: string;
  type: "GLOBAL" | "COUNTRY" | "STATE" | "DISTRICT" | "CITY" | "AREA" | "PINCODE";
  parent?: string;
  ancestors: string[];
  depth: number;
  location?: { type: "Point"; coordinates: [number, number] };
  children?: string[];
}

export interface SalesEmployeeDto {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  status: string;
  department?: { _id: string; name: string; code: string };
  designation?: { _id: string; name: string; code: string };
  reportingManager?: { _id: string; firstName: string; lastName: string; employeeId: string };
  workLocation?: { geoNode?: string; coordinates?: { type: "Point"; coordinates: [number, number] } };
}

export type CapacityStatus = "HEALTHY" | "APPROACHING" | "CRITICAL";

export interface GeographicRollupNode {
  _id: string;
  name: string;
  code: string;
  type: "GLOBAL" | "COUNTRY" | "STATE" | "DISTRICT" | "CITY" | "AREA" | "PINCODE" | "TERRITORY";
  depth: number;
  parent?: string;
  ancestors: string[];
  location?: { type: "Point"; coordinates: [number, number] };
  assignedTarget: number;
  actualRevenue: number;
  salesQuantity: number;
  salesTransactionCount: number;
  targetPacingPercentage: number;
  pipelineValue: number;
  leadCount: number;
  leadConversionRate: number;
  customerCount: number;
  activeHeadcount: number;
  channelPartnerCount: number;
  configuredCapacityPerRep: number;
  requiredHeadcount: number;
  headcountGap: number;
  isCapacityBottleneck: boolean;
  estimatedOpportunityLost: number;
  whiteSpaceRecommendation: string;
  capacityUtilization: number;
  capacityStatus: CapacityStatus;
  managerName?: string;
  territoryCount?: number;
}

export interface GeographicAnalyticsResponse extends SalesAnalytics {
  salesQuantity: number;
  salesTransactionCount: number;
  node: GeographicRollupNode;
  children: GeographicRollupNode[];
  ancestors: Array<{ _id: string; name: string; code: string; type: string }>;
  hierarchyLevel: "GLOBAL" | "COUNTRY" | "STATE" | "DISTRICT" | "CITY" | "AREA" | "PINCODE" | "TERRITORY";
    territories?: Array<{ _id: string; name: string; code: string; managerName?: string; activeHeadcount: number; actualRevenue: number; salesQuantity: number; salesTransactionCount: number }>;
}

export type HeatmapPointTuple = [number, number, number]; // [lat, lng, intensity]

export interface HeatmapPointsResponse {
  type: "leads" | "customers" | "revenue" | "quantity";
  points: HeatmapPointTuple[];
}

export type CredibilityStatus = "EXCEEDED" | "JUSTIFIED" | "GAP_DETECTED" | "UNTESTED";

export interface SkillCredibilityAnalytics {
  skillId: string;
  name: string;
  level: string;
  category: string;
  rating: number; // Claimed score 1-10
  demonstratedRating?: number; // 1-10 verified performance score
  velocityRatio?: number; // Estimated hours / Actual hours
  onTimeRate?: number;
  averageQuality?: number;
  credibilityStatus: CredibilityStatus;
  tasksEvaluatedCount: number;
}

export interface EmployeeSkillRank {
  employeeId: string;
  employeeName: string;
  designationName: string;
  departmentName: string;
  departmentRank: number;
  companyRank: number;
  overallCredibilityScore: number;
  demonstratedAverage: number;
  claimedAverage: number;
  completedTasksCount: number;
  velocityRatio: number;
}

export const APPLICANT_STAGES = ["SOURCED", "SCREENED", "INTERVIEWING", "OFFER_EXTENDED", "HIRED", "REJECTED"] as const;
export type ApplicantStage = (typeof APPLICANT_STAGES)[number];

export const REGULARIZATION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type RegularizationStatus = (typeof REGULARIZATION_STATUSES)[number];

export interface LeavePolicyItem {
  _id: string;
  name: string;
  code: string;
  quotaDays: number;
  isPaid: boolean;
  description?: string;
  isActive: boolean;
  isSystem?: boolean;
}

export interface LeaveBalanceItem {
  id?: string;
  type: string;
  name?: string;
  quotaDays: number;
  usedDays: number;
  remainingDays: number;
  isPaid?: boolean;
  isSystem?: boolean;
  description?: string;
}

export interface SPOFItem {
  skillId: string;
  skillName: string;
  category: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  verifiedRating: number;
}

export * from "./salesEod.js";
export * from "./departmentEod.js";
