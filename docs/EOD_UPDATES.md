# End-of-day updates

## Research and design

There is no universal practice followed by every successful company. Reporting frequency depends on the team. Atlassian describes short daily check-ins around recent work, upcoming work, and blockers. GitLab documents asynchronous updates with progress, next steps, and support needs; some teams use weekly updates.

- https://www.atlassian.com/agile/scrum/standups
- https://handbook.gitlab.com/handbook/engineering/ai/ai-coding/how-we-work/async-updates/
- https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/developer-experience/application-lifecycle/workflow/

For MobiusEMS, use a brief daily journal: completed outcomes, work in progress, next working-day priorities, blockers and support needed, and self-reported work health. Keep urgent escalation outside the daily journal. Counts and health are communication aids, not employee productivity scores.

## Using the section

Open **Workspace → EOD updates** (`/eod`). All authenticated users with an active employee profile can write their own updates. Dates use Asia/Kolkata (IST); past dates are supported and future dates are rejected. There is one record per employee per date per tenant.

Employees can save incomplete private drafts, submit, edit submissions, and view super-admin feedback. Submission requires completed work or work in progress plus next priorities. At-risk or blocked work requires an explanation. Updating a submission clears the earlier acknowledgement and feedback so the changed report can be reviewed again. Submitted reports cannot return to draft.

Super admins see submitted reports and active employee profiles joined by the selected date. They can filter by department, search employees, filter work health or review state, expand reports, acknowledge them, and leave feedback. Coverage includes the currently active roster: historical reporting does not reconstruct archived employees or historical department assignments. No-update counts are not attendance or overdue counts; holidays, leave, individual schedules, and reporting deadlines are not inferred.

Data uses the existing tenant-scoped model and startup registry, including a tenant/employee/date unique index. Drafts are excluded from the admin endpoint. Ownership comes from the authenticated user's employee profile, never the request body. Review actions are restricted to SUPER_ADMIN. Writes are audited.

## API

- `GET /api/v1/eod?date=YYYY-MM-DD`: own report, or admin roster and submitted reports.
- `PUT /api/v1/eod`: save own draft or submission.
- `PATCH /api/v1/eod/:id/review`: super-admin acknowledgement and optional feedback.

No new dependencies, automatic messages, or scheduled reminders are introduced.
