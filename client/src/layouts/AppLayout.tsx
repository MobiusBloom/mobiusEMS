import { useEffect, useState, type ComponentType } from "react";
import logo from "@/assets/mobius-ems-official-logo.png";
import logoMark from "@/assets/mobius-ems-official-mark.png";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CapabilityName, PermissionName, RoleName, SectionPermissionName, PlanFeatures } from "@mobius-ems/shared";
import {
  Bot, BrainCircuit, BriefcaseBusiness, Building2, CalendarCheck2,
  ChevronLeft, CircleGauge, CreditCard, FileSpreadsheet, FileText, GraduationCap, ListTodo, LogOut, Menu,
  MailPlus, MapPinned, Route, ShieldCheck, Sparkles, Target, TrendingUp, UserCog, UserPlus, UserRound, Users, Workflow, X,
} from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { HeaderSearch } from "@/components/HeaderSearch";
import { NotificationsPopover } from "@/components/NotificationsPopover";
import { MobiusEmsAiFloating } from "@/features/ai/AiWorkspacePanels";
import { authApi } from "@/features/auth/authApi";
import { useAuth } from "@/features/auth/AuthProvider";
import { productSuite, productSuiteStages } from "@/data/productSuite";
import { cn } from "@/lib/cn";

type NavItem = {
  label: string;
  description?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  path: string;
  roles?: RoleName[];
  permission?: PermissionName;
  permissions?: PermissionName[];
  capability?: CapabilityName;
  platformOnly?: boolean;
  section?: SectionPermissionName;
  requiredFeature?: keyof PlanFeatures;
};

const superAdminRole: RoleName[] = ["SUPER_ADMIN"];

const coreGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", icon: CircleGauge, path: "/", section: "section.dashboard" },
      { label: "My profile", icon: UserRound, path: "/me", section: "section.profile" },
      { label: "AI Workspace", icon: Bot, path: "/ai-workspace", section: "section.ai_workspace", requiredFeature: "aiEnabled" },
    ],
  },

  {
    label: "People & HR",
    items: [
      { label: "Employees", icon: Users, path: "/employees", section: "section.employees" },
      { label: "Org hierarchy", icon: Workflow, path: "/hierarchy" },
      { label: "Organization", icon: Building2, path: "/organization", section: "section.organization" },
      { label: "Attendance", icon: CalendarCheck2, path: "/attendance", section: "section.attendance" },
      { label: "Leave & recognition", icon: Users, path: "/people-ops", section: "section.people_ops" },
    ],
  },
  {
    label: "Talent acquisition",
    items: [
      { label: "Applicants", icon: UserPlus, path: "/applicants", section: "section.applicants" },
      { label: "Resume library", icon: FileText, path: "/resumes", section: "section.resumes" },
      { label: "Resume screener", icon: BrainCircuit, path: "/resume-screener", section: "section.resume_screener" },
    ],
  },
  {
    label: "Performance & growth",
    items: [
      { label: "Goals & performance", icon: Target, path: "/performance", section: "section.performance" },
      { label: "Skills & Verification", icon: Sparkles, path: "/skills", section: "section.skills" },
      { label: "Assessments", icon: ShieldCheck, path: "/assessments", section: "section.assessments" },
      { label: "Learning & training", icon: GraduationCap, path: "/development", section: "section.development" },
      { label: "Contribution & support", icon: TrendingUp, path: "/contribution", section: "section.contribution" },
    ],
  },
  {
    label: "Work & projects",
    items: [
      { label: "Tasks & projects", icon: BriefcaseBusiness, path: "/work", section: "section.work" },
      { label: "Task tracker", icon: ListTodo, path: "/task-tracker", section: "section.task_tracker" },
    ],
  },
  {
    label: "Sales & CRM",
    items: [
      { label: "Sales dashboard", icon: TrendingUp, path: "/sales", permissions: ["sales.analytics.self", "sales.analytics.team", "sales.analytics.all"], capability: "SALES_MODULE", section: "section.sales" },
      { label: "Lead Work", icon: FileSpreadsheet, path: "/lead-work", permissions: ["sales.view.self", "sales.view.team", "sales.view.all"], capability: "SALES_MODULE", section: "section.sales" },
      { label: "My target & performance", icon: Target, path: "/sales/my-target", permission: "sales.analytics.self", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Leads", icon: Users, path: "/sales/leads", permissions: ["sales.view.self", "sales.view.team", "sales.view.all"], capability: "SALES_MODULE", section: "section.sales" },
      { label: "Customers", icon: UserRound, path: "/sales/customers", permission: "sales.customer.view", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Targets", icon: Target, path: "/sales/targets", permission: "sales.target.view", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Revenue", icon: TrendingUp, path: "/sales/revenue", permission: "sales.revenue.view", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Country sales & map", icon: MapPinned, path: "/sales/geography", permissions: ["sales.map.self", "sales.map.team", "sales.map.all"], capability: "SALES_MODULE", section: "section.sales" },
      { label: "Territories (ownership)", icon: Route, path: "/sales/territories", permission: "sales.territory.view", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Channel partners", icon: Building2, path: "/sales/channel-partners", permission: "sales.channel_partner.view", capability: "SALES_MODULE", section: "section.sales" },
      { label: "Sales employees", icon: Users, path: "/sales/employees", permissions: ["sales.view.team", "sales.view.all"], capability: "SALES_MODULE", section: "section.sales" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Subscription & Plan", icon: CreditCard, path: "/subscription", roles: ["SUPER_ADMIN", "HR_ADMIN"] },
      { label: "Administrators", icon: UserCog, path: "/administrators", roles: superAdminRole },
      { label: "Documents & reports", icon: FileText, path: "/governance", section: "section.governance" },
      { label: "Access & audit", icon: ShieldCheck, path: "/governance?tab=audit", permission: "audit.view", section: "section.governance" },
      { label: "Email automation", icon: MailPlus, path: "/email-automation", section: "section.email_automation", requiredFeature: "emailAutomationEnabled" },
    ],
  },
];

const groups: { label: string; items: NavItem[] }[] = [
  ...coreGroups,
  ...productSuiteStages.map(({ stage, label }) => ({
    label: `Complete suite · ${label}`,
    items: productSuite
      .filter((feature) => feature.stage === stage)
      .map((feature) => ({
        label: `${feature.id} ${feature.name}`,
        description: feature.description,
        icon: Sparkles,
        path: `/welcome#${feature.id}`,
      })),
  })),
];

export const AppLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }, [location.pathname]);

  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      setUser(null);
      queryClient.clear();
      try {
        sessionStorage.clear();
      } catch {
        // Storage can be unavailable in locked-down browser contexts.
      }
      window.location.replace("/welcome");
    },
  });

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.roles || item.roles.includes(user!.role)) &&
          (!item.section || user!.permissions.includes(item.section)) &&
          (!item.permission || user!.permissions.includes(item.permission)) &&
          (!item.permissions || item.permissions.some((permission) => user!.permissions.includes(permission))) &&
          (!item.capability || user!.capabilities.includes(item.capability)) &&
          (!item.platformOnly || user!.isPlatformAdmin) &&
          (!item.requiredFeature || user!.features?.[item.requiredFeature])
      ),
    }))
    .filter((group) => group.items.length);


  const allVisiblePaths = visibleGroups.flatMap((g) => g.items.map((i) => i.path));

  const isItemActive = (itemPath: string) => {
    if (itemPath.startsWith("/governance")) {
      return location.pathname === "/governance" &&
        (itemPath.includes("tab=audit") === (new URLSearchParams(location.search).get("tab") === "audit"));
    }
    if (itemPath === "/") {
      return location.pathname === "/";
    }
    if (location.pathname === itemPath) {
      return true;
    }
    if (location.pathname.startsWith(`${itemPath}/`)) {
      const hasMoreSpecific = allVisiblePaths.some(
        (p) => p !== itemPath && p.startsWith(itemPath) && (location.pathname === p || location.pathname.startsWith(`${p}/`))
      );
      return !hasMoreSpecific;
    }
    return false;
  };

  const sidebar = (
    <aside
      className={cn(
        "flex h-full max-w-[86vw] flex-col border-r bg-white transition-[width] duration-200",
        collapsed ? "w-[76px]" : "w-[260px]"
      )}
    >
      {/* Sidebar header */}
      <div className="flex h-16 items-center border-b px-4 sm:h-20 sm:px-5">
        <img
          src={collapsed ? logoMark : logo}
          alt="MobiusEMS"
          className={cn("shrink-0 rounded-md object-contain", collapsed ? "h-9 w-9" : "h-11 w-[185px]")}
        />
        {/* Desktop collapse toggle */}
        <button
          className="ml-auto hidden size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 lg:grid"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronLeft size={16} className={cn("transition", collapsed && "rotate-180")} />
        </button>
        {/* Mobile close button */}
        <button
          className="ml-auto grid size-8 place-items-center lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4" aria-label="Primary navigation">
        {visibleGroups.map((group, groupIdx) => (
          <div key={group.label} className={groupIdx > 0 ? "pt-1" : ""}>
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">
                {group.label}
              </p>
            )}
            {collapsed && groupIdx > 0 && (
              <div className="mx-auto my-2 h-px w-8 bg-slate-200" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(item.path);
                return (
                  <button
                    key={`${item.label}-${item.path}`}
                    onClick={() => { navigate(item.path); setMobileOpen(false); }}
                    title={item.description ? `${item.label} — ${item.description}` : item.label}
                    className={cn(
                      "flex min-h-9 w-full items-center rounded-xl px-3 py-2 text-left text-xs font-medium transition",
                      active
                        ? "bg-brand-50 font-semibold text-brand-700 shadow-2xs"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <Icon size={16} className={cn("shrink-0", active ? "text-brand-600" : "text-slate-500")} />
                    {!collapsed && (
                      <span className="ml-3 min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.description && <span className="mt-0.5 block line-clamp-2 text-[10px] font-normal leading-4 text-slate-400">{item.description}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User / logout */}
      <div className="space-y-2 border-t p-3">
        <div
          className={cn(
            "flex w-full items-center rounded-xl p-2 text-left",
            collapsed && "justify-center"
          )}
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-semibold">
            {user?.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}
          </div>
          {!collapsed && (
            <>
              <div className="ml-2.5 min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{user?.name}</p>
                <p className="truncate text-[10px] text-slate-400">{user?.role.replaceAll("_", " ")}</p>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label="Sign out"
          title="Sign out"
          disabled={logout.isPending}
          className={cn(
            "flex h-10 w-full items-center rounded-xl px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60",
            collapsed && "justify-center px-0"
          )}
          onClick={() => logout.mutate()}
        >
          <LogOut size={17} />
          {!collapsed && <span className="ml-3">{logout.isPending ? "Signing out…" : "Sign out"}</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen w-full min-w-0 max-w-full overflow-x-clip">
      {/* Desktop sidebar — fixed */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        {sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <button
            aria-label="Close navigation backdrop"
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <div className="relative h-full w-[min(280px,86vw)] shadow-2xl">
            {sidebar}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div
        className={cn(
          "flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-clip transition-[margin] duration-200",
          collapsed ? "lg:ml-[76px]" : "lg:ml-[260px]"
        )}
      >
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-16 min-w-0 max-w-full items-center gap-2 border-b bg-[#f6f8f7]/90 px-4 backdrop-blur-xl sm:h-20 sm:gap-3 sm:px-8">
          {/* Hamburger — mobile only */}
          <button
            className="grid size-10 shrink-0 place-items-center rounded-xl border bg-white lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={18} />
          </button>

          {/* Search bar — hidden on tiny screens, shown sm+ */}
          <div className="hidden min-w-0 flex-1 sm:block sm:max-w-md">
            <HeaderSearch />
          </div>

          {/* Right side actions */}
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationsPopover />
            <div className="ml-1 hidden text-right sm:block">
              <p className="text-xs font-semibold">{user?.name}</p>
              <p className="text-[10px] text-slate-400">{user?.role.replaceAll("_", " ")}</p>
            </div>
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              disabled={logout.isPending}
              className="ml-1 grid size-10 shrink-0 place-items-center rounded-xl border bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
              onClick={() => logout.mutate()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {/* Mobile search bar — shown only below sm */}
        <div className="border-b bg-white px-4 py-2 sm:hidden">
          <HeaderSearch />
        </div>

        {/* Page content */}
        <Outlet />
        <MobiusEmsAiFloating />
      </div>
    </div>
  );
};
