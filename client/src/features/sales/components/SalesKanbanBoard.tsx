import { LeadOrigin } from "./LeadOrigin";
import { useState } from "react";
import {
  Building2,
  Clock,
  IndianRupee,
  MapPin,
  TrendingUp,
  AlertTriangle,
  Flame,
} from "lucide-react";
import type { SalesRecord } from "../salesApi";

interface SalesKanbanBoardProps {
  path: "pipeline" | "leads";
  items: SalesRecord[];
  canManage: boolean;
  onMoveStage: (itemId: string, newStageOrStatus: string) => void;
  onSelectRecord: (record: SalesRecord) => void;
}

interface ColumnDef {
  id: string;
  label: string;
  color: string;
  badgeBg: string;
  defaultProbability?: number;
}

const formatCurrency = (amount: number, curr = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: curr,
    maximumFractionDigits: 0,
  }).format(amount);

const getDaysInStage = (dateStr?: string) => {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
};

export const SalesKanbanBoard = ({
  path,
  items,
  canManage,
  onMoveStage,
  onSelectRecord,
}: SalesKanbanBoardProps) => {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const pipelineColumns: ColumnDef[] = [
    { id: "DISCOVERY", label: "Discovery", color: "border-t-blue-500", badgeBg: "bg-blue-50 text-blue-700", defaultProbability: 20 },
    { id: "QUALIFICATION", label: "Qualification", color: "border-t-indigo-500", badgeBg: "bg-indigo-50 text-indigo-700", defaultProbability: 40 },
    { id: "PROPOSAL", label: "Proposal", color: "border-t-amber-500", badgeBg: "bg-amber-50 text-amber-700", defaultProbability: 60 },
    { id: "NEGOTIATION", label: "Negotiation", color: "border-t-purple-500", badgeBg: "bg-purple-50 text-purple-700", defaultProbability: 80 },
    { id: "WON", label: "Closed Won", color: "border-t-emerald-500", badgeBg: "bg-emerald-50 text-emerald-700", defaultProbability: 100 },
    { id: "LOST", label: "Closed Lost", color: "border-t-rose-500", badgeBg: "bg-rose-50 text-rose-700", defaultProbability: 0 },
  ];

  const leadColumns: ColumnDef[] = [
    { id: "NEW", label: "New Leads", color: "border-t-blue-500", badgeBg: "bg-blue-50 text-blue-700" },
    { id: "CONTACTED", label: "Contacted", color: "border-t-cyan-500", badgeBg: "bg-cyan-50 text-cyan-700" },
    { id: "QUALIFIED", label: "Qualified", color: "border-t-amber-500", badgeBg: "bg-amber-50 text-amber-700" },
    { id: "CONVERTED", label: "Converted", color: "border-t-emerald-500", badgeBg: "bg-emerald-50 text-emerald-700" },
    { id: "LOST", label: "Lost", color: "border-t-rose-500", badgeBg: "bg-rose-50 text-rose-700" },
  ];

  const columns = path === "pipeline" ? pipelineColumns : leadColumns;

  const getItemColumn = (item: SalesRecord): string => {
    if (path === "pipeline") {
      if (item.status === "WON") return "WON";
      if (item.status === "LOST") return "LOST";
      return item.stage?.toUpperCase() || "DISCOVERY";
    }
    return item.status || "NEW";
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (!canManage) return;
    setDraggedItemId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const itemId = e.dataTransfer.getData("text/plain") || draggedItemId;
    if (itemId) {
      onMoveStage(itemId, columnId);
    }
    setDraggedItemId(null);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-6 pt-2 select-none">
      {columns.map((col) => {
        const columnItems = items.filter((it) => getItemColumn(it) === col.id);
        const totalValue = columnItems.reduce(
          (sum, it) => sum + (it.estimatedValue ?? it.amount ?? it.confirmedSaleAmount ?? 0),
          0
        );
        const weightedValue =
          path === "pipeline"
            ? columnItems.reduce(
                (sum, it) =>
                  sum +
                  ((it.estimatedValue ?? 0) * (it.probability ?? col.defaultProbability ?? 0)) / 100,
                0
              )
            : 0;

        const isDropTarget = dragOverColumn === col.id;

        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`flex w-80 shrink-0 flex-col rounded-2xl border bg-slate-100/70 p-3 transition-colors ${
              col.color
            } border-t-4 ${isDropTarget ? "bg-brand-50/70 ring-2 ring-brand-400" : ""}`}
          >
            {/* Column Header */}
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-800">{col.label}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${col.badgeBg}`}>
                    {columnItems.length}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-700">
                    {formatCurrency(totalValue)}
                  </span>
                  {path === "pipeline" && col.id !== "WON" && col.id !== "LOST" && (
                    <span className="text-slate-400 font-normal flex items-center gap-0.5">
                      <TrendingUp size={11} />
                      {formatCurrency(weightedValue)} wtd
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Card List */}
            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto min-h-[140px] max-h-[calc(100vh-280px)] pr-1">
              {columnItems.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400">
                  Drag items here
                </div>
              ) : (
                columnItems.map((item) => {
                  const val = item.estimatedValue ?? item.amount ?? item.confirmedSaleAmount ?? 0;
                  const daysInStage = getDaysInStage(item.createdAt);
                  const isStale = daysInStage >= 7 && col.id !== "WON" && col.id !== "LOST";
                  const isCritical = daysInStage >= 14 && col.id !== "WON" && col.id !== "LOST";

                  const ownerName =
                    item.ownerEmployee && typeof item.ownerEmployee === "object"
                      ? `${item.ownerEmployee.firstName} ${item.ownerEmployee.lastName}`
                      : undefined;

                  const customerName =
                    item.customer && typeof item.customer === "object"
                      ? item.customer.name
                      : item.companyName;

                  return (
                    <div
                      key={item._id}
                      draggable={canManage}
                      onDragStart={(e) => handleDragStart(e, item._id)}
                      onClick={() => onSelectRecord(item)}
                      className={`cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition hover:border-brand-400 hover:shadow-md ${
                        draggedItemId === item._id ? "opacity-40" : ""
                      }`}
                    >
                      {/* Top Badges: Days in stage & Status */}
                      <div className="flex items-center justify-between gap-1 mb-1.5 text-[11px]">
                        {isCritical ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">
                            <Flame size={11} /> {daysInStage}d stale
                          </span>
                        ) : isStale ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                            <AlertTriangle size={11} /> {daysInStage}d
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Clock size={11} /> {daysInStage}d
                          </span>
                        )}

                        {path === "pipeline" && item.probability !== undefined && (
                          <span className="font-semibold text-slate-500">
                            {item.probability}% win
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-semibold text-slate-900 line-clamp-1">
                        {item.name || item.companyName || "Untitled"}
                      </h4>

                      {/* Customer / Company */}
                      {customerName && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 line-clamp-1">
                          <Building2 size={12} className="text-slate-400 shrink-0" />
                          {customerName}
                        </p>
                      )}

                      {/* Location Market */}
                      {item.market && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 line-clamp-1">
                          <MapPin size={11} className="text-teal-600 shrink-0" />
                          {item.market}
                        </p>
                      )}

                      {path === "leads" && <p className="mt-3 text-xs text-slate-600">Sales employee: <span className="font-medium">{ownerName || "Unassigned"}</span>{typeof item.ownerEmployee === "object" && item.ownerEmployee?.employeeId && ` (${item.ownerEmployee.employeeId})`}</p>}

                      {path === "leads" && <p className="mt-1 text-xs text-slate-600">Lead brought by: <LeadOrigin record={item}/></p>}

                      {/* Value & Probability Bar */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-sm flex items-center">
                          <IndianRupee size={13} className="text-slate-500 mr-0.5" />
                          {formatCurrency(val, item.currency)}
                        </span>

                        {ownerName && (
                          <div
                            title={`Owner: ${ownerName}`}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700"
                          >
                            {ownerName
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                        )}
                      </div>

                      {/* Probability Progress Bar (Pipeline Only) */}
                      {path === "pipeline" && item.probability !== undefined && (
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all ${
                              item.status === "WON"
                                ? "bg-emerald-500"
                                : item.status === "LOST"
                                ? "bg-rose-500"
                                : "bg-brand-500"
                            }`}
                            style={{ width: `${item.probability}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
