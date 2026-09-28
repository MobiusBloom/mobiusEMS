import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import mongoose from "mongoose";
import { verifyDatabaseBackup } from "./backupDatabase.js";

interface BackupManifest { database: string; collections: { name: string; file: string }[] }
const RESTORABLE_COLLECTIONS = new Set(["departments", "designations", "permissions", "roles", "teams"]);

const run = async (): Promise<void> => {
  if (process.env.RESTORE_METADATA_CONFIRM !== "RESTORE_UPDATED_AT") throw new Error("Set RESTORE_METADATA_CONFIRM=RESTORE_UPDATED_AT to run this narrow recovery");
  const directory = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  if (!directory) throw new Error("Pass the verified pre-migration backup directory");
  await verifyDatabaseBackup(directory);
  const manifest = mongoose.mongo.BSON.EJSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"), { relaxed: false }) as BackupManifest;
  if (!process.env.MONGODB_MIGRATION_URI) throw new Error("Set MONGODB_MIGRATION_URI to the source MongoDB database");
  const client = new mongoose.mongo.MongoClient(process.env.MONGODB_MIGRATION_URI, { serverSelectionTimeoutMS: 20_000, connectTimeoutMS: 20_000, socketTimeoutMS: 60_000, retryWrites: true });
  await client.connect();
  let restored = 0;
  try {
    const database = client.db();
    if (database.databaseName !== manifest.database) throw new Error("Backup database does not match the configured database");
    for (const entry of manifest.collections.filter((item) => RESTORABLE_COLLECTIONS.has(item.name))) {
      const operations: mongoose.mongo.AnyBulkWriteOperation[] = [];
      const lines = createInterface({ input: createReadStream(path.join(directory, entry.file)).pipe(createGunzip()), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line) continue;
        const document = mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false }) as { _id?: mongoose.mongo.ObjectId; updatedAt?: Date };
        if (document._id && document.updatedAt) operations.push({ updateOne: { filter: { _id: document._id }, update: { $set: { updatedAt: document.updatedAt } } } });
      }
      if (operations.length) {
        const result = await database.collection(entry.name).bulkWrite(operations, { ordered: true });
        restored += result.modifiedCount;
      }
    }
    console.log(JSON.stringify({ restoredUpdatedAt: restored }, null, 2));
  } finally {
    await client.close();
  }
};

void run().catch((error: unknown) => { console.error("Metadata recovery failed", error); process.exit(1); });

