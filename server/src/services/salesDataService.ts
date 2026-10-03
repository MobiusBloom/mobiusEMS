import type { SessionUser } from "@mobius-ems/shared";
import { type HydratedDocument, type Model, Types } from "mongoose";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { Employee } from "../models/Employee.js";
import { EmployeeTerritoryAssignment } from "../models/EmployeeTerritoryAssignment.js";
import { GeoNode } from "../models/GeoNode.js";
import { SalesCustomer } from "../models/SalesCustomer.js";
import { LEAD_STATUSES, SalesLead } from "../models/SalesLead.js";
import { OPPORTUNITY_STATUSES, SalesOpportunity } from "../models/SalesOpportunity.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { SalesActivity } from "../models/SalesActivity.js";
import { calculateTargetProgress } from "./salesMath.js";
import { AppError } from "../utils/AppError.js";
import { leadAttributionForUser } from "./leadAttributionService.js";
import { writeAudit } from "./auditService.js";
import {
  assertSalesEmployeeScope,
  assertSalesGeoScope,
  assertSalesTerritoryScope,
  resolveSalesScope,
  type ResolvedSalesScope,
} from "./salesScopeService.js";

export type SalesEntityName = "leads" | "customers" | "opportunities" | "targets" | "revenue" | "channelPartners";
type SalesInput = Record<string, unknown> & { ownerEmployee?: string; employee?: string; territory?: string; geoNode?: string; market?: string };
type LeadStatus = typeof LEAD_STATUSES[number];
type OpportunityStatus = typeof OPPORTUNITY_STATUSES[number];
type TargetStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "CLOSED";

const leadTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "CONVERTED", "LOST"],
  CONTACTED: ["QUALIFIED", "CONVERTED", "LOST"],
  QUALIFIED: ["CONVERTED", "LOST"],
  CONVERTED: [],
  LOST: [],
};
export const canTransitionLeadStatus = (from: LeadStatus, to: LeadStatus) => from === to || leadTransitions[from].includes(to);
const opportunityTransitions: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  OPEN: ["WON", "LOST"],
  WON: [],
  LOST: [],
};
export const canTransitionOpportunityStatus = (from: OpportunityStatus, to: OpportunityStatus) => from === to || opportunityTransitions[from].includes(to);
const targetTransitions: Record<TargetStatus, readonly TargetStatus[]> = {
  DRAFT: ["ACTIVE", "SUPERSEDED"],
  ACTIVE: ["CLOSED", "SUPERSEDED"],
  SUPERSEDED: [],
  CLOSED: [],
};

export const salesPopulationPaths: Record<SalesEntityName, string> = {
  leads: "ownerEmployee createdByEmployee createdBy territory geoNode customer",
  customers: "ownerEmployee territory geoNode sourceLead",
  opportunities: "ownerEmployee territory geoNode lead customer",
  targets: "employee territory",
  revenue: "employee territory geoNode customer channelPartner sourceOpportunity",
  channelPartners: "ownerEmployee territory geoNode",
};

const modelFor = (entity: SalesEntityName): Model<Record<string, unknown>> => {
  switch (entity) {
    case "leads": return SalesLead as unknown as Model<Record<string, unknown>>;
    case "customers": return SalesCustomer as unknown as Model<Record<string, unknown>>;
    case "opportunities": return SalesOpportunity as unknown as Model<Record<string, unknown>>;
    case "targets": return SalesTarget as unknown as Model<Record<string, unknown>>;
    case "revenue": return SalesRevenueTransaction as unknown as Model<Record<string, unknown>>;
    case "channelPartners": return ChannelPartner as unknown as Model<Record<string, unknown>>;
  }
};

const territoryVisibility = (scope: ResolvedSalesScope, ownerField?: string): Record<string, unknown> => {
  const clauses: Record<string, unknown>[] = [];
  if (scope.allowedTerritoryIds.length) clauses.push({ territory: { $in: scope.allowedTerritoryIds } });
  const unassigned: Record<string, unknown> = { territory: { $exists: false } };
  if (ownerField && scope.level !== "ALL") unassigned[ownerField] = { $in: scope.allowedEmployeeIds };
  clauses.push(unassigned);
  return { $or: clauses };
};

