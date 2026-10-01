import { useEffect, useRef, useState } from "react";
import type { GeographicRollupNode, GeoNodeDto, HeatmapPointTuple } from "@mobius-ems/shared";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { salesMapTiles } from "./mapTiles";
import type { SalesLocationPin } from "../salesApi";
import { Flame } from "lucide-react";

interface GeoSalesMapProps {
  nodes: (GeographicRollupNode | (GeoNodeDto & Partial<GeographicRollupNode>))[];
  locations?: SalesLocationPin[];
  heatmapPoints?: HeatmapPointTuple[];
  showHeatmap?: boolean;
  heatmapType?: "leads" | "customers" | "revenue" | "quantity";
  showCoverageOverlay?: boolean;
  selectedId?: string;
  onSelectNode?: (node: GeographicRollupNode) => void;
  onSelect?: (id: string) => void;
  onDrillDown?: (id: string) => void;
  hierarchyFilter?: string;
  metricLabel?: string;
  metricValue?: string;
}

// Precise customer pin
const customerPin = L.divIcon({
  className: "custom-customer-pin",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;background:#059669;color:white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.25);"><div style="width:5px;height:5px;background:#ffffff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

// Precise lead pin
const leadPin = L.divIcon({
  className: "custom-lead-pin",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;background:#2563eb;color:white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.25);"><div style="width:5px;height:5px;background:#ffffff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

/**
 * High-performance HTML5 Canvas Density Heatmap Overlay
 * Renders smooth radial gradient hotspots in red/yellow/blue based on coordinate intensity
 */
const CanvasHeatmapOverlay = ({ points }: { points: HeatmapPointTuple[] }) => {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!points.length) return;
    const canvas = L.DomUtil.create("canvas", "leaflet-density-heatmap-canvas") as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "350";
    map.getPanes().overlayPane.appendChild(canvas);
    canvasRef.current = canvas;

    const render = () => {
      const size = map.getSize();
      const bounds = map.getBounds();
      const topLeft = map.latLngToLayerPoint(bounds.getNorthWest());
      L.DomUtil.setPosition(canvas, topLeft);

      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);

      for (const [lat, lng, intensity] of points) {
        if (!bounds.contains([lat, lng])) continue;
        const pt = map.latLngToContainerPoint([lat, lng]);
        const radius = Math.max(20, Math.min(50, 30 * Math.sqrt(intensity)));
        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
        const alpha = Math.min(0.85, Math.max(0.25, intensity));

        // Red center hotspot, fading to yellow, cyan, transparent
        grad.addColorStop(0, `rgba(239, 68, 68, ${alpha})`);
        grad.addColorStop(0.35, `rgba(245, 158, 11, ${alpha * 0.75})`);
        grad.addColorStop(0.7, `rgba(14, 165, 233, ${alpha * 0.4})`);
        grad.addColorStop(1, "rgba(14, 165, 233, 0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    map.on("moveend zoomend resize", render);
    render();

    return () => {
      map.off("moveend zoomend resize", render);
      canvas.remove();
    };
  }, [map, points]);

  return null;
};

/**
 * Pans/zooms when selectedId changes or on drilldown
 */
const MapPanToSelected = ({
  nodes,
  selectedId,
}: {
  nodes: (GeographicRollupNode | (GeoNodeDto & Partial<GeographicRollupNode>))[];
  selectedId?: string;
}) => {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const found = nodes.find((node) => node._id === selectedId);
    if (found?.location?.coordinates?.length === 2) {
      const [lng, lat] = found.location.coordinates;
      const targetZoom = (found.depth ?? 0) >= 3 ? 10 : (found.depth ?? 0) === 2 ? 7 : 5;
      map.flyTo([lat, lng], targetZoom, { duration: 1.2 });
    }
  }, [selectedId, nodes, map]);
  return null;
};

export const GeoSalesMap = ({
  nodes,
  locations = [],
  heatmapPoints = [],
  showHeatmap = false,
  heatmapType = "leads",
  showCoverageOverlay = true,
  selectedId,
  onSelectNode,
  onSelect,
  onDrillDown,
  hierarchyFilter = "ALL",
  metricLabel,
  metricValue,
}: GeoSalesMapProps) => {
  const [showLocationSummary, setShowLocationSummary] = useState(false);
  const handleSelect = (node: GeographicRollupNode) => {
    onSelectNode?.(node);
    onSelect?.(node._id);
  };

  const normalizedNodes: GeographicRollupNode[] = nodes.map((n) => ({
    _id: n._id,
    name: n.name,
    code: n.code,
    type: n.type,
    depth: n.depth ?? 0,
    parent: n.parent,
    ancestors: n.ancestors ?? [],
    location: n.location,
    assignedTarget: (n as GeographicRollupNode).assignedTarget ?? 0,
    actualRevenue: (n as GeographicRollupNode).actualRevenue ?? 0,
    salesQuantity: (n as GeographicRollupNode).salesQuantity ?? 0,
    salesTransactionCount: (n as GeographicRollupNode).salesTransactionCount ?? 0,
    targetPacingPercentage: (n as GeographicRollupNode).targetPacingPercentage ?? 0,
    pipelineValue: (n as GeographicRollupNode).pipelineValue ?? 0,
    leadCount: (n as GeographicRollupNode).leadCount ?? 0,
    leadConversionRate: (n as GeographicRollupNode).leadConversionRate ?? 0,
    customerCount: (n as GeographicRollupNode).customerCount ?? 0,
    activeHeadcount: (n as GeographicRollupNode).activeHeadcount ?? 0,
    channelPartnerCount: (n as GeographicRollupNode).channelPartnerCount ?? 0,
    configuredCapacityPerRep: (n as GeographicRollupNode).configuredCapacityPerRep ?? 50,
    requiredHeadcount: (n as GeographicRollupNode).requiredHeadcount ?? 0,
    headcountGap: (n as GeographicRollupNode).headcountGap ?? 0,
    isCapacityBottleneck: (n as GeographicRollupNode).isCapacityBottleneck ?? false,
    estimatedOpportunityLost: (n as GeographicRollupNode).estimatedOpportunityLost ?? 0,
    whiteSpaceRecommendation: (n as GeographicRollupNode).whiteSpaceRecommendation ?? "OPTIMAL_COVERAGE: MAINTAIN_OPERATION",
    capacityUtilization: (n as GeographicRollupNode).capacityUtilization ?? 0,
    capacityStatus: (n as GeographicRollupNode).capacityStatus ?? "HEALTHY",
    managerName: (n as GeographicRollupNode).managerName,
  }));

  // Filter nodes based on hierarchy pill
  const filteredNodes = normalizedNodes.filter((n) => {
    if (n.type === "GLOBAL") return false;
    if (hierarchyFilter === "ALL") return true;
    if (hierarchyFilter === "COUNTRIES" && n.type === "COUNTRY") return true;
    if (hierarchyFilter === "STATES" && n.type === "STATE") return true;
    if (hierarchyFilter === "DISTRICTS" && n.type === "DISTRICT") return true;
    if (hierarchyFilter === "CITIES" && n.type === "CITY") return true;
    if (hierarchyFilter === "AREAS" && n.type === "AREA") return true;
    if (hierarchyFilter === "PINCODES" && n.type === "PINCODE") return true;
    return false;
  });

  const locatedNodes = filteredNodes.filter((n) => n.location?.coordinates?.length === 2);

  if (showLocationSummary || !locatedNodes.length) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">Sales location summary</h2><p className="text-sm text-slate-500" role="status">View location data even when the map is unavailable.</p></div>
          <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-teal-700" onClick={() => setShowLocationSummary(false)}>Try map again</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredNodes.map((node) => (
            <button type="button" key={node._id} onClick={() => handleSelect(node)} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600">
              <p className="font-semibold text-slate-900">{node.name}</p><p className="text-xs text-slate-500">{node.type} · {node.code}</p>
              <p className="mt-3 text-sm text-slate-700">{node.leadCount} leads · {node.customerCount} customers</p>
              <p className="mt-1 text-sm font-semibold text-teal-700">₹{node.actualRevenue.toLocaleString("en-IN")} revenue</p>
            </button>
          ))}
        </div>
        {!filteredNodes.length && <p className="py-6 text-sm text-slate-500">No locations at this level. Choose All levels to explore this scope.</p>}
      </section>
    );
  }

  return (
    <div className="relative isolate z-0 h-[520px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-soft">
      <button type="button" onClick={() => setShowLocationSummary(true)} className="absolute right-3 top-3 z-[1000] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-teal-700 shadow-sm">Location summary</button>
      <MapContainer
        center={[21.5, 78.5]}
        zoom={4}
        className="h-full w-full"
        scrollWheelZoom
      >
        <TileLayer {...salesMapTiles} eventHandlers={{ tileerror: () => setShowLocationSummary(true) }} />
        <MapPanToSelected nodes={nodes} selectedId={selectedId} />

        {/* 1. Canvas Density Heatmap Layer */}
        {showHeatmap && heatmapPoints.length > 0 && (
          <CanvasHeatmapOverlay points={heatmapPoints} />
        )}

        {/* 2. Channel Partner 25km Coverage Zones */}
        {showCoverageOverlay && (
          <>
            {locatedNodes
              .filter((n) => n.channelPartnerCount > 0)
              .map((n) => {
                const [lng, lat] = n.location!.coordinates;
                return (
                  <Circle
                    key={`coverage-${n._id}`}
                    center={[lat, lng]}
                    radius={25000} // 25km radius in meters
                    pathOptions={{
                      color: "#3b82f6",
                      fillColor: "#60a5fa",
                      fillOpacity: 0.12,
                      weight: 1.5,
                      dashArray: "4, 6",
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1">
                        <span className="font-bold text-blue-900">Channel Partner Coverage Zone</span>
                        <p className="text-slate-600">Region: {n.name}</p>
                        <p className="text-slate-500">Radius: 25 km active dealer radius</p>
                        <p className="text-blue-700 font-semibold">{n.channelPartnerCount} Partner(s) Operating</p>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}
          </>
        )}

        {/* 3. White-Space Warning Zones (leads with 0 reps & 0 partners) */}
        {showCoverageOverlay && (
          <>
            {locatedNodes
              .filter(
                (n) =>
                  n.whiteSpaceRecommendation.includes("APPOINT_CHANNEL_PARTNER") ||
                  (n.leadCount > 0 && n.activeHeadcount === 0 && n.channelPartnerCount === 0)
              )
              .map((n) => {
                const [lng, lat] = n.location!.coordinates;
                return (
                  <CircleMarker
                    key={`whitespace-${n._id}`}
                    center={[lat, lng]}
                    radius={26}
                    pathOptions={{
                      color: "#e11d48",
                      fillColor: "#fb7185",
                      fillOpacity: 0.18,
                      weight: 2,
                      dashArray: "3, 5",
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1">
                        <span className="font-bold text-rose-700">⚠️ White-Space Opportunity Zone</span>
                        <p className="text-slate-700 font-medium">{n.name} ({n.type})</p>
                        <p className="text-slate-600">{n.leadCount} active leads with ZERO sales reps or partners.</p>
                        <p className="text-rose-600 font-semibold">Lost opportunity: ₹{Math.round(n.estimatedOpportunityLost).toLocaleString("en-IN")}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
          </>
        )}

        {/* 4. Geography Node Centroids with Capacity Gap Visual Badges */}
        {locatedNodes.map((node) => {
          const [lng, lat] = node.location!.coordinates;
          const isSelected = node._id === selectedId;

          // Dynamic Capacity Colors:
          // 🟢 Green: Healthy capacity (utilization <= 80%)
          // 🟡 Yellow: Approaching capacity (utilization > 80% & <= 100%)
          // 🔴 Red: Critical capacity bottleneck (understaffed, headcountGap > 0)
          let strokeColor = "#10b981"; // green
          let fillColor = "#34d399";
          if (node.capacityStatus === "CRITICAL" || node.headcountGap > 0) {
            strokeColor = "#dc2626"; // red
            fillColor = "#ef4444";
          } else if (node.capacityStatus === "APPROACHING" || node.capacityUtilization > 80) {
            strokeColor = "#d97706"; // yellow/amber
            fillColor = "#f59e0b";
          }

          const radius = isSelected ? 16 : node.type === "COUNTRY" ? 14 : node.type === "STATE" ? 11 : 9;

          return (
            <CircleMarker
              key={`node-${node._id}`}
              center={[lat, lng]}
              radius={radius}
              pathOptions={{
                color: isSelected ? "#0f172a" : strokeColor,
                fillColor: fillColor,
                fillOpacity: isSelected ? 0.9 : 0.75,
                weight: isSelected ? 3.5 : 2,
              }}
              eventHandlers={{
                click: () => handleSelect(node),
                dblclick: () => onDrillDown?.(node._id),
              }}
            >
              <Popup>
                <div className="min-w-[190px] space-y-1.5 text-xs">
                  <div className="flex items-center justify-between border-b pb-1">
                    <span className="font-bold text-slate-900">{node.name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                      {node.type}
                    </span>
                  </div>

                  <div className="space-y-0.5 text-slate-600">
                    <p className="flex justify-between">
                      <span>Leads:</span>
                      <strong className="text-slate-900">{node.leadCount}</strong>
                    </p>
                    <p className="flex justify-between">
                      <span>Active Reps:</span>
                      <strong className="text-slate-900">{node.activeHeadcount}</strong>
                    </p>
                    <p className="flex justify-between">
                      <span>Won Revenue:</span>
                      <strong className="text-emerald-700">₹{Math.round(node.actualRevenue).toLocaleString("en-IN")}</strong>
                    </p>
                    <p className="flex justify-between"><span>Sales Quantity:</span><strong>{node.salesQuantity.toLocaleString("en-IN")} units</strong></p>
                    <p className="flex justify-between"><span>Transactions:</span><strong>{node.salesTransactionCount}</strong></p>
                    <p className="flex justify-between">
                      <span>Capacity:</span>
                      <strong className={node.headcountGap > 0 ? "text-rose-600" : "text-emerald-600"}>
                        {node.capacityStatus} {node.headcountGap > 0 ? `(${node.headcountGap} gap)` : ""}
                      </strong>
                    </p>
                    {metricLabel && metricValue && (
                      <p className="flex justify-between">
                        <span>{metricLabel}:</span>
                        <strong className="text-teal-700">{metricValue}</strong>
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t flex flex-col gap-1">
                    <button
                      onClick={() => handleSelect(node)}
                      className="w-full rounded-md bg-slate-900 py-1 px-2 text-center text-[11px] font-medium text-white hover:bg-slate-800 transition"
                    >
                      View Intelligence
                    </button>
                    {onDrillDown && node.type !== "PINCODE" && !node._id.startsWith("market-") && (
                      <button
                        onClick={() => onDrillDown!(node._id)}
                        className="w-full rounded-md border border-slate-200 bg-white py-1 px-2 text-center text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition"
                      >
                        Drill Down ➔
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* 5. Precise Lead & Customer Pins */}
        {locations.map((loc) => {
          const [lng, lat] = loc.coordinates;
          const isCustomer = loc.entity === "customer";
          return (
            <Marker
              key={`${loc.entity}-${loc._id}`}
              position={[lat, lng]}
              icon={isCustomer ? customerPin : leadPin}
            >
              <Popup>
                <div className="min-w-[170px] space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2 border-b pb-1">
                    <span className="font-semibold text-slate-900">{loc.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        isCustomer ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {isCustomer ? "Customer" : "Lead"}
                    </span>
                  </div>
                  {loc.companyName && (
                    <div className="text-slate-600">
                      Company: <span className="font-medium text-slate-800">{loc.companyName}</span>
                    </div>
                  )}
                  <div className="text-slate-500">
                    Location: <span className="font-medium text-slate-700">{loc.state ? `${loc.state}, ` : ""}{loc.country}</span>
                  </div>
                  {Boolean(loc.value) && (
                    <div className="border-t pt-1 font-semibold text-emerald-700">
                      Value: {loc.currency ?? "INR"} {Math.round(loc.value ?? 0).toLocaleString("en-IN")}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Map Legend Overlay */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2 text-[11px] font-medium shadow-md backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-slate-700">Healthy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-slate-700">&gt;80% Cap</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-600" />
            <span className="text-slate-700">Bottleneck</span>
          </div>
          {showCoverageOverlay && (
            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-blue-500 bg-blue-100" />
              <span className="text-blue-700">25km Partner</span>
            </div>
          )}
          {showHeatmap && (
            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
              <Flame size={12} className="text-rose-500" />
              <span className="text-slate-700">Heatmap ({heatmapType})</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
