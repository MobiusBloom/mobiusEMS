import { useState, useMemo, useRef, type FC } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Award,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CornerDownRight,
  Crown,
  Focus,
  Layers3,
  Mail,
  Minus,
  Network,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { organizationApi } from "@/features/organization/organizationApi";
import { governanceApi } from "@/features/governance/governanceApi";
import type { HierarchyEmployeeNode } from "@/features/organization/types";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type ViewMode = "REPORTING_FLOW" | "SENIORITY_TIERS" | "DEPARTMENT_FLOW";

export const getSeniorityBadge = (rank: number) => {
  switch (rank) {
    case 1:
      return {
        label: "Tier 1 • Executive",
        badgeClass: "bg-gradient-to-r from-amber-500 to-yellow-600 text-white shadow-2xs font-bold",
        borderClass: "border-amber-400 shadow-amber-50",
        headerClass: "bg-amber-50 text-amber-900 border-amber-200",
        icon: Crown,
      };
    case 2:
      return {
        label: "Tier 2 • C-Suite / VP",
        badgeClass: "bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold",
        borderClass: "border-indigo-300 shadow-indigo-50",
        headerClass: "bg-indigo-50 text-indigo-900 border-indigo-200",
        icon: ShieldCheck,
      };
    case 3:
      return {
        label: "Tier 3 • Lead / Manager",
        badgeClass: "bg-teal-600 text-white font-semibold",
        borderClass: "border-teal-200 shadow-teal-50",
        headerClass: "bg-teal-50 text-teal-900 border-teal-200",
        icon: Users,
      };
    case 4:
      return {
        label: "Tier 4 • Senior Staff",
        badgeClass: "bg-emerald-700 text-white font-semibold",
        borderClass: "border-emerald-200 shadow-emerald-50",
        headerClass: "bg-emerald-50 text-emerald-900 border-emerald-200",
        icon: Award,
      };
    case 5:
      return {
        label: "Tier 5 • IC / Specialist",
        badgeClass: "bg-slate-700 text-white font-medium",
        borderClass: "border-slate-200",
        headerClass: "bg-slate-50 text-slate-900 border-slate-200",
        icon: Workflow,
      };
    default:
      return {
        label: "Tier 6 • Associate / Intern",
        badgeClass: "bg-slate-500 text-white font-normal",
        borderClass: "border-slate-200",
        headerClass: "bg-slate-100 text-slate-700 border-slate-200",
        icon: Users,
      };
  }
};

