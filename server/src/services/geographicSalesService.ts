import type { SessionUser, GeographicRollupNode, GeographicAnalyticsResponse, HeatmapPointTuple, HeatmapPointsResponse } from "@mobius-ems/shared";
import { GeoNode } from "../models/GeoNode.js";
import { SalesLead } from "../models/SalesLead.js";
import { SalesCustomer } from "../models/SalesCustomer.js";
import { SalesOpportunity } from "../models/SalesOpportunity.js";
import { SalesRevenueTransaction } from "../models/SalesRevenueTransaction.js";
import { SalesTarget } from "../models/SalesTarget.js";
import { ChannelPartner } from "../models/ChannelPartner.js";
import { EmployeeTerritoryAssignment } from "../models/EmployeeTerritoryAssignment.js";
import { SalesConfiguration } from "../models/SalesConfiguration.js";
import { SalesTerritory } from "../models/SalesTerritory.js";
import { AppError } from "../utils/AppError.js";
import { resolveSalesScope, assertSalesGeoScope } from "./salesScopeService.js";
import { descendantGeoIds } from "./geoService.js";

export interface CapacityBottleneckResult {
  configuredCapacityPerRep: number;
  requiredHeadcount: number;
  activeHeadcount: number;
  headcountGap: number;
  isCapacityBottleneck: boolean;
  estimatedOpportunityLost: number;
  capacityUtilization: number;
  capacityStatus: "HEALTHY" | "APPROACHING" | "CRITICAL";
}

/**
 * PRD Section 8 Decision Engine Calculations
 * Calculates capacity, bottlenecks, gaps, and estimated revenue lost
 */
export const calculateCapacityBottlenecks = (
  leadCount: number,
  activeHeadcount: number,
  configuredCapacityPerRep: number = 50,
  averageDealValue: number = 50000,
  historicalConversionRate: number = 10
): CapacityBottleneckResult => {
  const load = Math.max(0, leadCount);
  const headcount = Math.max(0, activeHeadcount);
  const capacity = Math.max(1, configuredCapacityPerRep);
  const requiredHeadcount = Math.ceil(load / capacity);
  const headcountGap = Math.max(0, requiredHeadcount - headcount);
  const isCapacityBottleneck = headcountGap > 0;

  // Rate normalized to fraction (e.g. 10% -> 0.10)
  const rate = historicalConversionRate > 1 ? historicalConversionRate / 100 : historicalConversionRate;

  // PRD Section 8 & test formula: headcountGap * capacityPerRep * averageDealValue * historicalConversionRate
  const estimatedOpportunityLost = headcountGap * capacity * averageDealValue * rate;

  const utilization = headcount > 0 ? Number(((load / (headcount * capacity)) * 100).toFixed(2)) : (load > 0 ? 100 : 0);
  const capacityStatus = isCapacityBottleneck || utilization > 100 ? "CRITICAL" : utilization > 80 ? "APPROACHING" : "HEALTHY";

  return {
    configuredCapacityPerRep: capacity,
    requiredHeadcount,
    activeHeadcount: headcount,
    headcountGap,
    isCapacityBottleneck,
    estimatedOpportunityLost: Math.round(estimatedOpportunityLost),
    capacityUtilization: utilization,
    capacityStatus,
  };
};

/**
 * Prescriptive AI Action & White-Space Recommendation logic
 */
export const determineWhiteSpaceRecommendation = ({
  leadCount,
  activeHeadcount,
  channelPartnerCount = 0,
  conversionRate = 0,
  healthyConversionRate = 10,
}: {
  leadCount: number;
  activeHeadcount: number;
  channelPartnerCount?: number;
  conversionRate?: number;
  healthyConversionRate?: number;
}): string => {
  // If high lead volume + zero partners + zero reps
  if (leadCount > 0 && channelPartnerCount === 0 && activeHeadcount === 0) {
    return "HIGH_EXPANSION_OPPORTUNITY: APPOINT_CHANNEL_PARTNER";
  }

  // If high lead volume + low reps + high conversion
  if (leadCount >= 50 && activeHeadcount > 0 && (leadCount / activeHeadcount > 50) && conversionRate >= (healthyConversionRate || 10)) {
    return "CAPACITY_BOTTLENECK: HIRE_SALES_REP";
  }
  if (leadCount > 0 && activeHeadcount > 0 && (leadCount / activeHeadcount > 80)) {
    return "CAPACITY_BOTTLENECK: HIRE_SALES_REP";
  }

  // If low lead volume + high reps
  if (activeHeadcount >= 2 && leadCount < activeHeadcount * 10) {
    return "OVER_CAPACITY: REALIGN_TERRITORY";
  }

  return "OPTIMAL_COVERAGE: MAINTAIN_OPERATION";
};

