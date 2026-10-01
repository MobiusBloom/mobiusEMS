import { useState, useMemo } from "react";
import countryMaster from "world-countries";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GeographicRollupNode } from "@mobius-ems/shared";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  ChevronRight,
  Eye,
  Globe2,
  Plus,
  RotateCcw,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { salesApi } from "../salesApi";
import { GeoSalesMap } from "../components/GeoSalesMap";
import { GeoIntelligencePanel } from "../components/GeoIntelligencePanel";
import { CountrySales } from "../components/CountrySales";
import { GeographyCreateDialog, type CreateGeographyInput } from "../components/GeographyCreateDialog";

type HierarchyFilter = "ALL" | "COUNTRIES" | "STATES" | "DISTRICTS" | "CITIES" | "AREAS" | "PINCODES";

export const GeographicSalesPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageGeo = user?.permissions.includes("sales.configuration.manage") ?? false;

  // Navigation / Drilldown State
  const [currentGeoId, setCurrentGeoId] = useState<string>("global");
  const [selectedNode, setSelectedNode] = useState<GeographicRollupNode | null>(null);
  const [hierarchyFilter, setHierarchyFilter] = useState<HierarchyFilter>("ALL");

  // Layer Controls State
  const [heatmapMode, setHeatmapMode] = useState<"off" | "leads" | "customers" | "revenue" | "quantity">("leads");
  const [showCoverageOverlay, setShowCoverageOverlay] = useState(true);
  const [activeTab, setActiveTab] = useState<"map" | "table">("map");

  // Dialog State
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // 1. Fetch Geographic Intelligence Data for current node
  const intelligenceQuery = useQuery({
    queryKey: ["sales", "geo-intelligence", currentGeoId],
    queryFn: () => salesApi.geoIntelligence(currentGeoId),
  });

  // 2. Fetch Heatmap Points when enabled
  const heatmapQuery = useQuery({
    queryKey: ["sales", "heatmap-points", heatmapMode, currentGeoId],
    queryFn: () => salesApi.heatmapPoints(heatmapMode === "off" ? "leads" : heatmapMode, currentGeoId === "global" ? undefined : currentGeoId),
    enabled: heatmapMode !== "off",
  });

  // 3. Fetch Country / Location pins for precise coordinates
  const countryPinsQuery = useQuery({
    queryKey: ["sales", "countries"],
    queryFn: salesApi.countries,
  });

  // 4. Fetch Geo tree for Create dialog
  const geoTreeQuery = useQuery({
    queryKey: ["sales", "geography", "tree"],
    queryFn: salesApi.geography,
  });

  // 5. Create Geography Mutation
  const createGeoMutation = useMutation({
    mutationFn: (input: CreateGeographyInput) => salesApi.createGeography(input as unknown as Record<string, unknown>),
    onSuccess: async () => {
      setCreateDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });

  const rawCurrentNode = intelligenceQuery.data?.node;
  const countryTotals = useMemo(() => (countryPinsQuery.data?.items ?? []).reduce((totals, item) => ({
    revenue: totals.revenue + Object.values(item.revenue).reduce((sum, value) => sum + value, 0),
    leads: totals.leads + item.leads,
    customers: totals.customers + item.customers,
  }), { revenue: 0, leads: 0, customers: 0 }), [countryPinsQuery.data?.items]);
  const currentNode = useMemo(() => {
    if (!rawCurrentNode || (rawCurrentNode._id !== "global" && rawCurrentNode.type !== "GLOBAL")) return rawCurrentNode;
    return {
      ...rawCurrentNode,
      actualRevenue: Math.max(rawCurrentNode.actualRevenue, countryTotals.revenue),
      leadCount: Math.max(rawCurrentNode.leadCount, countryTotals.leads),
      customerCount: Math.max(rawCurrentNode.customerCount, countryTotals.customers),
    };
  }, [rawCurrentNode, countryTotals]);
  const hierarchyChildren = useMemo(() => (intelligenceQuery.data?.children ?? []).filter((node) => node.type !== "GLOBAL"), [intelligenceQuery.data?.children]);
  const ancestors = useMemo(() => intelligenceQuery.data?.ancestors ?? [], [intelligenceQuery.data?.ancestors]);

  const childrenNodes = useMemo(() => {
    if (!currentNode || (currentNode._id !== "global" && currentNode.type !== "GLOBAL")) return hierarchyChildren;
      const existingNames = new Set(hierarchyChildren.map((node) => node.name.trim().toLowerCase()));
      const fallbackCountries: GeographicRollupNode[] = (countryPinsQuery.data?.items ?? []).flatMap((summary) => {
        const lookup = summary.country.trim().toLowerCase();
        if (lookup === "country not set" || existingNames.has(lookup)) return [];
        const country = countryMaster.find((item) => [item.name.common, item.name.official, item.cca2, item.cca3, ...item.altSpellings].some((alias) => alias.toLowerCase() === lookup));
        if (!country) return [];
        return [{
          _id: `market-${country.cca2}`,
          name: country.name.common,
          code: country.cca2,
          type: "COUNTRY" as const,
          ancestors: [],
          depth: 1,
          location: { type: "Point" as const, coordinates: [country.latlng[1], country.latlng[0]] as [number, number] },
          leadCount: summary.leads,
          customerCount: summary.customers,
          actualRevenue: Object.values(summary.revenue).reduce((total, value) => total + value, 0),
          assignedTarget: 0,
          salesQuantity: 0,
          salesTransactionCount: 0,
          targetPacingPercentage: 0,
          pipelineValue: 0,
          leadConversionRate: 0,
          activeHeadcount: 0,
          channelPartnerCount: 0,
          configuredCapacityPerRep: 50,
          requiredHeadcount: 0,
          headcountGap: 0,
          isCapacityBottleneck: false,
          estimatedOpportunityLost: 0,
          whiteSpaceRecommendation: "MARKET_SUMMARY",
          capacityUtilization: 0,
          capacityStatus: "HEALTHY" as const,
        } satisfies GeographicRollupNode];
      });
      return [...hierarchyChildren, ...fallbackCountries];
  }, [currentNode, hierarchyChildren, countryPinsQuery.data?.items]);

  const mapNodes = useMemo(() => {
    if (!currentNode) return [];
    const nodes = currentNode._id === "global" || currentNode.type === "GLOBAL" ? childrenNodes : [currentNode, ...childrenNodes];
    return nodes.map((node) => {
      if (node.type !== "COUNTRY" || node.location?.coordinates?.length === 2) return node;
      const country = countryMaster.find((item) => item.name.common.toLowerCase() === node.name.toLowerCase());
      return country ? { ...node, location: { type: "Point" as const, coordinates: [country.latlng[1], country.latlng[0]] as [number, number] } } : node;
    });
  }, [currentNode, childrenNodes]);

  // Handle drilldown into a child node
  const handleDrillDown = (nodeId: string) => {
    if (nodeId.startsWith("market-")) return;
    setCurrentGeoId(nodeId);
    setSelectedNode(null);
  };

  // Handle navigating up to any ancestor in the breadcrumb
  const handleBreadcrumbClick = (geoId: string) => {
    setCurrentGeoId(geoId);
    setSelectedNode(null);
  };

  const formatCurrency = (val?: number) => "₹" + Math.round(val ?? 0).toLocaleString("en-IN");

  return (
    <main className="flex-1 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* Header with Title and Mode Switcher */}
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-medium text-teal-700">Sales geography</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Sales by location</h1>
            <p className="mt-1 text-sm text-slate-500">
              Explore leads, customers, revenue and sales quantity by location.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Tab Switcher */}
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/80">
              <button
                onClick={() => setActiveTab("map")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === "map"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Map
              </button>
              <button
                onClick={() => setActiveTab("table")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === "table"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Summary table
              </button>
            </div>

            {canManageGeo && (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="gap-1.5 text-xs bg-teal-700 hover:bg-teal-800 text-white"
              >
                <Plus size={15} />
                Add Geography
              </Button>
            )}
          </div>
        </div>

        {activeTab === "table" ? (
          <CountrySales />
        ) : (
          <div className="space-y-6">
            {/* 1. Interactive Breadcrumb Navigation Header */}
            <nav
              aria-label="Geographic Hierarchy Breadcrumb"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white px-5 py-3.5 shadow-2xs"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">
                  Scope:
                </span>

                {/* Global Root Breadcrumb */}
                <button
                  onClick={() => handleBreadcrumbClick("global")}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                    currentGeoId === "global"
                      ? "bg-teal-50 text-teal-800 font-bold border border-teal-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Globe2 size={14} className="text-teal-600" />
                  <span>Global</span>
                </button>

                {/* Ancestors Trail */}
                {ancestors
                  .filter((anc) => anc._id !== "global")
                  .map((anc) => (
                    <div key={anc._id} className="flex items-center gap-2">
                      <ChevronRight size={14} className="text-slate-300 shrink-0" />
                      <button
                        onClick={() => handleBreadcrumbClick(anc._id)}
                        className="rounded-lg px-2.5 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition font-medium"
                      >
                        {anc.name}
                      </button>
                    </div>
                  ))}

                {/* Current Drilled Node */}
                {currentNode && currentNode._id !== "global" && (
                  <div className="flex items-center gap-2">
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                    <span className="flex items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1 font-bold text-teal-900 border border-teal-200">
                      <span>{currentNode.name}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-700 bg-teal-100/80 px-1.5 py-0.2 rounded">
                        {currentNode.type}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Reset to Global Button */}
              {currentGeoId !== "global" && (
                <button
                  onClick={() => handleBreadcrumbClick("global")}
                  className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
                >
                  <RotateCcw size={13} />
                  Reset to Global View
                </button>
              )}
            </nav>

            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/80 bg-white p-4">
              <label className="text-xs font-semibold text-slate-600">Show level
                <select className="mt-1 block h-10 min-w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={hierarchyFilter} onChange={(event) => setHierarchyFilter(event.target.value as HierarchyFilter)}>
                  <option value="ALL">All levels</option><option value="COUNTRIES">Countries</option><option value="STATES">States</option><option value="DISTRICTS">Districts</option><option value="CITIES">Cities</option><option value="AREAS">Areas</option><option value="PINCODES">Pincodes</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Map layer
                <select className="mt-1 block h-10 min-w-44 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={heatmapMode} onChange={(event) => setHeatmapMode(event.target.value as typeof heatmapMode)}>
                  <option value="off">No heatmap</option><option value="leads">Lead density</option><option value="customers">Customer value</option><option value="revenue">Revenue</option><option value="quantity">Sales quantity</option>
                </select>
              </label>

                <button
                  onClick={() => setShowCoverageOverlay(!showCoverageOverlay)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    showCoverageOverlay
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Building2 size={14} className={showCoverageOverlay ? "text-blue-600" : "text-slate-400"} />
                  <span>Partner coverage</span>
                </button>
            </div>

            {/* 3. The Map Canvas */}
            {intelligenceQuery.isLoading ? (
              <Skeleton className="h-[520px] w-full rounded-2xl" />
            ) : intelligenceQuery.isError ? (
              <div className="space-y-4">
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                  <div><p className="font-semibold">Detailed geography is temporarily unavailable</p><p className="mt-1 text-sm">Country sales summary is available below.</p></div>
                  <Button variant="secondary" onClick={() => void intelligenceQuery.refetch()}>Try again</Button>
                </div>
                <CountrySales />
              </div>
            ) : (
              <GeoSalesMap
                nodes={mapNodes}
                locations={countryPinsQuery.data?.locations}
                heatmapPoints={heatmapQuery.data?.points}
                showHeatmap={heatmapMode !== "off"}
                heatmapType={heatmapMode === "off" ? "leads" : heatmapMode}
                showCoverageOverlay={showCoverageOverlay}
                selectedId={selectedNode?._id}
                onSelectNode={(node) => setSelectedNode(node)}
                onDrillDown={handleDrillDown}
                hierarchyFilter={hierarchyFilter}
              />
            )}

            {/* 4. Rollup Metrics Summary Cards for Selected Scope */}
            {currentNode && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft"><p className="text-xs font-medium text-slate-500">Sales Quantity</p><p className="mt-2 text-2xl font-bold text-slate-900">{currentNode.salesQuantity.toLocaleString("en-IN")}</p><p className="mt-1 text-xs text-slate-500">Across {currentNode.salesTransactionCount} transactions</p></div>
                {/* Revenue Achievement Card */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Revenue Target Pacing</span>
                    <TrendingUp size={15} className="text-teal-600" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {formatCurrency(currentNode.actualRevenue)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Target: {formatCurrency(currentNode.assignedTarget)} ·{" "}
                    <strong className="text-teal-700">{currentNode.targetPacingPercentage}% paced</strong>
                  </p>
                </div>

                {/* Lead Volume & Conversion */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Active Lead Load</span>
                    <Briefcase size={15} className="text-blue-600" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {currentNode.leadCount.toLocaleString("en-IN")} leads
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {currentNode.leadConversionRate}% win rate · {currentNode.customerCount} customers
                  </p>
                </div>

                {/* Capacity Bottleneck Status */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Sales Rep Bandwidth</span>
                    <Users size={15} className="text-indigo-600" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {currentNode.activeHeadcount} Rep{currentNode.activeHeadcount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-xs">
                    {currentNode.headcountGap > 0 ? (
                      <span className="font-semibold text-rose-600">
                        ⚠️ Deficit of {currentNode.headcountGap} rep{currentNode.headcountGap === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="font-medium text-emerald-600">
                        ✓ Optimal capacity utilization ({currentNode.capacityUtilization}%)
                      </span>
                    )}
                  </p>
                </div>

                {/* Opportunity Lost / White-Space */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Est. Opportunity Lost</span>
                    <AlertTriangle size={15} className="text-rose-600" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-rose-600">
                    {formatCurrency(currentNode.estimatedOpportunityLost)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {currentNode.channelPartnerCount} Channel Partner{currentNode.channelPartnerCount === 1 ? "" : "s"} active
                  </p>
                </div>
              </div>
            )}

            {/* 5. Child Regions & Territories Drilldown Section */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-soft space-y-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {currentNode?.name} Child Regions &amp; Operating Units
                  </h2>
                  <p className="text-xs text-slate-500">
                    {childrenNodes.length} direct descendant nodes under this geographic scope. Click &quot;Inspect&quot; to review the decision engine or &quot;Drill Down&quot; to zoom in.
                  </p>
                </div>
                <div className="text-xs font-semibold text-slate-500">
                  Total Revenue: <strong className="text-slate-900">{formatCurrency(currentNode?.actualRevenue)}</strong>
                </div>
              </div>

              {childrenNodes.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  No further child levels defined under this node. This territory is at the lowest registered operational level.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {childrenNodes.map((child) => {
                    const isBottleneck = child.isCapacityBottleneck || child.headcountGap > 0;
                    const isWhite = child.whiteSpaceRecommendation.includes("APPOINT_CHANNEL_PARTNER");

                    return (
                      <div
                        key={child._id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 hover:border-teal-600 hover:bg-white transition shadow-2xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-bold text-slate-900">{child.name}</h3>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                {child.type} · {child.code}
                              </span>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                isBottleneck
                                  ? "bg-rose-100 text-rose-800"
                                  : child.capacityStatus === "APPROACHING"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {child.capacityStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2 text-xs">
                            <div>
                              <p className="text-slate-400 text-[11px]">Won Revenue</p>
                              <p className="font-bold text-slate-900">{formatCurrency(child.actualRevenue)}</p>
                              <p className="text-[11px] text-slate-500">{child.salesQuantity} units · {child.salesTransactionCount} sales</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[11px]">Lead Load</p>
                              <p className="font-bold text-slate-900">{child.leadCount} leads</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[11px]">Sales Reps</p>
                              <p className="font-bold text-slate-900">{child.activeHeadcount} reps</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[11px]">Partners</p>
                              <p className="font-bold text-slate-900">{child.channelPartnerCount} active</p>
                            </div>
                          </div>

                          {isWhite && (
                            <div className="rounded-md bg-indigo-50 p-2 text-[11px] font-medium text-indigo-800">
                              ⚡ White-space opportunity: Zero rep / partner presence
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                          <button
                            onClick={() => setSelectedNode(child)}
                            className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                          >
                            <Eye size={13} />
                            <span>Inspect</span>
                          </button>
                          <Button
                            variant="secondary"
                            disabled={child._id.startsWith("market-")}
                            onClick={() => handleDrillDown(child._id)}
                            className="gap-1 text-xs"
                          >
                            <span>{child._id.startsWith("market-") ? "Market summary" : "Drill Down"}</span>
                            <ArrowRight size={13} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 6. Slide-Over Geographic Intelligence Panel */}
            <GeoIntelligencePanel
              node={selectedNode}
              ancestors={ancestors}
              onClose={() => setSelectedNode(null)}
              onDrillDown={handleDrillDown}
              canDrillDown={Boolean(selectedNode && !selectedNode._id.startsWith("market-") && childrenNodes.some((c) => c._id === selectedNode._id))}
            />
          </div>
        )}
      </div>

      {/* Create Geography Dialog */}
      {canManageGeo && (
        <GeographyCreateDialog
          open={createDialogOpen}
          nodes={geoTreeQuery.data?.items ?? []}
          pending={createGeoMutation.isPending}
          error={createGeoMutation.error?.message}
          onClose={() => setCreateDialogOpen(false)}
          onSubmit={(input) => createGeoMutation.mutate(input)}
        />
      )}
    </main>
  );
};