const scopeFilter = (scope: ResolvedSalesScope, entity: SalesEntityName): Record<string, unknown> => {
  if (entity === "targets") {
    return {
      isLatest: { $ne: false },
      $or: [
        { employee: { $in: scope.allowedEmployeeIds } },
        { territory: { $in: scope.allowedTerritoryIds } },
      ],
    };
  }
  if (entity === "channelPartners") return {
    ...territoryVisibility(scope, "ownerEmployee"),
    ...(scope.level === "SELF" && scope.employeeId ? { ownerEmployee: scope.employeeId } : {}),
  };
  const employeeField = entity === "revenue" ? "employee" : "ownerEmployee";
  return {
    [employeeField]: { $in: scope.allowedEmployeeIds },
    ...territoryVisibility(scope),
  };
};

const applyCustomerContext = async (scope: ResolvedSalesScope, entity: SalesEntityName, input: SalesInput) => {
  if (!["opportunities", "revenue"].includes(entity) || typeof input.customer !== "string") return;
  const customer = await SalesCustomer.findOne({ _id: input.customer, ...scopeFilter(scope, "customers") }).select("ownerEmployee territory geoNode market currency").lean();
  if (!customer) throw new AppError("Customer not found", 404);
  if (entity === "revenue") input.employee = customer.ownerEmployee.toString();
  else input.ownerEmployee = customer.ownerEmployee.toString();
  if (customer.territory) input.territory = customer.territory.toString();
  if (customer.geoNode) input.geoNode = customer.geoNode.toString();
  if (customer.market) input.market = customer.market;
  input.currency = customer.currency;
};

const applyTerritoryGeography = async (input: SalesInput) => {
  if (!input.territory || input.geoNode) return;
  const territory = await SalesTerritory.findById(input.territory).select("coverageRules.geoNodeIds").lean();
  const primaryGeo = territory?.coverageRules?.geoNodeIds?.[0];
  if (primaryGeo) input.geoNode = primaryGeo.toString();
};

const validateReferences = async (scope: ResolvedSalesScope, input: SalesInput): Promise<void> => {
  const employeeId = input.employee ?? input.ownerEmployee;
  if (employeeId) {
    assertSalesEmployeeScope(scope, employeeId);
    if (!await Employee.exists({ _id: employeeId, isActive: true })) throw new AppError("Employee not found", 404);
  }
  if (input.territory) {
    assertSalesTerritoryScope(scope, input.territory);
    if (!await SalesTerritory.exists({ _id: input.territory, status: { $ne: "INACTIVE" } })) throw new AppError("Territory not found", 404);
  }
  const now = new Date();
  if (employeeId && input.territory && !await EmployeeTerritoryAssignment.exists({
    employee: employeeId,
    territory: input.territory,
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: now } }],
  })) throw new AppError("Assign the employee to this territory before creating the sales record", 422, "EMPLOYEE_TERRITORY_REQUIRED");
  if (input.geoNode) {
    assertSalesGeoScope(scope, input.geoNode);
    if (!await GeoNode.exists({ _id: input.geoNode, isActive: true })) throw new AppError("Geography not found", 404);
  }
  if (typeof input.customer === "string" && !await SalesCustomer.exists({ _id: input.customer, ...scopeFilter(scope, "customers") })) throw new AppError("Customer not found", 404);
  if (typeof input.lead === "string" && !await SalesLead.exists({ _id: input.lead, ...scopeFilter(scope, "leads") })) throw new AppError("Lead not found", 404);
  if (typeof input.channelPartner === "string" && !await ChannelPartner.exists({ _id: input.channelPartner, ...scopeFilter(scope, "channelPartners") })) throw new AppError("Channel partner not found", 404);
};

type SalesRecordDocument = HydratedDocument<Record<string, unknown>>;
const optionalId = (value: unknown) => value ? String(value) : undefined;
const mayAdjustRevenue = (viewer: SessionUser) => viewer.permissions.includes("sales.revenue.manage") || viewer.permissions.includes("sales.configuration.manage");

const adjustCustomerRevenue = async (customerId: string | undefined, amount: number, transactionDate?: Date) => {
  if (!customerId || !amount) return;
  await SalesCustomer.updateOne(
    { _id: customerId },
    {
      $inc: { lifetimeRevenue: amount },
      ...(amount > 0 && transactionDate ? { $max: { lastOrderDate: transactionDate } } : {}),
    },
  );
};