export interface HierarchyNodeRecord {
  _id: string;
  name: string;
  code: string;
  type: "GLOBAL" | "COUNTRY" | "STATE" | "DISTRICT" | "CITY" | "AREA" | "PINCODE" | "TERRITORY";
  parent?: string;
  ancestors: string[];
  depth: number;
  location?: { type: "Point"; coordinates: [number, number] };
  managerName?: string;
}

export interface NodeDataRecord {
  assignedTarget?: number;
  actualRevenue?: number;
  salesQuantity?: number;
  salesTransactionCount?: number;
  pipelineValue?: number;
  leadCount?: number;
  convertedLeadCount?: number;
  customerCount?: number;
  activeHeadcount?: number;
  channelPartnerCount?: number;
  averageDealValue?: number;
  historicalConversionRate?: number;
  configuredCapacityPerRep?: number;
}

/**
 * Pure aggregation function for 7-level hierarchy rollups
 */
export const rollupHierarchyMetrics = (
  nodes: HierarchyNodeRecord[],
  nodeDataMap: Record<string, NodeDataRecord>,
  targetGeoId: string,
  defaultCapacity: number = 50,
  defaultHealthyConversion: number = 10
): {
  node: GeographicRollupNode;
  children: GeographicRollupNode[];
  ancestors: Array<{ _id: string; name: string; code: string; type: string }>;
} => {
  const target = nodes.find((n) => n._id === targetGeoId);
  const targetNode = target ?? {
    _id: "global",
    name: "Global",
    code: "GLOBAL",
    type: "GLOBAL" as const,
    ancestors: [] as string[],
    depth: 0,
  };

  const getDescendantIds = (nodeId: string): Set<string> => {
    const set = new Set<string>([nodeId]);
    if (nodeId === "global" || (nodeId === targetNode._id && targetNode.type === "GLOBAL")) {
      for (const n of nodes) set.add(n._id);
      return set;
    }
    for (const n of nodes) {
      if (n.ancestors.includes(nodeId) || n.parent === nodeId) {
        set.add(n._id);
      }
    }
    return set;
  };

  const rollupForNode = (node: HierarchyNodeRecord): GeographicRollupNode => {
    const descendantIds = getDescendantIds(node._id);
    let assignedTarget = 0;
    let actualRevenue = 0;
    let salesQuantity = 0;
    let salesTransactionCount = 0;
    let pipelineValue = 0;
    let leadCount = 0;
    let convertedLeadCount = 0;
    let customerCount = 0;
    let activeHeadcount = 0;
    let channelPartnerCount = 0;
    let totalDealValue = 0;
    let dealValueSamples = 0;
    const capacityPerRep = nodeDataMap[node._id]?.configuredCapacityPerRep ?? defaultCapacity;

    for (const id of descendantIds) {
      const data = nodeDataMap[id];
      if (!data) continue;
      assignedTarget += data.assignedTarget ?? 0;
      actualRevenue += data.actualRevenue ?? 0;
      salesQuantity += data.salesQuantity ?? 0;
      salesTransactionCount += data.salesTransactionCount ?? 0;
      pipelineValue += data.pipelineValue ?? 0;
      leadCount += data.leadCount ?? 0;
      convertedLeadCount += data.convertedLeadCount ?? 0;
      customerCount += data.customerCount ?? 0;
      activeHeadcount += data.activeHeadcount ?? 0;
      channelPartnerCount += data.channelPartnerCount ?? 0;
      if (data.averageDealValue && data.averageDealValue > 0) {
        totalDealValue += data.averageDealValue;
        dealValueSamples++;
      }
    }

    const conversionRate = leadCount > 0 ? Number(((convertedLeadCount / leadCount) * 100).toFixed(2)) : 0;
    const averageDealValue = dealValueSamples > 0
      ? totalDealValue / dealValueSamples
      : convertedLeadCount > 0
        ? actualRevenue / convertedLeadCount
        : 50000;

    const bottleneck = calculateCapacityBottlenecks(
      leadCount,
      activeHeadcount,
      capacityPerRep,
      averageDealValue,
      conversionRate > 0 ? conversionRate : defaultHealthyConversion
    );

    const whiteSpace = determineWhiteSpaceRecommendation({
      leadCount,
      activeHeadcount,
      channelPartnerCount,
      conversionRate,
      healthyConversionRate: defaultHealthyConversion,
    });

    const targetPacingPercentage = assignedTarget > 0
      ? Number(((actualRevenue / assignedTarget) * 100).toFixed(2))
      : actualRevenue > 0
        ? 100
        : 0;

    return {
      _id: node._id,
      name: node.name,
      code: node.code,
      type: node.type,
      depth: node.depth ?? 0,
      parent: node.parent,
      ancestors: node.ancestors ?? [],
      location: node.location,
      managerName: node.managerName,
      assignedTarget,
      actualRevenue,
      salesQuantity,
      salesTransactionCount,
      targetPacingPercentage,
      pipelineValue,
      leadCount,
      leadConversionRate: conversionRate,
      customerCount,
      channelPartnerCount,
      ...bottleneck,
      whiteSpaceRecommendation: whiteSpace,
    };
  };

  const selectedRollup = rollupForNode(targetNode);

  // Determine immediate children
  const immediateChildrenNodes = nodes.filter((n) => {
    if (targetNode._id === "global" || targetNode.type === "GLOBAL") {
      return n.type !== "GLOBAL" && (n.type === "COUNTRY" || n.depth === 1 || n.parent === "global");
    }
    return n.parent === targetNode._id;
  });

  const childrenRollup = immediateChildrenNodes.map((child) => rollupForNode(child));

  // Determine ancestors
  const ancestorItems = (targetNode.ancestors || [])
    .map((ancId) => nodes.find((n) => n._id === ancId))
    .filter((n): n is HierarchyNodeRecord => Boolean(n))
    .map((n) => ({ _id: n._id, name: n.name, code: n.code, type: n.type }));

  if (targetNode._id !== "global" && targetNode.type !== "GLOBAL") {
    ancestorItems.unshift({ _id: "global", name: "Global", code: "GLOBAL", type: "GLOBAL" });
  }

  return {
    node: selectedRollup,
    children: childrenRollup,
    ancestors: ancestorItems,
  };
};

