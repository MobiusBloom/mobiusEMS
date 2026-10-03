import { LeadOrigin } from "./LeadOrigin";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  PhoneCall,
  FileText,
  Clock,
  ArrowRight,
  MapPin,
  CheckCircle2,
  Send,
  User,
  Building2,
  IndianRupee,
} from "lucide-react";
import { salesApi, type SalesActivityItem, type SalesRecord } from "../salesApi";
import { Button } from "@/components/ui/Button";

interface SalesActivityDrawerProps {
  record: SalesRecord | null;
  path: "leads" | "customers" | "pipeline";
  onClose: () => void;
  onUpdateStage?: (stage: string) => void;
  onUpdateStatus?: (status: string) => void;
}

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatCurrency = (amount?: number, curr = "INR") => {
  if (amount === undefined || amount === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: curr,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const SalesActivityDrawer = ({
  record,
  path,
  onClose,
  onUpdateStage,
  onUpdateStatus,
}: SalesActivityDrawerProps) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | "notes" | "calls">("all");
  const [noteType, setNoteType] = useState<"NOTE" | "CALL_LOG">("NOTE");
  const [content, setContent] = useState("");

  const recordId = record?._id ?? "";

  const activitiesQuery = useQuery({
    queryKey: ["sales", path, recordId, "activities"],
    queryFn: () => salesApi.activities(path, recordId),
    enabled: Boolean(recordId),
  });

  const addActivityMutation = useMutation({
    mutationFn: () =>
      salesApi.createActivity(path, recordId, {
        type: noteType,
        content: content.trim(),
      }),
    onSuccess: async () => {
      setContent("");
      await queryClient.invalidateQueries({
        queryKey: ["sales", path, recordId, "activities"],
      });
    },
  });

  if (!record) return null;

  const activities: SalesActivityItem[] = activitiesQuery.data?.items ?? [];
  const filteredActivities = activities.filter((act) => {
    if (activeTab === "notes") return act.type === "NOTE";
    if (activeTab === "calls") return act.type === "CALL_LOG";
    return true;
  });

  const title = record.name || record.companyName || "Sales Record";
  const company = record.companyName || (record.customer && typeof record.customer === "object" ? record.customer.name : undefined);
  const value = record.estimatedValue ?? record.amount ?? record.confirmedSaleAmount;
  const ownerName = record.ownerEmployee && typeof record.ownerEmployee === "object"
    ? `${record.ownerEmployee.firstName} ${record.ownerEmployee.lastName}`
    : typeof record.ownerEmployee === "string" ? record.ownerEmployee : undefined;

  const pipelineStages = [
    { value: "DISCOVERY", label: "Discovery" },
    { value: "QUALIFICATION", label: "Qualification" },
    { value: "PROPOSAL", label: "Proposal" },
    { value: "NEGOTIATION", label: "Negotiation" },
  ];

  const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-brand-700">
                {path === "pipeline" ? "Opportunity" : path === "leads" ? "Lead" : "Customer"}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  record.status === "WON" || record.status === "CONVERTED"
                    ? "bg-emerald-50 text-emerald-700"
                    : record.status === "LOST"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                {record.status ?? "OPEN"}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-bold text-slate-900">{title}</h2>
            {company && company !== title && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                <Building2 size={13} className="text-slate-400" />
                {company}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Quick Highlights Bar */}
        <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/75 px-6 py-3 text-xs">
          <div>
            <span className="text-slate-400">Deal Value</span>
            <p className="font-semibold text-slate-900 flex items-center gap-0.5">
              <IndianRupee size={12} className="text-slate-500" />
              {formatCurrency(value, record.currency)}
            </p>
          </div>
          <div>
            {path === "leads" && <div className="mb-3"><span className="text-slate-400">Lead brought by</span><p className="font-semibold text-slate-900"><LeadOrigin record={record}/></p></div>}
            <span className="text-slate-400">{path === "leads" ? "Sales employee" : "Owner"}</span>
            <p className="font-semibold text-slate-900 flex items-center gap-1">
              <User size={12} className="text-slate-400" />
              {ownerName || "Unassigned"}
              {typeof record.ownerEmployee === "object" && record.ownerEmployee?.employeeId && <span className="text-xs font-normal text-slate-500">({record.ownerEmployee.employeeId})</span>}
            </p>
          </div>
          <div>
            <span className="text-slate-400">Location</span>
            <p className="font-semibold text-slate-900 flex items-center gap-1 truncate" title={record.market || "None"}>
              <MapPin size={12} className="text-slate-400" />
              {record.market || "—"}
            </p>
          </div>
        </div>

        {/* Stage Progress Stepper */}
        {path === "pipeline" && onUpdateStage && (
          <div className="border-b border-slate-100 px-6 py-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pipeline Stage</span>
            <div className="mt-2 flex gap-1.5">
              {pipelineStages.map((stg) => {
                const isCurrent = record.stage?.toUpperCase() === stg.value;
                return (
                  <button
                    key={stg.value}
                    type="button"
                    onClick={() => onUpdateStage(stg.value)}
                    className={`flex-1 rounded-lg py-1.5 px-2 text-center text-xs font-medium transition ${
                      isCurrent
                        ? "bg-brand-600 text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {stg.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {path === "leads" && onUpdateStatus && (
          <div className="border-b border-slate-100 px-6 py-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lead Status</span>
            <div className="mt-2 flex gap-1.5">
              {leadStatuses.map((st) => {
                const isCurrent = record.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => onUpdateStatus(st)}
                    className={`flex-1 rounded-lg py-1.5 px-1 text-center text-xs font-medium transition ${
                      isCurrent
                        ? "bg-brand-600 text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Input box for new note or call */}
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => setNoteType("NOTE")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                noteType === "NOTE"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <FileText size={13} />
              Add Note
            </button>
            <button
              type="button"
              onClick={() => setNoteType("CALL_LOG")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                noteType === "CALL_LOG"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <PhoneCall size={13} />
              Log Call
            </button>
          </div>
          <div className="flex gap-2">
            <textarea
              rows={2}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                noteType === "NOTE"
                  ? "Write an internal note or meeting summary..."
                  : "Log call summary, client feedback, or next steps..."
              }
              className="flex-1 rounded-xl border border-slate-200 p-2.5 text-xs focus:border-brand-500 focus:outline-none"
            />
            <Button
              type="button"
              disabled={!content.trim() || addActivityMutation.isPending}
              onClick={() => addActivityMutation.mutate()}
              className="self-end px-3 py-2 text-xs"
            >
              <Send size={13} className="mr-1" />
              Post
            </Button>
          </div>
        </div>

        {/* Activity Timeline Navigation */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-2 bg-slate-50/50">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-2 py-1 font-medium rounded-md transition ${
                activeTab === "all" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              All Activity ({activities.length})
            </button>
            <button
              onClick={() => setActiveTab("notes")}
              className={`px-2 py-1 font-medium rounded-md transition ${
                activeTab === "notes" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Notes
            </button>
            <button
              onClick={() => setActiveTab("calls")}
              className={`px-2 py-1 font-medium rounded-md transition ${
                activeTab === "calls" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Calls
            </button>
          </div>
          <span className="text-[11px] text-slate-400">Chronological feed</span>
        </div>

        {/* Timeline Items List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {activitiesQuery.isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading activity timeline...</div>
          ) : filteredActivities.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              <Clock size={28} className="mx-auto mb-2 text-slate-300" />
              No activity logged yet. Add a note or call above!
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {filteredActivities.map((act) => {
                const isCall = act.type === "CALL_LOG";
                const isStage = act.type === "STAGE_CHANGE";
                const isLocation = act.type === "LOCATION_PIN";
                const isConversion = act.type === "CONVERSION";

                return (
                  <div key={act._id} className="relative group">
                    {/* Timeline Node Pin */}
                    <div
                      className={`absolute -left-6 top-0 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white ring-4 ring-white ${
                        isCall
                          ? "bg-amber-500"
                          : isStage
                          ? "bg-blue-500"
                          : isConversion
                          ? "bg-emerald-500"
                          : isLocation
                          ? "bg-teal-500"
                          : "bg-slate-700"
                      }`}
                    >
                      {isCall ? (
                        <PhoneCall size={9} />
                      ) : isStage ? (
                        <ArrowRight size={9} />
                      ) : isConversion ? (
                        <CheckCircle2 size={9} />
                      ) : isLocation ? (
                        <MapPin size={9} />
                      ) : (
                        <FileText size={9} />
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span className="font-semibold text-slate-700">
                          {act.performedByName || (act.performedBy ? `${act.performedBy.firstName || ""} ${act.performedBy.lastName || ""}`.trim() : "System")}
                        </span>
                        <span>{formatDateTime(act.createdAt)}</span>
                      </div>
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{act.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
