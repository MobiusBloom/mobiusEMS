# Daily Work Intelligence (EOD)

## Architecture assessment

The original module had an authenticated Express router, a tenant-scoped EodUpdate model, Zod validators, a React Query editor/admin page, audit events and browser voice dictation. It stored accomplishments, inProgress, nextPlan, blockers, health and draft/submitted state. Reviews were SUPER_ADMIN-only. Tasks, TaskActivity, DailyTodo, CRM and LeadWorkActivity already contain execution evidence; goals, KPIs and performance reviews remain separate.

The upgrade extends those components. EodTemplate uses tenantModel and the existing PostgreSQL compatibility layer. EOD services resolve permissions/hierarchy, resolve templates, derive work evidence, and aggregate analytics on the server. No second ORM, unmanaged database access, new task architecture, AI provider, or automatic data backfill is introduced.

## Employee flow

Open Workspace > Daily work intelligence (`/eod`) and choose My daily report. Employee ID, name, designation, department, team and reporting manager come from the authenticated employee profile. Report dates use Asia/Kolkata (IST); past dates are supported, future/invalid dates rejected.

The work snapshot includes assigned tasks, completion events, ongoing/blocked/review/reopened/overdue tasks, delivery quality, hours variance and non-personal Daily Todos. Task cards include project, deadline, completion note, safe HTTP(S) evidence links, quality and blocker context. Personal todos never enter a report.

Add a concise key outcome or in-progress context, department-specific context, support needs, and up to three next-day commitments. A priority may link an owned task and include urgency, expected outcome/date and a note. Legacy nextPlan text remains editable. Priorities do not create tasks. Previous report commitments show live completed, newly blocked, explicitly carried forward or pending states. Unlinked work remains pending until context is supplied; the system does not infer performance.

Voice input uses the existing SpeechRecognition/webkitSpeechRecognition component. It can append to common and template text fields. Switching fields stops recording. Browser/microphone/speech-service support is required; typed input is always available.

Incomplete drafts are private. Submission requires an outcome or in-progress context, nextPlan or structured priorities, and a blocker explanation for AT_RISK/BLOCKED health. Required manual template fields are enforced only on submission. Submitted reports may be edited but cannot become drafts. Each edit refreshes source evidence and clears review/feedback. An optional reported completion count is compared neutrally with recorded completions; differences are not accusations or automated judgments.

There remains one report per tenant/employee/date. Ownership, snapshots, source metrics and reviewer identity come from the server. Request validation strips attempts to supply those fields. Linked priorities cannot reference another employee's tasks.

## Manager and Super Admin flow

Team reports shows submitted reports for the permitted hierarchy, with four coordination actions: Acknowledge, Add feedback, Needs clarification, Support required. Self-review is rejected. Review writes match the submission timestamp to detect stale reports. Saves/reviews/template edits are audited.

Analytics & review provides selected date, 7/30/90-day and custom ranges (maximum 366 days), department/team/reporting-manager/employee/project/health/submission filters, execution cards, daily trends, department drill-down, blocker breakdowns, reported activity, linked priorities and report evidence. Clear filters returns to the permitted scope. Selecting a department or an employee-related attention item narrows the dashboard. The accessible trend table accompanies charts.

Attention Required covers aging blockers, urgent/high overdue work, reviews, low department report coverage, repeated access events, repeated linked-task carry-forward and overdue sales follow-ups. Blocker age and low-coverage thresholds are configurable per dashboard query. These are support prompts, not punitive rankings.

## Permissions and rollout

Backend route middleware requires section.eod and the relevant action permission. Scope is resolved separately for view, review and analytics; possessing broad view access does not grant broad review access.

| Role default | EOD scope |
| --- | --- |
| EMPLOYEE | submit, view.self, analytics.self |
| TEAM_LEAD / MANAGER | self plus view.team, review.team, analytics.team |
| DEPARTMENT_HEAD | self plus view.department, review.department, analytics.department |
| SUPER_ADMIN | all EOD permissions, including template.manage |
| HR_ADMIN | self only; wider EOD permissions must be explicitly granted |
| APPLICANT | no EOD access |

Supported keys: section.eod; eod.submit; eod.view.self/team/department/all; eod.review.team/department/all; eod.analytics.self/team/department/all; eod.template.manage.

Team scope reuses the reporting hierarchy, including recursive reports, existing team-lead behavior, and teams explicitly led by the viewer. Department scope includes the viewer's department and departments they head. Broad access requires the corresponding all permission, including for HR. Missing profiles fail closed unless explicit organization scope is granted. Managers never see others' drafts through list/detail/analytics endpoints. The employee's /me endpoint remains the private editing path.

