# MobiusEMS

MobiusEMS is the flagship employee management product of Mobius Bloom Venture Pvt Ltd. It is an independent workforce capability, delivery, growth, and performance-intelligence platform for `ems.mobiusbloom.com`, and does not share code or runtime infrastructure with the Laravel application at `whalexy.com`.

## What is included

- Secure, invitation-only accounts, forced password change, resumable onboarding, rotating refresh sessions, and database-backed RBAC
- Dynamic organization structure, employee lifecycle administration, Employee 360 profiles, and career timelines
- Skill claims, private evidence, independent verification, assessments, role gaps, and organization heatmaps
- Projects, task Kanban, validated transitions, blocker tracking, time/quality/rework metrics, and immutable activity history
- Local voice-to-task capture for employees and superadmins, with editable transcripts, task assignment/status commands, and organization-level voice audit history
- Goals, configurable KPIs, structured reviews, explainable weighted performance snapshots, and historical trends
- Training, skill growth, workload classification, project-staffing recommendations, recognition, and leave workflows
- Private document storage, in-app notifications, global search, reports, access audit, role settings, and live role-scoped dashboards
- Deterministic performance scoring plus permission-aware AI summaries and assistance. AI remains recommendation-only and explicitly excludes promotion, termination, salary, and disciplinary decisions.

## Technology

React, TypeScript, Vite, Tailwind CSS, shadcn-style primitives, TanStack Query, React Hook Form, Zod, Recharts, Lucide, Express, PostgreSQL 16, `pg`, a tenant-safe document compatibility layer, JWT, bcrypt, Cloudinary authenticated assets, Helmet, restricted CORS, origin checks, and rate limiting.

## Structure

```text
client/src/                 React application, features, routes and UI
server/src/                Versioned REST API and business services
  config/ controllers/ jobs/ middleware/ models/ routes/ services/ validators/
shared/src/                Shared roles, permissions and response types
docs/                      Architecture and database reference
.env.example               Safe configuration template
```

See [docs/sales-workflow.md](docs/sales-workflow.md) for the role boundaries and connected Sales Intelligence lifecycle.

## Local installation

Requirements: Node.js 20+, npm 10+, and Docker Desktop (or PostgreSQL 16+).

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, two different random JWT secrets of at least 32 characters, and the initial Super Admin values.
3. Run `npm install`.
4. Run `npm run db:up` and wait for the PostgreSQL health check.
5. Run `npm run seed` to create permissions, system roles, and the Super Admin.
6. Run `npm run dev` and open `http://localhost:5173`.

### Free local voice transcription

Voice tasks use `faster-whisper` on the application server, so there is no per-minute transcription fee and recorded audio is not retained after transcription.

1. Install Python 3.10 or newer.
2. Run `python -m pip install -r server/requirements-voice.txt`.
3. Keep the default multilingual `small` model, or configure `VOICE_WHISPER_MODEL`, `VOICE_WHISPER_DEVICE`, `VOICE_WHISPER_COMPUTE_TYPE`, and optional `VOICE_WHISPER_LANGUAGE` in `.env`.
4. The model downloads to the server's local Hugging Face cache on first use. Production hosting must provide persistent storage and enough memory for the selected model.

Employees can create self-reported tasks, update status, or complete work from the Work page. Completion commands prefill the matching task, actual hours, and completion note before moving the task into review. Superadmins can assign work, update tasks, and review voice-command history across the organization. Every transcript becomes an editable preview before it is applied, and confirmed commands are also written to the audit log.

The voice interface supports automatic detection plus explicit selection for English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, and Urdu. Multilingual status phrases are interpreted without a paid NLP API; when task-title matching is uncertain, the employee selects the correct task from their permitted list before confirmation.


## Commands

- `npm run dev`, `npm run dev:client`, `npm run dev:server`
- `npm run build`, `npm start`
- `npm run typecheck`, `npm run lint`
- `npm run seed`
- `npm run db:up`, `npm run db:down`, `npm run db:logs`
- `npm run migrate:mongo` for the one-time MongoDB-to-PostgreSQL transfer

## PostgreSQL

Local development uses PostgreSQL 16 through `compose.yaml`. Application records are stored in one PostgreSQL table per domain model with an indexed JSONB document, stable 24-character identifiers, tenant-leading indexes, and database-enforced unique business keys. This preserves the existing API and service contracts while removing MongoDB as a runtime dependency. Binary fallback storage uses the `binary_objects` PostgreSQL table.

For production, create a least-privilege PostgreSQL database, require TLS, restrict network access to the application host, set `DATABASE_URL`, and set `POSTGRES_SSL=true`. Back up the database with the hosting provider's snapshots and `pg_dump`.

### Existing MongoDB data

Set `MONGODB_MIGRATION_URI` temporarily and run `npm run migrate:mongo`. The migration is resumable: records and GridFS files are upserted by their existing identifiers. Remove the MongoDB migration credential after verification. See [the PostgreSQL migration runbook](docs/POSTGRESQL_MIGRATION.md).

## Private documents

Configure the Cloudinary variables to enable external uploads. Files are stored as authenticated resources with randomized keys and signed downloads. If Cloudinary is unavailable, private files are stored in PostgreSQL `bytea` records scoped by tenant. MIME type and size are validated before upload. Never place employee files under `client/public` or another predictable public folder.

## Production deployment on Hostinger

1. Create a separate Hostinger Node.js Web App and map `ems.mobiusbloom.com` to it. Do not place this project in Laravel's `public_html`.
2. Select Node.js 20 or newer. Install build dependencies with `npm ci --include=dev` and build with `npm run build`. CSS tooling is required during the build, even when the hosting environment sets `NODE_ENV=production`.
3. Set the start command to `npm start`.
4. Add all production environment values in Hostinger. Use `NODE_ENV=production`, `CLIENT_URL=https://ems.mobiusbloom.com`, and `COOKIE_DOMAIN=ems.mobiusbloom.com`.
5. Point the subdomain DNS record using the value Hostinger supplies and enable HTTPS.

Express serves `client/dist`, retains `/api/v1/*` for REST endpoints, and applies SPA fallback for client routes.

### AI provider configuration

Groq is the default. Set `AI_PROVIDER=groq`, `GROQ_API_KEY`, and optionally `AI_MODEL`. The provider layer also supports OpenAI, OpenRouter, Together, Anthropic, Gemini, and generic OpenAI-compatible APIs through `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, and optional `AI_BASE_URL`. Put keys only in Hostinger environment variables, then redeploy. `AI_COMPANY_KNOWLEDGE` can contain approved policy notes used by MobiusEMS AI; unanswered policy questions are escalated to HR.

AI requests are rate-limited, role-scoped, and audit logged. Employee contribution and performance summaries are advisory drafts. Daily personal to-dos are private and excluded from performance evidence. Mood Break jokes are safety-constrained and cached to limit provider usage.

## Security notes

Access and refresh tokens use HttpOnly cookies; production cookies are Secure and SameSite Strict. Refresh tokens rotate and reuse invalidates the session family. Mutations require an allowed origin. Backend middleware enforces every permission and business services enforce employee/manager scope. Passwords use bcrypt and are never returned except the one-time generated temporary credential. Sensitive actions are audit logged. Production errors do not expose stacks.

Before launch, rotate seed credentials, use high-entropy secrets, configure PostgreSQL and storage backups, test restoration, restrict Hostinger environment access, and run `npm run typecheck`, `npm run lint`, and `npm run build` in CI.

See [architecture](docs/ARCHITECTURE.md) and [schema reference](docs/SCHEMA.md).

