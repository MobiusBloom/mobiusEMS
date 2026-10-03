import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock3, LocateFixed, LogIn, LogOut, MapPin, Ruler, ShieldCheck, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { attendanceApi } from "@/features/attendance/attendanceApi";
import { organizationApi } from "@/features/organization/organizationApi";

const locate = () => new Promise<GeolocationPosition>((resolve, reject) => { if (!navigator.geolocation) return reject(new Error("Location is not supported by this device.")); navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(error.code === 1 ? "Location permission is required to mark attendance." : "Unable to get your current location. Turn on GPS and try again.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); });
const time = (value?: string) => value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export const AttendancePage = () => { const { user } = useAuth(); return user?.role === "SUPER_ADMIN" ? <AdminRegister/> : <EmployeeClock/>; };

const REASONS = [
  { value: "CLIENT_MEETING", label: "Client / On-site Meeting" },
  { value: "TRANSIT_DELAY", label: "Transit / Commute Delay" },
  { value: "TECHNICAL_ISSUE", label: "Technical / Biometric Issue" },
  { value: "WORK_TRAVEL", label: "Official Work Travel" },
  { value: "EMERGENCY", label: "Personal Emergency" },
  { value: "OTHER", label: "Other Business Reason" },
];

const EmployeeClock = () => {
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ["attendance", "today"], queryFn: attendanceApi.today });
  const [locationMessage, setLocationMessage] = useState("");
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqDateKey, setReqDateKey] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [reqReason, setReqReason] = useState<string>("CLIENT_MEETING");
  const [reqNote, setReqNote] = useState("");
  const [reqError, setReqError] = useState("");

  const myReqs = useQuery({ queryKey: ["attendance", "regularizations"], queryFn: () => attendanceApi.regularizations() });

  const action = useMutation({
    mutationFn: async (kind: "IN" | "OUT") => {
      setLocationMessage("Getting your precise office location…");
      const position = await locate();
      setLocationMessage(`Location found with ${Math.round(position.coords.accuracy)} m accuracy.`);
      return kind === "IN" ? attendanceApi.checkIn(position) : attendanceApi.checkOut(position);
    },
    onSuccess: async () => {
      setLocationMessage("");
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    }
  });

  const reqMutation = useMutation({
    mutationFn: (body: { dateKey: string; reason: string; note: string }) => attendanceApi.requestRegularization(body),
    onSuccess: async () => {
      setShowReqModal(false);
      setReqNote("");
      setReqError("");
      await queryClient.invalidateQueries({ queryKey: ["attendance", "regularizations"] });
    },
    onError: (err) => {
      setReqError((err instanceof Error ? err.message : "") || "Failed to submit regularization request.");
    }
  });

  if (today.isLoading) return <main className="p-8"><Skeleton className="h-96"/></main>;
  const data = today.data;
  if (!data) return <main className="p-8 text-sm text-red-600">Attendance is unavailable.</main>;
  const record = data.attendance;
  const complete = Boolean(record?.checkOutAt);

  return (
    <main className="flex-1 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-brand-700">Daily attendance</p>
            <h1 className="mt-1 text-3xl font-semibold">Office check-in</h1>
            <p className="mt-2 text-sm text-slate-500">Attendance is accepted only within the approved office geofence.</p>
          </div>
          <Button variant="secondary" onClick={() => setShowReqModal(true)}>
            <ClipboardCheck size={16} /> Request Regularization
          </Button>
        </div>

        <div className="mt-7 grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-3xl border bg-white p-6 shadow-soft sm:p-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm text-slate-400">Today</p>
                <p className="mt-1 text-xl font-semibold">{new Date(`${data.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
              <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${record ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {record?.status.replaceAll("_", " ") ?? "NOT CHECKED IN"}
              </span>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Metric label="Check-in" value={time(record?.checkInAt)} icon={LogIn}/>
              <Metric label="Check-out" value={time(record?.checkOutAt)} icon={LogOut}/>
              <Metric label="Worked" value={record ? duration(record.workedMinutes) : "0h 0m"} icon={Clock3}/>
            </div>
            <div className="mt-8 rounded-2xl bg-brand-50 p-5">
              <div className="flex gap-3">
                <LocateFixed className="mt-0.5 shrink-0 text-brand-700" size={20}/>
                <div>
                  <p className="font-semibold text-brand-900">Location verification required</p>
                  <p className="mt-1 text-sm leading-6 text-brand-700">Allow precise location when your browser asks. The server validates your distance from the office for both check-in and check-out.</p>
                </div>
              </div>
            </div>
            {(action.error || locationMessage) && <p role="alert" className={`mt-5 rounded-xl p-3 text-sm ${action.error ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>{action.error?.message ?? locationMessage}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              <Button className="w-full sm:w-auto" disabled={action.isPending || complete} onClick={() => action.mutate(record ? "OUT" : "IN")}>
                {action.isPending ? <><LocateFixed size={17}/> Verifying location…</> : !record ? <><LogIn size={17}/> Check in at office</> : !complete ? <><LogOut size={17}/> Check out from office</> : <><ShieldCheck size={17}/> Attendance completed</>}
              </Button>
            </div>
          </section>
          <aside className="rounded-3xl bg-ink p-6 text-white shadow-soft sm:p-7">
            <div className="grid size-11 place-items-center rounded-2xl bg-white/10"><Building2 size={20}/></div>
            <h2 className="mt-5 text-xl font-semibold">Approved office</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">{data.office.name}</p>
            <div className="mt-6 space-y-3 text-sm">
              <Info label="Allowed radius" value={`${data.office.radiusMeters} metres`}/>
              <Info label="GPS accuracy" value={`Within ${data.office.maxAccuracyMeters} metres`}/>
              {record && <Info label="Check-in distance" value={`${record.checkInLocation.distanceMeters} metres`}/>}
            </div>
            <p className="mt-7 border-t border-white/10 pt-5 text-xs leading-5 text-white/40">Location is captured only when you press check-in or check-out.</p>
          </aside>
        </div>

        {/* Regularization History */}
        <section className="mt-8 rounded-3xl border bg-white p-6 shadow-soft sm:p-8">
          <h2 className="text-xl font-semibold">My Regularization Requests</h2>
          <p className="mt-1 text-sm text-slate-500">History of late marks or missing check-in regularizations submitted for manager approval.</p>
          <div className="mt-5 overflow-x-auto">
            {myReqs.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : myReqs.data?.items && myReqs.data.items.length > 0 ? (
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Original Status</th>
                    <th className="px-4 py-3">Requested</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {myReqs.data.items.map((r) => (
                    <tr key={r._id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">{r.dateKey}</td>
                      <td className="px-4 py-3 text-slate-700">{r.reason.replaceAll("_", " ")}</td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500">{r.originalStatus}</span></td>
                      <td className="px-4 py-3 font-semibold text-brand-700">{r.requestedStatus}</td>
                      <td className="px-4 py-3"><RegularizationBadge status={r.status} /></td>
                      <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-500" title={r.note}>{r.note}{r.reviewComment ? ` (Reviewer: ${r.reviewComment})` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">No regularization requests found.</p>
            )}
          </div>
        </section>

        {/* Request Modal */}
        {showReqModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold">Request Attendance Regularization</h3>
              <p className="mt-1 text-xs text-slate-500">Submit a missed punch or late arrival explanation for manager review.</p>
              
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <label className="block font-medium text-slate-700">Date</label>
                  <Input type="date" value={reqDateKey} max={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })} onChange={(e) => setReqDateKey(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Reason</label>
                  <select value={reqReason} onChange={(e) => setReqReason(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm">
                    {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700">Explanation / Note (Min 5 chars)</label>
                  <textarea rows={3} value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="Provide details on why regularization is needed..." className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
                </div>
              </div>

              {reqError && <p className="mt-3 text-xs font-medium text-red-600">{reqError}</p>}

              <div className="mt-6 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowReqModal(false)} disabled={reqMutation.isPending}>Cancel</Button>
                <Button disabled={reqMutation.isPending || reqNote.trim().length < 5} onClick={() => reqMutation.mutate({ dateKey: reqDateKey, reason: reqReason, note: reqNote })}>
                  {reqMutation.isPending ? "Submitting…" : "Submit Request"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

const AdminRegister = () => {
  const [tab, setTab] = useState<"register" | "regularizations">("register");
  const [filters, setFilters] = useState({ date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), department: "", search: "" });
  const [radiusInput, setRadiusInput] = useState("");
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  
  const queryClient = useQueryClient();
  const register = useQuery({ queryKey: ["attendance", "register", filters], queryFn: () => attendanceApi.register(params) });
  const regularizations = useQuery({ queryKey: ["attendance", "all-regularizations"], queryFn: () => attendanceApi.regularizations() });
  const organization = useQuery({ queryKey: ["organization"], queryFn: organizationApi.list });
  
  const data = register.data;
  const configuredRadius = data?.office.radiusMeters;
  useEffect(() => { if (configuredRadius !== undefined) setRadiusInput(String(configuredRadius)); }, [configuredRadius]);

  const configure = useMutation({ mutationFn: async () => attendanceApi.configureOffice(await locate(), configuredRadius ?? 300), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["attendance"] }) });
  const radius = Number(radiusInput);
  const radiusInvalid = radiusInput === "" || !Number.isInteger(radius) || radius < 50 || radius > 5000;
  const updateRadius = useMutation({ mutationFn: () => attendanceApi.updateOfficeRadius(radius), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["attendance"] }) });

  const [reviewNote, setReviewNote] = useState("");
  const [activeRegId, setActiveRegId] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, comment }: { id: string; status: "APPROVED" | "REJECTED"; comment?: string }) => attendanceApi.reviewRegularization(id, { status, reviewComment: comment }),
    onSuccess: async () => {
      setActiveRegId(null);
      setReviewNote("");
      await queryClient.invalidateQueries({ queryKey: ["attendance"] });
    }
  });

  const pendingCount = regularizations.data?.items.filter(r => r.status === "PENDING").length ?? 0;

  return (
    <main className="flex-1 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-brand-700">Organization attendance</p>
            <h1 className="mt-1 text-3xl font-semibold">Attendance & Regularization Register</h1>
            <p className="mt-2 text-sm text-slate-500">Super Admin and Manager view across all departments.</p>
          </div>
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
            <button className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`} onClick={() => setTab("register")}>
              Daily Register
            </button>
            <button className={`relative rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "regularizations" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`} onClick={() => setTab("regularizations")}>
              Regularizations
              {pendingCount > 0 && <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{pendingCount}</span>}
            </button>
          </div>
        </div>

        {tab === "register" ? (
          <>
            {data && (
              <section className={`mt-7 rounded-2xl border p-5 ${data.office.isPreciselyConfigured ? "bg-emerald-50/60" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-semibold">{data.office.isPreciselyConfigured ? "Office location is calibrated" : "Office pin needs calibration"}</p>
                    <p className="mt-1 text-sm text-slate-600">{data.office.isPreciselyConfigured ? `Using the exact pin saved at ${data.office.name}.` : "The current pin is an estimated Labhandih location. While physically inside Shivnath Business Centre, capture the exact office pin once."}</p>
                  </div>
                  <Button variant="secondary" disabled={configure.isPending} onClick={() => configure.mutate()}>
                    <LocateFixed size={17}/>{configure.isPending ? "Capturing exact pin…" : data.office.isPreciselyConfigured ? "Update office pin" : "Set office location here"}
                  </Button>
                </div>
                <form className="mt-5 border-t border-emerald-900/10 pt-5" onSubmit={(event) => { event.preventDefault(); if (!radiusInvalid && data.office.isPreciselyConfigured) updateRadius.mutate(); }}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="block max-w-xs flex-1 text-sm font-medium" htmlFor="attendance-radius">
                      Attendance radius (metres)
                      <Input id="attendance-radius" type="number" min={50} max={5000} step={1} inputMode="numeric" aria-describedby="attendance-radius-help" className="mt-2 bg-white" value={radiusInput} onChange={(event) => { setRadiusInput(event.target.value); updateRadius.reset(); }}/>
                    </label>
                    <Button type="submit" variant="secondary" disabled={!data.office.isPreciselyConfigured || radiusInvalid || updateRadius.isPending}>
                      <Ruler size={17}/>{updateRadius.isPending ? "Saving…" : "Save radius"}
                    </Button>
                  </div>
                  <p id="attendance-radius-help" className={`mt-2 text-xs ${radiusInvalid ? "text-red-700" : "text-slate-500"}`}>{radiusInvalid ? "Enter a whole number from 50 to 5,000 metres." : `Employees can check in or out within ${radiusInput} metres of the office pin.`}</p>
                  {!data.office.isPreciselyConfigured && <p className="mt-2 text-xs text-amber-800">Set the exact office location before changing the radius.</p>}
                  {updateRadius.error && <p role="alert" className="mt-3 text-sm text-red-700">{updateRadius.error.message}</p>}
                  {updateRadius.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">Attendance radius updated to {data.office.radiusMeters} metres.</p>}
                </form>
                {configure.error && <p role="alert" className="mt-3 text-sm text-red-700">{configure.error.message}</p>}
                {configure.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">Exact office location saved. Employee attendance now uses this pin.</p>}
              </section>
            )}

            <section className="mt-5 rounded-2xl border bg-white p-4 shadow-soft">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })}/>
                <select className="h-11 rounded-xl border px-3 text-sm" value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
                  <option value="">All departments</option>
                  {organization.data?.departments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                </select>
                <Input placeholder="Search employee or ID" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })}/>
              </div>
            </section>

            {register.isLoading ? (
              <Skeleton className="mt-5 h-96"/>
            ) : register.error ? (
              <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{register.error.message}</p>
            ) : data && (
              <>
                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
                  <Summary label="Employees" value={data.summary.total}/>
                  <Summary label="Present" value={data.summary.present}/>
                  <Summary label="Late" value={data.summary.late}/>
                  <Summary label="Half day" value={data.summary.halfDay}/>
                  <Summary label="On leave" value={data.summary.onLeave}/>
                  <Summary label="Absent" value={data.summary.absent}/>
                </div>
                <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-soft">
                  <div className="flex items-center gap-3 border-b p-5">
                    <MapPin size={17} className="text-brand-700"/>
                    <div>
                      <p className="text-sm font-semibold">{data.office.name}</p>
                      <p className="text-xs text-slate-400">Verified within {data.office.radiusMeters} m</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3">Employee</th>
                          <th className="px-5 py-3">Department</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3">Check-in</th>
                          <th className="px-5 py-3">Check-out</th>
                          <th className="px-5 py-3">Hours</th>
                          <th className="px-5 py-3">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.items.map((item) => (
                          <tr key={item.employee._id}>
                            <td className="whitespace-nowrap px-5 py-4">
                              <p className="font-semibold">{item.employee.firstName} {item.employee.lastName}</p>
                              <p className="text-xs text-slate-400">{item.employee.employeeId}</p>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">{item.employee.department.name}</td>
                            <td className="px-5 py-4"><Status value={item.dailyStatus}/></td>
                            <td className="whitespace-nowrap px-5 py-4">{time(item.attendance?.checkInAt)}</td>
                            <td className="whitespace-nowrap px-5 py-4">{time(item.attendance?.checkOutAt)}</td>
                            <td className="whitespace-nowrap px-5 py-4">{item.attendance ? duration(item.attendance.workedMinutes) : "—"}</td>
                            <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{item.attendance ? `${item.attendance.checkInLocation.distanceMeters} m from office` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.items.length === 0 && <p className="p-10 text-center text-sm text-slate-400">No employees match these filters.</p>}
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-soft">
            <div className="p-5 border-b">
              <h2 className="text-lg font-semibold">Attendance Regularization Requests</h2>
              <p className="text-xs text-slate-500">Review employee punch adjustments, field visit authorizations, and late arrival requests.</p>
            </div>
            {regularizations.isLoading ? (
              <Skeleton className="h-64 m-5" />
            ) : regularizations.data?.items && regularizations.data.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Employee</th>
                      <th className="px-5 py-3">Department</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Original Status</th>
                      <th className="px-5 py-3">Reason</th>
                      <th className="px-5 py-3">Note</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {regularizations.data.items.map((r) => (
                      <tr key={r._id}>
                        <td className="whitespace-nowrap px-5 py-4">
                          <p className="font-semibold">{r.employee?.firstName} {r.employee?.lastName}</p>
                          <p className="text-xs text-slate-400">{r.employee?.employeeId}</p>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">{r.employee?.department?.name ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-4 font-medium">{r.dateKey}</td>
                        <td className="px-5 py-4"><span className="text-xs text-slate-500">{r.originalStatus}</span></td>
                        <td className="px-5 py-4 text-xs font-medium text-slate-700">{r.reason.replaceAll("_", " ")}</td>
                        <td className="max-w-xs px-5 py-4 text-xs text-slate-600">{r.note}</td>
                        <td className="px-5 py-4"><RegularizationBadge status={r.status} /></td>
                        <td className="whitespace-nowrap px-5 py-4 text-right">
                          {r.status === "PENDING" ? (
                            <div className="flex items-center justify-end gap-2">
                              {activeRegId === r._id ? (
                                <div className="flex items-center gap-2">
                                  <Input placeholder="Optional review comment" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} className="h-8 text-xs max-w-[180px]" />
                                  <Button className="h-8 px-2.5 text-xs" onClick={() => reviewMutation.mutate({ id: r._id, status: "APPROVED", comment: reviewNote })} disabled={reviewMutation.isPending}>
                                    Confirm Approve
                                  </Button>
                                  <button type="button" className="inline-flex h-8 items-center justify-center rounded-xl bg-red-600 px-2.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60" onClick={() => reviewMutation.mutate({ id: r._id, status: "REJECTED", comment: reviewNote })} disabled={reviewMutation.isPending}>
                                    Reject
                                  </button>
                                  <Button className="h-8 px-2.5 text-xs" variant="secondary" onClick={() => { setActiveRegId(null); setReviewNote(""); }}>
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <Button className="h-8 px-3 text-xs" variant="secondary" onClick={() => setActiveRegId(r._id)}>
                                    Review
                                  </Button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{r.reviewedBy ? `by ${r.reviewedBy.name}` : "Processed"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-10 text-center text-sm text-slate-400">No regularization requests found.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
};

const RegularizationBadge = ({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) => {
  const style = status === "APPROVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : status === "REJECTED" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style}`}>{status}</span>;
};

const Metric = ({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) => <div className="rounded-2xl border p-4"><Icon size={17} className="text-brand-700"/><p className="mt-4 text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
const Info = ({ label, value }: { label: string; value: string }) => <div className="flex justify-between gap-3 rounded-xl bg-white/5 p-3"><span className="text-white/50">{label}</span><span className="text-right font-medium">{value}</span></div>;
const Summary = ({ label, value }: { label: string; value: number }) => <div className="rounded-2xl border bg-white p-4 shadow-soft"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
const Status = ({ value }: { value: string }) => { const style = value === "PRESENT" ? "bg-emerald-50 text-emerald-700" : value === "LATE" ? "bg-amber-50 text-amber-700" : value === "HALF_DAY" ? "bg-orange-50 text-orange-700" : value === "ON_LEAVE" ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"; return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${style}`}>{value.replaceAll("_", " ")}</span>; };

