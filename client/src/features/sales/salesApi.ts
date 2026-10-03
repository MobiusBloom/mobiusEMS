import type {
  GeoNodeDto,
  GeographicAnalyticsResponse,
  HeatmapPointsResponse,
  SalesAnalytics,
  SalesEmployeeDto,
} from "@mobius-ems/shared";
import { api } from "@/api/client";

export interface SalesRecord {
  _id: string;
  name?: string;
  companyName?: string;
  primaryContactName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  market?: string;
  code?: string;
  status?: string;
  stage?: string;
  currency?: string;
  estimatedValue?: number;
  confirmedSaleAmount?: number;
  lifetimeRevenue?: number;
  amount?: number;
  quantity?: number;
  geoNode?: string | GeoNodeDto;
  revenueTarget?: number;
  leadTarget?: number;
  conversionTarget?: number;
  probability?: number;
  source?: string;
  customerType?: string;
  type?: string;
  reference?: string;
  lostReason?: string;
  lead?: string | { _id: string; name: string };
  customer?: string | { _id: string; name: string };
  sourceLead?: string | { _id: string; name: string };
  channelPartner?: string | { _id: string; name: string; code?: string };
  sourceOpportunity?: string | { _id: string; name: string };
  ownerEmployee?: string | { _id: string; firstName: string; lastName: string; employeeId?: string };
  createdByEmployee?: SalesRecord["ownerEmployee"];
  createdBy?: string | { _id: string; name: string };
  employee?: string | { _id: string; firstName: string; lastName: string };
  territory?: string | { _id: string; name: string; code: string };
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  transactionDate?: string;
  expectedCloseDate?: string;
  actualCloseDate?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  version?: number;
  targetGroupId?: string;
  changeReason?: string;
  createdAt?: string;
  justification?: string;
  actualSales?: number;
  achievedAmount?: number;
  achievementPercentage?: number;
  remainingAmount?: number;
  remainingPercentage?: number;
  state?: string;
  coordinates?: { type: "Point"; coordinates: [number, number] };
}

export interface SalesTerritory {
  _id: string;
  name: string;
  code: string;
  parentTerritory?: string | { _id: string; name: string; code: string };
  ancestors: string[];
  status: string;
  ownerEmployee?: { _id: string; firstName: string; lastName: string; employeeId: string };
  effectiveFrom: string;
  effectiveTo?: string;
  coverageRules: { geoNodeIds: (string | GeoNodeDto)[] };
}

export interface TargetPerformanceDto {
  target: SalesRecord & {
    version?: number;
    targetGroupId?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    compensationRule?: {
      ruleType?: "PROPORTIONAL" | "COMMISSION_SLABS" | "FLAT_COMMISSION" | "TARGET_GATE" | "HYBRID";
      commissionRate?: number;
      bonusThresholdPercentage?: number;
      bonusRate?: number;
      basePayAllocation?: number;
      currency?: string;
      ruleName?: string;
      proportionalConfig?: { maxPayout: number; baselineTarget?: number };
      slabs?: { fromPercentage: number; toPercentage: number | null; rate: number; rateType: "PERCENTAGE" | "FIXED" }[];
      floorPercentage?: number;
      capAmount?: number;
      capPercentage?: number;
      accelerators?: { thresholdPercentage: number; multiplier: number }[];
    };
  };
  performance: {
    officialTarget: number;
    actualAchievement: number;
    employeeCommitment: number | null;
    achievementPercentage: number;
    remainingOfficialTarget: number;
    remainingCommitment: number | null;
    daysRemaining: number;
    requiredDailyRunRate: number;
    requiredWeeklyRunRate: number;
    projectedAchievementPercentage: number;
    status: string;
    targetAmount: number;
    achievedAmount: number;
    remainingAmount: number;
    remainingPercentage: number;
    payout?: {
      commission: number;
      bonus: number;
      basePay: number;
      totalPayout: number;
      proportionalEarnings?: number;
      slabBreakdown?: { tier: string; achievementInRange: number; rate: number; payout: number }[];
      acceleratorBonus?: number;
      floorApplied: boolean;
      floorThreshold?: number;
      capApplied: boolean;
      capLimit?: number;
      explanationText: string[];
      breakdown: CalculationAuditBreakdown;
    };
  };
  commitment?: {
    committedRevenue?: number;
    version?: number;
    status?: string;
  };
  reminderStatus?: {
    totalRemindersSent: number;
    lastReminderSentAt: string | null;
    lastReminderType: string | null;
    lastReminderMilestone: number | null;
    history?: {
      _id: string;
      reminderType: string;
      milestonePercentage?: number;
      achievementPercentage: number;
      remainingPercentage: number;
      title: string;
      body: string;
      sentAt: string;
      channel: string;
    }[];
  };
}