const createWonRevenue = async (viewer: SessionUser, opportunity: SalesRecordDocument) => {
  const customerId = optionalId(opportunity.get("customer"));
  if (!customerId) throw new AppError("Link a customer before marking an opportunity as won", 422, "OPPORTUNITY_CUSTOMER_REQUIRED");
  const transactionDate = (opportunity.get("actualCloseDate") as Date | undefined) ?? new Date();
  const amount = Number(opportunity.get("estimatedValue") ?? 0);
  const result = await SalesRevenueTransaction.updateOne(
    { sourceOpportunity: opportunity.get("_id") },
    { $setOnInsert: {
      sourceOpportunity: opportunity.get("_id"),
      customer: customerId,
      employee: opportunity.get("ownerEmployee"),
      ...(opportunity.get("territory") ? { territory: opportunity.get("territory") } : {}),
      geoNode: opportunity.get("geoNode"),
      market: opportunity.get("market"),
      amount,
      quantity: 1,
      currency: opportunity.get("currency") ?? "INR",
      transactionDate,
      source: "OPPORTUNITY_WON",
      reference: `OPP-${opportunity.id}`,
    } },
    { upsert: true, runValidators: true },
  );
  if (!result.upsertedCount) return;
  await adjustCustomerRevenue(customerId, amount, transactionDate);
  await writeAudit({
    user: viewer.id,
    action: "SALES_REVENUE_AUTO_CREATED",
    entityType: "SalesRevenueTransaction",
    entityId: String(result.upsertedId),
    newValue: { sourceOpportunity: opportunity.id, customer: customerId, amount },
  });
};

export const listSalesData = async (viewer: SessionUser, entity: SalesEntityName) => {
  const scope = await resolveSalesScope(viewer);
  const items = await modelFor(entity)
    .find(scopeFilter(scope, entity))
    .populate(salesPopulationPaths[entity], "firstName lastName employeeId name code type")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  if (entity === "targets") {
    return Promise.all(
      (items as unknown as Array<Record<string, unknown>>).map(async (target) => {
        const employeeId = (target.employee as { _id?: unknown } | undefined)?._id ?? target.employee;
        const territoryId = (target.territory as { _id?: unknown } | undefined)?._id ?? target.territory;
        let actual = 0;
        const pStart = target.periodStart ? new Date(target.periodStart as string | Date) : undefined;
        const pEnd = target.periodEnd ? new Date(target.periodEnd as string | Date) : undefined;

        if (pStart && pEnd) {
          if (employeeId) {
            const res = await SalesRevenueTransaction.aggregate([
              {
                $match: {
                  employee: new Types.ObjectId(String(employeeId)),
                  transactionDate: { $gte: pStart, $lte: pEnd },
                },
              },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ]);
            actual = res[0]?.total ?? 0;
          } else if (territoryId) {
            const res = await SalesRevenueTransaction.aggregate([
              {
                $match: {
                  territory: new Types.ObjectId(String(territoryId)),
                  transactionDate: { $gte: pStart, $lte: pEnd },
                },
              },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ]);
            actual = res[0]?.total ?? 0;
          }
        }
        const progress = calculateTargetProgress(Number(target.revenueTarget || 0), actual);
        return {
          ...target,
          actualSales: actual,
          achievedAmount: progress.achievedAmount,
          achievementPercentage: progress.achievementPercentage,
          remainingAmount: progress.remainingAmount,
          remainingPercentage: progress.remainingPercentage,
        };
      }),
    );
  }

  return items;
};

