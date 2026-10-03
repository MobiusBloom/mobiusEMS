import type { SessionUser } from "@mobius-ems/shared";
import { EmployeeTargetCommitment } from "../models/EmployeeTargetCommitment.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { resolveSalesScope } from "./salesScopeService.js";
import { calculateCompensationPayout, calculateTargetPerformance, percentage, type CompensationRuleConfig } from "./salesMath.js";
import { CompensationPeriod, Payout } from "../models/Payout.js";
import { getTargetReminderStatus } from "./targetReminderService.js";
import { AppError } from "../utils/AppError.js";

const targetFilter = (scope: Awaited<ReturnType<typeof resolveSalesScope>>) => ({
  employee: { $in: scope.allowedEmployeeIds },
  status: { $in: ["ACTIVE", "CLOSED"] },
  isLatest: { $ne: false },
});

export const targetPerformance = async (viewer: SessionUser, team = false) => {
  const scope = await resolveSalesScope(viewer);
  if (!team && scope.employeeId) {
    scope.allowedEmployeeIds = scope.allowedEmployeeIds.filter((id) => id.toString() === scope.employeeId);
  }
  const targets = await SalesTarget.find(targetFilter(scope))
    .sort({ periodStart: -1 })
    .populate("employee", "firstName lastName employeeId")
    .lean();

  return Promise.all(
    targets.map(async (target) => {
      const employeeId = (target.employee as { _id?: unknown })._id ?? target.employee;
      const effectiveStart = target.effectiveFrom ?? target.periodStart;
      const effectiveEnd = target.effectiveTo ?? target.periodEnd;
      const actual = (
        await SalesRevenueTransaction.aggregate([
          {
            $match: {
              employee: employeeId,
              transactionDate: { $gte: target.periodStart, $lte: target.periodEnd },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
      )[0]?.total ?? 0;

      const commitment = await EmployeeTargetCommitment.findOne({ target: target._id, employee: employeeId })
        .sort({ version: -1 })
        .lean();

      const performance = calculateTargetPerformance({
        officialTarget: target.revenueTarget,
        actual,
        commitment: commitment?.committedRevenue,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        compensationRule: target.compensationRule,
      });

      const reminderSummary = await getTargetReminderStatus(target._id.toString());

      return {
        target: {
          ...target,
          version: target.version ?? 1,
          effectiveFrom: effectiveStart,
          effectiveTo: effectiveEnd,
        },
        performance,
        commitment,
        reminderStatus: reminderSummary,
      };
    }),
  );
};

export const targetPerformanceForVersion = async (viewer: SessionUser, targetId: string) => {
  const scope = await resolveSalesScope(viewer);
  const target = await SalesTarget.findOne({
    _id: targetId,
    employee: { $in: scope.allowedEmployeeIds },
  })
    .populate("employee", "firstName lastName employeeId")
    .lean();
  if (!target) throw new AppError("Target version not found", 404);

  const employeeId = (target.employee as { _id?: unknown })._id ?? target.employee;
  const effectiveStart = target.effectiveFrom ?? target.periodStart;
  const effectiveEnd = target.effectiveTo ?? target.periodEnd;

  const actual = (
    await SalesRevenueTransaction.aggregate([
      {
        $match: {
          employee: employeeId,
          transactionDate: { $gte: effectiveStart, $lte: effectiveEnd },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
  )[0]?.total ?? 0;

  const performance = calculateTargetPerformance({
    officialTarget: target.revenueTarget,
    actual,
    periodStart: target.periodStart,
    periodEnd: target.periodEnd,
    compensationRule: target.compensationRule,
  });

  return {
    target: {
      ...target,
      version: target.version ?? 1,
      effectiveFrom: effectiveStart,
      effectiveTo: effectiveEnd,
    },
    performance,
  };
};
export const commitToTarget = async (viewer: SessionUser, targetId: string, body: { committedRevenue?: number; note?: string }) => {
  const scope = await resolveSalesScope(viewer); if (!scope.employeeId) throw new AppError("Only employees can submit commitments", 403);
  const target = await SalesTarget.findOne({ _id: targetId, employee: scope.employeeId }); if (!target) throw new AppError("Target not found", 404);
  const version = ((await EmployeeTargetCommitment.findOne({ target: targetId, employee: scope.employeeId }).sort({ version: -1 }).lean())?.version ?? 0) + 1;
  return EmployeeTargetCommitment.create({ target: targetId, employee: scope.employeeId, ...body, version, submittedAt: new Date(), status: "SUBMITTED" });
};

export const simulateCompensationRule = (ruleConfig: CompensationRuleConfig, testScenarios: number[], targetAmount: number) => {
  const scenarios = testScenarios.map((achievedAmount) => {
    const payout = calculateCompensationPayout(ruleConfig, achievedAmount, targetAmount);
    return { achievedAmount, achievementPercentage: percentage(achievedAmount, targetAmount), payout: payout.totalPayout, effectiveCommissionPercentage: percentage(payout.totalPayout, achievedAmount), breakdown: payout.breakdown };
  });
  return { targetAmount, scenarios, totalCompanyPayoutExposure: Number(scenarios.reduce((sum, item) => sum + item.payout, 0).toFixed(2)) };
};

export const closeCompensationPeriod = async (viewer: SessionUser, body: { periodId?: string; periodType?: "MONTHLY" | "QUARTERLY" | "YEARLY"; periodStart?: Date; periodEnd?: Date }) => {
  const period = body.periodId ? await CompensationPeriod.findById(body.periodId) : await CompensationPeriod.findOneAndUpdate(
    { periodType: body.periodType, periodStart: body.periodStart, periodEnd: body.periodEnd },
    { $setOnInsert: { periodType: body.periodType, periodStart: body.periodStart, periodEnd: body.periodEnd, status: "OPEN" } },
    { upsert: true, new: true },
  );
  if (!period) throw new AppError("Compensation period not found", 404);
  if (period.status === "CLOSED") throw new AppError("Compensation period is already closed", 409);
  const targets = await SalesTarget.find({ periodType: period.periodType, periodStart: period.periodStart, periodEnd: period.periodEnd, employee: { $exists: true }, isLatest: { $ne: false }, status: { $in: ["ACTIVE", "CLOSED"] } });
  const snapshots = [];
  for (const target of targets) {
    const achievedAmount = (await SalesRevenueTransaction.aggregate([{ $match: { employee: target.employee, transactionDate: { $gte: period.periodStart, $lte: period.periodEnd } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]))[0]?.total ?? 0;
    const breakdown = calculateCompensationPayout(target.compensationRule, achievedAmount, target.revenueTarget).breakdown;
    snapshots.push({ employeeId: target.employee!, targetId: target._id, periodId: period._id, ruleVersion: target.version ?? 1, targetAmount: target.revenueTarget, achievedAmount, achievementPercentage: percentage(achievedAmount, target.revenueTarget), breakdown, isLocked: true as const });
  }
  if (snapshots.length) await Payout.insertMany(snapshots, { ordered: true });
  period.status = "CLOSED"; period.closedAt = new Date(); period.closedBy = viewer.id as never; await period.save();
  await SalesTarget.updateMany({ _id: { $in: targets.map((target) => target._id) } }, { $set: { status: "CLOSED" } });
  return { period, payoutsCreated: snapshots.length };
};

export const myPayouts = async (viewer: SessionUser) => {
  const scope = await resolveSalesScope(viewer);
  if (!scope.employeeId) throw new AppError("An employee profile is required", 403);
  const locked = await Payout.find({ employeeId: scope.employeeId }).sort({ createdAt: -1 }).populate("periodId").populate("targetId").lean();
  const projection = (await targetPerformance(viewer)).filter((item) => item.target.status === "ACTIVE").map((item) => ({ target: item.target, breakdown: item.performance.payout?.breakdown }));
  return { locked, currentCycleProjection: projection };
};

export const payoutsForPeriod = async (viewer: SessionUser, periodId: string) => {
  const scope = await resolveSalesScope(viewer);
  return Payout.find({ periodId, employeeId: { $in: scope.allowedEmployeeIds } }).sort({ employeeId: 1 }).populate("employeeId", "firstName lastName employeeId").populate("targetId").lean();
};