export const OrgHierarchyPage = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("REPORTING_FLOW");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<HierarchyEmployeeNode | null>(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [zoomLevel, setZoomLevel] = useState(1);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Auto-structure and manager assignment state
  const [isAutoStructuring, setIsAutoStructuring] = useState(false);
  const [autoStructureMsg, setAutoStructureMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [isEditingManager, setIsEditingManager] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [isSavingManager, setIsSavingManager] = useState(false);
  const [managerActionMsg, setManagerActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["organization-hierarchy-flow"],
    queryFn: organizationApi.getHierarchyFlow,
  });

  const employees = useMemo(() => data?.employees || [], [data?.employees]);
  const departments = useMemo(() => data?.departments || [], [data?.departments]);
  const teams = useMemo(() => data?.teams || [], [data?.teams]);
  const seniorityTiers = useMemo(() => data?.seniorityTiers || [], [data?.seniorityTiers]);
  const stats = data?.stats;
  const jobDescriptionsQuery = useQuery({
    queryKey: ["governance", "job-descriptions"],
    queryFn: governanceApi.jobDescriptions,
  });
  const openJobs = useMemo(() => jobDescriptionsQuery.data?.items ?? [], [jobDescriptionsQuery.data]);

  const canManageHierarchy = user?.role === "SUPER_ADMIN" || user?.role === "HR_ADMIN";

  // Identify current logged-in employee node
  const myEmployee = useMemo(() => {
    if (!user) return null;
    return (
      employees.find(
        (e) => e.userId === user.id || e.officialEmail?.toLowerCase() === user.email?.toLowerCase()
      ) || null
    );
  }, [employees, user]);

  // Build employee lookup maps
  const employeeMap = useMemo(() => {
    const map = new Map<string, HierarchyEmployeeNode>();
    for (const emp of employees) {
      map.set(emp._id, emp);
    }
    return map;
  }, [employees]);

  // Direct reports map: managerId -> direct reports array (sorted by seniority)
  const directReportsMap = useMemo(() => {
    const map = new Map<string, HierarchyEmployeeNode[]>();
    for (const emp of employees) {
      const mgrId = emp.effectiveReportingManager?._id || emp.reportingManager?._id;
      if (mgrId) {
        const existing = map.get(mgrId) || [];
        existing.push(emp);
        map.set(mgrId, existing);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.seniorityRank || 99) - (b.seniorityRank || 99));
    }
    return map;
  }, [employees]);

  // Root employees (those without a reporting manager or manager not in active list)
  // Ranked so CEO is guaranteed to be the single primary root at the top
  const rootEmployees = useMemo(() => {
    const roots = employees.filter((emp) => {
      const mgrId = emp.effectiveReportingManager?._id || emp.reportingManager?._id;
      if (!mgrId) return true;
      return !employeeMap.has(mgrId);
    });
    roots.sort((a, b) => (a.seniorityRank || 99) - (b.seniorityRank || 99));
    return roots;
  }, [employees, employeeMap]);

  // Search filter
  const matchingEmployeeIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase().trim();
    const matches = new Set<string>();
    for (const emp of employees) {
      if (
        emp.name.toLowerCase().includes(q) ||
        emp.officialEmail.toLowerCase().includes(q) ||
        emp.designation?.name?.toLowerCase().includes(q) ||
        emp.department?.name?.toLowerCase().includes(q) ||
        emp.team?.name?.toLowerCase().includes(q)
      ) {
        matches.add(emp._id);
      }
    }
    return matches;
  }, [searchQuery, employees]);

  // Toggle node collapse
  const toggleCollapse = (id: string) => {
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedNodeIds(new Set());
  };

  const collapseAll = () => {
    const allManagerIds = new Set<string>();
    for (const emp of employees) {
      if (emp.directReportsCount > 0) {
        allManagerIds.add(emp._id);
      }
    }
    setCollapsedNodeIds(allManagerIds);
  };

  // Focus on current user
  const handleFocusOnMe = () => {
    if (!myEmployee) return;
    setHighlightedId(myEmployee._id);
    setSelectedEmployee(myEmployee);

    let currMgrId = myEmployee.effectiveReportingManager?._id || myEmployee.reportingManager?._id;
    if (currMgrId) {
      setCollapsedNodeIds((prev) => {
        const next = new Set(prev);
        while (currMgrId) {
          next.delete(currMgrId);
          const mgr = employeeMap.get(currMgrId);
          currMgrId = mgr?.effectiveReportingManager?._id || mgr?.reportingManager?._id;
        }
        return next;
      });
    }

    setTimeout(() => {
      const el = document.getElementById(`org-node-${myEmployee._id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }, 120);
  };

  // Calculate chain of command for selected employee
  const reportingChain = useMemo(() => {
    if (!selectedEmployee) return [];
    const chain: HierarchyEmployeeNode[] = [];
    let curr: HierarchyEmployeeNode | undefined = selectedEmployee;
    const visited = new Set<string>();

    while (curr && !visited.has(curr._id)) {
      visited.add(curr._id);
      chain.unshift(curr);
      const mgrId = curr.effectiveReportingManager?._id || curr.reportingManager?._id;
      if (mgrId) {
        curr = employeeMap.get(mgrId);
      } else {
        curr = undefined;
      }
    }
    return chain;
  }, [selectedEmployee, employeeMap]);

  // Compute recursive subordinate IDs for selected employee to prevent circular cycles in reassignment
  const selectedSubordinateIds = useMemo(() => {
    if (!selectedEmployee) return new Set<string>();
    const result = new Set<string>();
    const queue = [selectedEmployee._id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const subs = directReportsMap.get(curr) || [];
      for (const sub of subs) {
        if (!result.has(sub._id)) {
          result.add(sub._id);
          queue.push(sub._id);
        }
      }
    }
    return result;
  }, [selectedEmployee, directReportsMap]);

  // Handle Auto-Structure action
  const handleAutoStructure = async (forceAll = false) => {
    try {
      setIsAutoStructuring(true);
      setAutoStructureMsg(null);
      const res = await organizationApi.autoStructureHierarchy(forceAll);
      await refetch();
      setAutoStructureMsg({
        type: "success",
        text: `Hierarchy successfully structured! Updated ${res.updatedCount} reporting lines under ${res.topExecutiveName || "CEO"} (${res.topExecutiveTitle || "Executive Leadership"}).`,
      });
      setTimeout(() => setAutoStructureMsg(null), 8000);
    } catch (err) {
      setAutoStructureMsg({
        type: "error",
        text: (err instanceof Error ? err.message : "") || "Failed to auto-structure hierarchy.",
      });
    } finally {
      setIsAutoStructuring(false);
    }
  };

  // Handle manual manager reassignment
  const handleSaveManager = async () => {
    if (!selectedEmployee) return;
    try {
      setIsSavingManager(true);
      setManagerActionMsg(null);
      const mgrId = selectedManagerId === "ROOT_NONE" ? null : selectedManagerId;
      await organizationApi.updateEmployeeManager(selectedEmployee._id, mgrId);
      await refetch();
      setIsEditingManager(false);
      setManagerActionMsg({
        type: "success",
        text: "Reporting manager updated and saved to company database.",
      });
      setTimeout(() => setManagerActionMsg(null), 6000);
    } catch (err) {
      setManagerActionMsg({
        type: "error",
        text: (err instanceof Error ? err.message : "") || "Failed to update reporting manager.",
      });
    } finally {
      setIsSavingManager(false);
    }
  };

  // Sync selected manager ID when drawer opens
  const openEmployeeDrawer = (emp: HierarchyEmployeeNode) => {
    setSelectedEmployee(emp);
    setIsEditingManager(false);
    setSelectedManagerId(emp.reportingManager?._id || "ROOT_NONE");
    setManagerActionMsg(null);
  };

  return (
    <main className="flex-1 overflow-x-hidden bg-[#f8fafc] px-4 py-6 sm:px-8 sm:py-8 min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-[1600px] space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-600">
              <Workflow size={20} className="text-brand-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
                Organization Structure
              </span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                Public Organization View
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Visual Hierarchy Flow
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              Explore the executive chain of command, seniority tiers, and departmental structure across the company.
            </p>
          </div>

          {/* Mode Switcher, Auto-Structure & Focus on Me */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setViewMode("REPORTING_FLOW")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  viewMode === "REPORTING_FLOW"
                    ? "bg-brand-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Network size={14} />
                Reporting Hierarchy
              </button>
              <button
                type="button"
                onClick={() => setViewMode("SENIORITY_TIERS")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  viewMode === "SENIORITY_TIERS"
                    ? "bg-brand-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Crown size={14} />
                Seniority Tiers (1–6)
              </button>
              <button
                type="button"
                onClick={() => setViewMode("DEPARTMENT_FLOW")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  viewMode === "DEPARTMENT_FLOW"
                    ? "bg-brand-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Building2 size={14} />
                Departments & Teams
              </button>
            </div>

            {canManageHierarchy && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleAutoStructure(false)}
                disabled={isAutoStructuring}
                className="h-9 text-xs font-semibold shadow-2xs bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
                title="Automatically structure reporting relationships based on executive seniority"
              >
                <Sparkles size={14} className="mr-1.5 text-amber-600 animate-pulse" />
                {isAutoStructuring ? "Structuring..." : "Auto-Structure Hierarchy"}
              </Button>
            )}

            {myEmployee && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleFocusOnMe}
                className="h-9 text-xs font-semibold shadow-2xs"
                title="Locate my position in the organization tree"
              >
                <Focus size={14} className="mr-1.5 text-brand-600" />
                Focus on Me
              </Button>
            )}
          </div>
        </div>

        {/* Action Notifications */}
        {autoStructureMsg && (
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-2xl border p-3.5 text-xs shadow-2xs animate-in fade-in slide-in-from-top-2",
              autoStructureMsg.type === "success"
                ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            )}
          >
            {autoStructureMsg.type === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-red-600 shrink-0" />
            )}
            <span className="font-medium">{autoStructureMsg.text}</span>
            <button
              type="button"
              onClick={() => setAutoStructureMsg(null)}
              className="ml-auto text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Stats Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <Users size={18} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Total Workforce</p>
                <p className="text-lg font-bold text-slate-900">{stats?.totalEmployees ?? employees.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <Crown size={18} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Executive Seniority Tiers</p>
                <p className="text-lg font-bold text-slate-900">{seniorityTiers.length} Bands</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
                <Building2 size={18} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Departments</p>
                <p className="text-lg font-bold text-slate-900">{stats?.totalDepartments ?? departments.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Managers & Leads</p>
                <p className="text-lg font-bold text-slate-900">{stats?.totalManagers ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-600">
                <Briefcase size={18} />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Open Requisitions</p>
                <p className="text-lg font-bold text-slate-900">{openJobs.length} Positions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action & Search Control Bar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
          {/* Search bar */}
          <div className="relative flex-1 sm:max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by employee name, role, department..."
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Tree Controls (Expand/Collapse, Zoom) */}
          {viewMode === "REPORTING_FLOW" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={expandAll}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium text-slate-600 hover:bg-white transition"
                  title="Expand all branches"
                >
                  <ChevronsDown size={13} />
                  Expand All
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium text-slate-600 hover:bg-white transition"
                  title="Collapse all branches"
                >
                  <ChevronsUp size={13} />
                  Collapse All
                </button>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.6, Number((z - 0.1).toFixed(1))))}
                  className="grid size-7 place-items-center rounded-md text-slate-600 hover:bg-white transition"
                  title="Zoom Out"
                >
                  <ZoomOut size={13} />
                </button>
                <span className="px-1 text-[11px] font-bold text-slate-600 select-none">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(1.4, Number((z + 0.1).toFixed(1))))}
                  className="grid size-7 place-items-center rounded-md text-slate-600 hover:bg-white transition"
                  title="Zoom In"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="grid size-7 place-items-center rounded-md text-slate-600 hover:bg-white transition"
                  title="Reset Zoom"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Notice Banner: Unassigned Reporting Managers with One-Click Auto-Structure */}
        {(stats?.unassignedManagersCount ?? 0) > 0 && canManageHierarchy && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs shadow-2xs">
            <div className="flex items-start gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500 text-white shrink-0 shadow-xs mt-0.5">
                <Sparkles size={18} />
              </div>
              <div>
                <p className="font-bold text-amber-900 text-sm">
                  Executive Seniority Inference Active ({stats?.unassignedManagersCount} Unassigned Reporting Lines)
                </p>
                <p className="text-amber-800/90 mt-0.5">
                  Employees without explicit reporting managers in the database are dynamically structured by industry seniority (CEO → C-Suite → ICs). Click below to permanently persist these reporting lines.
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => handleAutoStructure(false)}
              disabled={isAutoStructuring}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shrink-0 shadow-xs h-9 px-4"
            >
              {isAutoStructuring ? "Persisting..." : "⚡ Persist Hierarchy to Database"}
            </Button>
          </div>
        )}

        {/* Main Canvas Area */}
        <div className="relative rounded-3xl border border-slate-200 bg-white p-4 shadow-soft min-h-[550px] overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-20 text-center">
              <div className="size-12 rounded-2xl bg-brand-50 text-brand-600 grid place-items-center mb-3 animate-bounce">
                <Network size={24} />
              </div>
              <p className="text-sm font-semibold text-slate-800">Building Organization Hierarchy...</p>
              <p className="mt-1 text-xs text-slate-400">Rendering visual reporting tree & executive flow</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-20 text-center">
              <p className="text-sm font-semibold text-red-600">Failed to load organization hierarchy flow.</p>
              <Button onClick={() => refetch()} variant="secondary" className="mt-3 text-xs">
                Retry
              </Button>
            </div>
          ) : viewMode === "REPORTING_FLOW" ? (
            /* VIEW 1: INDUSTRY STANDARD REPORTING HIERARCHY TREE VIEW */
            <div
              ref={containerRef}
              className="w-full overflow-auto p-4 sm:p-8"
              style={{ minHeight: "500px" }}
            >
              {rootEmployees.length === 0 ? (
                <div className="py-20 text-center">
                  <p className="text-sm text-slate-500">No active employees found in the organization.</p>
                </div>
              ) : (
                <div
                  className="flex flex-col items-center transition-transform origin-top duration-200 pb-12"
                  style={{ transform: `scale(${zoomLevel})` }}
                >
                  {/* Organization Root Hub */}
                  <div className="flex flex-col items-center mb-6">
                    <div className="flex items-center gap-2.5 rounded-2xl border-2 border-brand-500 bg-gradient-to-r from-brand-600 to-indigo-600 px-5 py-3 text-white shadow-lg">
                      <Building2 size={20} className="text-amber-300 shrink-0" />
                      <div>
                        <h2 className="text-sm font-bold tracking-tight">
                          {user?.tenantName ?? "MobiusEMS Organization"}
                        </h2>
                        <p className="text-[10px] text-brand-100 font-medium">Executive Seniority & Reporting Tree</p>
                      </div>
                    </div>
                    {/* Trunk vertical line */}
                    <div className="h-6 w-0.5 bg-slate-300" />
                  </div>

                  {/* Root Leaders (CEO / Managing Director guaranteed at top) */}
                  <div className="flex flex-wrap justify-center gap-8 sm:gap-12">
                    {rootEmployees.map((root) => (
                      <ReportingTreeNode
                        key={root._id}
                        node={root}
                        directReportsMap={directReportsMap}
                        collapsedNodeIds={collapsedNodeIds}
                        toggleCollapse={toggleCollapse}
                        onSelectEmployee={openEmployeeDrawer}
                        selectedId={selectedEmployee?._id}
                        highlightedId={highlightedId}
                        myUserId={user?.id}
                        matchingEmployeeIds={matchingEmployeeIds}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : viewMode === "SENIORITY_TIERS" ? (
            /* VIEW 2: SENIORITY TIERS (LEVEL 1-6 BANDS) */
            <div className="p-4 sm:p-6 space-y-6">
              <div className="border-b pb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Crown size={18} className="text-amber-500" />
                  Executive Seniority Bands & Tiers
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Employees grouped by organizational seniority level, spanning Executive Leadership (Tier 1) down to Associate & Interns (Tier 6).
                </p>
              </div>

              <div className="space-y-6">
                {seniorityTiers.map((tier) => {
                  const badge = getSeniorityBadge(tier.rank);
                  const Icon = badge.icon;
                  return (
                    <div
                      key={tier.rank}
                      className={cn("rounded-2xl border bg-white p-5 shadow-2xs transition", badge.borderClass)}
                    >
                      <div className="flex items-center justify-between border-b pb-3 mb-4">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("grid size-8 place-items-center rounded-lg shadow-xs", badge.badgeClass)}>
                            <Icon size={16} />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">{tier.tierName}</h4>
                            <span className="text-[11px] text-slate-500">
                              Level {tier.rank} Organizational Seniority
                            </span>
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                          {tier.employees.length} {tier.employees.length === 1 ? "Employee" : "Employees"}
                        </span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        {tier.employees.map((emp) => (
                          <div
                            key={emp._id}
                            onClick={() => openEmployeeDrawer(emp)}
                            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 hover:border-brand-400 hover:bg-white hover:shadow-soft transition cursor-pointer"
                          >
                            {emp.profilePhotoUrl ? (
                              <img
                                src={emp.profilePhotoUrl}
                                alt={emp.name}
                                className="size-10 rounded-xl object-cover ring-1 ring-slate-200 shrink-0"
                              />
                            ) : (
                              <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-xs shrink-0">
                                {emp.firstName[0]}
                                {emp.lastName[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <h5 className="truncate text-xs font-bold text-slate-900 group-hover:text-brand-600 transition">
                                {emp.name}
                              </h5>
                              <p className="truncate text-[11px] text-slate-500">
                                {emp.designation?.name || "Staff Member"}
                              </p>
                              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                                <span>{emp.department?.name || "General"}</span>
                                {emp.directReportsCount > 0 && (
                                  <>
                                    <span>•</span>
                                    <span className="font-semibold text-brand-700">
                                      {emp.directReportsCount} reports
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <ChevronRight size={14} className="text-slate-300 group-hover:text-brand-500 shrink-0 transition" />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* VIEW 3: DEPARTMENT & TEAM FLOW VIEW */
            <div className="p-4 sm:p-6 space-y-6">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {departments.map((dept) => {
                  const deptTeams = teams.filter((t) => t.department?._id === dept._id);
                  const deptEmployees = employees.filter((e) => e.department?._id === dept._id);

                  return (
                    <div
                      key={dept._id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 shadow-2xs hover:border-brand-300 transition"
                    >
                      <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                            <Building2 size={18} />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">{dept.name}</h3>
                            {dept.code && (
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                {dept.code}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
                          {deptEmployees.length} {deptEmployees.length === 1 ? "Member" : "Members"}
                        </span>
                      </div>

                      {/* Teams in department */}
                      <div className="mt-4 space-y-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Teams ({deptTeams.length})
                        </p>
                        {deptTeams.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No teams configured in this department.</p>
                        ) : (
                          deptTeams.map((team) => {
                            const teamEmployees = deptEmployees.filter((e) => e.team?._id === team._id);
                            return (
                              <div
                                key={team._id}
                                className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <Layers3 size={13} className="text-slate-400" />
                                    {team.name}
                                  </span>
                                  <span className="text-[10px] font-semibold text-slate-500">
                                    {teamEmployees.length} members
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {teamEmployees.map((e) => (
                                    <button
                                      key={e._id}
                                      type="button"
                                      onClick={() => openEmployeeDrawer(e)}
                                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition"
                                    >
                                      <span className="size-1.5 rounded-full bg-brand-500" />
                                      {e.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )}

                        {/* Direct Dept Members without a team */}
                        {deptEmployees.filter((e) => !e.team).length > 0 && (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-3">
                            <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                              General Department Members:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {deptEmployees
                                .filter((e) => !e.team)
                                .map((e) => (
                                  <button
                                    key={e._id}
                                    type="button"
                                    onClick={() => openEmployeeDrawer(e)}
                                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition"
                                  >
                                    <span className="size-1.5 rounded-full bg-slate-400" />
                                    {e.name}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Open Headcount / Requisitions */}
                        {openJobs.length > 0 && (
                          <div className="rounded-xl border border-dashed border-teal-200 bg-teal-50/50 p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[11px] font-semibold text-teal-800 flex items-center gap-1">
                                <Briefcase size={12} className="text-teal-600" />
                                Open Headcount ({openJobs.length}):
                              </span>
                              <span className="text-[10px] font-bold text-teal-700 bg-teal-100/80 rounded-full px-2 py-0.5">
                                Hiring
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {openJobs.slice(0, 3).map((job) => (
                                <span
                                  key={job._id}
                                  className="inline-flex items-center gap-1 rounded-md bg-white border border-teal-200 px-2 py-0.5 text-[11px] font-medium text-teal-800 shadow-2xs"
                                >
                                  <span className="size-1.5 rounded-full bg-teal-500" />
                                  {job.title}
                                </span>
                              ))}
                              {openJobs.length > 3 && (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-teal-600">
                                  +{openJobs.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Employee Detail Slide-Out Drawer */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative flex h-full w-full max-w-md flex-col bg-white p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setSelectedEmployee(null)}
              className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X size={18} />
            </button>

            {/* Profile Header */}
            <div className="flex items-center gap-4 border-b pb-5 pt-2">
              {selectedEmployee.profilePhotoUrl ? (
                <img
                  src={selectedEmployee.profilePhotoUrl}
                  alt={selectedEmployee.name}
                  className="size-16 rounded-2xl object-cover ring-2 ring-brand-100 shrink-0"
                />
              ) : (
                <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-lg font-bold text-white shadow-xs shrink-0">
                  {selectedEmployee.firstName[0]}
                  {selectedEmployee.lastName[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate text-lg font-bold text-slate-900">{selectedEmployee.name}</h3>
                  {selectedEmployee.userId === user?.id && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 shrink-0">
                      YOU
                    </span>
                  )}
                </div>
                <p className="truncate text-xs font-semibold text-brand-600">
                  {selectedEmployee.designation?.name || "Team Member"}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-mono">{selectedEmployee.employeeId}</span>
                  <span>•</span>
                  <span className="capitalize">{selectedEmployee.status.toLowerCase()}</span>
                </div>
              </div>
            </div>

            {/* Seniority Tier Banner */}
            <div className="mt-4">
              {(() => {
                const badge = getSeniorityBadge(selectedEmployee.seniorityRank || 5);
                const Icon = badge.icon;
                return (
                  <div className={cn("flex items-center justify-between rounded-xl border p-3 text-xs", badge.headerClass)}>
                    <div className="flex items-center gap-2">
                      <Icon size={16} />
                      <span className="font-bold">{badge.label}</span>
                    </div>
                    <span className="font-medium text-[11px]">
                      Level {selectedEmployee.seniorityRank || 5} Band
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Reassignment Feedback Message */}
            {managerActionMsg && (
              <div
                className={cn(
                  "mt-3 flex items-center gap-2 rounded-xl border p-3 text-xs",
                  managerActionMsg.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                )}
              >
                {managerActionMsg.type === "success" ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle size={15} className="text-red-600 shrink-0" />
                )}
                <span>{managerActionMsg.text}</span>
              </div>
            )}

            {/* Details List */}
            <div className="mt-5 space-y-4 text-xs">
              {/* Contact */}
              <div>
                <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                  Contact & Communication
                </span>
                <div className="mt-2 space-y-2">
                  <a
                    href={`mailto:${selectedEmployee.officialEmail}`}
                    className="flex items-center gap-2 text-slate-700 hover:text-brand-600"
                  >
                    <Mail size={14} className="text-slate-400" />
                    <span>{selectedEmployee.officialEmail}</span>
                  </a>
                  {selectedEmployee.phone && (
                    <div className="flex items-center gap-2 text-slate-700">
                      <Phone size={14} className="text-slate-400" />
                      <span>{selectedEmployee.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Department & Team */}
              <div>
                <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                  Organization Placement
                </span>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between rounded-xl border bg-slate-50/80 p-2.5">
                    <span className="text-slate-500">Department</span>
                    <span className="font-bold text-slate-800">{selectedEmployee.department?.name || "General"}</span>
                  </div>
                  {selectedEmployee.team && (
                    <div className="flex items-center justify-between rounded-xl border bg-slate-50/80 p-2.5">
                      <span className="text-slate-500">Team</span>
                      <span className="font-bold text-slate-800">{selectedEmployee.team.name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-xl border bg-slate-50/80 p-2.5">
                    <span className="text-slate-500">Employment Type</span>
                    <span className="font-bold text-slate-800 capitalize">
                      {selectedEmployee.employmentType.replace("_", " ").toLowerCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reporting Manager / Line Management */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                    Direct Reporting Manager
                  </span>
                  {canManageHierarchy && !isEditingManager && (
                    <button
                      type="button"
                      onClick={() => setIsEditingManager(true)}
                      className="text-[11px] font-bold text-brand-600 hover:text-brand-700"
                    >
                      Change Manager
                    </button>
                  )}
                </div>

                {isEditingManager ? (
                  <div className="mt-2 rounded-2xl border border-brand-200 bg-brand-50/30 p-3 space-y-3">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Select New Reporting Manager:
                    </label>
                    <select
                      value={selectedManagerId}
                      onChange={(e) => setSelectedManagerId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-hidden"
                    >
                      <option value="ROOT_NONE">None (Top Executive / Company Root)</option>
                      {employees
                        .filter(
                          (cand) =>
                            cand._id !== selectedEmployee._id &&
                            !selectedSubordinateIds.has(cand._id)
                        )
                        .sort((a, b) => (a.seniorityRank || 99) - (b.seniorityRank || 99))
                        .map((cand) => (
                          <option key={cand._id} value={cand._id}>
                            {cand.name} — {cand.designation?.name || "Staff"} ({cand.seniorityTierName || `Tier ${cand.seniorityRank}`})
                          </option>
                        ))}
                    </select>
                    <p className="text-[10px] text-slate-400 italic">
                      * Direct subordinates and circular paths are automatically excluded to preserve valid tree structure.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={handleSaveManager}
                        disabled={isSavingManager}
                        className="h-8 text-xs font-semibold"
                      >
                        {isSavingManager ? "Saving..." : "Save Manager"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setIsEditingManager(false)}
                        className="h-8 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border bg-slate-50/80 p-2.5">
                    {selectedEmployee.reportingManager ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {selectedEmployee.reportingManager.profilePhotoUrl ? (
                            <img
                              src={selectedEmployee.reportingManager.profilePhotoUrl}
                              alt={selectedEmployee.reportingManager.name}
                              className="size-8 rounded-lg object-cover ring-1 ring-slate-200"
                            />
                          ) : (
                            <div className="grid size-8 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
                              {selectedEmployee.reportingManager.firstName[0]}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-800">{selectedEmployee.reportingManager.name}</p>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {selectedEmployee.reportingManager.employeeId}
                            </span>
                          </div>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          Direct Assigned
                        </span>
                      </div>
                    ) : selectedEmployee.effectiveReportingManager ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {selectedEmployee.effectiveReportingManager.profilePhotoUrl ? (
                            <img
                              src={selectedEmployee.effectiveReportingManager.profilePhotoUrl}
                              alt={selectedEmployee.effectiveReportingManager.name}
                              className="size-8 rounded-lg object-cover ring-1 ring-slate-200"
                            />
                          ) : (
                            <div className="grid size-8 place-items-center rounded-lg bg-amber-600 text-xs font-bold text-white">
                              {selectedEmployee.effectiveReportingManager.firstName[0]}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-800">{selectedEmployee.effectiveReportingManager.name}</p>
                            <span className="text-[10px] text-amber-700 font-medium">
                              Auto-Inferred by Seniority
                            </span>
                          </div>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          ⚡ Inferred
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-600">
                        <Crown size={15} className="text-amber-500" />
                        <span className="font-medium">Company Root / Executive Leader (No Superior)</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chain of Command (Reporting Line) */}
              <div>
                <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                  Chain of Command (Ascending to CEO)
                </span>
                <div className="mt-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-3 space-y-2">
                  {reportingChain.length <= 1 ? (
                    <p className="text-slate-500 italic text-xs">Pinnacle of organization structure (Company Root).</p>
                  ) : (
                    reportingChain.map((node, idx) => {
                      const isTarget = node._id === selectedEmployee._id;
                      return (
                        <div key={node._id} className="flex items-center gap-2">
                          <span className="grid size-5 place-items-center rounded-full bg-brand-200 text-[10px] font-bold text-brand-800 shrink-0">
                            {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEmployeeDrawer(node)}
                            className={cn(
                              "text-left truncate hover:underline flex-1",
                              isTarget ? "font-bold text-brand-700" : "text-slate-700 font-medium"
                            )}
                          >
                            {node.name}
                            <span className="ml-1.5 text-[10px] text-slate-400">
                              ({node.designation?.name || "Staff"})
                            </span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Direct Reports */}
              {selectedEmployee.directReportsCount > 0 && (
                <div>
                  <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                    Direct Subordinates ({selectedEmployee.directReportsCount})
                  </span>
                  <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                    {(directReportsMap.get(selectedEmployee._id) || []).map((sub) => (
                      <button
                        key={sub._id}
                        type="button"
                        onClick={() => openEmployeeDrawer(sub)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
                      >
                        <div className="truncate">
                          <p className="font-bold text-slate-800 truncate">{sub.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{sub.designation?.name || "Member"}</p>
                        </div>
                        <CornerDownRight size={14} className="text-slate-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-auto pt-6">
              <Button
                variant="secondary"
                className="w-full text-xs font-semibold"
                onClick={() => setSelectedEmployee(null)}
              >
                Close Drawer
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

/* RECURSIVE REPORTING TREE NODE COMPONENT */
interface ReportingTreeNodeProps {
  node: HierarchyEmployeeNode;
  directReportsMap: Map<string, HierarchyEmployeeNode[]>;
  collapsedNodeIds: Set<string>;
  toggleCollapse: (id: string) => void;
  onSelectEmployee: (emp: HierarchyEmployeeNode) => void;
  selectedId?: string;
  highlightedId?: string | null;
  myUserId?: string;
  matchingEmployeeIds?: Set<string> | null;
}

const ReportingTreeNode: FC<ReportingTreeNodeProps> = ({
  node,
  directReportsMap,
  collapsedNodeIds,
  toggleCollapse,
  onSelectEmployee,
  selectedId,
  highlightedId,
  myUserId,
  matchingEmployeeIds,
}) => {
  const directReports = directReportsMap.get(node._id) || [];
  const hasChildren = directReports.length > 0;
  const isCollapsed = collapsedNodeIds.has(node._id);
  const isMe = node.userId === myUserId;
  const isSelected = selectedId === node._id;
  const isHighlighted = highlightedId === node._id;
  const isSearchMatch = matchingEmployeeIds?.has(node._id);

  const seniorityBadge = getSeniorityBadge(node.seniorityRank || 5);

  return (
    <div className="flex flex-col items-center">
      {/* Node Card */}
      <div
        id={`org-node-${node._id}`}
        className={cn(
          "group relative flex w-64 flex-col rounded-2xl border bg-white p-3.5 shadow-soft transition-all duration-200 cursor-pointer hover:-translate-y-1 hover:shadow-soft-lg",
          isSelected
            ? "border-brand-500 ring-3 ring-brand-200"
            : isHighlighted
            ? "border-brand-500 ring-4 ring-brand-400 animate-pulse bg-brand-50/20"
            : isMe
            ? "border-amber-400 ring-2 ring-amber-300/70"
            : isSearchMatch
            ? "border-emerald-500 ring-3 ring-emerald-200 bg-emerald-50/20"
            : "border-slate-200 hover:border-brand-300"
        )}
        onClick={() => onSelectEmployee(node)}
      >
        {/* Top Badges */}
        <div className="flex items-center justify-between mb-2">
          <span className={cn("rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shrink-0", seniorityBadge.badgeClass)}>
            {seniorityBadge.label}
          </span>

          {node.directReportsCount > 0 ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 shrink-0">
              👥 {node.directReportsCount} reports
            </span>
          ) : (
            node.isReportingManagerInferred && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700" title="Seniority-inferred reporting line">
                ⚡ Inferred
              </span>
            )
          )}
        </div>

        {/* Avatar & Name */}
        <div className="flex items-center gap-3">
          {node.profilePhotoUrl ? (
            <img
              src={node.profilePhotoUrl}
              alt={node.name}
              className="size-11 rounded-xl object-cover ring-1 ring-slate-200 shrink-0"
            />
          ) : (
            <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-xs shrink-0">
              {node.firstName[0]}
              {node.lastName[0]}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h4 className="truncate text-xs font-bold text-slate-900 group-hover:text-brand-600 transition">
                {node.name}
              </h4>
              {isMe && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[8px] font-bold text-amber-800 shrink-0">
                  YOU
                </span>
              )}
            </div>
            <p className="truncate text-[11px] font-medium text-slate-500">
              {node.designation?.name || "Team Member"}
            </p>
            <span className="text-[10px] text-slate-400 font-medium">
              {node.department?.name || "General"}
            </span>
          </div>
        </div>

        {/* Footer Meta */}
        <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400">
          <span className="truncate max-w-[140px]">{node.officialEmail}</span>
          <span className="font-mono text-[9px] font-semibold text-slate-500">{node.employeeId}</span>
        </div>

        {/* Expand / Collapse Button if has children */}
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(node._id);
            }}
            className={cn(
              "absolute -bottom-3 left-1/2 -translate-x-1/2 grid size-6 place-items-center rounded-full border shadow-2xs text-white transition",
              isCollapsed
                ? "bg-brand-600 border-brand-700 hover:bg-brand-700"
                : "bg-slate-700 border-slate-800 hover:bg-slate-900"
            )}
            title={isCollapsed ? `Expand ${directReports.length} direct reports` : "Collapse direct reports"}
          >
            {isCollapsed ? <Plus size={12} /> : <Minus size={12} />}
          </button>
        )}
      </div>

      {/* Children Subtree */}
      {hasChildren && !isCollapsed && (
        <div className="flex flex-col items-center">
          {/* Vertical line from parent to horizontal connector */}
          <div className="h-6 w-0.5 bg-slate-300" />

          {/* Children container with connecting branch lines */}
          <div className="relative flex gap-6 pt-0">
            {/* Horizontal connector bar covering all children except when single child */}
            {directReports.length > 1 && (
              <div
                className="absolute top-0 h-0.5 bg-slate-300"
                style={{
                  left: "calc(130px)",
                  right: "calc(130px)",
                }}
              />
            )}

            {directReports.map((child) => (
              <div key={child._id} className="relative flex flex-col items-center">
                {/* Vertical drop line down into each child card */}
                <div className="h-6 w-0.5 bg-slate-300" />
                <ReportingTreeNode
                  node={child}
                  directReportsMap={directReportsMap}
                  collapsedNodeIds={collapsedNodeIds}
                  toggleCollapse={toggleCollapse}
                  onSelectEmployee={onSelectEmployee}
                  selectedId={selectedId}
                  highlightedId={highlightedId}
                  myUserId={myUserId}
                  matchingEmployeeIds={matchingEmployeeIds}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
