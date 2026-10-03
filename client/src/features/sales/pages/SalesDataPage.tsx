import countryMaster from "world-countries";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionName } from "@mobius-ems/shared";
import { Database, Plus, Kanban, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { salesApi, type SalesRecord } from "../salesApi";
import { getStatesForCountry, getStateCoordinates } from "../data/stateData";
import { LocationPickerMap } from "../components/LocationPickerMap";
import { LeadOrigin } from "../components/LeadOrigin";
import { SalesKanbanBoard } from "../components/SalesKanbanBoard";
import { SalesActivityDrawer } from "../components/SalesActivityDrawer";

type SalesDataPath = "leads" | "customers" | "pipeline" | "targets" | "revenue" | "channel-partners";
type Column = { label: string; align?: "right"; render: (item: SalesRecord) => ReactNode };
type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "LOST";
type OpportunityStatus = "OPEN" | "WON" | "LOST";

const managePermissions: Record<SalesDataPath, PermissionName[]> = {
  leads: ["sales.lead.manage.self", "sales.lead.manage.team", "sales.lead.manage.all"],
  customers: ["sales.customer.manage.self", "sales.customer.manage.team", "sales.customer.manage.all", "sales.configuration.manage"],
  pipeline: ["sales.pipeline.manage"],
  targets: ["sales.target.manage"],
  revenue: ["sales.revenue.manage"],
  "channel-partners": ["sales.channel_partner.manage", "sales.channel_partner.manage.self"],
};

const sectionMeta: Record<SalesDataPath, { purpose: string; next: string; hr: string; empty: string }> = {
  leads: {
    purpose: "Capture a potential buyer and move it through first contact, qualification and conversion.",
    next: "When a lead is converted, its customer account is created automatically.",
    hr: "Review lead ownership, response discipline and conversion health without changing sales records.",
    empty: "No leads have been captured in your scope.",
  },
  customers: {
    purpose: "Keep confirmed buyers in one account list. Customers can come from converted leads or direct sales.",
    next: "Create an opportunity for the customer when a real deal is being discussed.",
    hr: "Review account ownership and customer coverage; commercial records remain Sales-controlled.",
    empty: "No customers are available in your scope.",
  },
  pipeline: {
    purpose: "Track real deals for customers, including stage, expected value, close date and win probability.",
    next: "Marking a deal WON automatically records revenue and updates the customer's lifetime revenue.",
    hr: "Use pipeline and win/loss patterns for capacity and performance conversations, not payroll decisions alone.",
    empty: "No opportunities are currently in your pipeline.",
  },
  targets: {
    purpose: "Show approved monthly, quarterly or yearly goals for an employee or territory.",
    next: "Sales employees view their goal; authorized leadership owns target creation and closure.",
    hr: "Compare target load and attainment for workforce planning while keeping targets read-only.",
    empty: "No targets have been assigned in your scope.",
  },
  revenue: {
    purpose: "Show realized sales value. Won opportunities generate these records automatically.",
    next: "Authorized administrators can also enter an exceptional manual transaction with a customer reference.",
    hr: "Use revenue as one business outcome alongside role, opportunity and capacity context.",
    empty: "No revenue transactions are available in your scope.",
  },
  "channel-partners": {
    purpose: "Register a distributor, dealer, reseller or service partner that helps generate or deliver sales.",
    next: "Attach partner-assisted revenue to the partner so contribution remains traceable.",
    hr: "Review who owns each partner relationship and where additional partner capacity is needed.",
    empty: "No channel partners are available in your scope.",
  },
};

const leadTransitions: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "CONVERTED", "LOST"],
  CONTACTED: ["QUALIFIED", "CONVERTED", "LOST"],
  QUALIFIED: ["CONVERTED", "LOST"],
  CONVERTED: [],
  LOST: [],
};
const opportunityTransitions: Record<OpportunityStatus, OpportunityStatus[]> = { OPEN: ["WON", "LOST"], WON: [], LOST: [] };
const targetTransitions: Record<string, string[]> = { DRAFT: ["ACTIVE"], ACTIVE: ["CLOSED"], CLOSED: [] };
const pipelineStages = [
  { value: "DISCOVERY", label: "Discovery", probability: 20 },
  { value: "QUALIFICATION", label: "Qualification", probability: 40 },
  { value: "PROPOSAL", label: "Proposal", probability: 60 },
  { value: "NEGOTIATION", label: "Negotiation", probability: 80 },
] as const;

const idOf = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_id" in value) return String((value as { _id: unknown })._id);
  return "";
};
const labelOf = (value: unknown) => {
  if (!value) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const item = value as { firstName?: string; lastName?: string; name?: string; code?: string };
    return item.name ?? ([item.firstName, item.lastName].filter(Boolean).join(" ") || item.code || "—");
  }
  return String(value);
};
const money = (currency = "INR", value?: number) => `${currency} ${(value ?? 0).toLocaleString("en-IN")}`;
const date = (value?: string) => value ? new Date(value).toLocaleDateString("en-IN") : "—";
const countryOptions = countryMaster.map((country) => country.name.common).sort();
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10); };
const initialForm = () => ({
  name: "", companyName: "", contactName: "", email: "", phone: "", notes: "", market: "", country: "", state: "", code: "", employee: "", territory: "", geoNode: "", customer: "", channelPartner: "",
  value: "0", quantity: "1", probability: "20", source: "REFERRAL", date: today(), endDate: monthEnd(),
  stage: "DISCOVERY", type: "OTHER", customerType: "BUSINESS", reference: "",
  leadTarget: "0", conversionTarget: "0", periodType: "MONTHLY", targetScope: "EMPLOYEE", currency: "INR", justification: "",
  commissionRate: "5", bonusRate: "2",
  ruleType: "FLAT_COMMISSION", maxPayout: "10000", floorPercentage: "", capAmount: "", acceleratorMultiplier: "1.5",
  slabs: [
    { fromPercentage: "0", toPercentage: "50", rate: "2" },
    { fromPercentage: "50", toPercentage: "80", rate: "5" },
    { fromPercentage: "80", toPercentage: "100", rate: "8" },
    { fromPercentage: "100", toPercentage: "", rate: "12" },
  ],
  latitude: undefined as number | undefined,
  longitude: undefined as number | undefined,
});