Shared defaults apply to newly created roles. Existing persisted roles are not silently broadened. Use the admin permission UI or the explicit idempotent rollout below. The script only adds role-appropriate EOD grants to system roles, preserves other grants, and does not touch reports or create database tables.

From the server directory, against an already-deployed schema:

```powershell
npx tsx src/jobs/grantEodPermissions.ts --tenant=<tenant-object-id>
# Review the dry-run grants, then explicitly apply with an audit actor:
npx tsx src/jobs/grantEodPermissions.ts --tenant=<tenant-object-id> --apply --actor=<admin-user-object-id>
```

Repeat separately for each tenant. No rollout/backfill script has been executed as part of this implementation.

## Templates and department adapters

A tenant template stores department, optional designation, active/default flags, monotonically increasing version, adapter, sections, and creator/updater. Resolution prefers department+designation, then department, then organization default, then the built-in department fallback. Within specificity, default templates take precedence, then newest version, then stable ID. Submitted reports keep a full template snapshot so later template edits/deactivation do not alter old fields. Drafts use their saved template until submitted. The template manager supports creation, editing, activation/deactivation, sections and fields.

Field types: TEXT, TEXTAREA, NUMBER, CURRENCY, DATE, SELECT, MULTI_SELECT, CHECKBOX, RATING (1-5). Configuration is limited to 10 sections, 20 fields per section and 100 uniquely named fields. Manual response types/options/dates are checked against the resolved template. System fields are read-only and cannot be supplied in responses. Templates cannot contain executable queries or arbitrary data sources.

Secure source IDs: TASKS_COMPLETED_TODAY, TASKS_IN_PROGRESS, TASKS_BLOCKED, TASKS_IN_REVIEW, TASKS_REOPENED, TASKS_OVERDUE, DAILY_TODOS_COMPLETED, SALES_LEADS_CONTACTED, SALES_QUALIFIED_LEADS, SALES_FOLLOWUPS_COMPLETED, SALES_MEETINGS, SALES_PIPELINE_ADDED, SALES_REVENUE_BOOKED, SALES_REVENUE_COLLECTED. Unavailable sources return no value rather than inventing zero. Currency fields with multiple source currencies are unavailable in the scalar template field; the sales panel displays each currency separately.

- Engineering: technical summary, decisions, learning and dependencies; delivery, hours, quality and blocker evidence comes from tasks.
- Sales: CRM/lead-work evidence plus customer conversations, objections, follow-ups, support and next target. Enabled by the existing department SALES_MODULE capability, not an arbitrary department-name comparison.
- AI/ML: experiment/research, objective, dataset, model/provider, optional evaluation/results, observation, outcome, findings and next experiment. Evaluation metrics are never mandatory for research-only work. Outcomes and numeric manual responses aggregate as reported department activity.
- HR: manual screening/interview/request counts, onboarding context and HR follow-ups. Existing applicant stage notes lack actor attribution, so they are not presented as employee-derived activity.
- Marketing: configurable manual campaign/content/enquiry/approval/blocker fields, with reported numeric department totals.

Only the central fallback resolver uses department-name patterns; tenant templates bind actual department/designation IDs. No scattered department checks appear in the UI.

## Analytics definitions

