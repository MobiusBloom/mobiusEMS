import type { SessionUser } from "@mobius-ems/shared";
import { SalesActivity } from "../models/SalesActivity.js";
import { SalesCustomer } from "../models/SalesCustomer.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesOpportunity } from "../models/SalesOpportunity.js";
import { AppError } from "../utils/AppError.js";
import { resolveSalesScope } from "./salesScopeService.js";

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

type ActionCandidate = NextBestActionDto & { conversionProbability: number };
type RankedAction = ActionCandidate & { priorityScore: number };
const DAY = 86_400_000;
const urgencyWeight = { CRITICAL: 3, HIGH: 2, NORMAL: 1 } as const;
const effortFactor = { CALL: 1.2, WHATSAPP: 1, EMAIL: 0.8, MEETING: 2 } as const;
const idOf = (value: unknown) => String(value);
const dateOf = (value: unknown) => value ? new Date(String(value)) : null;
const includesSignal = (value: unknown, signals: string[]) => signals.some((signal) => String(value ?? "").toLowerCase().includes(signal));

export const rankNextActions = (actions: ActionCandidate[]): RankedAction[] => actions
  .map((action) => ({
    ...action,
    priorityScore: Number((urgencyWeight[action.urgency] * Math.max(1, action.dealValue) * Math.max(1, action.conversionProbability) / 100 / effortFactor[action.recommendedChannel]).toFixed(2)),
  }))
  .sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id))
  .slice(0, 5);

