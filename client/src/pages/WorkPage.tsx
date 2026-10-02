import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ClipboardPlus, FileText, Mic, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/features/auth/AuthProvider";
import { employeeApi } from "@/features/employees/employeeApi";
import { organizationApi } from "@/features/organization/organizationApi";
import { ManualTaskDialog } from "@/features/work/ManualTaskDialog";
import { TaskDrawer } from "@/features/work/TaskDrawer";
import { VoiceTaskDialog } from "@/features/work/VoiceTaskDialog";
import { TaskDispatcherDialog } from "@/features/work/TaskDispatcherDialog";
import { workApi, type Task } from "@/features/work/workApi";
import { GamificationHeader } from "@/features/work/GamificationHeader";

const columns = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"] as const;

export const WorkPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTaskId = searchParams.get("task");
  const isEmployee = user?.role === "EMPLOYEE";
  const [dialog, setDialog] = useState<"project" | "task" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [dispatcherOpen, setDispatcherOpen] = useState(false);
  const [dragged, setDragged] = useState<Task | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [blocked, setBlocked] = useState<{ task: Task; target: string } | null>(null);
  const [blockReason, setBlockReason] = useState("TECHNICAL_ISSUE");
  const [projectForm, setProjectForm] = useState({ name: "", description: "", code: "", department: "", projectManager: "", teamMembers: [] as string[], startDate: new Date().toISOString().slice(0, 10), status: "PLANNING", priority: "MEDIUM" });
  const [taskForm, setTaskForm] = useState({ name: "", description: "", project: "", assignedEmployee: "", priority: "MEDIUM", complexity: "MEDIUM", estimatedHours: 4, deadline: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });

  const projects = useQuery({ queryKey: ["projects"], queryFn: workApi.projects });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: workApi.tasks });
  const standardTasks = useMemo(() => tasks.data?.items.filter((task) => (task as Task & { taskType?: string }).taskType !== "LEAD_LIST") ?? [], [tasks.data?.items]);
  const metrics = useQuery({ queryKey: ["tasks", "metrics"], queryFn: workApi.metrics });
  const organization = useQuery({ queryKey: ["organization"], queryFn: organizationApi.list, enabled: !!dialog });
  const employees = useQuery({ queryKey: ["employees", "work"], queryFn: () => employeeApi.list(new URLSearchParams({ page: "1", limit: "100" })), enabled: !!dialog });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: ["projects"] }), queryClient.invalidateQueries({ queryKey: ["gamification"] })]); };
  const generateProjectCode = (name: string) =>
    name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 15) || `PRJ-${Date.now().toString(36).toUpperCase()}`;
  const createProject = useMutation({ mutationFn: () => workApi.createProject({ ...projectForm, code: projectForm.code || generateProjectCode(projectForm.name) }), onSuccess: async () => { setDialog(null); await refresh(); } });
  const createTask = useMutation({ mutationFn: () => workApi.createTask({ ...taskForm, estimatedHours: Number(taskForm.estimatedHours) }), onSuccess: async () => { setDialog(null); await refresh(); } });
  const transition = useMutation({ mutationFn: ({ task, status, blockerReason }: { task: Task; status: string; blockerReason?: string }) => workApi.transition(task._id, { status, ...(status === "BLOCKED" && { blockerReason, blockerExternal: ["WAITING_FOR_CLIENT", "EXTERNAL_DEPENDENCY", "ACCESS_REQUIRED"].includes(blockerReason ?? "") }) }), onSuccess: refresh });
  const move = (task: Task, status: string) => { if (task.status === status) return; if (status === "BLOCKED") setBlocked({ task, target: status }); else transition.mutate({ task, status }); };
  const canCreate = user?.permissions.includes("task.create");

  useEffect(() => {
    if (!linkedTaskId || !standardTasks.length) return;
    const linkedTask = standardTasks.find((item) => item._id === linkedTaskId);
    if (!linkedTask) return;
    setSelected(linkedTask);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  }, [linkedTaskId, searchParams, setSearchParams, standardTasks]);

  return <main className="flex-1 overflow-hidden px-5 py-8 sm:px-8"><div className="mx-auto max-w-[1600px]">
    {isEmployee && <div className="mb-7"><GamificationHeader/></div>}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-brand-700">Work</p><h1 className="mt-1 text-3xl font-semibold">Projects & task board</h1><p className="mt-2 text-sm text-slate-500">Track outcomes, blockers, quality, deadlines and rework without rewarding longer hours.</p></div>{isEmployee ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setManualOpen(true)}><ClipboardPlus size={16}/> Add manual task</Button><Button onClick={() => setVoiceOpen(true)}><Mic size={16}/> Voice task</Button></div> : canCreate && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setDialog("project")}><Plus size={16}/> Project</Button><Button variant="secondary" onClick={() => setDialog("task")}><Plus size={16}/> Task</Button><Button variant="secondary" onClick={() => setDispatcherOpen(true)}><FileText size={16}/> Import tasks</Button><Button onClick={() => setVoiceOpen(true)}><Mic size={16}/> Voice control</Button></div>}</div>

    <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">{[{ label: "Open tasks", value: metrics.data?.open ?? 0 }, { label: "Overdue", value: metrics.data?.overdue ?? 0 }, { label: "On-time rate", value: `${metrics.data?.onTimeRate ?? 0}%` }, { label: "Quality", value: metrics.data?.averageQuality || "—" }, { label: "Rework rate", value: `${metrics.data?.reworkRate ?? 0}%` }].map((item) => <div className="rounded-xl border bg-white p-4" key={item.label}><p className="text-xs text-slate-400">{item.label}</p><p className="mt-1 text-xl font-semibold">{item.value}</p></div>)}</section>

    <section className="mt-5 overflow-x-auto pb-3"><div className="grid min-w-[1200px] grid-cols-5 gap-3">{columns.map((status) => <div key={status} className="rounded-2xl bg-slate-100/80 p-3" onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged) move(dragged, status); setDragged(null); }}><div className="flex items-center justify-between px-1 py-2"><h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{status.replaceAll("_", " ")}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{standardTasks.filter((task) => task.status === status).length}</span></div><div className="mt-2 min-h-96 space-y-3">{standardTasks.filter((task) => task.status === status).map((task) => <article draggable onDragStart={() => setDragged(task)} onClick={() => setSelected(task)} key={task._id} className="cursor-grab rounded-xl border bg-white p-4 shadow-sm active:cursor-grabbing"><div className="flex items-start justify-between"><div><span className="text-[10px] font-semibold text-slate-400">{task.taskId}</span>{task.assignmentSource === "SELF_REPORTED" && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">MANUAL</span>}</div><div className="flex gap-1.5"><span className="rounded-full bg-gradient-to-r from-violet-100 to-cyan-100 px-2 py-0.5 text-[9px] font-bold text-violet-700">+{task.potentialXp} XP</span><span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${task.priority === "CRITICAL" ? "bg-red-50 text-red-700" : task.priority === "HIGH" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-500"}`}>{task.priority}</span></div></div><h3 className="mt-2 text-sm font-semibold leading-5">{task.name}</h3><p className="mt-2 text-xs text-slate-400">{task.project.name}</p>{task.verbalAssigner && <p className="mt-1 text-[10px] text-blue-600">Verbally assigned by {task.verbalAssigner}</p>}{task.blocker && <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700"><AlertTriangle size={14}/><span>{task.blocker.reason.replaceAll("_", " ")}</span></div>}<div className="mt-4 flex items-center justify-between border-t pt-3"><div className="flex items-center gap-1 text-[11px] text-slate-400"><CalendarClock size={13}/>{new Date(task.deadline).toLocaleDateString()}</div><div className="grid size-7 place-items-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">{task.assignedEmployee.firstName[0]}{task.assignedEmployee.lastName[0]}</div></div></article>)}</div></div>)}</div></section>
  </div>

  {dialog && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/35 p-4"><form className="my-auto w-full max-w-lg rounded-2xl bg-white p-6" onSubmit={(event) => { event.preventDefault(); if (dialog === "project") createProject.mutate(); else createTask.mutate(); }}><h2 className="text-xl font-semibold">Create {dialog}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Name<Input required className="mt-2" value={dialog === "project" ? projectForm.name : taskForm.name} onChange={(event) => dialog === "project" ? setProjectForm({ ...projectForm, name: event.target.value }) : setTaskForm({ ...taskForm, name: event.target.value })}/></label><label className="text-sm font-medium sm:col-span-2">Description <span className="font-normal text-slate-400">(optional)</span><textarea rows={3} maxLength={dialog === "project" ? 3000 : 5000} className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-50" placeholder={dialog === "project" ? "Describe the project goals, scope, or expected outcome" : "Add instructions, context, or the expected outcome"} value={dialog === "project" ? projectForm.description : taskForm.description} onChange={(event) => dialog === "project" ? setProjectForm({ ...projectForm, description: event.target.value }) : setTaskForm({ ...taskForm, description: event.target.value })}/><span className="mt-1 block text-xs font-normal text-slate-400">{dialog === "project" ? "Add context that should be saved with this project." : "The description will appear in the task details."}</span></label>{dialog === "project" ? <><label className="text-sm font-medium sm:col-span-2">Department<select required className="mt-2 h-11 w-full rounded-xl border px-3" value={projectForm.department} onChange={(event) => setProjectForm({ ...projectForm, department: event.target.value })}><option value="">Select department</option>{organization.data?.departments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-sm font-medium sm:col-span-2">Project manager<select required className="mt-2 h-11 w-full rounded-xl border px-3" value={projectForm.projectManager} onChange={(event) => setProjectForm({ ...projectForm, projectManager: event.target.value })}><option value="">Select project manager</option>{employees.data?.items.map((item) => <option key={item._id} value={item._id}>{item.firstName} {item.lastName}</option>)}</select></label></> : <><label className="text-sm font-medium">Project<select required className="mt-2 h-11 w-full rounded-xl border px-3" value={taskForm.project} onChange={(event) => setTaskForm({ ...taskForm, project: event.target.value })}><option value="">Select project</option>{projects.data?.items.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Assignee<select required className="mt-2 h-11 w-full rounded-xl border px-3" value={taskForm.assignedEmployee} onChange={(event) => setTaskForm({ ...taskForm, assignedEmployee: event.target.value })}><option value="">Select assignee</option>{employees.data?.items.map((item) => <option key={item._id} value={item._id}>{item.firstName} {item.lastName}</option>)}</select></label><label className="text-sm font-medium">Estimated hours<Input required type="number" min=".25" step=".25" className="mt-2" value={taskForm.estimatedHours} onChange={(event) => setTaskForm({ ...taskForm, estimatedHours: Number(event.target.value) })}/></label><label className="text-sm font-medium">Deadline<Input required type="date" className="mt-2" value={taskForm.deadline} onChange={(event) => setTaskForm({ ...taskForm, deadline: event.target.value })}/></label></>}</div>{(createProject.error || createTask.error) && <p className="mt-3 text-sm text-red-600">{createProject.error?.message ?? createTask.error?.message}</p>}<div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={createProject.isPending || createTask.isPending}>Create</Button></div></form></div>}
  {manualOpen && <ManualTaskDialog projects={projects.data?.items ?? []} onClose={() => setManualOpen(false)} onSuccess={refresh}/>} 
  {voiceOpen && user && <VoiceTaskDialog role={user.role} onClose={() => setVoiceOpen(false)} onSuccess={refresh}/>} 
  {dispatcherOpen && <TaskDispatcherDialog projects={projects.data?.items ?? []} onClose={() => setDispatcherOpen(false)} onSuccess={refresh}/>}
  {blocked && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4"><form className="w-full max-w-sm rounded-2xl bg-white p-6" onSubmit={(event) => { event.preventDefault(); transition.mutate({ task: blocked.task, status: blocked.target, blockerReason: blockReason }); setBlocked(null); }}><h2 className="text-xl font-semibold">Mark task blocked</h2><p className="mt-2 text-sm text-slate-500">Choose the cause so performance calculations can distinguish external delays.</p><label className="mt-5 block text-sm font-medium">Blocker reason<select className="mt-2 h-11 w-full rounded-xl border px-3" value={blockReason} onChange={(event) => setBlockReason(event.target.value)}>{["WAITING_FOR_MANAGER", "WAITING_FOR_CLIENT", "TECHNICAL_ISSUE", "DEPENDENCY", "ACCESS_REQUIRED", "REQUIREMENT_UNCLEAR", "EXTERNAL_DEPENDENCY", "OTHER"].map((item) => <option key={item}>{item.replaceAll("_", " ")}</option>)}</select></label><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setBlocked(null)}>Cancel</Button><Button>Confirm blocker</Button></div></form></div>}
  {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} onRefresh={refresh}/>} 
  </main>;
};
