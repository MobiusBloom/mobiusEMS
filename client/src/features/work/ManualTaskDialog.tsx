import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { workApi, type Project } from "./workApi";
import { skillApi } from "@/features/skills/skillApi";

export const ManualTaskDialog = ({ projects, onClose, onSuccess }: { projects: Project[]; onClose: () => void; onSuccess: () => Promise<void> }) => {
  const roleAssessment = useQuery({ queryKey: ["skills", "role-assessment"], queryFn: skillApi.roleAssessment });
  const skillsList = roleAssessment.data?.assessment?.scores || roleAssessment.data?.catalog || [];

  const [form, setForm] = useState({
    name: "",
    description: "",
    project: "",
    verbalAssigner: "",
    skillId: "",
    skillName: "",
    priority: "MEDIUM",
    complexity: "MEDIUM",
    estimatedHours: 1,
    deadline: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  });

  const create = useMutation({
    mutationFn: () => workApi.createManualTask({ ...form, estimatedHours: Number(form.estimatedHours) }),
    onSuccess: async () => { await onSuccess(); onClose(); }
  });

  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/35 p-4 backdrop-blur-sm"><form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><div className="flex items-start"><div className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><ClipboardPlus size={18}/></div><div className="ml-3"><h2 className="text-xl font-semibold">Add verbally assigned task</h2><p className="mt-1 text-xs text-slate-400">Record work assigned outside the system. It will be assigned to you automatically.</p></div><button type="button" className="ml-auto grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close" onClick={onClose}><X size={17}/></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Task name<Input required minLength={2} className="mt-2" placeholder="What needs to be done?" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label><label className="text-sm font-medium">Project<select required className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })}><option value="">Select your project</option>{projects.map((project) => <option value={project._id} key={project._id}>{project.name}</option>)}</select></label><label className="text-sm font-medium">Verbally assigned by<Input required minLength={2} className="mt-2" placeholder="Manager or lead name" value={form.verbalAssigner} onChange={(event) => setForm({ ...form, verbalAssigner: event.target.value })}/></label>

  {skillsList.length > 0 && <label className="text-sm font-medium sm:col-span-2">Tested Skill (optional — measures delivery velocity)
    <select className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={form.skillId} onChange={(event) => {
      const selected = skillsList.find((s) => ("skillId" in s ? s.skillId : s.id) === event.target.value);
      setForm({ ...form, skillId: event.target.value, skillName: selected?.name || "" });
    }}>
      <option value="">General (No specific skill)</option>
      {skillsList.map((item) => {
        const id = "skillId" in item ? item.skillId : item.id;
        return <option value={id} key={id}>{item.name} ({item.level} · Claimed {"rating" in item ? item.rating : "?"}/10)</option>;
      })}
    </select>
  </label>}

  <label className="text-sm font-medium">Priority<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-sm font-medium">Complexity<select className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={form.complexity} onChange={(event) => setForm({ ...form, complexity: event.target.value })}>{["EASY", "MEDIUM", "HARD", "VERY_HARD"].map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-medium">Estimated hours<Input required type="number" min=".25" step=".25" className="mt-2" value={form.estimatedHours} onChange={(event) => setForm({ ...form, estimatedHours: Number(event.target.value) })}/></label><label className="text-sm font-medium">Deadline<Input required type="date" className="mt-2" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })}/></label><label className="text-sm font-medium sm:col-span-2">Description<textarea rows={3} maxLength={5000} className="mt-2 w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-50" placeholder="Add useful instructions or expected outcome" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label></div>{projects.length === 0 && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">You must be added to a project before recording a manual task.</p>}{create.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{create.error.message}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={projects.length === 0 || create.isPending}>{create.isPending ? "Adding..." : "Add to my board"}</Button></div></form></div>;
};

