export interface CapacityMetrics { currentLeadLoad: number; configuredLeadCapacity: number; requiredHeadcount: number; activeHeadcount: number; headcountGap: number; capacityUtilization: number; coveragePercentage: number }
export const calculateCapacity = (leadCount: number, activeHeadcount: number, capacityPerEmployee: number): CapacityMetrics => {
  const load = Math.max(0, leadCount); const headcount = Math.max(0, activeHeadcount); const capacity = Math.max(1, capacityPerEmployee);
  const requiredHeadcount = Math.ceil(load / capacity);
  return { currentLeadLoad: load, configuredLeadCapacity: capacity, requiredHeadcount, activeHeadcount: headcount, headcountGap: Math.max(0, requiredHeadcount - headcount), capacityUtilization: headcount ? Number((load / (headcount * capacity) * 100).toFixed(2)) : load ? 100 : 0, coveragePercentage: requiredHeadcount ? Number((Math.min(1, headcount / requiredHeadcount) * 100).toFixed(2)) : 100 };
};
export const percentage = (numerator: number, denominator: number): number => denominator > 0 ? Number((numerator / denominator * 100).toFixed(2)) : 0;

export interface TargetProgressMetrics {
  targetAmount: number;
  achievedAmount: number;
  achievementPercentage: number;
  remainingAmount: number;
  remainingPercentage: number;
}

export const calculateTargetProgress = (target: number, actual: number): TargetProgressMetrics => {
  const t = Math.max(0, target);
  const a = Math.max(0, actual);
  const achievementPercentage = t > 0 ? Number(((a / t) * 100).toFixed(2)) : (a > 0 ? 100 : 0);
  const remainingAmount = Math.max(0, t - a);
  const remainingPercentage = t > 0 ? Number(((remainingAmount / t) * 100).toFixed(2)) : 0;
  return {
    targetAmount: t,
    achievedAmount: a,
    achievementPercentage,
    remainingAmount,
    remainingPercentage,
  };
};

export type CompensationRuleType = "PROPORTIONAL" | "COMMISSION_SLABS" | "FLAT_COMMISSION" | "TARGET_GATE" | "HYBRID";
export interface CompensationSlab {
  fromPercentage: number;
  toPercentage: number | null;
  rate: number;
  rateType: "PERCENTAGE" | "FIXED";
}
export interface CompensationAccelerator { thresholdPercentage: number; multiplier: number }
export interface CompensationRuleConfig {
  ruleType?: CompensationRuleType;
  commissionRate?: number;
  bonusThresholdPercentage?: number;
  bonusRate?: number;
  basePayAllocation?: number;
  proportionalConfig?: { maxPayout: number; baselineTarget?: number };
  slabs?: CompensationSlab[];
  floorPercentage?: number;
  capAmount?: number;
  capPercentage?: number;
  accelerators?: CompensationAccelerator[];
}

export interface CalculationAuditBreakdown {
  ruleType: CompensationRuleType;
  basePay: number;
  proportionalEarnings?: number;
  slabBreakdown?: { tier: string; achievementInRange: number; rate: number; payout: number }[];
  acceleratorBonus?: number;
  floorApplied: boolean;
  floorThreshold?: number;
  capApplied: boolean;
  capLimit?: number;
  deductionsOrAdjustments: number;
  totalPayout: number;
  explanationText: string[];
}
export interface CompensationPayoutResult extends CalculationAuditBreakdown {
  commission: number;
  bonus: number;
  breakdown: CalculationAuditBreakdown;
}

const money = (value: number) => Number(value.toFixed(2));
const acceleratorFor = (percentageValue: number, accelerators: readonly CompensationAccelerator[]) =>
  [...accelerators].filter((item) => percentageValue >= item.thresholdPercentage).sort((a, b) => b.thresholdPercentage - a.thresholdPercentage)[0]?.multiplier ?? 1;