export const countrySales = async (viewer: SessionUser) => {
  const scope = await resolveSalesScope(viewer);
  const geography = await GeoNode.find({}).select("name type ancestors").lean();
  const countryForGeo = (id: unknown) => {
    const node = geography.find((entry) => String(entry._id) === String(id));
    return (node?.type === "COUNTRY" ? node : geography.find((entry) => entry.type === "COUNTRY" && node?.ancestors.some((ancestor) => String(ancestor) === String(entry._id))))?.name;
  };
  const entities = ["leads", "customers", "opportunities", "revenue", "channelPartners"] as const;
  const groups = new Map<string, { country: string; leads: number; customers: number; partners: number; converted: number; pipeline: Record<string, number>; revenue: Record<string, number> }>();
  const locations: Array<{
    _id: string;
    name: string;
    entity: "lead" | "customer";
    country: string;
    state?: string;
    coordinates: [number, number]; // [lng, lat]
    status: string;
    value?: number;
    currency?: string;
    phone?: string;
    email?: string;
    companyName?: string;
  }> = [];

  for (const entity of entities) {
    const records = await modelFor(entity)
      .find(scopeFilter(scope, entity))
      .select("name companyName primaryContactName market coordinates geoNode customer status currency amount estimatedValue confirmedSaleAmount lifetimeRevenue phone email")
      .populate(entity === "revenue" || entity === "opportunities" ? [{ path: "customer", select: "market geoNode" }] : [])
      .lean();

    for (const record of records) {
      const customer = record.customer as { market?: string; geoNode?: unknown } | undefined;
      const rawMarket = String(record.market || customer?.market || countryForGeo(record.geoNode || customer?.geoNode) || "Country not set").trim();

      let country = rawMarket;
      let state: string | undefined;
      if (rawMarket.includes(",")) {
        const parts = rawMarket.split(",").map((p) => p.trim());
        country = parts[parts.length - 1] || rawMarket;
        state = parts.slice(0, -1).join(", ");
      }

      const key = country.toLowerCase();
      const row = groups.get(key) ?? { country, leads: 0, customers: 0, partners: 0, converted: 0, pipeline: {}, revenue: {} };
      if (entity === "leads") {
        row.leads++;
        if (record.status === "CONVERTED") row.converted++;
      }
      if (entity === "customers") row.customers++;
      if (entity === "channelPartners") row.partners++;
      const currency = String(record.currency || "INR");
      if (entity === "opportunities" && record.status === "OPEN") row.pipeline[currency] = (row.pipeline[currency] || 0) + Number(record.estimatedValue || 0);
      if (entity === "revenue") row.revenue[currency] = (row.revenue[currency] || 0) + Number(record.amount || 0);
      groups.set(key, row);

      // Collect specific located coordinates for leads and customers
      if ((entity === "leads" || entity === "customers") && record.coordinates && Array.isArray((record.coordinates as { coordinates?: unknown }).coordinates)) {
        const coords = (record.coordinates as { coordinates: [number, number] }).coordinates;
        if (coords.length === 2 && !Number.isNaN(coords[0]) && !Number.isNaN(coords[1])) {
          locations.push({
            _id: String(record._id),
            name: String(record.name || (entity === "leads" ? "Lead" : "Customer")),
            entity: entity === "leads" ? "lead" : "customer",
            country,
            state,
            coordinates: coords,
            status: String(record.status || "ACTIVE"),
            value: Number((record as Record<string, unknown>).confirmedSaleAmount || (record as Record<string, unknown>).lifetimeRevenue || (record as Record<string, unknown>).estimatedValue || 0),
            currency,
            phone: record.phone ? String(record.phone) : undefined,
            email: record.email ? String(record.email) : undefined,
            companyName: ((record as Record<string, unknown>).companyName || (record as Record<string, unknown>).primaryContactName) ? String((record as Record<string, unknown>).companyName || (record as Record<string, unknown>).primaryContactName) : undefined,
          });
        }
      }
    }
  }
  return { items: [...groups.values()], locations };
};

export const listTerritorySalesData = async (viewer: SessionUser, entity: SalesEntityName, territoryId: string) => {
  const scope = await resolveSalesScope(viewer);
  assertSalesTerritoryScope(scope, territoryId);
  return modelFor(entity).find({ ...scopeFilter(scope, entity), territory: territoryId }).populate(salesPopulationPaths[entity], "firstName lastName employeeId name code type").sort({ createdAt: -1 }).limit(500).lean();
};