const StatusControl = ({ item, path, nextStatuses, reasonRequired = false }: {
  item: SalesRecord;
  path: SalesDataPath;
  nextStatuses: string[];
  reasonRequired?: boolean;
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [candidate, setCandidate] = useState("");
  const [reason, setReason] = useState("");
  const [saleAmount, setSaleAmount] = useState(String(item.estimatedValue ?? 0));
  const canUpdate = managePermissions[path].some((permission) => user?.permissions.includes(permission));
  const update = useMutation({
    mutationFn: () => salesApi.updateRecord(path, item._id, {
      status: candidate,
      ...(path === "leads" && candidate === "CONVERTED" ? { saleAmount: Number(saleAmount) } : {}),
      ...(candidate === "LOST" ? { lostReason: reason.trim() } : {}),
    }),
    onSuccess: async () => {
      setCandidate("");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["target-performance"] });
      await queryClient.invalidateQueries({ queryKey: ["sales", "analytics"] });
    },
  });
  if (!canUpdate || nextStatuses.length === 0) return <div><span className="font-semibold">{item.status}</span>{item.lostReason && <p className="mt-1 max-w-52 whitespace-normal text-xs text-slate-400">{item.lostReason}</p>}</div>;
  return <div className="min-w-40">
    <select aria-label={`Update ${item.name ?? "record"} status`} disabled={update.isPending} className="h-9 rounded-lg border bg-white px-2 text-xs font-semibold" value={candidate || item.status} onChange={(event) => setCandidate(event.target.value)}>
      <option value={item.status}>{item.status}</option>
      {nextStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
    </select>
    {candidate && <div className="mt-2 space-y-2 whitespace-normal">
      {path === "leads" && candidate === "CONVERTED" && <label>Confirmed sale amount ({item.currency})<Input type="number" min="0" step="0.01" value={saleAmount} onChange={(event) => setSaleAmount(event.target.value)}/><span className="text-xs">Confirm the final sale value. This amount will be recorded as revenue.</span></label>}
      {candidate === "LOST" && <Input aria-label="Lost reason" required={reasonRequired} placeholder="Reason for loss" className="h-9 text-xs" value={reason} onChange={(event) => setReason(event.target.value)}/>}
      <div className="flex gap-1">
        <Button type="button" className="h-8 px-2 text-xs" disabled={update.isPending || (candidate === "CONVERTED" && (!saleAmount || !Number.isFinite(Number(saleAmount)) || Number(saleAmount) < 0)) || (candidate === "LOST" && reasonRequired && !reason.trim())} onClick={() => update.mutate()}>Confirm</Button>
        <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setCandidate(""); setReason(""); }}>Cancel</Button>
      </div>
    </div>}
    {update.error && <p className="mt-1 max-w-52 whitespace-normal text-xs text-red-600">{update.error.message}</p>}
  </div>;
};

const PipelineStageControl = ({ item }: { item: SalesRecord }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canUpdate = user?.permissions.includes("sales.pipeline.manage") && item.status === "OPEN";
  const current = pipelineStages.find((stage) => stage.value === item.stage?.toUpperCase());
  const update = useMutation({
    mutationFn: (stageValue: string) => {
      const stage = pipelineStages.find((candidate) => candidate.value === stageValue)!;
      return salesApi.updateRecord("pipeline", item._id, { stage: stage.value, probability: stage.probability });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["target-performance"] });
      await queryClient.invalidateQueries({ queryKey: ["sales", "analytics"] });
    },
  });
  if (!canUpdate) return item.stage?.replaceAll("_", " ") ?? "—";
  return <div><select aria-label={`Update ${item.name ?? "opportunity"} stage`} disabled={update.isPending} className="h-9 rounded-lg border bg-white px-2 text-xs" value={current?.value ?? item.stage} onChange={(event) => update.mutate(event.target.value)}>{!current && item.stage && <option value={item.stage}>{item.stage}</option>}{pipelineStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label} · {stage.probability}%</option>)}</select>{update.error && <p className="mt-1 max-w-52 whitespace-normal text-xs text-red-600">{update.error.message}</p>}</div>;
};