export const calculateCompensationPayout = (
  rule: CompensationRuleConfig | undefined,
  achieved: number,
  target: number,
): CompensationPayoutResult => {
  const safeRule = rule ?? {};
  const ruleType = safeRule.ruleType ?? "FLAT_COMMISSION";
  const revenue = Math.max(0, achieved);
  const quota = Math.max(0, target);
  const achievement = quota > 0 ? revenue / quota * 100 : 0;
  const basePay = money(Math.max(0, safeRule.basePayAllocation ?? 0));
  const explanations: string[] = [`Rule type: ${ruleType}. Achievement: ${money(achievement)}%.`];
  const floorThreshold = Math.max(ruleType === "TARGET_GATE" ? 100 : 0, safeRule.floorPercentage ?? 0);
  if (floorThreshold > 0 && achievement < floorThreshold) {
    explanations.push(`Floor requirement ${floorThreshold}% was not met; variable and base payout are zero.`);
    const breakdown: CalculationAuditBreakdown = { ruleType, basePay: 0, floorApplied: true, floorThreshold, capApplied: false, deductionsOrAdjustments: 0, totalPayout: 0, explanationText: explanations };
    return { ...breakdown, commission: 0, bonus: 0, breakdown };
  }

  const accelerators = [...(safeRule.accelerators ?? [])];
  if (!accelerators.length && safeRule.bonusRate && safeRule.bonusThresholdPercentage) {
    // Preserve legacy rules as an additive rate above their threshold.
    accelerators.push({ thresholdPercentage: safeRule.bonusThresholdPercentage, multiplier: 1 });
  }
  let regularEarnings = 0;
  let acceleratorBonus = 0;
  let proportionalEarnings: number | undefined;
  let slabBreakdown: CalculationAuditBreakdown["slabBreakdown"];

  if (ruleType === "PROPORTIONAL" || (ruleType === "HYBRID" && safeRule.proportionalConfig)) {
    const baseline = Math.max(0, safeRule.proportionalConfig?.baselineTarget ?? quota);
    const maxPayout = Math.max(0, safeRule.proportionalConfig?.maxPayout ?? 0);
    const baseRevenue = Math.min(revenue, baseline);
    regularEarnings = baseline > 0 ? baseRevenue / baseline * maxPayout : 0;
    if (revenue > baseline && baseline > 0) {
      const excessPct = (revenue - baseline) / baseline * 100;
      const multiplier = acceleratorFor(100 + excessPct, accelerators);
      const unaccelerated = (revenue - baseline) / baseline * maxPayout;
      acceleratorBonus = unaccelerated * multiplier;
      if (multiplier > 1) explanations.push(`Revenue above quota earned ${multiplier}x (${money(acceleratorBonus)}).`);
    }
    proportionalEarnings = money(regularEarnings + acceleratorBonus);
    explanations.push(`Proportional earnings: achieved ${money(revenue)} / baseline ${money(baseline)} × max payout ${money(maxPayout)}.`);
  } else if (ruleType === "COMMISSION_SLABS" || (ruleType === "HYBRID" && safeRule.slabs?.length)) {
    slabBreakdown = [];
    const sorted = [...(safeRule.slabs ?? [])].sort((a, b) => a.fromPercentage - b.fromPercentage);
    for (const slab of sorted) {
      const fromAmount = quota * Math.max(0, slab.fromPercentage) / 100;
      const toAmount = slab.toPercentage == null ? revenue : quota * Math.max(slab.fromPercentage, slab.toPercentage) / 100;
      const eligible = Math.max(0, Math.min(revenue, toAmount) - fromAmount);
      if (eligible <= 0) continue;
      const midpointPct = quota > 0 ? ((fromAmount + eligible / 2) / quota * 100) : 0;
      const multiplier = acceleratorFor(midpointPct, accelerators);
      const raw = slab.rateType === "FIXED" ? slab.rate : eligible * slab.rate / 100;
      const payout = raw * multiplier;
      regularEarnings += raw;
      acceleratorBonus += raw * (multiplier - 1);
      slabBreakdown.push({ tier: `${slab.fromPercentage}%–${slab.toPercentage == null ? "∞" : `${slab.toPercentage}%`}`, achievementInRange: money(eligible), rate: slab.rate, payout: money(payout) });
    }
    explanations.push(...slabBreakdown.map((item) => `${item.tier}: ${item.achievementInRange} at ${item.rate}${sorted.find((s) => `${s.fromPercentage}%–${s.toPercentage == null ? "∞" : `${s.toPercentage}%`}` === item.tier)?.rateType === "PERCENTAGE" ? "%" : " fixed"} = ${item.payout}.`));
  } else {
    const rate = Math.max(0, safeRule.commissionRate ?? 0);
    const thresholdAmount = quota;
    const legacyFlatRule = safeRule.ruleType == null;
    regularEarnings = (legacyFlatRule ? revenue : Math.min(revenue, thresholdAmount || revenue)) * rate / 100;
    if (!legacyFlatRule && quota > 0 && revenue > quota) {
      const excess = revenue - quota;
      const multiplier = acceleratorFor(achievement, accelerators);
      acceleratorBonus = excess * rate / 100 * multiplier;
    }
    if (safeRule.bonusRate && safeRule.bonusThresholdPercentage && quota > 0) {
      const legacyEligible = Math.max(0, revenue - quota * safeRule.bonusThresholdPercentage / 100);
      acceleratorBonus += legacyEligible * safeRule.bonusRate / 100;
    }
    explanations.push(`Flat commission: ${money(revenue)} at ${rate}%.`);
  }

  const commission = money(regularEarnings);
  const bonus = money(acceleratorBonus);
  let totalPayout = money(basePay + regularEarnings + acceleratorBonus);
  const capLimits = [safeRule.capAmount, safeRule.capPercentage == null ? undefined : quota * safeRule.capPercentage / 100].filter((value): value is number => value != null && value >= 0);
  const capLimit = capLimits.length ? Math.min(...capLimits) : undefined;
  const capApplied = capLimit != null && totalPayout > capLimit;
  if (capApplied) { totalPayout = money(capLimit!); explanations.push(`Payout capped at ${totalPayout}.`); }
  const breakdown: CalculationAuditBreakdown = { ruleType, basePay, proportionalEarnings, slabBreakdown, acceleratorBonus: bonus || undefined, floorApplied: false, floorThreshold: floorThreshold || undefined, capApplied, capLimit, deductionsOrAdjustments: 0, totalPayout, explanationText: explanations };
  return { ...breakdown, commission, bonus, breakdown };
};

