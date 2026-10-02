import { useState } from "react";
import { CheckCircle2, FileText, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Project } from "./workApi";
import { workApi, type DispatcherPreview } from "./workApi";

type Draft = { extractedTask: string; name: string; description: string; assignedEmployee: string; dueDate: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; estimatedHours: number; included: boolean };
const tomorrow = () => { const date = new Date(Date.now() + 86_400_000); date.setHours(17, 0, 0, 0); return date.toISOString().slice(0, 16); };
const localDateTime = (value?: string) => value ? new Date(new Date(value).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : tomorrow();

export const TaskDispatcherDialog = ({ projects, onClose, onSuccess }: { projects: Project[]; onClose: () => void; onSuccess: () => Promise<void> }) => {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [project, setProject] = useState(projects[0]?._id ?? "");
  const [mode, setMode] = useState<"AUTO_CREATE" | "CONFIRM_FIRST">("CONFIRM_FIRST");
  const [preview, setPreview] = useState<DispatcherPreview>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const loadDrafts = (data: DispatcherPreview) => setDrafts(data.items.filter((item) => item.status !== "CREATED").map((item) => ({
    extractedTask: item._id, name: item.action, description: item.snippet, assignedEmployee: item.employee?._id ?? "", dueDate: localDateTime(item.dueDate), priority: item.priority, estimatedHours: 1, included: true
  })));
  const analyze = async () => {
    setPending(true); setError("");
    try { const data = await workApi.dispatcherPreview({ text, file, project, mode }); setPreview(data); loadDrafts(data); if (data.items.some((item) => item.status === "CREATED")) await onSuccess(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not extract tasks"); }
    finally { setPending(false); }
  };
  const commit = async () => {
    if (!preview) return;
    const selected = drafts.filter((draft) => draft.included);
    if (!selected.length) { setError("Select at least one task"); return; }
    if (selected.some((draft) => !draft.assignedEmployee || !draft.dueDate || !draft.name.trim())) { setError("Every selected task needs a title, assignee, and deadline"); return; }
    setPending(true); setError("");
    try {
      const data = await workApi.dispatcherCommit(preview.taskImport._id, selected.map((draft) => ({ extractedTask: draft.extractedTask, name: draft.name, description: draft.description, assignedEmployee: draft.assignedEmployee, dueDate: new Date(draft.dueDate).toISOString(), priority: draft.priority, estimatedHours: draft.estimatedHours })));
      setPreview(data); loadDrafts(data); await onSuccess(); if (!data.items.some((item) => item.status !== "CREATED")) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create tasks"); }
    finally { setPending(false); }
  };
  const update = (index: number, value: Partial<Draft>) => setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...value } : draft));
  const created = preview?.items.filter((item) => item.status === "CREATED") ?? [];

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4"><div className="mx-auto my-8 w-full max-w-5xl rounded-3xl bg-white shadow-2xl">
    <header className="flex items-start justify-between border-b p-6"><div><div className="flex items-center gap-2 text-brand-700"><Sparkles size={18}/><span className="text-sm font-semibold">AI Task Dispatcher</span></div><h2 className="mt-1 text-2xl font-semibold">Turn a document into assigned tasks</h2><p className="mt-1 text-sm text-slate-500">Paste instructions or upload TXT, PDF, or DOCX. Review assignments before they reach the board.</p></div><button type="button" aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100" onClick={onClose}><X size={20}/></button></header>
    {!preview ? <section className="space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Project<select required className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={project} onChange={(event) => setProject(event.target.value)}><option value="">Select project</option>{projects.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Processing mode<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="CONFIRM_FIRST">Review before creating</option><option value="AUTO_CREATE">Auto-create high confidence</option></select></label></div>
      <label className="block text-sm font-medium">Source text<textarea rows={10} maxLength={100000} className="mt-2 w-full rounded-xl border px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-50" placeholder="Paste meeting notes, a plan, email, or forwarded message…" value={text} onChange={(event) => setText(event.target.value)}/></label>
      <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-sm text-slate-600 hover:border-brand-300 hover:bg-brand-50/40"><Upload size={18}/><span>{file ? file.name : "Or upload TXT, PDF, or DOCX"}</span><input className="hidden" type="file" accept=".txt,.pdf,.docx" onChange={(event) => setFile(event.target.files?.[0])}/></label>
      {error && <p className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={pending || !project || (!text.trim() && !file)} onClick={analyze}><Sparkles size={16}/>{pending ? "Extracting…" : "Extract tasks"}</Button></div>
    </section> : <section className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">{preview.items.length} instruction{preview.items.length === 1 ? "" : "s"} found</p><p className="text-xs text-slate-500">{preview.taskImport.sourceName ?? "Pasted text"} · {preview.taskImport.project.name}</p></div><Button variant="secondary" onClick={() => { setPreview(undefined); setDrafts([]); }}>Use another source</Button></div>
      {created.length > 0 && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={17}/>{created.length} task{created.length === 1 ? "" : "s"} created</p><div className="mt-2 flex flex-wrap gap-2">{created.map((item) => <span key={item._id} className="rounded-full bg-white px-3 py-1 text-xs text-emerald-700">{item.task?.taskId} · {item.action}</span>)}</div></div>}
      <div className="space-y-4">{drafts.map((draft, index) => { const source = preview.items.find((item) => item._id === draft.extractedTask); return <article key={draft.extractedTask} className={`rounded-2xl border p-4 ${source?.status === "NEEDS_REVIEW" ? "border-amber-300 bg-amber-50/30" : "bg-slate-50/50"}`}>
        <div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><input type="checkbox" checked={draft.included} onChange={(event) => update(index, { included: event.target.checked })}/>Create task</label><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${(source?.confidence ?? 0) >= .75 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{Math.round((source?.confidence ?? 0) * 100)}% confidence</span></div>
        <p className="mt-2 text-xs italic text-slate-500">“{source?.snippet}”</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium sm:col-span-2">Task title<input className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm" value={draft.name} onChange={(event) => update(index, { name: event.target.value })}/></label><label className="text-xs font-medium">Assignee<select className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm" value={draft.assignedEmployee} onChange={(event) => update(index, { assignedEmployee: event.target.value })}><option value="">Resolve assignee</option>{preview.options.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}</select></label><label className="text-xs font-medium">Deadline<input type="datetime-local" className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm" value={draft.dueDate} onChange={(event) => update(index, { dueDate: event.target.value })}/></label><label className="text-xs font-medium">Priority<select className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm" value={draft.priority} onChange={(event) => update(index, { priority: event.target.value as Draft["priority"] })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-medium">Estimated hours<input type="number" min=".25" step=".25" className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm" value={draft.estimatedHours} onChange={(event) => update(index, { estimatedHours: Number(event.target.value) })}/></label>{source?.dependency && <div className="sm:col-span-2 text-xs text-slate-500"><span className="font-semibold">Dependency:</span> {source.dependency}</div>}</div>
      </article>; })}</div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Close</Button>{drafts.length > 0 && <Button disabled={pending} onClick={commit}><FileText size={16}/>{pending ? "Creating…" : `Create ${drafts.filter((draft) => draft.included).length} tasks`}</Button>}</div>
    </section>}
  </div></div>;
};