- Coverage = submitted employee-day reports / eligible employee-days. Eligibility uses active profiles joined by each date plus authors of authorized historical submissions. It does not reconstruct full historical employment, leave, holidays or individual working schedules. Missing reports are missing eligible employee-days, not unique absent employees or poor performance. No submission cutoff/late classification exists.
- Health counts are distinct employees who reported the selected health during the range. Daily health trends count submitted reports.
- Completions are distinct task IDs per period, combining completionDate and TASK_COMPLETED/status events. Daily trends deduplicate within each date; a task completed on multiple days may appear on each day's trend but once in the period total. Assigned-in-period uses task creation date, not a reconstructed assignment history.
- Open/in-progress/blocked/in-review/reopened metrics use current active source tasks. Archived tasks can contribute historical completion evidence but do not enter the open backlog. Overdue compares a non-terminal task deadline with the earlier of now and range end, using current status; it is not reconstructed historical status.
- On-time percentage uses completed tasks with a completionDate and compares completionDate <= deadline. Average quality includes completed tasks with a recorded rating. Hours/variance use the same completed-task cohort with actualHours; missing measurements are excluded. Delivery variance is mean completionDate minus deadline in days. Rework counts reopening activity events in the selected period. Missing quality/reliability evidence is null, not zero.
- Blocker created/resolved counts use TASK_BLOCKED/TASK_UNBLOCKED events. Active reason/department/project breakdown and age use current unresolved task blocker state. The employee task cards and filtered table expose the affected people/dependencies. Repeated access alerts use blocker events, not employee scores.
- Backlog trends use per-report submission snapshots. Legacy days without snapshots are null. Snapshot series cover submitted employees only and are not extrapolated to the entire organization. Task completion and blocker activity charts use actual events without relying on EOD submission.
- Manual numeric responses aggregate under department activity and remain explicitly labeled reported activity. They are not independently verified CRM/task metrics.
- Sales contacts deduplicate leads touched through lead-work interactions or CALL_LOG activity by scoped actors. Qualification/conversion use qualifiedAt/convertedAt. Meetings/video calls use typed lead-work interactions. Completed follow-ups count interactions whose prior state was FOLLOW_UP (not distinct scheduled appointments). Overdue follow-ups use current FOLLOW_UP work items with an earlier nextFollowUpAt. Opportunities/pipeline use creation timestamp. Booked revenue is WON opportunity estimated value with actualCloseDate; recorded revenue uses transactionDate/amount. Collection cannot be derived from this schema and is unavailable. Currency totals never mix currencies. Target achievement uses full matching target periods to the selected date, not daily revenue divided by monthly target. Hot opportunities are current OPEN deals with >=70% probability.
- Previous-period comparisons use an equal-length preceding range and the same filtered cohort. Coverage delta is percentage points, not relative percentage growth. Historical task reassignment is not fully reconstructable; live task queries use current ownership.

## Historical compatibility and migration safety

Legacy accomplishments/inProgress/nextPlan/blockers/health/status/acknowledgement fields remain intact and readable. Snapshot/response/priority additions are optional. No destructive transformation or report backfill is necessary.

At the first submission, the server captures organization and template context available at submission time. It cannot infer an employee's true department on a retroactive date before organization history was recorded. Later submitted edits preserve organization/template snapshots and refresh work evidence. Legacy reports without snapshots keep their legacy fallback instead of pretending to know historical organization. Department filters/access use saved department IDs where present; only legacy records fall back to current employee department. Current source work of a former department member is not exposed through historical department reports.

TenantModel keeps tenant scoping and prefixes schema indexes. EOD retains the tenant/employee/date unique index and declares tenant-aware status/date and departmentSnapshot/date indexes; templates declare department/designation/active/version indexes. Existing deployment schema synchronization remains the project's responsibility; the feature does not run migration jobs. The compatibility layer currently materializes tenant rows and implements many operators/aggregates in server memory, and only materializes some index declarations as PostgreSQL indexes. Large-tenant database-side aggregation and full non-unique index support are existing persistence limitations, not bypassed here. New context/project joins use bulk model queries rather than per-row populate calls, and work/sales queries are batched without per-employee queries. Date ranges are bounded and React Query reuses/caches permitted filter choices.

## API

All routes are under /api/v1/eod, authenticated, tenant-scoped and validated with Zod where they accept input.

| Method / path | Contract |
| --- | --- |
| GET /?date=YYYY-MM-DD | Existing contract: own reports for self scope, otherwise permitted roster + submitted updates; adds scope |
| GET /me?date=YYYY-MM-DD | Employee context, own update, resolved template, saved-or-live summary, liveSummary |
| PUT / | Own legacy text fields, optional importantNote/remarks, responses, <=3 priorities, optional reportedCompleted; date/health/status |
| GET /team?date=YYYY-MM-DD | Scoped roster and submitted reports; requires broad view permission |
| GET /analytics?start=...&end=... | Aggregated overview/comparison/trends/departments/execution/blockers/alerts plus permitted evidence; optional filters and attention thresholds |
| GET /:id | Own draft/submission or submitted record permitted by view scope |
| PATCH /:id/review | state, managerComment, optional ISO submission revision; reviewed identity/time set by server |
| GET /templates | Template manager list plus department/designation choices |
| POST /templates | Validated template definition; server version=1 and creator/updater |
| PATCH /templates/:id | Complete validated replacement configuration; increments version |

No automatic reminders/messages, simplistic productivity score, or AI-generated claims are added. Goals, KPI evaluation and formal performance workflows remain responsible for performance assessment.

## Validation

EOD tests cover ownership, draft privacy, submitted-to-draft rejection, legacy reading, snapshot preservation, task links, review access/stale submissions, RBAC scopes, hierarchy/department resolution, templates/field types, source summaries, IST dates, tenant rejection, range filters, blocker analytics and neutral commitments. Run npm test, npm run typecheck and npm run build. Repository-wide lint currently has unrelated existing errors; changed EOD files are linted separately.