export const createSalesData = async (viewer: SessionUser, entity: SalesEntityName, raw: SalesInput) => {
  const scope = await resolveSalesScope(viewer);
  const input = { ...raw };
  const employeeKey = entity === "targets" || entity === "revenue" ? "employee" : "ownerEmployee";
  if (scope.level === "SELF" && entity !== "channelPartners") input[employeeKey] = scope.employeeId;
  if (scope.level === "SELF" && entity === "channelPartners") input.ownerEmployee = scope.employeeId;
  if (entity === "leads") {
    Object.assign(input, await leadAttributionForUser(viewer.id));
    input.status = "NEW";
    delete input.customer;
    delete input.firstResponseAt;
    delete input.qualifiedAt;
    delete input.convertedAt;
    delete input.lostReason;
  }
  if (entity === "customers" && !mayAdjustRevenue(viewer)) input.lifetimeRevenue = 0;
  if (entity === "opportunities") {
    input.status = "OPEN";
    delete input.actualCloseDate;
    delete input.lostReason;
  }
  if (entity === "channelPartners" && !input.code) {
    input.code = (String(input.name || "PARTNER").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").slice(0, 15) || "PARTNER") + "_" + Math.random().toString(36).substring(2, 6).toUpperCase();
  }
  await applyCustomerContext(scope, entity, input);
  await applyTerritoryGeography(input);
  if (!["targets", "channelPartners"].includes(entity) && !input[employeeKey]) throw new AppError("Employee is required", 422);
  if (entity === "targets") {
    input.version = 1;
    input.isLatest = true;
    input.status = input.status || "ACTIVE";
    input.createdBy = viewer.id;
    if (["SUPER_ADMIN", "HR_ADMIN"].includes(viewer.role)) {
      input.approvedBy = viewer.id;
      input.approvedAt = new Date();
    }
  }
  await validateReferences(scope, input);
  const item = await modelFor(entity).create(input);
  if (entity === "targets" && !item.get("targetGroupId")) {
    item.set("targetGroupId", item.id);
    await item.save();
  }
  if (entity === "revenue") {
    await adjustCustomerRevenue(optionalId(item.get("customer")), Number(item.get("amount") ?? 0), item.get("transactionDate") as Date | undefined);
  }
  await writeAudit({
    user: viewer.id,
    action: `SALES_${entity.toUpperCase()}_CREATED`,
    entityType: modelFor(entity).modelName,
    entityId: item.id,
    newValue: input,
  });
  if (["leads", "customers", "opportunities"].includes(entity)) {
    await SalesActivity.create({
      entityType: entity,
      entityId: item._id,
      type: "NOTE",
      content: `${entity === "leads" ? "Lead" : entity === "customers" ? "Customer" : "Opportunity"} created`,
      performedBy: new Types.ObjectId(viewer.id),
      performedByName: viewer.email,
    }).catch(() => {});
  }
  return item;
};

export const updateSalesData = async (viewer: SessionUser, entity: SalesEntityName, id: string, raw: SalesInput) => {
  const scope = await resolveSalesScope(viewer);
  const model = modelFor(entity);
  const item = await model.findOne({ _id: id, ...scopeFilter(scope, entity) });
  if (!item) throw new AppError("Sales record not found", 404);
  const input = { ...raw };
  const previous = item.toObject();
  if (raw.saleAmount !== undefined && (entity !== "leads" || raw.status !== "CONVERTED")) throw new AppError("Sale amount requires lead conversion", 422);
  delete input.saleAmount;
  if (entity === "opportunities" && item.get("status") !== "OPEN") {
    const fields = Object.keys(input);
    const isIdempotentStatusRetry = fields.length === 1 && input.status === item.get("status");
    if (!isIdempotentStatusRetry) throw new AppError("Closed opportunities cannot be edited", 409, "OPPORTUNITY_CLOSED");
  }
  if (entity === "leads") {
    delete input.createdBy;
    delete input.createdByEmployee;
    delete input.customer;
    delete input.convertedAt;
    delete input.firstResponseAt;
    delete input.qualifiedAt;
  }
  if (entity === "leads" && typeof input.status === "string") {
    const previousStatus = item.get("status") as LeadStatus;
    const nextStatus = input.status as LeadStatus;
    if (!canTransitionLeadStatus(previousStatus, nextStatus)) throw new AppError(`Lead cannot move from ${previousStatus} to ${nextStatus}`, 409, "INVALID_LEAD_TRANSITION");
    if (nextStatus === "LOST" && !input.lostReason && !item.get("lostReason")) throw new AppError("A lost reason is required", 422, "LOST_REASON_REQUIRED");
    if (["CONTACTED", "QUALIFIED", "CONVERTED"].includes(nextStatus) && !item.get("firstResponseAt")) input.firstResponseAt = new Date();
    if (["QUALIFIED", "CONVERTED"].includes(nextStatus) && !item.get("qualifiedAt")) input.qualifiedAt = new Date();
  }
  if (entity === "customers" && !mayAdjustRevenue(viewer)) delete input.lifetimeRevenue;
  if (entity === "targets" && typeof input.status === "string") {
    const previousStatus = item.get("status") as TargetStatus;
    const nextStatus = input.status as TargetStatus;
    if (previousStatus !== nextStatus && !targetTransitions[previousStatus].includes(nextStatus)) throw new AppError(`Target cannot move from ${previousStatus} to ${nextStatus}`, 409, "INVALID_TARGET_TRANSITION");
  }
  const canEditClosedTarget = viewer.role === "SUPER_ADMIN" || viewer.role === "HR_ADMIN";
  if (entity === "targets" && item.get("status") === "CLOSED" && !canEditClosedTarget) {
    const fields = Object.keys(input).filter((field) => field !== "status");
    const isIdempotentStatusRetry = fields.length === 0 && input.status === "CLOSED";
    if (!isIdempotentStatusRetry) throw new AppError("Closed targets cannot be edited", 409, "TARGET_CLOSED");
  }
  if (entity === "opportunities" && typeof input.status === "string") {
    const previousStatus = item.get("status") as OpportunityStatus;
    const nextStatus = input.status as OpportunityStatus;
    if (!canTransitionOpportunityStatus(previousStatus, nextStatus)) throw new AppError(`Opportunity cannot move from ${previousStatus} to ${nextStatus}`, 409, "INVALID_OPPORTUNITY_TRANSITION");
    if (nextStatus === "LOST" && !input.lostReason && !item.get("lostReason")) throw new AppError("A lost reason is required", 422, "LOST_REASON_REQUIRED");
    if (nextStatus === "WON" && !(input.customer ?? item.get("customer"))) throw new AppError("Link a customer before marking an opportunity as won", 422, "OPPORTUNITY_CUSTOMER_REQUIRED");
    if (nextStatus === "WON") input.probability = 100;
    if (nextStatus === "LOST") input.probability = 0;
    if (["WON", "LOST"].includes(nextStatus) && !item.get("actualCloseDate")) input.actualCloseDate = new Date();
  }
  if (entity === "opportunities" && input.status === "OPEN") {
    delete input.actualCloseDate;
    delete input.lostReason;
  }
  if (scope.level === "SELF") {
    const employeeKey = entity === "targets" || entity === "revenue" ? "employee" : "ownerEmployee";
    if (input[employeeKey]) input[employeeKey] = scope.employeeId;
  }
  await applyCustomerContext(scope, entity, input);
  await applyTerritoryGeography(input);
  await validateReferences(scope, input);
  let convertedCustomer;
  if (entity === "leads" && input.status === "CONVERTED" && !item.get("customer")) {
    convertedCustomer = await SalesCustomer.findOneAndUpdate(
      { sourceLead: item._id },
      { $setOnInsert: {
        name: item.get("companyName") || item.get("name"),
        primaryContactName: item.get("name"),
        email: item.get("email"),
        phone: item.get("phone"),
        sourceLead: item._id,
        ownerEmployee: item.get("ownerEmployee"),
        ...(item.get("territory") ? { territory: item.get("territory") } : {}),
        geoNode: item.get("geoNode"),
        market: item.get("market"),
        coordinates: item.get("coordinates"),
        status: "ACTIVE",
        customerType: "CONVERTED_LEAD",
        lifetimeRevenue: 0,
        currency: item.get("currency") ?? "INR",
      } },
      { upsert: true, new: true, runValidators: true },
    );
    if (convertedCustomer) {
      input.customer = convertedCustomer._id;
      input.convertedAt = new Date();
    }
  }
  if (entity === "targets" && (item.get("status") === "SUPERSEDED" || item.get("isLatest") === false)) {
    throw new AppError("Historical target versions are immutable and cannot be modified", 409, "TARGET_VERSION_IMMUTABLE");
  }
  const meaningfulTargetFields = [
    "revenueTarget", "leadTarget", "conversionTarget", "customerAcquisitionTarget",
    "periodStart", "periodEnd", "periodType", "currency", "compensationRule",
    "effectiveFrom", "effectiveTo", "justification", "employee", "territory"
  ];
  const isMeaningfulTargetChange = entity === "targets" && meaningfulTargetFields.some(
    (field) => raw[field] !== undefined && JSON.stringify(raw[field]) !== JSON.stringify(previous[field])
  );
  if (isMeaningfulTargetChange) {
    const newVersion = (Number(item.get("version")) || 1) + 1;
    const targetGroupId = String(item.get("targetGroupId") || item.id);
    const newEffectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom as string) : new Date();

    item.set({
      isLatest: false,
      status: "SUPERSEDED",
      effectiveTo: newEffectiveFrom,
      targetGroupId,
    });
    await item.save();

    const previousDoc = item.toObject();
    delete previousDoc._id;
    delete previousDoc.createdAt;
    delete previousDoc.updatedAt;

    const newTarget = await SalesTarget.create({
      ...previousDoc,
      ...input,
      targetGroupId,
      version: newVersion,
      effectiveFrom: newEffectiveFrom,
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo as string) : previousDoc.periodEnd,
      isLatest: true,
      status: input.status && input.status !== "SUPERSEDED" ? input.status : "ACTIVE",
      createdBy: viewer.id,
      approvedBy: ["SUPER_ADMIN", "HR_ADMIN"].includes(viewer.role) ? viewer.id : input.approvedBy,
      approvedAt: ["SUPER_ADMIN", "HR_ADMIN"].includes(viewer.role) ? new Date() : undefined,
      changeReason: (input.changeReason as string) || (input.justification as string) || "Target revision",
    });

    await writeAudit({
      user: viewer.id,
      action: "SALES_TARGET_VERSION_CREATED",
      entityType: "SalesTarget",
      entityId: newTarget.id,
      oldValue: { version: item.get("version"), id: item.id },
      newValue: { version: newVersion, targetGroupId, revenueTarget: newTarget.revenueTarget },
    });

    return newTarget;
  }
  item.set(input);
  await item.save();
  if (entity === "leads" && input.status === "CONVERTED" && raw.saleAmount !== undefined) {
    const result = await SalesRevenueTransaction.updateOne(
      { sourceLead: item._id },
      { $setOnInsert: {
        sourceLead: item._id, customer: item.get("customer"), employee: item.get("ownerEmployee"),
        territory: item.get("territory"), geoNode: item.get("geoNode"), amount: Number(raw.saleAmount), quantity: 1,
        currency: item.get("currency") ?? "INR", transactionDate: new Date(), source: "LEAD_CONVERSION",
        reference: "LEAD-" + item.id,
      } },
      { upsert: true, runValidators: true },
    );
    if (result.upsertedCount) await adjustCustomerRevenue(optionalId(item.get("customer")), Number(raw.saleAmount), new Date());
    const revenue = await SalesRevenueTransaction.findOne({ sourceLead: item._id }).select("amount").lean();
    item.set("confirmedSaleAmount", revenue?.amount);
    await item.save();
  }
  if (entity === "opportunities" && input.status === "WON") await createWonRevenue(viewer, item);
  if (entity === "revenue") {
    const previousCustomer = optionalId(previous.customer);
    const nextCustomer = optionalId(item.get("customer"));
    const previousAmount = Number(previous.amount ?? 0);
    const nextAmount = Number(item.get("amount") ?? 0);
    if (previousCustomer === nextCustomer) {
      await adjustCustomerRevenue(nextCustomer, nextAmount - previousAmount, item.get("transactionDate") as Date | undefined);
    } else {
      await adjustCustomerRevenue(previousCustomer, -previousAmount);
      await adjustCustomerRevenue(nextCustomer, nextAmount, item.get("transactionDate") as Date | undefined);
    }
  }
  if (convertedCustomer) await writeAudit({ user: viewer.id, action: "SALES_CUSTOMER_AUTO_CREATED", entityType: "SalesCustomer", entityId: convertedCustomer.id, newValue: { sourceLead: item.id } });
  await writeAudit({
    user: viewer.id,
    action: `SALES_${entity.toUpperCase()}_UPDATED`,
    entityType: model.modelName,
    entityId: item.id,
    oldValue: previous,
    newValue: input,
  });
  if (["leads", "customers", "opportunities"].includes(entity)) {
    if (entity === "opportunities" && input.stage && input.stage !== previous.stage) {
      await SalesActivity.create({
        entityType: "opportunities",
        entityId: item._id,
        type: "STAGE_CHANGE",
        content: `Stage updated from ${previous.stage ?? "None"} to ${input.stage}`,
        metadata: { previousStage: previous.stage, nextStage: input.stage },
        performedBy: new Types.ObjectId(viewer.id),
        performedByName: viewer.email,
      }).catch(() => {});
    }
    if (input.status && input.status !== previous.status) {
      await SalesActivity.create({
        entityType: entity,
        entityId: item._id,
        type: input.status === "CONVERTED" ? "CONVERSION" : "STATUS_CHANGE",
        content: input.status === "CONVERTED"
          ? `Lead converted to customer with confirmed sale`
          : `Status changed from ${previous.status ?? "None"} to ${input.status}`,
        metadata: { previousStatus: previous.status, nextStatus: input.status },
        performedBy: new Types.ObjectId(viewer.id),
        performedByName: viewer.email,
      }).catch(() => {});
    }
    if (["leads", "customers"].includes(entity) && input.market && input.market !== previous.market) {
      await SalesActivity.create({
        entityType: entity,
        entityId: item._id,
        type: "LOCATION_PIN",
        content: `Location updated to ${input.market}`,
        metadata: { market: input.market, coordinates: input.coordinates },
        performedBy: new Types.ObjectId(viewer.id),
        performedByName: viewer.email,
      }).catch(() => {});
    }
  }
  return item;
};

