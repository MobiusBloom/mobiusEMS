# Multi-tenant production runbook

## Isolation model

Every tenant-owned PostgreSQL row contains a non-null `tenant_id`, and the same identifier is retained inside its JSONB document. The PostgreSQL model adapter adds the active tenant to reads, writes, updates, deletes, aggregates, inserts, and bulk operations. An operation without request-scoped tenant context fails closed. `Tenant`, `Permission`, and system migration records are global models.

Unique business keys are tenant-local. Two organizations may therefore use the same user email, employee ID, department code, project code, or skill name. Tenant-leading PostgreSQL indexes enforce those boundaries.

JWT access and refresh tokens carry the tenant ID. A suspended organization is rejected on every authenticated request. PostgreSQL fallback file storage keeps binary content in `binary_objects` with a required `tenant_id`; Cloudinary uploads continue to use tenant-prefixed folders.

## PostgreSQL setup

For local development:

```bash
npm run db:up
npm run seed
```

The first application or seed startup creates all model tables, JSONB indexes, unique business-key indexes, the binary object table, and the default tenant. Startup is idempotent and does not overwrite existing organization data.

To migrate an existing MongoDB deployment, temporarily set `MONGODB_MIGRATION_URI` and run:

```bash
npm run migrate:mongo
```

The migration upserts records and GridFS objects by their original identifiers, validates destination counts, and can be rerun. Keep the old application drained during the final transfer. Retain a provider-native MongoDB backup until the PostgreSQL verification and application smoke tests are complete, then remove the migration credential.

See [POSTGRESQL_MIGRATION.md](POSTGRESQL_MIGRATION.md) for the complete cutover and rollback procedure.

## Configuration

```dotenv
DATABASE_URL=postgresql://app_user:strong-password@database-host:5432/mobius_ems
POSTGRES_MIN_POOL_SIZE=2
POSTGRES_MAX_POOL_SIZE=30
POSTGRES_SSL=true
DEFAULT_TENANT_NAME=MobiusEMS
DEFAULT_TENANT_SLUG=mobius-ems
PLATFORM_ADMIN_EMAILS=owner@example.com
EMAIL_AUTOMATION_ENABLED=true
```

`PLATFORM_ADMIN_EMAILS` is a comma-separated allowlist. An allowlisted account must also have the `SUPER_ADMIN` role. When the variable is empty, `SUPER_ADMIN_EMAIL` is the fallback platform owner. The original organization keeps its normal login behavior; the Organization ID can be left blank unless the same email exists in multiple organizations.

## Vendor onboarding

An allowlisted platform owner can use **Administration → Vendor organizations** or these endpoints:

- `GET /api/v1/platform/tenants`
- `POST /api/v1/platform/tenants`
- `PATCH /api/v1/platform/tenants/:id/status`

Provisioning creates tenant-local roles, starter departments/designations, and a tenant Super Admin. The new administrator must change the temporary password on first sign-in. Suspending a tenant immediately blocks access but retains all records for later reactivation.

## Operational checks

After deployment:

1. Confirm startup logs contain `PostgreSQL connected and schema verified`.
2. Confirm `GET /api/health` reports `database: connected`.
3. Sign in to the original account without an Organization ID and verify historical records.
4. Provision a test organization and sign in using its Organization ID.
5. Create the same department or employee email in both organizations to confirm tenant-local uniqueness.
6. Suspend the test organization and confirm its existing session receives `401`.
7. Monitor PostgreSQL connection usage and tune the configured pool limits for the deployment size.
