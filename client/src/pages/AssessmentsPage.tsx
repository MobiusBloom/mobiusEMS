import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  Play,
  Search,
  Sparkles,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/features/auth/AuthProvider";
import { employeeApi } from "@/features/employees/employeeApi";
import { skillApi } from "@/features/skills/skillApi";
import { AssessmentMakerModal } from "@/features/assessments/AssessmentMakerModal";
import { AssessmentTestRunner } from "@/features/assessments/AssessmentTestRunner";
import { AssessmentResultModal } from "@/features/assessments/AssessmentResultModal";

const difficultyBadgeStyle: Record<string, string> = {
  BEGINNER: "bg-sky-50 text-sky-700 border-sky-200",
  INTERMEDIATE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ADVANCED: "bg-purple-50 text-purple-700 border-purple-200",
  EXPERT: "bg-rose-50 text-rose-700 border-rose-200",
};

export const AssessmentsPage = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  const canManage =
    !["EMPLOYEE", "APPLICANT"].includes(user?.role ?? "") && (
    user?.permissions.some((p) =>
      ["skill.verify", "skill.create", "employee.update", "department.view"].includes(p)
    ) ?? false);

  const [activeTab, setActiveTab] = useState<"my" | "all">(canManage ? "all" : "my");
  const [makerOpen, setMakerOpen] = useState(false);
  const [runningAssessmentId, setRunningAssessmentId] = useState<string | null>(null);
  const [viewResultId, setViewResultId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Queries
  const assessmentsQuery = useQuery({
    queryKey: ["assessments"],
    queryFn: skillApi.assessments,
  });

  const employeesQuery = useQuery({
    queryKey: ["employees", "assessment-selector"],
    queryFn: () => employeeApi.list(new URLSearchParams({ limit: "100", page: "1" })),
    enabled: canManage,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => skillApi.deleteAssessment(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["assessments"] });
    },
  });

  const allAssessments = useMemo(() => assessmentsQuery.data?.items ?? [], [assessmentsQuery.data?.items]);

  // Current employee's assessments
  const myAssessments = useMemo(() => {
    return allAssessments.filter((item) => {
      const assignedUser = item.assignedEmployee?.user;
      const assignedUserId = (typeof assignedUser === "string" ? assignedUser : assignedUser?._id) || "";
      // If backend filtered for employee, all returned items belong to them
      if (["EMPLOYEE", "APPLICANT"].includes(user?.role ?? "")) return true;
      return assignedUserId === user?.id;
    });
  }, [allAssessments, user]);

  // Filtered company assessments
  const filteredAllAssessments = useMemo(() => {
    return allAssessments.filter((item) => {
      const q = searchQuery.toLowerCase();
      const empName = `${item.assignedEmployee?.firstName || item.assignedCandidate?.name || ""} ${item.assignedEmployee?.lastName || ""}`.toLowerCase();
      const empId = (item.assignedEmployee?.employeeId || "").toLowerCase();
      const title = (item.name || "").toLowerCase();

      const matchesSearch = !q || empName.includes(q) || empId.includes(q) || title.includes(q);

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "PENDING" && item.status !== "COMPLETED") ||
        (statusFilter === "PASSED" && item.result === "PASSED") ||
        (statusFilter === "FAILED" && item.result === "FAILED");

      return matchesSearch && matchesStatus;
    });
  }, [allAssessments, searchQuery, statusFilter]);

  // Statistics calculation
  const stats = useMemo(() => {
    const list = activeTab === "my" ? myAssessments : allAssessments;
    const total = list.length;
    const completed = list.filter((a) => a.status === "COMPLETED").length;
    const pending = total - completed;
    const passed = list.filter((a) => a.result === "PASSED").length;
    const passRate = completed > 0 ? Math.round((passed / completed) * 100) : 0;

    return { total, completed, pending, passed, passRate };
  }, [allAssessments, myAssessments, activeTab]);

  return (
    <main className="flex-1 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-[1440px] space-y-7">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                Workforce Capability
              </span>
              <span className="text-xs text-slate-400">· Industry Standard</span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">
              Assessments & Skill Testing
            </h1>
            <p className="mt-1 text-sm text-slate-500 max-w-2xl">
              Create AI-generated assessments tailored to any Job Description (JD), assign to employees,
              and execute verified tests with real-time auto-grading and review scorecards.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {canManage && (
              <Button
                onClick={() => setMakerOpen(true)}
                className="gap-2 bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-600/20 hover:from-brand-700 hover:to-indigo-700"
              >
                <Sparkles size={16} />
                AI Assessment Maker
              </Button>
            )}
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Total Assessments
              </p>
              <div className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-600">
                <FileCheck2 size={18} />
              </div>
            </div>
            <p className="mt-2 text-3xl font-black text-slate-900">{stats.total}</p>
            <p className="mt-1 text-[11px] text-slate-400">Active and archived evaluations</p>
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Pending Tests
              </p>
              <div className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <Clock size={18} />
              </div>
            </div>
            <p className="mt-2 text-3xl font-black text-amber-600">{stats.pending}</p>
            <p className="mt-1 text-[11px] text-slate-400">Awaiting submission</p>
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Completed
              </p>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <CheckCircle2 size={18} />
              </div>
            </div>
            <p className="mt-2 text-3xl font-black text-blue-600">{stats.completed}</p>
            <p className="mt-1 text-[11px] text-slate-400">Fully scored & evaluated</p>
          </div>

          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Pass Rate
              </p>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <Award size={18} />
              </div>
            </div>
            <p className="mt-2 text-3xl font-black text-emerald-600">{stats.passRate}%</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {stats.passed} passed of {stats.completed} submitted
            </p>
          </div>
        </div>

        {/* Tabs & Controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={() => setActiveTab("all")}
                className={`rounded-2xl px-4 py-2 text-xs font-bold transition ${
                  activeTab === "all"
                    ? "bg-brand-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All Company Assessments ({allAssessments.length})
              </button>
            )}

            <button
              onClick={() => setActiveTab("my")}
              className={`rounded-2xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "my"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              My Assessments ({myAssessments.length})
            </button>
          </div>

          {activeTab === "all" && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-56">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <Input
                  className="h-9 pl-9 text-xs"
                  placeholder="Filter by title or employee..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="PASSED">Passed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          )}
        </div>

        {/* ==================================================== */}
        {/* TAB 1: MY ASSESSMENTS VIEW                           */}
        {/* ==================================================== */}
        {activeTab === "my" && (
          <div className="space-y-4">
            {myAssessments.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-soft">
                <FileCheck2 className="mx-auto text-slate-300 mb-3" size={40} />
                <h3 className="text-base font-bold text-slate-800">No Assessments Assigned to You</h3>
                <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                  When your manager or HR administrator assigns a competency test or skill evaluation,
                  it will appear here for you to complete.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {myAssessments.map((item) => {
                  const isCompleted = item.status === "COMPLETED";
                  const isPassed = item.result === "PASSED";

                  return (
                    <div
                      key={item._id}
                      className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft transition hover:shadow-md"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                              difficultyBadgeStyle[item.difficulty] || "bg-slate-50 text-slate-600"
                            }`}
                          >
                            {item.difficulty}
                          </span>
                          {isCompleted ? (
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                isPassed
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {isPassed ? "PASSED" : "FAILED"}
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                              PENDING
                            </span>
                          )}
                        </div>

                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{item.name}</h3>
                          {item.jobDescription && (
                            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                              {item.jobDescription}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                          <span className="flex items-center gap-1">
                            <Clock size={14} className="text-slate-400" />
                            {item.timeLimitMinutes} minutes
                          </span>
                          <span className="flex items-center gap-1">
                            <FileCheck2 size={14} className="text-slate-400" />
                            {item.questions?.length || 0} questions
                          </span>
                          <span className="flex items-center gap-1">
                            <Award size={14} className="text-slate-400" />
                            Passing: {item.passingScore}%
                          </span>
                        </div>
                      </div>

                      <div className="mt-6 border-t border-slate-100 pt-4 flex items-center justify-between">
                        {isCompleted ? (
                          <>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Score Achieved
                              </p>
                              <p className="text-base font-black text-slate-800">
                                {item.score} / {item.maximumScore}{" "}
                                <span className="text-xs font-semibold text-emerald-600">
                                  ({item.percentage ?? Math.round(((item.score || 0) / (item.maximumScore || 1)) * 100)}%)
                                </span>
                              </p>
                              <p className="text-[11px] text-slate-500">{item.timedOut ? "Timed out · " : ""}{item.focusLossCount ?? 0} tab visibility changes</p>
                            </div>
                            <Button
                              variant="secondary"
                              onClick={() => setViewResultId(item._id)}
                              className="h-8 px-3 text-xs gap-1.5"
                            >
                              <Eye size={14} /> View Scorecard
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-amber-600 font-medium">
                              Ready for you to take
                            </span>
                            <Button
                              onClick={() => setRunningAssessmentId(item._id)}
                              className="h-8 px-3 text-xs gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold"
                            >
                              <Play size={14} /> Start Assessment
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: ALL COMPANY ASSESSMENTS VIEW                  */}
        {/* ==================================================== */}
        {activeTab === "all" && (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
            {filteredAllAssessments.length === 0 ? (
              <div className="p-12 text-center">
                <FileCheck2 className="mx-auto text-slate-300 mb-2" size={36} />
                <h4 className="text-sm font-bold text-slate-700">No Assessments Match Your Filters</h4>
                <p className="mt-1 text-xs text-slate-400">
                  Try adjusting your search query or generate an assessment using the button above.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredAllAssessments.map((item) => {
                  const isCompleted = item.status === "COMPLETED";
                  const isPassed = item.result === "PASSED";

                  return (
                    <div
                      key={item._id}
                      className="flex flex-col gap-4 p-5 transition hover:bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {/* Left: Assessment Details */}
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              difficultyBadgeStyle[item.difficulty] || "bg-slate-50 text-slate-600"
                            }`}
                          >
                            {item.difficulty}
                          </span>
                          <h3 className="font-bold text-slate-900 text-sm">{item.name}</h3>
                          {item.skill?.name && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 font-medium">
                              {item.skill.name}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>{item.questions?.length || 0} questions</span>
                          <span>·</span>
                          <span>{item.timeLimitMinutes} mins limit</span>
                          <span>·</span>
                          <span>Pass mark: {item.passingScore}%</span>
                        </div>
                      </div>

                      {/* Middle: Assigned Employee */}
                      <div className="sm:text-right shrink-0">
                        <p className="text-xs font-bold text-slate-800">
                          {item.assignedEmployee ? `${item.assignedEmployee.firstName} ${item.assignedEmployee.lastName}` : item.assignedCandidate?.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {item.assignedEmployee?.employeeId || item.assignedCandidate?.email} ·{" "}
                          {item.assignedEmployee?.designation?.name || item.assignedCandidate?.position || "Interview applicant"}
                        </p>
                      </div>

                      {/* Right: Status & Actions */}
                      <div className="flex items-center gap-3 shrink-0 sm:justify-end">
                        {isCompleted ? (
                          <div className="text-right">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                isPassed
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {item.score} / {item.maximumScore} ({item.percentage ?? Math.round(((item.score || 0) / (item.maximumScore || 1)) * 100)}%)
                            </span>
                            <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                              {isPassed ? "PASSED" : "FAILED"}
                            </p>
                          </div>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                            PENDING
                          </span>
                        )}

                        {isCompleted ? (
                          <Button
                            variant="secondary"
                            onClick={() => setViewResultId(item._id)}
                            className="h-8 px-3 gap-1 text-xs"
                          >
                            <Eye size={13} /> Scorecard
                          </Button>
                        ) : (
                          <Button
                            onClick={() => setRunningAssessmentId(item._id)}
                            className="h-8 px-3 gap-1 bg-brand-600 hover:bg-brand-700 text-white text-xs"
                          >
                            <Play size={13} /> Take Test
                          </Button>
                        )}

                        {canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete assessment "${item.name}" for ${item.assignedEmployee?.firstName || item.assignedCandidate?.name}?`
                                )
                              ) {
                                deleteMutation.mutate(item._id);
                              }
                            }}
                            className="text-slate-300 hover:text-red-500 transition p-1"
                            title="Delete assessment"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      {makerOpen && (
        <AssessmentMakerModal
          isOpen={makerOpen}
          onClose={() => setMakerOpen(false)}
          employees={employeesQuery.data?.items ?? []}
          employeeLoadError={employeesQuery.error?.message}
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: ["assessments"] });
          }}
        />
      )}

      {runningAssessmentId && (
        <AssessmentTestRunner
          assessmentId={runningAssessmentId}
          onClose={() => setRunningAssessmentId(null)}
          onCompleted={async () => {
            await qc.invalidateQueries({ queryKey: ["assessments"] });
          }}
        />
      )}

      {viewResultId && (
        <AssessmentResultModal
          assessmentId={viewResultId}
          onClose={() => setViewResultId(null)}
        />
      )}
    </main>
  );
};
