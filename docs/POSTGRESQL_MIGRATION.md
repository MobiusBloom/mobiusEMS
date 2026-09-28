# PostgreSQL migration runbook

MobiusEMS now uses PostgreSQL as its runtime database. MongoDB is accessed only by the optional one-time data-transfer utilities.

## Local database

```powershell
npm run db:up
docker compose ps
npm run seed
npm run dev
```

The default local connection is:

```text
postgresql://mobius:mobius@127.0.0.1:5432/mobius_ems
```

Override `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_PORT` before `docker compose up` when shared defaults are unsuitable. Update `DATABASE_URL` to match.

## Storage design

- Each registered domain model receives its own PostgreSQL table.
- Stable existing `_id` values are retained in the table `id` column.
- `tenant_id` is a required indexed column for each tenant-owned model.
- The complete validated model payload is stored as `jsonb` so existing API contracts, nested assessment data, scoring snapshots, and flexible integration metadata remain compatible.
- A GIN index supports JSONB access, while unique schema fields receive PostgreSQL unique expression indexes. Tenant-owned uniqueness is scoped by `tenant_id`.
- Private fallback files use `binary_objects.content bytea`; Cloudinary remains supported.

The compatibility layer lives in `server/src/persistence/postgresModel.ts`. It translates existing model reads, writes, populations, bulk operations, and aggregation stages to PostgreSQL-backed operations. This allows the API migration to remain backward compatible without requiring a frontend rewrite.

## Migrating existing data

1. Back up MongoDB and PostgreSQL independently.
2. Ensure every tenant-owned MongoDB document has `tenantId`.
3. Configure the destination `DATABASE_URL`.
4. Set `MONGODB_MIGRATION_URI` to a read-only source credential.
5. Start PostgreSQL and run the migration:

```powershell
npm run db:up
npm run migrate:mongo
```

The command creates the destination schema, upserts every registered collection, transfers `privateDocuments` GridFS files to `binary_objects`, and prints per-collection counts. It is safe to rerun because identifiers are preserved and writes use upserts.

After verification, remove `MONGODB_MIGRATION_URI`. The application itself requires only `DATABASE_URL`.

## Production cutover

1. Put the old application in maintenance/read-only mode.
2. Take a final MongoDB snapshot.
3. Run `npm run migrate:mongo` against the production PostgreSQL destination.
4. Start the new application and verify `/api/health` reports PostgreSQL connected.
5. Smoke-test login, employee lists, project/task updates, attendance, documents, sales analytics, and background email jobs.
6. Keep the MongoDB snapshot until the agreed rollback window has expired.

Rollback consists of stopping the PostgreSQL-backed release and redeploying the previous MongoDB-backed release against the untouched MongoDB snapshot. Do not allow writes to both releases simultaneously.