export const getDailySalesCockpit = async (viewer: SessionUser, now = new Date()) => {
  const scope = await resolveSalesScope(viewer, now);
  if (!scope.employeeId) throw new AppError("A sales employee profile is required", 403);
  const ownerEmployee = scope.employeeId;
  const [leads, opportunities, customers] = await Promise.all([
    SalesLead.find({ ownerEmployee, status: { $in: ["NEW", "CONTACTED", "QUALIFIED"] } }).lean(),
    SalesOpportunity.find({ ownerEmployee, status: "OPEN" }).lean(),
    SalesCustomer.find({ ownerEmployee, status: "ACTIVE" }).lean(),
  ]);
  const entityIds = [...leads, ...opportunities, ...customers].map((item) => item._id);
  const activities = await SalesActivity.find({ entityId: { $in: entityIds } }).sort({ createdAt: -1 }).lean();
  const latest = new Map<string, typeof activities[number]>();
  for (const activity of activities) if (!latest.has(idOf(activity.entityId))) latest.set(idOf(activity.entityId), activity);
  const actions: ActionCandidate[] = [];
  const push = (action: ActionCandidate) => actions.push(action);
  const timing = (urgency: NextBestActionDto["urgency"]) => urgency === "CRITICAL" ? "Now - within 30 minutes" : urgency === "HIGH" ? "Today 2:00 PM - 4:00 PM" : "Today before close of business";

  for (const lead of leads) {
    const ageHours = (now.getTime() - new Date(lead.createdAt).getTime()) / 3_600_000;
    const inbound = includesSignal(lead.source, ["inbound", "website", "referral"]);
    if (inbound && !lead.firstResponseAt && ageHours > 2) push({ id: `sla:${lead._id}`, entityType: "lead", entityId: idOf(lead._id), title: "Inbound SLA breached", clientName: lead.companyName || lead.name, dealValue: lead.estimatedValue, conversionProbability: lead.status === "QUALIFIED" ? 65 : lead.status === "CONTACTED" ? 40 : 20, recommendedAction: "Call and qualify the inbound enquiry", recommendedChannel: "CALL", suggestedTiming: timing("CRITICAL"), reasonCodes: [`Uncontacted for ${Math.floor(ageHours)} hours`, `Inbound source: ${lead.source}`], confidenceScore: 90, draftScriptOrNote: `Hi ${lead.name}, I am following up on your enquiry. What outcome are you hoping to achieve?`, urgency: "CRITICAL" });
    const activity = latest.get(idOf(lead._id));
    if (activity && (includesSignal(activity.content, ["opened", "viewed", "revisited"]) || includesSignal(JSON.stringify(activity.metadata), ["opened", "viewed", "revisited"]))) push({ id: `warm:${lead._id}`, entityType: "lead", entityId: idOf(lead._id), title: "Warm lead re-engaged", clientName: lead.companyName || lead.name, dealValue: lead.estimatedValue, conversionProbability: lead.status === "QUALIFIED" ? 65 : 40, recommendedAction: "Send a contextual follow-up while intent is fresh", recommendedChannel: lead.phone ? "WHATSAPP" : "EMAIL", suggestedTiming: timing("HIGH"), reasonCodes: ["Recent content or email engagement", activity.content], confidenceScore: 75, draftScriptOrNote: `Hi ${lead.name}, I noticed renewed interest. Would a quick discussion help answer any questions?`, urgency: "HIGH" });
  }

  const entityById = new Map<string, { type: NextBestActionDto["entityType"]; name: string; value: number; probability: number }>();
  for (const lead of leads) entityById.set(idOf(lead._id), { type: "lead", name: lead.companyName || lead.name, value: lead.estimatedValue, probability: lead.status === "QUALIFIED" ? 65 : lead.status === "CONTACTED" ? 40 : 20 });
  for (const opportunity of opportunities) entityById.set(idOf(opportunity._id), { type: "opportunity", name: opportunity.name, value: opportunity.estimatedValue, probability: opportunity.probability });
  for (const customer of customers) entityById.set(idOf(customer._id), { type: "customer", name: customer.name, value: customer.lifetimeRevenue, probability: 60 });
  const overdueEntities = new Set<string>();
  for (const activity of activities) {
    const due = dateOf(activity.metadata?.dueAt ?? activity.metadata?.scheduledFor);
    const entity = entityById.get(idOf(activity.entityId));
    if (due && due < now && entity && !overdueEntities.has(idOf(activity.entityId))) { overdueEntities.add(idOf(activity.entityId)); push({ id: `overdue:${activity._id}`, entityType: entity.type, entityId: idOf(activity.entityId), title: "Follow-up overdue", clientName: entity.name, dealValue: entity.value, conversionProbability: entity.probability, recommendedAction: activity.content || "Complete the scheduled follow-up", recommendedChannel: "CALL", suggestedTiming: timing("CRITICAL"), reasonCodes: [`Due ${due.toLocaleString("en-IN")}`], confidenceScore: Math.min(95, entity.probability + 20), urgency: "CRITICAL" }); }
  }

  for (const opportunity of opportunities) {
    const activity = latest.get(idOf(opportunity._id));
    const lastTouch = new Date(activity?.createdAt ?? (opportunity as typeof opportunity & { updatedAt?: Date }).updatedAt ?? now);
    const idleDays = (now.getTime() - lastTouch.getTime()) / DAY;
    const proposal = includesSignal(opportunity.stage, ["proposal", "quote"]);
    if (proposal && idleDays >= 2 && idleDays <= 3) push({ id: `proposal:${opportunity._id}`, entityType: "opportunity", entityId: idOf(opportunity._id), title: "Proposal awaiting response", clientName: opportunity.name, dealValue: opportunity.estimatedValue, conversionProbability: opportunity.probability, recommendedAction: "Call to resolve proposal questions or pricing objections", recommendedChannel: "CALL", suggestedTiming: timing("HIGH"), reasonCodes: [`Proposal sent ${Math.floor(idleDays)} days ago`, `${opportunity.probability}% conversion probability`], confidenceScore: Math.min(95, opportunity.probability + 15), draftScriptOrNote: "Confirm the proposal was received, ask what needs clarification, and agree the next decision step.", urgency: "HIGH" });
    if (idleDays > 5 && opportunity.estimatedValue >= 100_000) push({ id: `stalled:${opportunity._id}`, entityType: "opportunity", entityId: idOf(opportunity._id), title: "High-value deal stalled", clientName: opportunity.name, dealValue: opportunity.estimatedValue, conversionProbability: opportunity.probability, recommendedAction: "Reconfirm need, stakeholder and next milestone", recommendedChannel: "CALL", suggestedTiming: timing("HIGH"), reasonCodes: [`No touchpoint in ${Math.floor(idleDays)} days`, `${opportunity.probability}% conversion probability`], confidenceScore: Math.max(40, opportunity.probability), urgency: "HIGH" });
  }

  const probabilityBreakdown = { high: opportunities.filter((item) => item.probability >= 70).length, medium: opportunities.filter((item) => item.probability >= 40 && item.probability < 70).length, low: opportunities.filter((item) => item.probability < 40).length };
  return {
    generatedAt: now.toISOString(),
    nextBestActions: rankNextActions(actions).map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !["priorityScore", "conversionProbability"].includes(key)))),
    highPotentialClients: opportunities.filter((item) => item.probability >= 70).sort((a, b) => b.estimatedValue * b.probability - a.estimatedValue * a.probability).slice(0, 5).map((item) => ({ id: idOf(item._id), name: item.name, value: item.estimatedValue, probability: item.probability, stage: item.stage, weightedValue: item.estimatedValue * item.probability / 100 })),
    probabilityBreakdown,
    slaBreaches: actions.filter((item) => item.id.startsWith("sla:")).length,
    overdueFollowUps: actions.filter((item) => item.id.startsWith("overdue:")).length,
  };
};