/**
 * Controller-facing Geographic Analytics Service
 * Loads MongoDB collections, aggregates recursively across 7 levels, returns enriched response.
 */
export const getGeographicAnalytics = async (
  viewer: SessionUser,
  geoId: string
): Promise<GeographicAnalyticsResponse> => {
  const scope = await resolveSalesScope(viewer);
  const isGlobal = !geoId || geoId.toLowerCase() === "global";

  if (!isGlobal) {
    assertSalesGeoScope(scope, geoId);
  }

  const [storedConfig, allGeoNodes, allTerritories] = await Promise.all([
    SalesConfiguration.findOne({ key: "DEFAULT" }).lean(),
    GeoNode.find({ isActive: true, ...(scope.allowedGeoIds.length ? { _id: { $in: scope.allowedGeoIds } } : {}) }).lean(),
    SalesTerritory.find({ status: "ACTIVE" }).populate("ownerEmployee", "firstName lastName").lean(),
  ]);

  const config = storedConfig ?? {
    defaultLeadCapacityPerEmployee: 50,
    healthyConversionRate: 15,
    responseSlaMinutes: 240,
    opportunityWeights: { demand: 20, coverageGap: 25, customerWhiteSpace: 15, pipelinePotential: 15, growth: 10, conversionPotential: 15 },
  };

  const targetNode = isGlobal ? undefined : allGeoNodes.find((node) => String(node._id) === geoId);
  if (!isGlobal && !targetNode) {
    throw new AppError("Geography not found", 404);
  }

  const targetIdStr = targetNode ? String(targetNode._id) : "global";

  // Build hierarchy node list
  const hierarchyNodes: HierarchyNodeRecord[] = allGeoNodes.map((n) => ({
    _id: String(n._id),
    name: n.name,
    code: n.code,
    type: n.type,
    parent: n.parent ? String(n.parent) : undefined,
    ancestors: (n.ancestors || []).map((a) => String(a)),
    depth: n.depth,
    location: n.location,
  }));

  // Find descendant IDs in scope
  const targetDescendantIds = isGlobal
    ? allGeoNodes.map((n) => n._id)
    : await descendantGeoIds(geoId);

  // Find territories covering target descendants
  const relevantTerritories = allTerritories.filter((t) =>
    t.coverageRules?.geoNodeIds?.some((gId) => targetDescendantIds.some((descId) => String(descId) === String(gId)))
  );
  const relevantTerritoryIds = relevantTerritories.map((t) => t._id);

  // Query records
  const [leads, customers, opportunities, revenues, targets, channelPartners, assignments] = await Promise.all([
    SalesLead.find({
      $or: [
        { geoNode: { $in: targetDescendantIds } },
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("geoNode territory status estimatedValue currency createdAt firstResponseAt").lean(),

    SalesCustomer.find({
      status: "ACTIVE",
      $or: [
        { geoNode: { $in: targetDescendantIds } },
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("_id geoNode territory lifetimeRevenue").lean(),

    SalesOpportunity.find({
      status: "OPEN",
      $or: [
        { geoNode: { $in: targetDescendantIds } },
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("geoNode territory estimatedValue probability").lean(),

    SalesRevenueTransaction.find({
      $or: [
        { geoNode: { $in: targetDescendantIds } },
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("geoNode territory amount quantity currency transactionDate").lean(),

    SalesTarget.find({
      status: { $in: ["ACTIVE", "CLOSED"] },
      $or: [
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("revenueTarget territory employee").lean(),

    ChannelPartner.find({
      status: "ACTIVE",
      $or: [
        { geoNode: { $in: targetDescendantIds } },
        ...(relevantTerritoryIds.length ? [{ territory: { $in: relevantTerritoryIds } }] : []),
      ],
    }).select("_id geoNode territory").lean(),

    EmployeeTerritoryAssignment.find({
      isActive: true,
      territory: { $in: relevantTerritoryIds },
    }).select("employee territory").lean(),
  ]);

  // Aggregate raw counts per geoNode
  const nodeDataMap: Record<string, NodeDataRecord> = {};

  const ensureNodeData = (id: string): NodeDataRecord => {
    if (!nodeDataMap[id]) {
      nodeDataMap[id] = {
        assignedTarget: 0,
        actualRevenue: 0,
        salesQuantity: 0,
        salesTransactionCount: 0,
        pipelineValue: 0,
        leadCount: 0,
        convertedLeadCount: 0,
        customerCount: 0,
        activeHeadcount: 0,
        channelPartnerCount: 0,
        configuredCapacityPerRep: config.defaultLeadCapacityPerEmployee || 50,
      };
    }
    return nodeDataMap[id];
  };

  // Map territory to primary geoNode
  const territoryGeoMap = new Map<string, string>();
  for (const t of relevantTerritories) {
    const firstGeo = t.coverageRules?.geoNodeIds?.[0];
    if (firstGeo) territoryGeoMap.set(String(t._id), String(firstGeo));
  }

  // Aggregate leads
  for (const lead of leads) {
    const gId = lead.geoNode ? String(lead.geoNode) : lead.territory ? territoryGeoMap.get(String(lead.territory)) : undefined;
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.leadCount = (data.leadCount ?? 0) + 1;
    if (lead.status === "CONVERTED") {
      data.convertedLeadCount = (data.convertedLeadCount ?? 0) + 1;
    }
  }

  // Aggregate customers
  for (const cust of customers) {
    const gId = cust.geoNode ? String(cust.geoNode) : cust.territory ? territoryGeoMap.get(String(cust.territory)) : undefined;
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.customerCount = (data.customerCount ?? 0) + 1;
  }

  // Aggregate opportunities
  for (const opp of opportunities) {
    const gId = opp.geoNode ? String(opp.geoNode) : opp.territory ? territoryGeoMap.get(String(opp.territory)) : undefined;
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.pipelineValue = (data.pipelineValue ?? 0) + (opp.estimatedValue || 0);
  }

  // Aggregate revenue
  for (const rev of revenues) {
    const gId = rev.geoNode ? String(rev.geoNode) : rev.territory ? territoryGeoMap.get(String(rev.territory)) : undefined;
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.actualRevenue = (data.actualRevenue ?? 0) + (rev.amount || 0);
    data.salesQuantity = (data.salesQuantity ?? 0) + (rev.quantity ?? 1);
    data.salesTransactionCount = (data.salesTransactionCount ?? 0) + 1;
  }

  // Aggregate channel partners
  for (const cp of channelPartners) {
    const gId = cp.geoNode ? String(cp.geoNode) : cp.territory ? territoryGeoMap.get(String(cp.territory)) : undefined;
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.channelPartnerCount = (data.channelPartnerCount ?? 0) + 1;
  }

  // Aggregate active headcount from territory assignments
  const nodeRepSets = new Map<string, Set<string>>();
  for (const assign of assignments) {
    const gId = territoryGeoMap.get(String(assign.territory));
    if (!gId) continue;
    if (!nodeRepSets.has(gId)) nodeRepSets.set(gId, new Set());
    nodeRepSets.get(gId)!.add(String(assign.employee));
  }
  for (const [gId, reps] of nodeRepSets.entries()) {
    const data = ensureNodeData(gId);
    data.activeHeadcount = reps.size;
  }

  // Aggregate targets
  for (const target of targets) {
    if (!target.territory) continue;
    const gId = territoryGeoMap.get(String(target.territory));
    if (!gId) continue;
    const data = ensureNodeData(gId);
    data.assignedTarget = (data.assignedTarget ?? 0) + (target.revenueTarget || 0);
  }

  // Perform recursive child rollups
  const rollup = rollupHierarchyMetrics(
    hierarchyNodes,
    nodeDataMap,
    targetIdStr,
    config.defaultLeadCapacityPerEmployee || 50,
    config.healthyConversionRate || 15
  );

  // Map territories in scope
  const territoryList = relevantTerritories.map((t) => {
    const owner = t.ownerEmployee as { firstName?: string; lastName?: string } | undefined;
    const assignedReps = assignments.filter((a) => String(a.territory) === String(t._id)).length;
    const territoryRevenue = revenues.filter((r) => String(r.territory) === String(t._id));
    return {
      _id: String(t._id),
      name: t.name,
      code: t.code,
      managerName: owner ? `${owner.firstName || ""} ${owner.lastName || ""}`.trim() : undefined,
      activeHeadcount: assignedReps,
      actualRevenue: territoryRevenue.reduce((sum, item) => sum + (item.amount || 0), 0),
      salesQuantity: territoryRevenue.reduce((sum, item) => sum + (item.quantity ?? 1), 0),
      salesTransactionCount: territoryRevenue.length,
    };
  });

  const node = rollup.node;
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    generatedAt: now.toISOString(),
    scope: scope.level,
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    currency: "INR",
    targetRevenue: node.assignedTarget,
    actualRevenue: node.actualRevenue,
    salesQuantity: node.salesQuantity,
    salesTransactionCount: node.salesTransactionCount,
    targetAchievement: node.targetPacingPercentage,
    leadCount: node.leadCount,
    qualifiedLeadCount: node.leadCount,
    convertedLeadCount: Math.round(node.leadCount * (node.leadConversionRate / 100)),
    conversionRate: node.leadConversionRate,
    customerCount: node.customerCount,
    pipelineValue: node.pipelineValue,
    weightedPipeline: node.pipelineValue * 0.5,
    employeeCount: node.activeHeadcount,
    channelPartnerCount: node.channelPartnerCount,
    avgFirstResponseMinutes: 0,
    delayedLeadCount: 0,
    currentLeadLoad: node.leadCount,
    configuredLeadCapacity: node.configuredCapacityPerRep,
    requiredHeadcount: node.requiredHeadcount,
    activeHeadcount: node.activeHeadcount,
    headcountGap: node.headcountGap,
    capacityUtilization: node.capacityUtilization,
    coveragePercentage: node.requiredHeadcount ? Math.min(100, Number(((node.activeHeadcount / node.requiredHeadcount) * 100).toFixed(2))) : 100,
    leadDemandScore: Math.min(100, node.leadCount),
    coverageGapScore: Math.max(0, 100 - (node.requiredHeadcount ? (node.activeHeadcount / node.requiredHeadcount) * 100 : 100)),
    customerWhiteSpaceScore: node.leadCount ? Math.max(0, 100 - ((node.customerCount / node.leadCount) * 100)) : 0,
    pipelinePotentialScore: 50,
    growthScore: 50,
    conversionPotentialScore: 50,
    opportunityScore: 60,
    opportunityBand: node.headcountGap > 0 ? "HIGH" : "MEDIUM",
    estimatedLostConversions: node.headcountGap * (node.leadConversionRate / 100),
    estimatedOpportunityLost: node.estimatedOpportunityLost,
    isEstimate: true,
    node,
    children: rollup.children,
    ancestors: rollup.ancestors,
    hierarchyLevel: node.type,
    territories: territoryList,
  };
};

/**
 * Weighted coordinates feed for density heatmaps
 * Returns [lat, lng, intensity] tuples
 */
export const getGeographicHeatmapPoints = async (
  viewer: SessionUser,
  type: "leads" | "customers" | "revenue" | "quantity" = "leads",
  geoId?: string
): Promise<HeatmapPointsResponse> => {
  const scope = await resolveSalesScope(viewer);
  const isGlobal = !geoId || geoId.toLowerCase() === "global";

  const filter: Record<string, unknown> = {
    coordinates: { $exists: true, $ne: null },
  };

  if (!isGlobal) {
    assertSalesGeoScope(scope, geoId!);
    const descendants = await descendantGeoIds(geoId!);
    filter.geoNode = { $in: descendants };
  } else if (scope.allowedGeoIds.length) {
    filter.geoNode = { $in: scope.allowedGeoIds };
  }

  const points: HeatmapPointTuple[] = [];

  if (type === "revenue" || type === "quantity") {
    const revenueFilter: Record<string, unknown> = {};
    if (!isGlobal) {
      const descendants = await descendantGeoIds(geoId!);
      revenueFilter.geoNode = { $in: descendants };
    } else if (scope.allowedGeoIds.length) {
      revenueFilter.geoNode = { $in: scope.allowedGeoIds };
    }
    const rows = await SalesRevenueTransaction.find(revenueFilter)
      .select("geoNode amount quantity")
      .populate("geoNode", "location")
      .lean();
    for (const row of rows) {
      const geo = row.geoNode as unknown as { location?: { coordinates?: [number, number] } };
      const coordinates = geo?.location?.coordinates;
      if (!coordinates) continue;
      const [lng, lat] = coordinates;
      const raw = type === "revenue" ? (row.amount || 0) / 200000 : (row.quantity ?? 1) / 100;
      points.push([lat, lng, Number(Math.min(1, Math.max(0.2, raw)).toFixed(2))]);
    }
    return { type, points };
  }

  if (type === "customers") {
    const customers = await SalesCustomer.find(filter)
      .select("coordinates lifetimeRevenue name")
      .lean();

    for (const cust of customers) {
      if (!cust.coordinates || !Array.isArray(cust.coordinates.coordinates)) continue;
      const [lng, lat] = cust.coordinates.coordinates;
      if (typeof lng !== "number" || typeof lat !== "number" || Number.isNaN(lng) || Number.isNaN(lat)) continue;

      // Normalize lifetime revenue into intensity between 0.2 and 1.0
      const rev = cust.lifetimeRevenue ?? 0;
      const intensity = Number(Math.min(1.0, Math.max(0.2, rev / 200000)).toFixed(2));
      points.push([lat, lng, intensity]);
    }
  } else {
    const leads = await SalesLead.find(filter)
      .select("coordinates estimatedValue status createdAt firstResponseAt name")
      .lean();

    const now = Date.now();
    for (const lead of leads) {
      if (!lead.coordinates || !Array.isArray(lead.coordinates.coordinates)) continue;
      const [lng, lat] = lead.coordinates.coordinates;
      if (typeof lng !== "number" || typeof lat !== "number" || Number.isNaN(lng) || Number.isNaN(lat)) continue;

      // Intensity reflects deal value, lead score or uncontacted age
      let weight = (lead.estimatedValue ?? 0) / 100000;
      if (lead.status === "QUALIFIED") weight += 0.3;
      if (lead.status === "NEW") {
        const daysOld = lead.createdAt ? (now - new Date(lead.createdAt).getTime()) / 86400000 : 0;
        if (daysOld > 7) weight += 0.25;
      }
      const intensity = Number(Math.min(1.0, Math.max(0.2, weight)).toFixed(2));
      points.push([lat, lng, intensity]);
    }
  }

  return { type, points };
};