export interface SalesLocationPin {
  _id: string;
  name: string;
  entity: "lead" | "customer";
  country: string;
  state?: string;
  coordinates: [number, number];
  status: string;
  value?: number;
  currency?: string;
  phone?: string;
  email?: string;
  companyName?: string;
}

export interface SalesActivityItem {
  _id: string;
  entityType: "leads" | "customers" | "opportunities";
  entityId: string;
  type: "NOTE" | "CALL_LOG" | "STAGE_CHANGE" | "STATUS_CHANGE" | "LOCATION_PIN" | "CONVERSION";
  content: string;
  metadata?: Record<string, unknown>;
  performedByName?: string;
  performedBy?: {
    _id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  createdAt: string;
}

export interface NextBestActionDto {
  id: string;
  entityType: "lead" | "opportunity" | "customer";
  entityId: string;
  title: string;
  clientName: string;
  dealValue: number;
  recommendedAction: string;
  recommendedChannel: "CALL" | "WHATSAPP" | "EMAIL" | "MEETING";
  suggestedTiming: string;
  reasonCodes: string[];
  confidenceScore: number;
  draftScriptOrNote?: string;
  urgency: "CRITICAL" | "HIGH" | "NORMAL";
}

export interface DailySalesCockpitDto {
  generatedAt: string;
  nextBestActions: NextBestActionDto[];
  highPotentialClients: { id: string; name: string; value: number; probability: number; stage: string; weightedValue: number }[];
  probabilityBreakdown: { high: number; medium: number; low: number };
  slaBreaches: number;
  overdueFollowUps: number;
}

export const salesApi = {
  simulateCompensation: (body: { ruleConfig: Record<string, unknown>; targetAmount: number; testScenarios: number[] }) => api.post<CompensationSimulation>("/api/v1/sales/compensation/simulate", body),
  myPayouts: () => api.get<{ locked: LockedPayout[]; currentCycleProjection: unknown[] }>("/api/v1/sales/payouts/me"),
  targetPerformance: () => api.get<{ items: TargetPerformanceDto[] }>("/api/v1/sales/target-performance/me"),
  dailyCockpit: () => api.get<DailySalesCockpitDto>("/api/v1/sales/daily-cockpit/me"),
  teamTargetPerformance: () => api.get<{ items: TargetPerformanceDto[] }>("/api/v1/sales/target-performance/team"),
  targetVersions: (targetId: string) => api.get<{ items: (SalesRecord & { version: number; effectiveFrom: string; effectiveTo?: string })[] }>(`/api/v1/sales/targets/${targetId}/versions`),
  targetReminders: (targetId: string) => api.get<{ totalRemindersSent: number; lastReminderSentAt: string | null; history: unknown[] }>(`/api/v1/sales/targets/${targetId}/reminders`),
  triggerReminder: (targetId: string) => api.post<{ shouldSend: boolean; reason: string }>(`/api/v1/sales/targets/${targetId}/remind`, {}),
  commitment: (targetId: string, body: { committedRevenue: number }) => api.post(`/api/v1/sales/target-performance/${targetId}/commitment`, body),
  countries: () => api.get<{
    items: { country: string; leads: number; customers: number; partners: number; converted: number; pipeline: Record<string, number>; revenue: Record<string, number> }[];
    locations?: SalesLocationPin[];
  }>("/api/v1/sales/countries"),
  selfAnalytics: () => api.get<SalesAnalytics>("/api/v1/sales/me/analytics"),
  teamAnalytics: () => api.get<SalesAnalytics>("/api/v1/sales/team/analytics"),
  overviewAnalytics: () => api.get<SalesAnalytics>("/api/v1/sales/analytics/overview"),
  employeeAnalytics: (id: string) => api.get<SalesAnalytics>(`/api/v1/sales/employees/${id}/analytics`),
  employees: () => api.get<{ items: SalesEmployeeDto[] }>("/api/v1/sales/employees"),
  geography: () => api.get<{ items: GeoNodeDto[] }>("/api/v1/sales/geography/tree"),
  createGeography: (body: Record<string, unknown>) => api.post<{ item: GeoNodeDto }>("/api/v1/sales/geography", body),
  geoAnalytics: (id: string) => api.get<SalesAnalytics>(`/api/v1/sales/geography/${id}/analytics`),
  geoIntelligence: (id: string = "global") => api.get<GeographicAnalyticsResponse>(`/api/v1/sales/geography/${id}/analytics`),
  heatmapPoints: (type: "leads" | "customers" | "revenue" | "quantity" = "leads", geoId?: string) =>
    api.get<HeatmapPointsResponse>(`/api/v1/sales/geography/heatmap-points?type=${type}${geoId ? `&geoId=${geoId}` : ""}`),
  territories: () => api.get<{ items: SalesTerritory[] }>("/api/v1/sales/territories"),
  territoryAnalytics: (id: string) => api.get<SalesAnalytics>(`/api/v1/sales/territories/${id}/analytics`),
  records: (path: string) => api.get<{ items: SalesRecord[] }>(`/api/v1/sales/${path}`),
  createRecord: (path: string, body: Record<string, unknown>) => api.post<{ item: SalesRecord }>(`/api/v1/sales/${path}`, body),
  updateRecord: (path: string, id: string, body: Record<string, unknown>) => api.patch<{ item: SalesRecord }>(`/api/v1/sales/${path}/${id}`, body),
  activities: (path: string, id: string) => api.get<{ items: SalesActivityItem[] }>(`/api/v1/sales/${path}/${id}/activities`),
  createActivity: (path: string, id: string, body: { type?: string; content: string; metadata?: Record<string, unknown> }) =>
    api.post<{ item: SalesActivityItem }>(`/api/v1/sales/${path}/${id}/activities`, body),
  createTerritory: (body: Record<string, unknown>) => api.post<{ item: SalesTerritory }>("/api/v1/sales/territories", body),
  assignTerritory: (body: Record<string, unknown>) => api.post<{ item: unknown }>("/api/v1/sales/territories/assignments", body),
};

export interface CalculationAuditBreakdown {
  ruleType: string; basePay: number; proportionalEarnings?: number;
  slabBreakdown?: { tier: string; achievementInRange: number; rate: number; payout: number }[];
  acceleratorBonus?: number; floorApplied: boolean; floorThreshold?: number; capApplied: boolean; capLimit?: number;
  deductionsOrAdjustments: number; totalPayout: number; explanationText: string[];
}
export interface CompensationSimulation { targetAmount: number; scenarios: { achievedAmount: number; achievementPercentage: number; payout: number; effectiveCommissionPercentage: number; breakdown: CalculationAuditBreakdown }[]; totalCompanyPayoutExposure: number }
export interface LockedPayout { _id: string; ruleVersion: number; targetAmount: number; achievedAmount: number; achievementPercentage: number; breakdown: CalculationAuditBreakdown; isLocked: true; createdAt: string; periodId?: { periodStart: string; periodEnd: string; periodType: string } }
