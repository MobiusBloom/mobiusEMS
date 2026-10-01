# MobiusEMS quality audit — 1 October 2026

This audit covers automated tests, real PostgreSQL integration scenarios in an isolated temporary schema, production API checks, TypeScript compilation, a production build, dependency advisories, and lint diagnostics. It does not certify every browser interaction or every combination of organization permissions.

## Fixes

- Existing projected PostgreSQL documents now merge their loaded fields with the stored record before validation. Saving no longer removes hidden credentials or excluded fields. Explicitly cleared fields are removed, and hydration does not reintroduce excluded schema defaults.
- Public email webhooks and unsubscribe links discover their owning tenant in system context, then perform updates inside that tenant's context. Invalid webhook tokens are rejected before lookup.
- Dashboard analytics and automatic reporting hierarchy support the string identifiers returned by PostgreSQL lean queries.
- Registration cannot use an OTP token at the legacy completion endpoint. OTP digests are keyed and bound to the organization and email, preventing offline enumeration of six-digit codes from a readable registration token. Production mail failures no longer reveal verification codes; SMTP failure can fall through to Brevo.
- The server binds its HTTP port before database and tenant initialization. APIs return 503 with Retry-After while initialization is pending; health reports readiness truthfully. Shutdown also stops expired-record cleanup.
- Error responses include a stable code in production without exposing stack traces.
- Frontend chunk recovery preserves its retry marker and unrelated session data. Blocked session storage cannot trigger an automatic reload loop.
- Unit tests can run without production credentials. Root test execution now includes frontend recovery regressions.

## Verification

| Check | Result |
| --- | --- |
| Frontend regression tests | 2 passed |
| Server tests | 170 passed |
| Full workspace TypeScript check | Passed |
| Full production build | Passed; existing large-chunk warning remains |
| npm audit --omit=dev | 0 reported vulnerabilities |
| Isolated PostgreSQL integration | 11 scenarios passed; temporary schema removed |
| Production API audit before changes | 256 requests: 202 HTTP 200, 43 HTTP 403, 8 HTTP 422, 2 HTTP 401, 1 HTTP 500 |

The production 500 was dashboard analytics calling `.equals()` on a PostgreSQL string identifier. The permission and validation responses are reported as responses, not automatically classified as feature failures. APIs requiring record IDs or additional query inputs were not exhaustively exercised by the static-route audit.

The integration scenarios verified correct and incorrect OTPs, rejection of the OTP completion bypass, duplicate registration, email-only login, wrong-password rejection, anonymous access rejection, employee creation/edit/profile access, credential preservation, employee permission enforcement, personal todo creation/completion/deletion, email-only password recovery/reset, reset-token replay rejection, cross-tenant read/write rejection, session refresh/logout revocation, and separate platform-owner login. Mail delivery was mocked; no test emails were sent to real users.

## Repeating the checks

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm audit --omit=dev` from the repository root.

For real PostgreSQL integration checks, build the server first, set `AUDIT_DATABASE_URL`, optionally set `AUDIT_DATABASE_SSL=true`, then run `npm run audit:integration -w server`. The database account must be able to create a temporary schema. The harness uses only its generated schema in search_path and removes that exact schema in finally. Use a dedicated test database for routine CI. It never sends external mail.

## Remaining quality work

The repository-wide lint gate is still failing: client 14 errors and 7 warnings; server 83 errors. Most errors are legacy explicit-any casts and unused variables; client warnings include React effect dependencies. Rules were not globally relaxed. These diagnostics require a separate typed-code cleanup and associated feature verification before the lint gate can be claimed green.

The frontend build still warns about large JavaScript chunks. Paid AI provider calls, real external mail delivery, voice transcription runtime, exhaustive file uploads, exhaustive browser layouts, load testing, and concurrent multi-worker write races were not validated end to end by this pass. Successful mocked mail tests do not prove provider deliverability. Production workforce records were not changed by the API audit.

Deployment verification is recorded below after the final production checks.
