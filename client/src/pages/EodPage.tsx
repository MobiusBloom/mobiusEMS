import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { VoiceDictation } from "@/components/VoiceDictation";

type Health = "ON_TRACK" | "AT_RISK" | "BLOCKED";
type Update = { _id: string; employee: string; date: string; accomplishments: string; inProgress: string; nextPlan: string; blockers: string; health: Health; status: "DRAFT" | "SUBMITTED"; submittedAt?: string; acknowledgedAt?: string; managerComment?: string };
type Employee = { _id: string; firstName: string; lastName: string; employeeId: string; department?: { name: string }; status: string };
type Data = { employees: Employee[]; updates: Update[] };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const labels = { ON_TRACK: "On track", AT_RISK: "At risk", BLOCKED: "Blocked" };
const panel = "rounded-2xl border bg-white p-5 sm:p-6";
const fields = [
  ["accomplishments", "What did you complete?", "Summarize outcomes and include task IDs or evidence links."],
  ["inProgress", "What is still in progress?", "Share progress and what remains."],
  ["nextPlan", "Next working day's priorities", "List your most important next steps."],
  ["blockers", "Blockers & support needed", "What is holding you back, and who or what can help?"]
] as const;

function EmployeeEditor({ date, update }: { date: string; update?: Update }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState({ accomplishments: update?.accomplishments ?? "", inProgress: update?.inProgress ?? "", nextPlan: update?.nextPlan ?? "", blockers: update?.blockers ?? "", health: update?.health ?? "ON_TRACK" as Health });
  const [saved, setSaved] = useState("");
  const [voiceField, setVoiceField] = useState<typeof fields[number][0]>("accomplishments");
  const save = useMutation({ mutationFn: (status: Update["status"]) => api.put("/api/v1/eod", { ...draft, date, status }), onSuccess: async (_, status) => { setSaved(status === "DRAFT" ? "Draft saved. Only you can see it." : "EOD submitted. Your super admin can now review it."); await client.invalidateQueries({ queryKey: ["eod"] }); } });
  return <section className={panel}>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Your daily update</h2><span className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">{update?.status === "SUBMITTED" ? "Submitted" : update ? "Draft" : "Not started"}</span></div>
    <form onSubmit={event => { event.preventDefault(); save.mutate("SUBMITTED"); }} className="space-y-5">
      <label className="block text-sm font-semibold">Section to update by voice<select className="mt-2 block h-11 w-full rounded-xl border bg-white px-3" value={voiceField} onChange={event => setVoiceField(event.target.value as typeof voiceField)}>{fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <VoiceDictation key={voiceField} disabled={save.isPending} onTranscript={text => { setSaved(""); setDraft(current => ({ ...current, [voiceField]: `${current[voiceField]}${current[voiceField] ? "\n" : ""}${text}`.slice(0, 4000) })); }}/>
      <label className="block text-sm font-semibold">How is your work going?<select className="mt-2 block min-h-11 w-full rounded-xl border bg-white p-3" value={draft.health} onChange={event => { setSaved(""); setDraft({ ...draft, health: event.target.value as Health }); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="grid gap-5 md:grid-cols-2">{fields.map(([key, label, hint]) => <label key={key} className="block text-sm font-semibold">{label}<span className="mt-1 block text-sm font-normal text-slate-500">{hint}</span><textarea className="mt-2 block w-full rounded-xl border p-3 font-normal" rows={5} maxLength={4000} required={key === "nextPlan" || (key === "blockers" && draft.health !== "ON_TRACK")} value={draft[key]} onChange={event => { setSaved(""); setDraft({ ...draft, [key]: event.target.value }); }}/></label>)}</div>
      <p className="text-sm text-slate-500">Keep it brief. Describe completed work or work in progress, and your next priorities. Raise urgent blockers directly with your manager.</p>
      {save.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{save.error.message}</p>}
      {saved && <p role="status" className="text-sm text-brand-700">{saved}</p>}
      <div className="flex flex-wrap justify-end gap-3">{update?.status !== "SUBMITTED" && <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate("DRAFT")}>Save draft</Button>}<Button disabled={save.isPending}>{save.isPending ? "Saving…" : update?.status === "SUBMITTED" ? "Update submission" : "Submit EOD"}</Button></div>
    </form>
    {update?.acknowledgedAt && <div className="mt-6 rounded-xl bg-brand-50 p-4"><p className="font-semibold text-brand-700">Reviewed by super admin</p><p className="mt-2 whitespace-pre-wrap text-sm">{update.managerComment || "Your update has been acknowledged."}</p></div>}
  </section>;
}

function Review({ update }: { update: Update }) {
  const client = useQueryClient();
  const [comment, setComment] = useState(update.managerComment ?? "");
  const review = useMutation({ mutationFn: () => api.patch(`/api/v1/eod/${update._id}/review`, { managerComment: comment }), onSuccess: () => client.invalidateQueries({ queryKey: ["eod"] }) });
  return <div className="mt-4 border-t pt-4"><label className="block text-sm font-semibold">Feedback / support plan<textarea rows={2} maxLength={2000} className="mt-2 w-full rounded-xl border p-3 font-normal" value={comment} onChange={event => setComment(event.target.value)}/></label><Button className="mt-2" variant="secondary" disabled={review.isPending} onClick={() => review.mutate()}><CheckCircle2 size={16}/>{review.isPending ? "Saving…" : update.acknowledgedAt ? "Update feedback" : "Acknowledge update"}</Button>{review.error && <p role="alert" className="mt-2 text-sm text-red-700">{review.error.message}</p>}{review.isSuccess && <p role="status" className="mt-2 text-sm text-brand-700">Feedback saved.</p>}</div>;
}

function AdminOverview({ data }: { data: Data }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [department, setDepartment] = useState("");
  const updates = new Map(data.updates.map(update => [update.employee, update]));
  const roster = data.employees.filter(employee => !department || employee.department?.name === department);
  const submitted = roster.filter(employee => updates.has(employee._id)).length;
  const blocked = roster.filter(employee => updates.get(employee._id)?.health === "BLOCKED").length;
  const atRisk = roster.filter(employee => updates.get(employee._id)?.health === "AT_RISK").length;
  const unreviewed = roster.filter(employee => { const update = updates.get(employee._id); return update && !update.acknowledgedAt; }).length;
  const visible = roster.filter(employee => {
    const update = updates.get(employee._id);
    const match = `${employee.firstName} ${employee.lastName} ${employee.employeeId}`.toLowerCase().includes(search.toLowerCase());
    return match && (filter === "ALL" || (filter === "MISSING" && !update) || (filter === "UNREVIEWED" && update && !update.acknowledgedAt) || update?.health === filter);
  });
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Submitted", `${submitted} / ${roster.length}`, "Reports available to review"], ["No update", roster.length - submitted, "No submitted report for this date"], ["Needs support", blocked + atRisk, `${blocked} blocked · ${atRisk} at risk`], ["Awaiting review", unreviewed, "Submitted, not yet acknowledged"]].map(([label, value, hint]) => <div key={label} className={panel}><p className="text-sm text-slate-500">{label}</p><p className="my-2 text-3xl font-semibold">{value}</p><p className="text-sm text-slate-500">{hint}</p></div>)}</div>
    <section className={panel}><div className="flex justify-between gap-3"><h2 className="font-semibold">Submission coverage</h2><span className="text-sm text-slate-600">{roster.length ? Math.round(submitted / roster.length * 100) : 0}% submitted</span></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="EOD submission coverage" aria-valuemin={0} aria-valuemax={roster.length || 1} aria-valuenow={submitted}><div className="h-full rounded-full bg-brand-600" style={{ width: `${roster.length ? submitted / roster.length * 100 : 0}%` }}/></div><p className="mt-3 text-sm text-slate-500">Active profiles joined by this date. No update may mean leave, a non-working day, or a draft; it is not a performance rating.</p></section>
    <section className={panel}><div className="mb-5 grid gap-3 md:grid-cols-3"><label className="text-sm font-semibold">Search employees<Input className="mt-2" placeholder="Name or employee ID" value={search} onChange={event => setSearch(event.target.value)}/></label><label className="text-sm font-semibold">Department<select className="mt-2 block min-h-11 w-full rounded-xl border bg-white px-3" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{Array.from(new Set(data.employees.map(employee => employee.department?.name).filter(Boolean))).sort().map(name => <option key={name}>{name}</option>)}</select></label><label className="text-sm font-semibold">Show<select className="mt-2 block min-h-11 w-full rounded-xl border bg-white px-3" value={filter} onChange={event => setFilter(event.target.value)}>{[["ALL", "All employees"], ["MISSING", "No update"], ["UNREVIEWED", "Awaiting review"], ...Object.entries(labels)].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="space-y-3">{visible.map(employee => { const update = updates.get(employee._id); return <details key={employee._id} className="rounded-xl border p-4"><summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{employee.firstName} {employee.lastName}</p><p className="text-sm text-slate-500">{employee.employeeId} · {employee.department?.name ?? "No department"}{employee.status === "ON_LEAVE" ? " · On leave" : ""}</p></div><div className="flex flex-wrap items-center gap-2 text-sm"><span className={`rounded-full px-3 py-1 ${!update ? "bg-slate-100 text-slate-600" : update.health === "ON_TRACK" ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-800"}`}>{update ? labels[update.health] : "No update"}</span>{update && <span className="text-slate-500">{update.acknowledgedAt ? "Reviewed" : "Awaiting review"} · View update</span>}</div></summary>{update ? <div className="mt-5"><p className="text-xs text-slate-500">Submitted {update.submittedAt ? new Date(update.submittedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""} IST</p><div className="mt-4 grid gap-5 md:grid-cols-2">{fields.map(([key, label]) => <div key={key}><h3 className="text-sm font-semibold">{label}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{update[key] || "None reported"}</p></div>)}</div><Review key={`${update._id}-${update.acknowledgedAt ?? "new"}`} update={update}/></div> : <p className="mt-3 text-sm text-slate-500">No submitted EOD for the selected date. Drafts are private to the employee.</p>}</details>; })}{!visible.length && <p className="py-8 text-center text-slate-500">No employees match these filters.</p>}</div>
    </section>
  </div>;
}

export function EodPage() {
  const { user } = useAuth();
  const admin = user?.role === "SUPER_ADMIN";
  const [date, setDate] = useState(today);
  const query = useQuery({ queryKey: ["eod", user?.id, date], queryFn: () => api.get<Data>(`/api/v1/eod?date=${date}`), enabled: !!date });
  return <main className="space-y-6 p-4 sm:p-8"><header className="flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-700"><ClipboardList size={18}/> Daily work journal</div><h1 className="text-2xl font-bold sm:text-3xl">{admin ? "Team EOD overview" : "End-of-day update"}</h1><p className="mt-2 text-slate-500">{admin ? "See progress, spot blockers, and give your team the support they need." : "A few minutes to share your progress and prepare for the next working day."}</p></div><label className="text-sm font-semibold">Report date (IST)<Input type="date" className="mt-2" value={date} max={today()} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label></header>
    {query.isPending && <p role="status" className={panel}>Loading EOD updates…</p>}
    {query.error && <div role="alert" className={panel}><AlertTriangle className="mb-2 text-amber-600"/><p>{query.error.message}</p><Button className="mt-3" variant="secondary" onClick={() => query.refetch()}>Try again</Button></div>}
    {query.data && !query.error && (admin ? <AdminOverview key={date} data={query.data}/> : <EmployeeEditor key={date} date={date} update={query.data.updates[0]}/>)}
  </main>;
}
