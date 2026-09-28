import { GridFSBucket, MongoClient, type Document as MongoDocument, type ObjectId } from "mongodb";
import { connectPostgres, disconnectPostgres, ensureBinaryObjectTable, ensurePostgresExtensions, postgres, quoteIdentifier } from "../persistence/postgres.js";
import { getPostgresModels, synchronizePostgresModels } from "../persistence/postgresModel.js";

const sourceUri = process.env.MONGODB_MIGRATION_URI;
if (!sourceUri) throw new Error("Set MONGODB_MIGRATION_URI to the source MongoDB database");

const plainJson = (document: MongoDocument): Record<string, unknown> => JSON.parse(JSON.stringify(document)) as Record<string, unknown>;

const migrateCollections = async (client: MongoClient) => {
  const source = client.db();
  const available = new Set((await source.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  const report: { collection: string; sourceDocuments: number; destinationDocuments: number }[] = [];
  for (const model of getPostgresModels()) {
    if (!available.has(model.table)) { report.push({ collection: model.table, sourceDocuments: 0, destinationDocuments: Number((await postgres.query(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(model.table)}`)).rows[0]?.count ?? 0) }); continue; }
    let documents = 0;
    for await (const sourceDocument of source.collection(model.table).find({})) {
      const document = plainJson(sourceDocument);
      if (document.storageProvider === "MONGODB") document.storageProvider = "POSTGRESQL";
      if (typeof document.profilePhotoKey === "string" && document.profilePhotoKey.startsWith("mongo:")) document.profilePhotoKey = `postgres:${document.profilePhotoKey.slice(6)}`;
      const id = String(document._id);
      const tenantId = document.tenantId ? String(document.tenantId) : null;
      if (model.tenantScoped && !tenantId) throw new Error(`${model.table}/${id} has no tenantId; complete the tenant migration before PostgreSQL cutover`);
      await postgres.query(
        `INSERT INTO ${quoteIdentifier(model.table)} (id, tenant_id, document, created_at, updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (id) DO UPDATE SET tenant_id=excluded.tenant_id, document=excluded.document, created_at=excluded.created_at, updated_at=excluded.updated_at`,
        [id, tenantId, JSON.stringify(document), document.createdAt ?? new Date(), document.updatedAt ?? document.createdAt ?? new Date()],
      );
      documents += 1;
    }
    const destinationDocuments = Number((await postgres.query(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(model.table)}`)).rows[0]?.count ?? 0);
    if (destinationDocuments < documents) throw new Error(`${model.table} verification failed: source=${documents}, destination=${destinationDocuments}`);
    report.push({ collection: model.table, sourceDocuments: documents, destinationDocuments });
  }
  return report;
};

const streamBuffer = async (bucket: GridFSBucket, id: ObjectId): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of bucket.openDownloadStream(id)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const migrateGridFs = async (client: MongoClient): Promise<number> => {
  const source = client.db();
  const names = new Set((await source.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  if (!names.has("privateDocuments.files")) return 0;
  const bucket = new GridFSBucket(source, { bucketName: "privateDocuments" });
  let migrated = 0;
  for await (const file of source.collection("privateDocuments.files").find({})) {
    const tenantId = String(file.metadata?.tenantId ?? "");
    if (!tenantId) throw new Error(`GridFS file ${String(file._id)} has no metadata.tenantId`);
    const content = await streamBuffer(bucket, file._id);
    const metadata = plainJson(file.metadata ?? {});
    await postgres.query(
      `INSERT INTO binary_objects (id, tenant_id, file_name, mime_type, category, metadata, content, size_bytes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET tenant_id=excluded.tenant_id, file_name=excluded.file_name, mime_type=excluded.mime_type, category=excluded.category, metadata=excluded.metadata, content=excluded.content, size_bytes=excluded.size_bytes`,
      [String(file._id), tenantId, file.filename, metadata.mimeType ?? "application/octet-stream", metadata.category ?? "EMPLOYEE_DOCUMENT", JSON.stringify(metadata), content, content.length, file.uploadDate ?? new Date()],
    );
    migrated += 1;
  }
  return migrated;
};

const run = async () => {
  const source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 20_000 });
  await Promise.all([connectPostgres(), source.connect()]);
  try {
    await import("../tenancy/modelRegistry.js");
    await ensurePostgresExtensions();
    await synchronizePostgresModels();
    await ensureBinaryObjectTable();
    const collections = await migrateCollections(source);
    const binaryObjects = await migrateGridFs(source);
    const sourceDocuments = collections.reduce((sum, item) => sum + item.sourceDocuments, 0);
    const destinationDocuments = collections.reduce((sum, item) => sum + item.destinationDocuments, 0);
    console.log(JSON.stringify({ migrated: true, sourceDocuments, destinationDocuments, binaryObjects, collections }, null, 2));
  } finally {
    await Promise.all([source.close(), disconnectPostgres()]);
  }
};

void run().catch((error: unknown) => { console.error("MongoDB to PostgreSQL migration failed", error); process.exit(1); });
