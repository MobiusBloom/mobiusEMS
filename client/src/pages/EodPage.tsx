import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmployeeReport, type MyReportData } from "@/features/eod/EmployeeReport";
import { EodAnalyticsDashboard, EodTeamReports } from "@/features/eod/EodAnalyticsDashboard";
import { EodTemplateManager } from "@/features/eod/EodTemplateManager";
import { panel, today } from "@/features/eod/EodComponents";
export function EodPage() {
  const { user } = useAuth();
  const canAnalyze = user?.permissions.some(p => p.startsWith("eod.analytics."));
  const canViewSelf = user?.permissions.includes("eod.view.self");
  const canManageTemplates = user?.permissions.includes("eod.template.manage");
  const canViewTeam = user?.permissions.some(p => ["eod.view.team", "eod.view.department", "eod.view.all"].includes(p));
  const [tab, setTab] = useState(canViewSelf && user?.role !== "SUPER_ADMIN" ? "report" : canAnalyze ? "analytics" : canViewTeam ? "team" : "templates");
  const [date, setDate] = useState(today);
  const query = useQuery({ queryKey: ["eod", "me", user?.id, date], queryFn: () => api.get<MyReportData>(`/api/v1/eod/me?date=${date}`), enabled: !!date && tab === "report" && !!canViewSelf, staleTime: 30_000 });
  return <main className="space-y-6 p-4 sm:p-8"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-700"><ClipboardList size={18} aria-hidden="true"/>Daily Work Intelligence</p><h1 className="text-2xl font-bold sm:text-3xl">{tab === "report" ? "Daily work report" : tab === "templates" ? "Reporting templates" : "Team work intelligence"}</h1><p className="mt-2 text-sm text-slate-600">Work visibility, shared context, and the support your team needs.</p></div><label className="text-sm font-semibold">Report date (IST)<Input type="date" className="mt-2" value={date} max={today()} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label></header><nav aria-label="Daily work views" className="flex flex-wrap gap-2 border-b pb-4">{[["report", "My daily report", canViewSelf], ["team", "Team reports", canViewTeam], ["analytics", "Analytics & review", canAnalyze], ["templates", "Templates", canManageTemplates]].filter(([, , allowed]) => allowed).map(([key, label]) => <Button key={String(key)} variant={tab === key ? "primary" : "secondary"} aria-pressed={tab === key} onClick={() => setTab(String(key))}>{label}</Button>)}</nav>
    {tab === "report" && <>{query.isPending && <p role="status" className={panel}>Loading your daily work…</p>}{query.error && <div role="alert" className={panel}><p>{query.error.message}</p><Button className="mt-3" variant="secondary" onClick={() => query.refetch()}>Try again</Button></div>}{query.data && !query.error && <EmployeeReport key={date} date={date} data={query.data} canSubmit={!!user?.permissions.includes("eod.submit")}/>}</>}
    {tab === "analytics" && canAnalyze && user && <EodAnalyticsDashboard user={user} date={date}/>}
    {tab === "team" && canViewTeam && user && <EodTeamReports user={user} date={date}/>}
    {tab === "templates" && canManageTemplates && <EodTemplateManager/>}
  </main>;
}