export type TargetRiskStatus = "NOT_STARTED" | "ON_TRACK" | "AT_RISK" | "CRITICAL" | "ACHIEVED" | "EXCEEDED" | "CLOSED";
export interface TargetPerformanceInput {
  officialTarget: number;
  actual: number;
  commitment?: number;
  periodStart: Date | string;
  periodEnd: Date | string;
  now?: Date;
  overachievementThreshold?: number;
  compensationRule?: CompensationRuleConfig;
}
export const calculateTargetPerformance = (input: TargetPerformanceInput) => {
  const now = input.now ?? new Date();
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodEnd < periodStart) throw new Error("Invalid target period");
  const target = Math.max(0, input.officialTarget);
  const actual = Math.max(0, input.actual);
  const progress = calculateTargetProgress(target, actual);
  const totalDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((Math.min(now.getTime(), periodEnd.getTime()) - periodStart.getTime()) / 86400000) + 1));
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86400000));
  const achievementPercentage = progress.achievementPercentage;
  const projectedPeriodRevenue = elapsedDays > 0 ? Number((actual / elapsedDays * totalDays).toFixed(2)) : 0;
  const projectedAchievementPercentage = percentage(projectedPeriodRevenue, target);
  const status: TargetRiskStatus = now < periodStart ? "NOT_STARTED" : now > periodEnd ? (achievementPercentage > (input.overachievementThreshold ?? 100) ? "EXCEEDED" : achievementPercentage >= 100 ? "ACHIEVED" : "CLOSED") : achievementPercentage > (input.overachievementThreshold ?? 100) ? "EXCEEDED" : achievementPercentage >= 100 ? "ACHIEVED" : projectedAchievementPercentage >= 100 ? "ON_TRACK" : projectedAchievementPercentage >= 75 ? "AT_RISK" : "CRITICAL";
  const payout = calculateCompensationPayout(input.compensationRule, actual, target);

  return {
    ...progress,
    officialTarget: target,
    actualAchievement: actual,
    employeeCommitment: input.commitment ?? null,
    remainingOfficialTarget: progress.remainingAmount,
    remainingCommitment: input.commitment == null ? null : Math.max(input.commitment - actual, 0),
    daysRemaining,
    requiredDailyRunRate: daysRemaining > 0 ? Number((progress.remainingAmount / daysRemaining).toFixed(2)) : 0,
    requiredWeeklyRunRate: daysRemaining > 0 ? Number((progress.remainingAmount / Math.max(1, Math.ceil(daysRemaining / 7))).toFixed(2)) : 0,
    currentDailyRunRate: elapsedDays > 0 ? Number((actual / elapsedDays).toFixed(2)) : 0,
    projectedPeriodRevenue,
    projectedAchievementPercentage,
    paceGap: Number((actual - target * elapsedDays / totalDays).toFixed(2)),
    status,
    payout,
  };
};
export const weightedPipelineValue = (items: readonly { estimatedValue: number; probability: number }[]): number => Number(items.reduce((sum, item) => sum + Math.max(0, item.estimatedValue) * Math.min(100, Math.max(0, item.probability)) / 100, 0).toFixed(2));

export interface OpportunityInputs { leadDemandScore: number; coverageGapScore: number; customerWhiteSpaceScore: number; pipelinePotentialScore: number; growthScore: number; conversionPotentialScore: number }
export interface OpportunityWeights { demand: number; coverageGap: number; customerWhiteSpace: number; pipelinePotential: number; growth: number; conversionPotential: number }
const clamp = (value: number) => Math.min(100, Math.max(0, value));
export const calculateOpportunityScore = (input: OpportunityInputs, weights: OpportunityWeights) => {
  const pairs: [number, number][] = [[input.leadDemandScore, weights.demand], [input.coverageGapScore, weights.coverageGap], [input.customerWhiteSpaceScore, weights.customerWhiteSpace], [input.pipelinePotentialScore, weights.pipelinePotential], [input.growthScore, weights.growth], [input.conversionPotentialScore, weights.conversionPotential]];
  const totalWeight = pairs.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0) || 1;
  const score = Number((pairs.reduce((sum, [value, weight]) => sum + clamp(value) * Math.max(0, weight), 0) / totalWeight).toFixed(2));
  const band = score <= 30 ? "LOW" : score <= 60 ? "MEDIUM" : score <= 80 ? "HIGH" : "CRITICAL";
  return { opportunityScore: score, opportunityBand: band as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };
};
export const calculateEstimatedOpportunityLost = (delayedLeads: number, healthyConversionRate: number, delayedConversionRate: number, averageDealValue: number) => {
  const estimatedLostConversions = Math.max(0, delayedLeads) * Math.max(0, healthyConversionRate - delayedConversionRate) / 100;
  return { estimatedLostConversions: Number(estimatedLostConversions.toFixed(2)), estimatedOpportunityLost: Number((estimatedLostConversions * Math.max(0, averageDealValue)).toFixed(2)), isEstimate: true as const };
};
