import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import mongoose from "mongoose";
import { verifyDatabaseBackup } from "./backupDatabase.js";

interface BackupManifest {
  database: string;
  collections: { name: string; file: string; documents: number }[];
}

const comparable = (document: Record<string, unknown>, collection: string): string => {
  delete document.tenantId;
  if (collection === "privateDocuments.files") {
    const metadata = document.metadata as Record<string, unknown> | undefined;
    if (metadata) delete metadata.tenantId;
  }
  return mongoose.mongo.BSON.EJSON.stringify(document, { relaxed: false });
};

const changedFields = (backedUp: Record<string, unknown>, live: Record<string, unknown>, collection: string): string[] => {
  delete backedUp.tenantId; delete live.tenantId;
  if (collection === "privateDocuments.files") {
    delete (backedUp.metadata as Record<string, unknown> | undefined)?.tenantId;
    delete (live.metadata as Record<string, unknown> | undefined)?.tenantId;
  }
  return [...new Set([...Object.keys(backedUp), ...Object.keys(live)])].filter((key) =>
    mongoose.mongo.BSON.EJSON.stringify(backedUp[key], { relaxed: false }) !== mongoose.mongo.BSON.EJSON.stringify(live[key], { relaxed: false }));
};

const run = async (): Promise<void> => {
  const backupDirectory = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  if (!backupDirectory) throw new Error("Pass the pre-migration backup directory as the first argument");
  await verifyDatabaseBackup(backupDirectory);
  const manifest = mongoose.mongo.BSON.EJSON.parse(await readFile(path.join(backupDirectory, "manifest.json"), "utf8"), { relaxed: false }) as BackupManifest;
  if (!process.env.MONGODB_MIGRATION_URI) throw new Error("Set MONGODB_MIGRATION_URI to the source MongoDB database");
  const client = new mongoose.mongo.MongoClient(process.env.MONGODB_MIGRATION_URI, { serverSelectionTimeoutMS: 20_000, connectTimeoutMS: 20_000, socketTimeoutMS: 60_000, retryReads: true, maxPoolSize: 5 });
  await client.connect();
  let verifiedDocuments = 0;
  const differences = new Map<string, { records: number; fields: Set<string> }>();
  try {
    const database = client.db();
    if (database.databaseName !== manifest.database) throw new Error(`Backup is for database ${manifest.database}, but the configured database is ${database.databaseName}`);
    for (const entry of manifest.collections) {
      const collection = database.collection(entry.name);
      const lines = createInterface({ input: createReadStream(path.join(backupDirectory, entry.file)).pipe(createGunzip()), crlfDelay: Infinity });
      let batch: Record<string, unknown>[] = [];
      const verifyBatch = async () => {
        if (!batch.length) return;
        const ids = batch.map((document) => document._id);
        if (ids.some((id) => !(id instanceof mongoose.mongo.ObjectId))) throw new Error(`Backup collection ${entry.name} contains an unsupported _id type`);
        const current = await collection.find({ _id: { $in: ids as mongoose.mongo.ObjectId[] } }).toArray();
        const byId = new Map(current.map((document) => [document._id.toString(), document as Record<string, unknown>]));
        for (const backedUp of batch) {
          const id = backedUp._id;
          const live = byId.get(String(id));
          if (!live) throw new Error(`Record ${entry.name}/${String(id)} is missing`);
          if (comparable(backedUp, entry.name) !== comparable(live, entry.name)) {
            const summary = differences.get(entry.name) ?? { records: 0, fields: new Set<string>() };
            summary.records += 1;
            for (const field of changedFields(backedUp, live, entry.name)) summary.fields.add(field);
            differences.set(entry.name, summary);
          }
          verifiedDocuments += 1;
        }
        batch = [];
      };
      for await (const line of lines) {
        if (!line) continue;
        batch.push(mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false }) as Record<string, unknown>);
        if (batch.length >= 250) await verifyBatch();
      }
      await verifyBatch();
    }
    if (differences.size) {
      const summary = [...differences].map(([collection, value]) => ({ collection, records: value.records, fields: [...value.fields].sort() }));
      throw new Error(`Records changed beyond tenantId: ${JSON.stringify(summary)}`);
    }
    console.log(JSON.stringify({ preserved: true, collections: manifest.collections.length, verifiedDocuments }, null, 2));
  } finally {
    await client.close();
  }
};

void run().catch((error: unknown) => { console.error("Migration preservation verification failed", error); process.exit(1); });
