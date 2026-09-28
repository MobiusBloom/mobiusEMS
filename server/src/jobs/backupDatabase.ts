import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
const migrationMongoUri = () => {
  const value = process.env.MONGODB_MIGRATION_URI;
  if (!value) throw new Error("Set MONGODB_MIGRATION_URI to the source MongoDB database before running this migration utility");
  return value;
};

const safeName = (name: string) => encodeURIComponent(name).replaceAll("%", "_");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

interface BackupManifest {
  format: number;
  createdAt: string;
  database: string;
  collections: { name: string; file: string; documents: number; bytes: number; sha256: string; indexes: unknown[] }[];
}

export const verifyDatabaseBackup = async (directory: string): Promise<{ collections: number; documents: number }> => {
  const manifest = mongoose.mongo.BSON.EJSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"), { relaxed: false }) as BackupManifest;
  if (Number(manifest.format) !== 1 || !Array.isArray(manifest.collections)) throw new Error("Unsupported or invalid backup manifest");
  let totalDocuments = 0;
  for (const collection of manifest.collections) {
    const filePath = path.resolve(directory, collection.file);
    if (path.dirname(filePath) !== path.resolve(directory)) throw new Error(`Unsafe backup filename: ${collection.file}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    if (hash.digest("hex") !== collection.sha256) throw new Error(`Checksum mismatch for ${collection.name}`);
    let documents = 0;
    const lines = createInterface({ input: createReadStream(filePath).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false });
      documents += 1;
    }
    if (documents !== Number(collection.documents)) throw new Error(`Document count mismatch for ${collection.name}`);
    totalDocuments += documents;
  }
  return { collections: manifest.collections.length, documents: totalDocuments };
};

export const createDatabaseBackup = async (requestedDirectory?: string): Promise<string> => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const directory = path.resolve(requestedDirectory || path.join(projectRoot, ".runtime", "backups", `before-tenant-migration-${stamp()}`));
  await mkdir(directory, { recursive: true });
  const client = new mongoose.mongo.MongoClient(migrationMongoUri(), { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const database = client.db();
    const collections = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((item) => item.name)
      .filter((name) => !name.startsWith("system."))
      .sort();
    const manifest: BackupManifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      database: database.databaseName,
      collections: [],
    };
    for (const name of collections) {
      const collection = database.collection(name);
      const file = `${safeName(name)}.ndjson.gz`;
      let documents = 0;
      const source = Readable.from((async function* () {
        for await (const document of collection.find({})) {
          documents += 1;
          yield `${mongoose.mongo.BSON.EJSON.stringify(document, { relaxed: false })}\n`;
        }
      })());
      const filePath = path.join(directory, file);
      await pipeline(source, createGzip({ level: 9 }), createWriteStream(filePath, { flags: "wx" }));
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(filePath)) hash.update(chunk);
      const indexes = await collection.indexes().catch(() => []);
      manifest.collections.push({ name, file, documents, bytes: (await stat(filePath)).size, sha256: hash.digest("hex"), indexes });
    }
    await writeFile(path.join(directory, "manifest.json"), mongoose.mongo.BSON.EJSON.stringify(manifest, { relaxed: false }, 2), { encoding: "utf8", flag: "wx" });
    await verifyDatabaseBackup(directory);
    return directory;
  } finally {
    await client.close();
  }
};

const run = async () => {
  const directory = await createDatabaseBackup(process.argv[2]);
  console.log(`Database backup completed: ${directory}`);
};

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  void run().catch((error: unknown) => { console.error("Database backup failed", error); process.exit(1); });
}