const columnsFor = (path: SalesDataPath, onSelectRecord?: (item: SalesRecord) => void): Column[] => {
  if (path === "leads") return [
    {
      label: "Lead",
      render: (item) => (
        <button
          type="button"
          onClick={() => onSelectRecord?.(item)}
          className="text-left group cursor-pointer"
        >
          <p className="font-semibold text-brand-700 group-hover:underline">{item.name ?? "—"}</p>
          {item.companyName && <p className="mt-1 text-xs font-normal text-slate-400">{item.companyName}</p>}
        </button>
      ),
    },
    { label: "Status / action", render: (item) => <StatusControl item={item} path="leads" nextStatuses={leadTransitions[(item.status ?? "NEW") as LeadStatus] ?? []} reasonRequired/> },
    { label: "Customer", render: (item) => item.customer ? labelOf(item.customer) : "—" },
    { label: "Contact", render: (item) => <div><p>{item.phone ?? "—"}</p>{item.email && <p className="mt-1 text-xs text-slate-400">{item.email}</p>}</div> },
    { label: "Lead brought by", render: (item) => <LeadOrigin record={item}/> },
    { label: "Source", render: (item) => item.source ?? "—" },
    { label: "Country / market", render: (item) => item.market ?? "—" },
    { label: "Sales employee", render: (item) => <div><p>{labelOf(item.ownerEmployee)}</p>{typeof item.ownerEmployee === "object" && item.ownerEmployee?.employeeId && <p className="mt-1 text-xs text-slate-400">{item.ownerEmployee.employeeId}</p>}</div> },
    { label: "Territory", render: (item) => labelOf(item.territory) },
    { label: "Estimated value", align: "right", render: (item) => money(item.currency, item.estimatedValue) },
  ];
  if (path === "customers") return [
    {
      label: "Customer",
      render: (item) => (
        <button
          type="button"
          onClick={() => onSelectRecord?.(item)}
          className="text-left group cursor-pointer"
        >
          <p className="font-semibold text-brand-700 group-hover:underline">{item.name ?? "—"}</p>
          {item.primaryContactName && <p className="mt-1 text-xs font-normal text-slate-400">Contact: {item.primaryContactName}</p>}
        </button>
      ),
    },
    { label: "Contact", render: (item) => <div><p>{item.phone ?? "—"}</p>{item.email && <p className="mt-1 text-xs text-slate-400">{item.email}</p>}</div> },
    { label: "Status / action", render: (item) => <StatusControl item={item} path="customers" nextStatuses={[item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"]}/> },
    { label: "Origin", render: (item) => item.sourceLead ? "Converted lead" : "Direct customer" },
    { label: "Country / market", render: (item) => item.market ?? "—" },
    { label: "Owner", render: (item) => labelOf(item.ownerEmployee) },
    { label: "Territory", render: (item) => labelOf(item.territory) },
    { label: "Lifetime revenue", align: "right", render: (item) => money(item.currency, item.lifetimeRevenue) },
  ];
  if (path === "pipeline") return [
    {
      label: "Opportunity",
      render: (item) => (
        <button
          type="button"
          onClick={() => onSelectRecord?.(item)}
          className="text-left group cursor-pointer"
        >
          <p className="font-semibold text-brand-700 group-hover:underline">{item.name ?? "—"}</p>
        </button>
      ),
    },
    { label: "Status / action", render: (item) => <StatusControl item={item} path="pipeline" nextStatuses={opportunityTransitions[(item.status ?? "OPEN") as OpportunityStatus] ?? []} reasonRequired/> },
    { label: "Customer", render: (item) => labelOf(item.customer) },
    { label: "Stage / action", render: (item) => <PipelineStageControl item={item}/> },
    { label: "Probability", render: (item) => `${item.probability ?? 0}%` },
    { label: "Expected close", render: (item) => date(item.expectedCloseDate) },
    { label: "Value", align: "right", render: (item) => money(item.currency, item.estimatedValue) },
  ];
  if (path === "targets") return [
    { label: "Period", render: (item) => `${date(item.periodStart)} – ${date(item.periodEnd)}` },
    { label: "Status / action", render: (item) => <StatusControl item={item} path="targets" nextStatuses={targetTransitions[item.status ?? "ACTIVE"] ?? []}/> },
    { label: "Version", render: (item) => <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">v{item.version ?? 1}</span> },
    { label: "Employee", render: (item) => labelOf(item.employee) },
    { label: "Territory", render: (item) => labelOf(item.territory) },
    { label: "Lead target", align: "right", render: (item) => (item.leadTarget ?? 0).toLocaleString("en-IN") },
    {
      label: "Revenue Target & Progress",
      align: "right",
      render: (item) => {
        const achieved = item.achievedAmount ?? 0;
        const remaining = item.remainingAmount ?? item.revenueTarget ?? 0;
        const pct = item.achievementPercentage ?? 0;
        return (
          <div className="text-right">
            <div className="font-semibold text-slate-900">{money(item.currency, item.revenueTarget)}</div>
            <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-slate-500">
              <span>Achieved:</span>
              <span className="font-semibold text-emerald-600">{money(item.currency, achieved)} ({pct}%)</span>
            </div>
            <div className="flex items-center justify-end gap-1.5 text-xs text-slate-500">
              <span>Remaining:</span>
              <span className="font-medium text-amber-600">{money(item.currency, remaining)}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full min-w-[110px] overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {item.justification && (
              <div className="mt-1 max-w-xs whitespace-normal text-left text-xs font-normal text-slate-400" title={item.justification}>
                Basis: {item.justification}
              </div>
            )}
          </div>
        );
      },
    },
  ];
  if (path === "revenue") return [
    { label: "Date", render: (item) => date(item.transactionDate) },
    { label: "Customer", render: (item) => labelOf(item.customer) },
    { label: "Source", render: (item) => item.source?.replaceAll("_", " ") ?? "—" },
    { label: "Reference", render: (item) => item.reference ?? "—" },
    { label: "Employee", render: (item) => labelOf(item.employee) },
    { label: "Territory", render: (item) => labelOf(item.territory) },
    { label: "Quantity", align: "right", render: (item) => (item.quantity ?? 1).toLocaleString("en-IN") },
    { label: "Amount", align: "right", render: (item) => money(item.currency, item.amount) },
  ];
  return [
    { label: "Partner", render: (item) => item.name ?? "—" },
    { label: "Code", render: (item) => item.code ?? "—" },
    { label: "Type", render: (item) => item.type?.replaceAll("_", " ") ?? "—" },
    { label: "Contact", render: (item) => <div><p>{item.contactName ?? "—"}</p>{item.phone && <p className="mt-1 text-xs text-slate-400">{item.phone}</p>}{item.email && <p className="text-xs text-slate-400">{item.email}</p>}</div> },
    { label: "Country / market", render: (item) => item.market ?? "—" },
    { label: "Status / action", render: (item) => <StatusControl item={item} path="channel-partners" nextStatuses={[item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"]}/> },
    { label: "Owner", render: (item) => labelOf(item.ownerEmployee) },
    { label: "Territory", render: (item) => labelOf(item.territory) },
  ];
};

export const SalesDataPage = ({ path, title }: { path: SalesDataPath; title: string }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [leadEmployeeFilter, setLeadEmployeeFilter] = useState("");
  const [form, setForm] = useState(initialForm);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [selectedRecordForDrawer, setSelectedRecordForDrawer] = useState<SalesRecord | null>(null);
  const canManage = managePermissions[path].some((permission) => user?.permissions.includes(permission));
  const hasTeamScope = Boolean(user?.permissions.includes("sales.view.team") || user?.permissions.includes("sales.view.all"));
  const isHrView = user?.role === "HR_ADMIN";
  const query = useQuery({ queryKey: ["sales", path], queryFn: () => salesApi.records(path) });
  const employees = useQuery({ queryKey: ["sales", "employees", "form"], queryFn: salesApi.employees, enabled: open && hasTeamScope });
  const territories = useQuery({ queryKey: ["sales", "territories", "form"], queryFn: salesApi.territories, enabled: open && hasTeamScope });
  const geographies = useQuery({ queryKey: ["sales", "geography", "form"], queryFn: salesApi.geography, enabled: open && path !== "targets" });
  const customers = useQuery({ queryKey: ["sales", "customers", "form"], queryFn: () => salesApi.records("customers"), enabled: open && ["pipeline", "revenue"].includes(path) });
  const partners = useQuery({ queryKey: ["sales", "channel-partners", "form"], queryFn: () => salesApi.records("channel-partners"), enabled: open && path === "revenue" });
  const columns = columnsFor(path, (record) => setSelectedRecordForDrawer(record));

  const leadOwners = [...new Map((query.data?.items ?? []).filter((item) => idOf(item.ownerEmployee)).map((item) => [idOf(item.ownerEmployee), item.ownerEmployee])).entries()].sort((a, b) => labelOf(a[1]).localeCompare(labelOf(b[1])));
  const visibleItems = (query.data?.items ?? []).filter((item) => path !== "leads" || !leadEmployeeFilter || idOf(item.ownerEmployee) === leadEmployeeFilter);

  const moveMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) => {
      if (path === "pipeline") {
        if (target === "WON") {
          return salesApi.updateRecord("pipeline", id, { status: "WON" });
        }
        if (target === "LOST") {
          return salesApi.updateRecord("pipeline", id, { status: "LOST", lostReason: "Closed Lost" });
        }
        const stg = pipelineStages.find((s) => s.value === target);
        return salesApi.updateRecord("pipeline", id, {
          stage: target,
          probability: stg?.probability ?? 50,
          status: "OPEN",
        });
      }
      if (path === "leads") {
        if (target === "CONVERTED") {
          const item = query.data?.items.find((it) => it._id === id);
          return salesApi.updateRecord("leads", id, {
            status: "CONVERTED",
            saleAmount: item?.estimatedValue ?? 0,
          });
        }
        if (target === "LOST") {
          return salesApi.updateRecord("leads", id, { status: "LOST", lostReason: "Closed Lost" });
        }
        return salesApi.updateRecord("leads", id, { status: target });
      }
      return Promise.resolve(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["target-performance"] });
      await queryClient.invalidateQueries({ queryKey: ["sales", "analytics"] });
    },
  });

  const create = useMutation({
    mutationFn: () => {
      const value = Number(form.value);
      const coords = (typeof form.latitude === "number" && typeof form.longitude === "number" && !Number.isNaN(form.latitude) && !Number.isNaN(form.longitude))
        ? { type: "Point" as const, coordinates: [form.longitude, form.latitude] as [number, number] }
        : undefined;
      const marketVal = form.market || (form.country ? (form.state ? `${form.state}, ${form.country}` : form.country) : undefined);
      const common = {
        ownerEmployee: form.employee || undefined,
        ...(form.territory ? { territory: form.territory } : {}),
        ...(form.geoNode ? { geoNode: form.geoNode } : {}),
        currency: form.currency,
        market: marketVal,
        ...(coords ? { coordinates: coords } : {}),
      };
      if (path === "leads") return salesApi.createRecord(path, { ...common, name: form.name, companyName: form.companyName || undefined, email: form.email || undefined, phone: form.phone || undefined, notes: form.notes || undefined, estimatedValue: value, source: form.source });
      if (path === "customers") return salesApi.createRecord(path, { ...common, name: form.name, primaryContactName: form.contactName || undefined, email: form.email || undefined, phone: form.phone || undefined, customerType: form.customerType, lifetimeRevenue: 0 });
      if (path === "pipeline") return salesApi.createRecord(path, { ...common, customer: form.customer, name: form.name, stage: form.stage, estimatedValue: value, probability: Number(form.probability), expectedCloseDate: form.date });
      if (path === "targets") return salesApi.createRecord(path, {
        employee: form.targetScope === "EMPLOYEE" ? form.employee : undefined,
        territory: form.targetScope === "TERRITORY" ? form.territory : undefined,
        periodType: form.periodType,
        periodStart: form.date,
        periodEnd: form.endDate,
        revenueTarget: value,
        leadTarget: Number(form.leadTarget),
        conversionTarget: Number(form.conversionTarget),
        currency: form.currency,
        status: "ACTIVE",
        compensationRule: {
          ruleType: form.ruleType,
          commissionRate: Number(form.commissionRate || 0),
          ...(form.ruleType === "PROPORTIONAL" ? { proportionalConfig: { maxPayout: Number(form.maxPayout || 0) } } : {}),
          ...(form.ruleType === "COMMISSION_SLABS" ? { slabs: form.slabs.map((slab) => ({ fromPercentage: Number(slab.fromPercentage), toPercentage: slab.toPercentage === "" ? null : Number(slab.toPercentage), rate: Number(slab.rate), rateType: "PERCENTAGE" })) } : {}),
          ...(form.floorPercentage !== "" ? { floorPercentage: Number(form.floorPercentage) } : {}),
          ...(form.capAmount !== "" ? { capAmount: Number(form.capAmount) } : {}),
          ...(form.acceleratorMultiplier !== "" ? { accelerators: [{ thresholdPercentage: 100, multiplier: Number(form.acceleratorMultiplier) }] } : {}),
        },
      });
      if (path === "revenue") return salesApi.createRecord(path, { customer: form.customer, employee: form.employee || undefined, ...(form.territory ? { territory: form.territory } : {}), ...(form.geoNode ? { geoNode: form.geoNode } : {}), amount: value, quantity: Number(form.quantity), currency: form.currency, transactionDate: form.date, source: form.source, reference: form.reference || undefined, channelPartner: form.channelPartner || undefined });
      const partnerCode = form.code || form.name.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").slice(0, 15) || "PARTNER";
      return salesApi.createRecord(path, { name: form.name, code: partnerCode, type: form.type, contactName: form.contactName || undefined, email: form.email || undefined, phone: form.phone || undefined, market: form.market || undefined, ...(form.territory ? { territory: form.territory } : {}), ...(form.geoNode ? { geoNode: form.geoNode } : {}), ownerEmployee: form.employee || undefined, status: "ACTIVE", effectiveFrom: form.date });
    },
    onSuccess: async () => {
      setOpen(false);
      setForm(initialForm());
      setNotice(`${title === "Pipeline" ? "Opportunity" : title.replace(/s$/, "")} created successfully.`);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["target-performance"] });
      await queryClient.invalidateQueries({ queryKey: ["sales", "analytics"] });
    },
  });

  const compensationSignature = JSON.stringify({ target: form.value, type: form.ruleType, commission: form.commissionRate, max: form.maxPayout, floor: form.floorPercentage, cap: form.capAmount, accelerator: form.acceleratorMultiplier, slabs: form.slabs });
  const simulation = useMutation({
    mutationFn: (_signature: string) => {
      const targetAmount = Number(form.value || 0);
      const ruleConfig: Record<string, unknown> = {
        ruleType: form.ruleType,
        commissionRate: Number(form.commissionRate || 0),
        ...(form.ruleType === "PROPORTIONAL" ? { proportionalConfig: { maxPayout: Number(form.maxPayout || 0) } } : {}),
        ...(form.ruleType === "COMMISSION_SLABS" ? { slabs: form.slabs.map((slab) => ({ fromPercentage: Number(slab.fromPercentage), toPercentage: slab.toPercentage === "" ? null : Number(slab.toPercentage), rate: Number(slab.rate), rateType: "PERCENTAGE" })) } : {}),
        ...(form.floorPercentage !== "" ? { floorPercentage: Number(form.floorPercentage) } : {}),
        ...(form.capAmount !== "" ? { capAmount: Number(form.capAmount) } : {}),
        accelerators: [{ thresholdPercentage: 100, multiplier: Number(form.acceleratorMultiplier || 1) }],
      };
      return salesApi.simulateCompensation({ ruleConfig, targetAmount, testScenarios: [0.5, 0.8, 1, 1.5].map((factor) => targetAmount * factor) });
    },
  });

  const chooseCustomer = (customerId: string) => {
    const customer = customers.data?.items.find((item) => item._id === customerId);
    setForm((current) => ({
      ...current,
      customer: customerId,
      employee: idOf(customer?.ownerEmployee) || current.employee,
      territory: idOf(customer?.territory) || current.territory,
      currency: customer?.currency || current.currency,
    }));
  };
  const openCreate = () => {
    setNotice("");
    setForm({ ...initialForm(), source: path === "revenue" ? "INVOICE" : "REFERRAL" });
    setOpen(true);
  };
  const addLabel = title === "Pipeline" ? "opportunity" : title.toLowerCase().replace(/s$/, "");
  const employeeField = hasTeamScope && <label className="text-sm font-medium">{path === "targets" ? "Target employee" : path === "leads" ? "Sales employee" : "Owner employee"}<select required={path !== "channel-partners"} className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.employee} onChange={(event) => setForm({ ...form, employee: event.target.value })}><option value="">Select employee</option>{employees.data?.items.map((employee) => <option key={employee._id} value={employee._id}>{employee.firstName} {employee.lastName} ({employee.employeeId})</option>)}</select></label>;
  const territoryField = <label className="text-sm font-medium">Territory (optional)<select required={path === "targets" && form.targetScope === "TERRITORY"} className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.territory} onChange={(event) => setForm({ ...form, territory: event.target.value })}><option value="">Leave unassigned</option>{territories.data?.items.map((territory) => <option key={territory._id} value={territory._id}>{territory.name}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-400">Use a territory only when your manager has defined one.</span></label>;
  const geographyField = <label className="text-sm font-medium">Geographic node<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.geoNode} onChange={(event) => setForm({ ...form, geoNode: event.target.value })}><option value="">Select country/state/district/city</option>{geographies.data?.items.map((geo) => <option key={geo._id} value={geo._id}>{`${"— ".repeat(Math.max(0, geo.depth - 1))}${geo.name} (${geo.type})`}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-400">Required for detailed map and geographic rollups.</span></label>;

  const handleCountryChange = (countryName: string) => {
    const cObj = countryMaster.find((c) => c.name.common === countryName);
    const defaultCoords = cObj?.latlng ? [cObj.latlng[0], cObj.latlng[1]] : undefined;
    const states = getStatesForCountry(countryName);
    const firstState = states[0];
    const initialCoords = (countryName === "India" && firstState)
      ? [firstState.lat, firstState.lng]
      : defaultCoords;

    const stateVal = (countryName === "India" && firstState) ? firstState.name : "";
    const marketVal = stateVal ? `${stateVal}, ${countryName}` : countryName;

    setForm((prev) => ({
      ...prev,
      country: countryName,
      state: stateVal,
      market: marketVal,
      latitude: initialCoords ? initialCoords[0] : undefined,
      longitude: initialCoords ? initialCoords[1] : undefined,
    }));
  };

  const handleStateChange = (stateName: string) => {
    const coords = getStateCoordinates(form.country, stateName);
    const marketVal = stateName ? `${stateName}, ${form.country}` : form.country;
    setForm((prev) => ({
      ...prev,
      state: stateName,
      market: marketVal,
      latitude: coords ? coords[0] : prev.latitude,
      longitude: coords ? coords[1] : prev.longitude,
    }));
  };

  const statesForSelectedCountry = getStatesForCountry(form.country);

  return <main className="flex-1 px-5 py-8 sm:px-8"><div className="mx-auto max-w-[1440px]">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-sm font-medium text-brand-700">Sales Intelligence</p>
        <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">{sectionMeta[path].purpose}</p>
      </div>
      <div className="flex items-center gap-2.5">
        {(path === "pipeline" || path === "leads") && (
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                viewMode === "table"
                  ? "bg-brand-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <LayoutList size={14} />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                viewMode === "kanban"
                  ? "bg-brand-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Kanban size={14} />
              Kanban Pipeline
            </button>
          </div>
        )}
        {canManage && <Button onClick={openCreate}><Plus size={16}/> Add {addLabel}</Button>}
      </div>
    </div>
    <div className={`mt-5 rounded-xl border p-4 text-sm ${isHrView ? "border-blue-100 bg-blue-50 text-blue-900" : "border-emerald-100 bg-emerald-50 text-emerald-900"}`}><p className="font-medium">{isHrView ? "HR view · Read only" : hasTeamScope ? "Team workflow" : "Your sales workflow"}</p><p className="mt-1 text-xs opacity-80">{isHrView ? sectionMeta[path].hr : sectionMeta[path].next}</p></div>
    {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    {path === "leads" && hasTeamScope && <div className="mt-5 flex flex-wrap items-end gap-4"><label className="text-sm font-medium">Sales employee<select className="mt-2 block h-11 rounded-xl border bg-white px-3" value={leadEmployeeFilter} onChange={(event) => setLeadEmployeeFilter(event.target.value)}><option value="">All sales employees</option>{leadOwners.map(([id, owner]) => <option key={id} value={id}>{labelOf(owner)}{typeof owner === "object" && owner?.employeeId ? ` (${owner.employeeId})` : ""}</option>)}</select></label><p role="status" className="pb-3 text-sm text-slate-500">{visibleItems.length} leads shown</p></div>}

    {viewMode === "kanban" && (path === "pipeline" || path === "leads") ? (
      <section className="mt-5">
        {query.isLoading ? (
          <div className="p-5"><Skeleton className="h-64"/></div>
        ) : query.isError ? (
          <p className="p-5 text-sm text-red-700">{query.error.message}</p>
        ) : (
          <SalesKanbanBoard
            path={path}
            items={visibleItems}
            canManage={canManage}
            onMoveStage={(id, target) => moveMutation.mutate({ id, target })}
            onSelectRecord={(rec) => setSelectedRecordForDrawer(rec)}
          />
        )}
      </section>
    ) : (
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-soft">
        {query.isLoading ? <div className="p-5"><Skeleton className="h-64"/></div> : query.isError ? <p className="p-5 text-sm text-red-700">{query.error.message}</p> : !visibleItems.length ? <div className="grid min-h-64 place-items-center p-6 text-center"><div><Database className="mx-auto text-slate-300"/><p className="mt-3 font-medium">Nothing here yet</p><p className="mt-1 text-sm text-slate-400">{path === "leads" && leadEmployeeFilter ? "No leads for this sales employee." : sectionMeta[path].empty}</p>{canManage && <Button className="mt-4" variant="secondary" onClick={openCreate}><Plus size={15}/> Add first {addLabel}</Button>}</div></div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{columns.map((column) => <th key={column.label} className={`px-5 py-3 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>)}</tr></thead><tbody className="divide-y">{visibleItems.map((item) => <tr key={item._id}>{columns.map((column) => <td key={column.label} className={`whitespace-nowrap px-5 py-4 align-top ${column.align === "right" ? "text-right font-medium" : "text-slate-600 first:font-medium first:text-ink"}`}>{column.render(item)}</td>)}</tr>)}</tbody></table></div>}
      </section>
    )}
  </div>
  {open && <div className="fixed inset-0 z-[2000] grid place-items-center overflow-y-auto bg-ink/35 p-4 backdrop-blur-sm"><form className="my-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><h2 className="text-xl font-semibold">Add {addLabel}</h2><p className="mt-1 text-sm text-slate-500">{sectionMeta[path].purpose}</p>
    {hasTeamScope && !territories.isLoading && !territories.data?.items.length && path !== "targets" && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No territories are configured yet. You can still capture unassigned sales records; add territories later for reporting.</div>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {["leads", "customers", "pipeline", "channel-partners"].includes(path) && <label className="text-sm font-medium sm:col-span-2">{path === "channel-partners" ? "Partner name" : path === "pipeline" ? "Opportunity name" : path === "customers" ? "Customer name" : "Lead name"}<Input required className="mt-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>}
      {path === "leads" && <>
        <label className="text-sm font-medium">Company/account (optional)<Input className="mt-2" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label>
        <label className="text-sm font-medium">Country (optional)
          <select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.country} onChange={(event) => handleCountryChange(event.target.value)}>
            <option value="">Select country</option>
            {countryOptions.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        {Boolean(form.country) && (
          <label className="text-sm font-medium">State / Region (optional)
            {statesForSelectedCountry.length > 0 ? (
              <select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.state} onChange={(event) => handleStateChange(event.target.value)}>
                <option value="">Select state / region</option>
                {statesForSelectedCountry.map((st) => <option key={st.name} value={st.name}>{st.name}{st.code ? ` (${st.code})` : ""}</option>)}
              </select>
            ) : (
              <Input className="mt-2" placeholder="Enter state or region" value={form.state} onChange={(event) => handleStateChange(event.target.value)}/>
            )}
          </label>
        )}
        {Boolean(form.country) && (
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium">Map Location Pinpoint</label>
            <LocationPickerMap
              lat={form.latitude}
              lng={form.longitude}
              onChange={(lat, lng) => setForm((prev) => ({ ...prev, latitude: lat, longitude: lng }))}
              label={form.state ? `${form.state}, ${form.country}` : form.country}
              zoom={form.state ? 8 : 5}
            />
          </div>
        )}
        <label className="text-sm font-medium">Phone<Input required inputMode="tel" className="mt-2" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
        <label className="text-sm font-medium">Email (optional)<Input type="email" className="mt-2" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
        <label className="text-sm font-medium sm:col-span-2">Follow-up notes (optional)<textarea className="mt-2 min-h-20 w-full rounded-xl border bg-white px-3 py-2" maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label>
      </>}
      {path === "customers" && <>
        <label className="text-sm font-medium">Primary contact<Input className="mt-2" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })}/></label>
        <label className="text-sm font-medium">Country (optional)
          <select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.country} onChange={(event) => handleCountryChange(event.target.value)}>
            <option value="">Select country</option>
            {countryOptions.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        {Boolean(form.country) && (
          <label className="text-sm font-medium">State / Region (optional)
            {statesForSelectedCountry.length > 0 ? (
              <select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.state} onChange={(event) => handleStateChange(event.target.value)}>
                <option value="">Select state / region</option>
                {statesForSelectedCountry.map((st) => <option key={st.name} value={st.name}>{st.name}{st.code ? ` (${st.code})` : ""}</option>)}
              </select>
            ) : (
              <Input className="mt-2" placeholder="Enter state or region" value={form.state} onChange={(event) => handleStateChange(event.target.value)}/>
            )}
          </label>
        )}
        {Boolean(form.country) && (
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium">Map Location Pinpoint</label>
            <LocationPickerMap
              lat={form.latitude}
              lng={form.longitude}
              onChange={(lat, lng) => setForm((prev) => ({ ...prev, latitude: lat, longitude: lng }))}
              label={form.state ? `${form.state}, ${form.country}` : form.country}
              zoom={form.state ? 8 : 5}
            />
          </div>
        )}
        <label className="text-sm font-medium">Phone<Input required inputMode="tel" className="mt-2" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
        <label className="text-sm font-medium">Email (optional)<Input type="email" className="mt-2" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
      </>}
      {path === "pipeline" && <label className="text-sm font-medium sm:col-span-2">Customer<select required className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.customer} onChange={(event) => chooseCustomer(event.target.value)}><option value="">Select confirmed customer</option>{customers.data?.items.filter((item) => item.status === "ACTIVE").map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-400">Convert a lead or add a direct customer first.</span></label>}
      {path === "revenue" && <><label className="text-sm font-medium">Customer<select required className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.customer} onChange={(event) => chooseCustomer(event.target.value)}><option value="">Select customer</option>{customers.data?.items.filter((item) => item.status === "ACTIVE").map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Channel partner (optional)<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.channelPartner} onChange={(event) => setForm({ ...form, channelPartner: event.target.value })}><option value="">Direct sale</option>{partners.data?.items.filter((item) => item.status === "ACTIVE").map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label></>}
      {path === "channel-partners" && <><label className="text-sm font-medium">Partner type<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{["DISTRIBUTOR", "DEALER", "RESELLER", "RETAILER", "SERVICE_PARTNER", "OTHER"].map((type) => <option key={type}>{type.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-medium">Country / market (optional)<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })}><option value="">Select country</option>{countryOptions.map((name) => <option key={name}>{name}</option>)}</select></label></>}
      {path === "channel-partners" && <><label className="text-sm font-medium">Contact person<Input required className="mt-2" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })}/></label><label className="text-sm font-medium">Phone<Input required inputMode="tel" className="mt-2" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label><label className="text-sm font-medium">Email (optional)<Input type="email" className="mt-2" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label></>}
      {!["targets", "pipeline", "revenue"].includes(path) && <>{employeeField}{hasTeamScope && territoryField}</>}
      {["pipeline", "revenue"].includes(path) && form.customer && <div className="rounded-xl border bg-slate-50 p-3 text-xs text-slate-600 sm:col-span-2">Owner and territory are inherited from <span className="font-semibold">{customers.data?.items.find((item) => item._id === form.customer)?.name}</span>.</div>}
      {path === "leads" && <><label className="text-sm font-medium">Lead source<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>{["REFERRAL", "WEBSITE", "OUTBOUND", "EVENT", "CHANNEL_PARTNER", "OTHER"].map((source) => <option key={source}>{source.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-medium">Potential value<Input required type="number" min="0" className="mt-2" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })}/></label></>}
      {path === "customers" && <label className="text-sm font-medium">Customer type<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.customerType} onChange={(event) => setForm({ ...form, customerType: event.target.value })}>{["BUSINESS", "INDIVIDUAL", "GOVERNMENT", "NON_PROFIT", "OTHER"].map((type) => <option key={type}>{type.replaceAll("_", " ")}</option>)}</select></label>}
      {path === "pipeline" && <><label className="text-sm font-medium">Stage<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.stage} onChange={(event) => { const stage = pipelineStages.find((item) => item.value === event.target.value)!; setForm({ ...form, stage: stage.value, probability: String(stage.probability) }); }}>{pipelineStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label><label className="text-sm font-medium">Win probability %<Input required type="number" min="0" max="100" className="mt-2" value={form.probability} onChange={(event) => setForm({ ...form, probability: event.target.value })}/></label><label className="text-sm font-medium">Deal value<Input required type="number" min="0" className="mt-2" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })}/></label><label className="text-sm font-medium">Expected close date<Input required type="date" min={today()} className="mt-2" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label></>}
      {path === "targets" && <>
        <label className="text-sm font-medium">Assign target to<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.targetScope} onChange={(event) => setForm({ ...form, targetScope: event.target.value })}><option value="EMPLOYEE">Employee</option><option value="TERRITORY">Territory</option></select></label>
        <label className="text-sm font-medium">Period type<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.periodType} onChange={(event) => setForm({ ...form, periodType: event.target.value })}>{["MONTHLY", "QUARTERLY", "YEARLY"].map((type) => <option key={type}>{type}</option>)}</select></label>
        {form.targetScope === "EMPLOYEE" ? employeeField : territoryField}
        <label className="text-sm font-medium">Period start<Input required type="date" className="mt-2" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label>
        <label className="text-sm font-medium">Period end<Input required type="date" min={form.date} className="mt-2" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })}/></label>
        <label className="text-sm font-medium">Revenue target<Input required type="number" min="0" className="mt-2" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })}/></label>
        <label className="text-sm font-medium">Lead target<Input required type="number" min="0" className="mt-2" value={form.leadTarget} onChange={(event) => setForm({ ...form, leadTarget: event.target.value })}/></label>
        <label className="text-sm font-medium">Conversion target %<Input required type="number" min="0" max="100" className="mt-2" value={form.conversionTarget} onChange={(event) => setForm({ ...form, conversionTarget: event.target.value })}/></label>
      </>}
      {path === "targets" && <section className="sm:col-span-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
        <h3 className="font-semibold text-ink">Target-based compensation formula</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Rule type<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.ruleType} onChange={(event) => setForm({ ...form, ruleType: event.target.value })}><option value="TARGET_GATE">Strict Target (100% Gate)</option><option value="PROPORTIONAL">Proportional</option><option value="COMMISSION_SLABS">Tiered Slabs</option><option value="FLAT_COMMISSION">Flat Commission</option></select></label>
          {form.ruleType === "PROPORTIONAL" && <label className="text-sm font-medium">Max payout<Input required type="number" min="0" className="mt-2" value={form.maxPayout} onChange={(event) => setForm({ ...form, maxPayout: event.target.value })}/><span className="mt-1 block text-xs font-normal text-slate-500">Target ₹100, max ₹10, achieved ₹80 → payout ₹8</span></label>}
          {["FLAT_COMMISSION", "TARGET_GATE"].includes(form.ruleType) && <label className="text-sm font-medium">Commission %<Input type="number" min="0" max="100" className="mt-2" value={form.commissionRate} onChange={(event) => setForm({ ...form, commissionRate: event.target.value })}/>{form.ruleType === "TARGET_GATE" && <span className="mt-1 block text-xs font-normal text-slate-500">Below 100% pays ₹0. At or above target, commission becomes eligible.</span>}</label>}
          {form.ruleType === "TARGET_GATE" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><span className="font-semibold text-amber-900">Eligibility gate: 100%</span><p className="mt-1 text-xs text-amber-800">Achievement below the full target always pays ₹0.</p></div> : <label className="text-sm font-medium">Floor % (optional)<Input type="number" min="0" className="mt-2" value={form.floorPercentage} onChange={(event) => setForm({ ...form, floorPercentage: event.target.value })}/></label>}
          <label className="text-sm font-medium">Cap amount (optional)<Input type="number" min="0" className="mt-2" value={form.capAmount} onChange={(event) => setForm({ ...form, capAmount: event.target.value })}/></label>
          <label className="text-sm font-medium">Multiplier above 100%<Input type="number" min="1" step="0.1" className="mt-2" value={form.acceleratorMultiplier} onChange={(event) => setForm({ ...form, acceleratorMultiplier: event.target.value })}/></label>
        </div>
        {form.ruleType === "COMMISSION_SLABS" && <div className="mt-4 space-y-2"><p className="text-sm font-semibold">Marginal tiers</p>{form.slabs.map((slab, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"><Input aria-label={`Tier ${index + 1} from percentage`} type="number" min="0" placeholder="From %" value={slab.fromPercentage} onChange={(event) => setForm({ ...form, slabs: form.slabs.map((item, itemIndex) => itemIndex === index ? { ...item, fromPercentage: event.target.value } : item) })}/><Input aria-label={`Tier ${index + 1} to percentage`} type="number" min="0" placeholder="To % (blank = ∞)" value={slab.toPercentage} onChange={(event) => setForm({ ...form, slabs: form.slabs.map((item, itemIndex) => itemIndex === index ? { ...item, toPercentage: event.target.value } : item) })}/><Input aria-label={`Tier ${index + 1} rate percentage`} type="number" min="0" step="0.01" placeholder="Rate %" value={slab.rate} onChange={(event) => setForm({ ...form, slabs: form.slabs.map((item, itemIndex) => itemIndex === index ? { ...item, rate: event.target.value } : item) })}/><Button type="button" variant="ghost" onClick={() => setForm({ ...form, slabs: form.slabs.filter((_, itemIndex) => itemIndex !== index) })}>×</Button></div>)}<Button type="button" variant="secondary" onClick={() => setForm({ ...form, slabs: [...form.slabs, { fromPercentage: "100", toPercentage: "", rate: "10" }] })}>Add tier</Button></div>}
        <div className="mt-4 rounded-xl bg-white p-3"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Test Formula / What-If</p><p className="text-xs text-slate-500">Preview at 50%, 80%, 100%, and 150% achievement.</p></div><Button type="button" variant="secondary" disabled={simulation.isPending || Number(form.value) <= 0} onClick={() => simulation.mutate(compensationSignature)}>{simulation.isPending ? "Testing…" : "Test formula"}</Button></div>{simulation.data && simulation.variables === compensationSignature && <div className="mt-3 grid grid-cols-4 gap-2">{simulation.data.scenarios.map((scenario) => <div key={scenario.achievementPercentage} className="rounded-lg bg-slate-50 p-2 text-center"><p className="text-xs text-slate-500">{scenario.achievementPercentage}%</p><p className="font-semibold text-emerald-700">{money(form.currency, scenario.payout)}</p></div>)}</div>}{simulation.data && simulation.variables !== compensationSignature && <p className="mt-3 text-xs font-medium text-amber-700">Formula changed. Click Test formula to calculate a fresh preview.</p>}{simulation.error && <p className="mt-2 text-xs text-red-600">{simulation.error.message}</p>}</div>
      </section>}
      {path !== "targets" && geographyField}
      {path === "revenue" && <><label className="text-sm font-medium">Amount<Input required type="number" min="0" className="mt-2" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })}/></label><label className="text-sm font-medium">Sales quantity<Input required type="number" min="1" step="1" className="mt-2" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })}/></label><label className="text-sm font-medium">Transaction date<Input required type="date" max={today()} className="mt-2" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label><label className="text-sm font-medium">Revenue source<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>{["INVOICE", "RECEIPT", "ADJUSTMENT", "OTHER"].map((source) => <option key={source}>{source}</option>)}</select></label><label className="text-sm font-medium">Invoice/reference<Input required className="mt-2" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })}/></label></>}
      {path === "channel-partners" && <label className="text-sm font-medium">Effective from<Input required type="date" className="mt-2" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label>}
    </div>
    {!hasTeamScope && path !== "targets" && <p className="mt-4 text-xs text-slate-400">Sales employee is set to your employee profile automatically. Geography and territory are optional.</p>}
    {path === "leads" && <p className="mt-3 text-xs text-slate-500">Your account is recorded automatically as the person who brought this lead, even if it is assigned to another employee.</p>}
    {create.error && <p className="mt-4 text-sm text-red-600">{create.error.message}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={create.isPending}>{create.isPending ? "Saving..." : "Save"}</Button></div>
  </form></div>}

  {selectedRecordForDrawer && ["leads", "customers", "pipeline"].includes(path) && (
    <SalesActivityDrawer
      record={selectedRecordForDrawer}
      path={path as "leads" | "customers" | "pipeline"}
      onClose={() => setSelectedRecordForDrawer(null)}
      onUpdateStage={(stage) => {
        moveMutation.mutate({ id: selectedRecordForDrawer._id, target: stage });
        setSelectedRecordForDrawer((prev) => (prev ? { ...prev, stage } : null));
      }}
      onUpdateStatus={(status) => {
        moveMutation.mutate({ id: selectedRecordForDrawer._id, target: status });
        setSelectedRecordForDrawer((prev) => (prev ? { ...prev, status } : null));
      }}
    />
  )}
  </main>;
};