export const listActivities = async (viewer: SessionUser, entity: SalesEntityName, entityId: string) => {
  const scope = await resolveSalesScope(viewer);
  const model = modelFor(entity);
  const exists = await model.exists({ _id: entityId, ...scopeFilter(scope, entity) });
  if (!exists) throw new AppError("Sales record not found", 404);

  return SalesActivity.find({ entityId })
    .populate("performedBy", "firstName lastName email")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

export const createActivity = async (
  viewer: SessionUser,
  entity: SalesEntityName,
  entityId: string,
  raw: { type?: string; content: string; metadata?: Record<string, unknown> },
) => {
  const scope = await resolveSalesScope(viewer);
  const model = modelFor(entity);
  const exists = await model.exists({ _id: entityId, ...scopeFilter(scope, entity) });
  if (!exists) throw new AppError("Sales record not found", 404);
  if (!raw.content || !raw.content.trim()) throw new AppError("Activity content is required", 422);

  return SalesActivity.create({
    entityType: entity as "leads" | "customers" | "opportunities",
    entityId: new Types.ObjectId(entityId),
    type: raw.type && ["NOTE", "CALL_LOG", "STAGE_CHANGE", "STATUS_CHANGE", "LOCATION_PIN", "CONVERSION"].includes(raw.type)
      ? (raw.type as "NOTE" | "CALL_LOG" | "STAGE_CHANGE" | "STATUS_CHANGE" | "LOCATION_PIN" | "CONVERSION")
      : "NOTE",
    content: raw.content.trim(),
    metadata: raw.metadata,
    performedBy: new Types.ObjectId(viewer.id),
    performedByName: viewer.email,
  });
};

export const listTargetVersions = async (viewer: SessionUser, targetId: string) => {
  const scope = await resolveSalesScope(viewer);
  const target = await SalesTarget.findById(targetId).lean();
  if (!target) throw new AppError("Target not found", 404);
  const targetGroupId = target.targetGroupId || target._id.toString();
  return SalesTarget.find({
    targetGroupId,
    $or: [
      { employee: { $in: scope.allowedEmployeeIds } },
      { territory: { $in: scope.allowedTerritoryIds } },
    ],
  })
    .populate("employee", "firstName lastName employeeId")
    .populate("territory", "name code")
    .populate("createdBy", "firstName lastName email")
    .populate("approvedBy", "firstName lastName email")
    .sort({ version: -1 })
    .lean();
};
