# Whalexy demonstration company

Set these values on the server and redeploy the main branch:

```dotenv
WHALEXY_DEMO_ENABLED=true
WHALEXY_DEMO_PASSWORD=<the private fixed password supplied to the owner>
```

The password must contain at least 16 characters. Do not commit the password or
change the production database/JWT settings. Startup provisions a separate
`Whalexy` company with organization ID `whalexy-demo`. Startup logs report
`Whalexy demo verified` on success. A provisioning failure is logged and does not
take the existing application offline; retry after correcting the reported cause.

Normal login at https://ems.whalexy.com uses the same configured password for:

| Account | Email |
| --- | --- |
| Superadmin | admin@whalexy-demo.example |
| Sales manager | manager@whalexy-demo.example |
| Sales employee | aarav@whalexy-demo.example |
| Sales employee | priya@whalexy-demo.example |
| Sales employee | kabir@whalexy-demo.example |
| HR | hr@whalexy-demo.example |
| Engineering | developer@whalexy-demo.example |
| Marketing | marketing@whalexy-demo.example |
| Operations | operations@whalexy-demo.example |
| Customer support | support@whalexy-demo.example |

Organization ID is optional when these emails are unique across companies. Use
`whalexy-demo` if the login asks for it. These are synthetic email addresses,
not mailboxes. Accounts have completed onboarding and no forced password change.
The superadmin controls only this tenant and receives no platform-owner access.

## Included data

Nine employees across six departments, teams and designations; five projects;
54 tasks with completed, review, active, blocked and pending examples; weekday
attendance history; leave policies and requests; goals and revenue KPIs;
skills and independent verifications; assessments/results; training;
performance and contribution reviews/snapshots; weekly updates and 1:1s;
recognition, progress badges, private to-dos, notifications and audit history;
downloadable PDF joining letters, employee resumes and applicant resumes; a job description;
India/state/city geography; three sales territories and employee assignments;
36 leads linked to three lead-list tasks (12 per sales employee), follow-ups,
interaction history and import summaries; 18 customers and 15 opportunities;
nine won-deal and three historical revenue transactions; six targets;
three locked payouts from a closed historical period; reseller partners; an
incentive rule; a draft email workflow and a blocked example contact.

Draft email workflows have no enrollments; no real messages, provider activity,
Gmail connection, AI output or voice recording is fabricated. Those integrations
continue to require their normal configuration and usage. Financial records and
performance scores are synthetic demonstration examples.

The fixture is a snapshot relative to its first creation date, not a rolling
simulation. Completed demo data and password changes are preserved across restarts.
Changing the password env value after provisioning does not reset existing users.
Set `WHALEXY_DEMO_ENABLED=false` after success to skip startup verification; this
does not remove the company or prevent login.

## Manual execution and validation

With the usual server environment and the demo password configured:

```sh
npm run seed:whalexy-demo
```

Validate every fixture through model schemas without connecting to PostgreSQL:

```sh
npm run seed:whalexy-demo -- --validate
```

Validation still requires the application's usual environment (including JWT
secrets), as model imports use the normal configuration module. Use
`DOTENV_CONFIG_PATH` if invoking from a directory other than the env file's location.
The seed refuses a pre-existing company with the same slug that lacks its marker,
serializes concurrent workers with a PostgreSQL advisory lock, and keeps an
incomplete new company in PROVISIONING until verification succeeds.
