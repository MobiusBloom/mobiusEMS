import { Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { Skeleton } from "@/components/ui/Skeleton";
import { LandingPage } from "@/pages/LandingPage";
import { OnboardingRoute, PasswordChangeRoute, PermissionRoute, ProtectedRoute, RoleRoute } from "@/routes/ProtectedRoute";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.replace("#", "");
      const timer = setTimeout(() => {
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash]);

  return null;
};

const LoginPage = lazyWithRetry(() => import("@/pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const SolutionsIndexPage = lazyWithRetry(() => import("@/pages/SolutionsPage").then((module) => ({ default: module.SolutionsIndexPage })));
const SolutionDetailPage = lazyWithRetry(() => import("@/pages/SolutionsPage").then((module) => ({ default: module.SolutionDetailPage })));
const RegisterPage = lazyWithRetry(() => import("@/pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const ChangePasswordPage = lazyWithRetry(() => import("@/pages/ChangePasswordPage").then((module) => ({ default: module.ChangePasswordPage })));
const ForgotPasswordPage = lazyWithRetry(() => import("@/pages/ResetPasswordPage").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazyWithRetry(() => import("@/pages/ResetPasswordPage").then((module) => ({ default: module.ResetPasswordPage })));
const OnboardingPage = lazyWithRetry(() => import("@/pages/OnboardingPage").then((module) => ({ default: module.OnboardingPage })));
const DashboardPage = lazyWithRetry(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const EmployeesPage = lazyWithRetry(() => import("@/pages/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const EmployeeProfilePage = lazyWithRetry(() => import("@/pages/EmployeeProfilePage").then((module) => ({ default: module.EmployeeProfilePage })));
const OrganizationPage = lazyWithRetry(() => import("@/pages/OrganizationPage").then((module) => ({ default: module.OrganizationPage })));
const SkillsPage = lazyWithRetry(() => import("@/pages/SkillsRoutePage").then((module) => ({ default: module.SkillsRoutePage })));
const AssessmentsPage = lazyWithRetry(() => import("@/pages/AssessmentsPage").then((module) => ({ default: module.AssessmentsPage })));
const WorkPage = lazyWithRetry(() => import("@/pages/WorkPage").then((module) => ({ default: module.WorkPage })));
const LeadWorkPage = lazyWithRetry(() => import("@/pages/LeadWorkPage").then((module) => ({ default: module.LeadWorkPage })));
const PerformancePage = lazyWithRetry(() => import("@/pages/PerformancePage").then((module) => ({ default: module.PerformancePage })));
const DevelopmentPage = lazyWithRetry(() => import("@/pages/DevelopmentPage").then((module) => ({ default: module.DevelopmentPage })));
const GovernancePage = lazyWithRetry(() => import("@/pages/GovernancePage").then((module) => ({ default: module.GovernancePage })));
const ResumesPage = lazyWithRetry(() => import("@/pages/ResumesPage").then((module) => ({ default: module.ResumesPage })));
const ApplicantsPage = lazyWithRetry(() => import("@/pages/ApplicantsPage").then((module) => ({ default: module.ApplicantsPage })));
const ResumeScreenerPage = lazyWithRetry(() => import("@/pages/ResumeScreenerPage").then((module) => ({ default: module.ResumeScreenerPage })));
const PeopleOpsPage = lazyWithRetry(() => import("@/pages/PeopleOpsPage").then((module) => ({ default: module.PeopleOpsPage })));
const MyProfilePage = lazyWithRetry(() => import("@/pages/MyProfilePage").then((module) => ({ default: module.MyProfilePage })));
const AdministratorsPage = lazyWithRetry(() => import("@/pages/AdministratorsPage").then((module) => ({ default: module.AdministratorsPage })));
const EmailAutomationPage = lazyWithRetry(() => import("@/pages/EmailAutomationPage").then((module) => ({ default: module.EmailAutomationPage })));
const AttendancePage = lazyWithRetry(() => import("@/pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const ContributionPage = lazyWithRetry(() => import("@/pages/ContributionPage").then((module) => ({ default: module.ContributionPage })));
const AiWorkspacePage = lazyWithRetry(() => import("@/pages/AiWorkspacePage").then((module) => ({ default: module.AiWorkspacePage })));
const TaskTrackerPage = lazyWithRetry(() => import("@/pages/TaskTrackerPage").then((module) => ({ default: module.TaskTrackerPage })));
const EodPage = lazyWithRetry(() => import("@/pages/EodPage").then((module) => ({ default: module.EodPage })));
const TenantsPage = lazyWithRetry(() => import("@/pages/TenantsPage").then((module) => ({ default: module.TenantsPage })));
const PlatformLoginPage = lazyWithRetry(() => import("@/pages/PlatformLoginPage").then((module) => ({ default: module.PlatformLoginPage })));
const SalesDashboardPage = lazyWithRetry(() => import("@/features/sales/pages/SalesDashboardPage").then((module) => ({ default: module.SalesDashboardPage })));
const GeographicSalesPage = lazyWithRetry(() => import("@/features/sales/pages/GeographicSalesPage").then((module) => ({ default: module.GeographicSalesPage })));
const SalesTerritoriesPage = lazyWithRetry(() => import("@/features/sales/pages/SalesTerritoriesPage").then((module) => ({ default: module.SalesTerritoriesPage })));
const SalesDataPage = lazyWithRetry(() => import("@/features/sales/pages/SalesDataPage").then((module) => ({ default: module.SalesDataPage })));
const SalesAgentsPage = lazyWithRetry(() => import("@/features/sales/pages/SalesAgentsPage").then((module) => ({ default: module.SalesAgentsPage })));
const TargetPerformancePage = lazyWithRetry(() => import("@/features/sales/pages/TargetPerformancePage").then((module) => ({ default: module.TargetPerformancePage })));
const OrgHierarchyPage = lazyWithRetry(() => import("@/pages/OrgHierarchyPage").then((module) => ({ default: module.OrgHierarchyPage })));
const SubscriptionPage = lazyWithRetry(() => import("@/pages/SubscriptionPage").then((module) => ({ default: module.SubscriptionPage })));
const TermsPage = lazyWithRetry(() => import("@/pages/TermsPage").then((module) => ({ default: module.TermsPage })));
const PrivacyPage = lazyWithRetry(() => import("@/pages/PrivacyPage").then((module) => ({ default: module.PrivacyPage })));


const PageLoader = () => <div className="space-y-4 p-8" aria-label="Loading page"><Skeleton className="h-9 w-64"/><Skeleton className="h-48 w-full"/><Skeleton className="h-48 w-full"/></div>;
const AccessDeniedPage = () => <main className="grid min-h-[60vh] flex-1 place-items-center p-8 text-center"><div><p className="text-sm font-semibold text-brand-700">Access restricted</p><h1 className="mt-2 text-3xl font-semibold">This section is not assigned to your role</h1><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500">Ask your Super Admin to enable this section in Administration → Access hierarchy.</p></div></main>;

export const App = () => <Suspense fallback={<PageLoader/>}><ScrollToTop/><Routes>
  <Route path="/welcome" element={<LandingPage/>}/>
  <Route path="/solutions" element={<SolutionsIndexPage/>}/>
  <Route path="/solutions/:slug" element={<SolutionDetailPage/>}/>
  <Route path="/terms" element={<TermsPage/>}/>
  <Route path="/privacy" element={<PrivacyPage/>}/>
  <Route path="/login" element={<LoginPage/>}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  <Route path="/reset-password" element={<ResetPasswordPage/>}/>
  <Route path="/register" element={<RegisterPage/>}/>
  <Route path="/platform/login" element={<PlatformLoginPage/>}/>
  <Route path="/platform/tenants" element={<TenantsPage/>}/>
  <Route element={<PasswordChangeRoute/>}><Route path="/change-password" element={<ChangePasswordPage/>}/></Route>
  <Route element={<OnboardingRoute/>}><Route path="/onboarding" element={<OnboardingPage/>}/></Route>
  <Route element={<ProtectedRoute/>}><Route element={<AppLayout/>}>
    <Route path="access-denied" element={<AccessDeniedPage/>}/>
    <Route element={<PermissionRoute permissions={["section.dashboard"]}/>}><Route index element={<DashboardPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.ai_workspace"]}/>}><Route path="ai-workspace" element={<AiWorkspacePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.profile"]}/>}><Route path="me" element={<MyProfilePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.employees"]}/>}><Route path="employees" element={<EmployeesPage/>}/><Route path="employees/:id" element={<EmployeeProfilePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.organization"]}/>}><Route path="organization" element={<OrganizationPage/>}/></Route>
    <Route path="hierarchy" element={<OrgHierarchyPage/>}/>
    <Route element={<PermissionRoute permissions={["section.eod"]}/>}><Route path="eod" element={<EodPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.skills"]}/>}><Route path="skills" element={<SkillsPage/>}/><Route path="skills/builder" element={<SkillsPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.assessments"]}/>}><Route path="assessments" element={<AssessmentsPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.work"]}/>}><Route path="work" element={<WorkPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.sales"]}/>}><Route element={<PermissionRoute permissions={["sales.view.self","sales.view.team","sales.view.all"]}/>}><Route path="lead-work" element={<LeadWorkPage/>}/></Route></Route>
    <Route element={<PermissionRoute permissions={["section.attendance"]}/>}><Route path="attendance" element={<AttendancePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.performance"]}/>}><Route path="performance" element={<PerformancePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.contribution"]}/>}><Route path="contribution" element={<ContributionPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.task_tracker"]}/>}><Route path="task-tracker" element={<TaskTrackerPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.development"]}/>}><Route path="development" element={<DevelopmentPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.governance"]}/>}><Route path="governance" element={<GovernancePage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.resumes"]}/>}><Route path="resumes" element={<ResumesPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.applicants"]}/>}><Route path="applicants" element={<ApplicantsPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.people_ops"]}/>}><Route path="people-ops" element={<PeopleOpsPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.resume_screener"]}/>}><Route path="resume-screener" element={<ResumeScreenerPage/>}/></Route>
    <Route element={<RoleRoute roles={["SUPER_ADMIN"]}/>}> <Route path="administrators" element={<AdministratorsPage/>}/></Route>
    <Route element={<RoleRoute roles={["SUPER_ADMIN", "HR_ADMIN"]}/>}> <Route path="subscription" element={<SubscriptionPage/>}/></Route>
    <Route element={<PermissionRoute permissions={["section.email_automation"]}/>}><Route path="email-automation" element={<EmailAutomationPage/>}/></Route>

    <Route element={<PermissionRoute permissions={["section.sales"]}/>}>
      <Route element={<PermissionRoute permissions={["sales.analytics.self","sales.analytics.team","sales.analytics.all"]}/>}> <Route path="sales" element={<SalesDashboardPage/>}/></Route>
      <Route element={<PermissionRoute permissions={["sales.analytics.self"]}/>}> <Route path="sales/my-target" element={<TargetPerformancePage/>}/></Route>
      <Route element={<PermissionRoute permissions={["sales.map.self","sales.map.team","sales.map.all"]}/>}> <Route path="sales/geography" element={<GeographicSalesPage/>}/></Route>
      <Route element={<PermissionRoute permissions={["sales.territory.view"]}/>}> <Route path="sales/territories" element={<SalesTerritoriesPage/>}/></Route>
      <Route element={<PermissionRoute permissions={["sales.view.self","sales.view.team","sales.view.all"]}/>}> <Route path="sales/employees" element={<SalesAgentsPage/>}/><Route path="sales/leads" element={<SalesDataPage path="leads" title="Leads"/>}/><Route path="sales/customers" element={<SalesDataPage path="customers" title="Customers"/>}/><Route path="sales/pipeline" element={<Navigate to="/sales/leads" replace/>}/><Route path="sales/targets" element={<SalesDataPage path="targets" title="Targets"/>}/><Route path="sales/revenue" element={<SalesDataPage path="revenue" title="Revenue"/>}/><Route path="sales/channel-partners" element={<SalesDataPage path="channel-partners" title="Channel partners"/>}/></Route>
    </Route>
  </Route></Route>
  <Route path="*" element={<div className="grid min-h-screen place-items-center"><p>Page not found</p></div>}/>
</Routes></Suspense>;
