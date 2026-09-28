import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const postgres = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.POSTGRES_MIN_POOL_SIZE,
  max: env.POSTGRES_MAX_POOL_SIZE,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
  application_name: "mobius-ems",
  ssl: env.POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
});

let connected = false;

export const connectPostgres = async (): Promise<void> => {
  const client = await postgres.connect();
  try {
    await client.query("SELECT 1");
    connected = true;
  } finally {
    client.release();
  }
};

export const disconnectPostgres = async (): Promise<void> => {
  connected = false;
  await postgres.end();
};

export const isPostgresConnected = (): boolean => connected;

export const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

export const ensurePostgresExtensions = async (): Promise<void> => {
  await postgres.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
};

export const ensureBinaryObjectTable = async (): Promise<void> => {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS binary_objects (
      id varchar(24) PRIMARY KEY,
      tenant_id varchar(24) NOT NULL,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      category text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      content bytea NOT NULL,
      size_bytes integer NOT NULL CHECK (size_bytes >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await postgres.query("CREATE INDEX IF NOT EXISTS binary_objects_tenant_id_idx ON binary_objects (tenant_id, id)");
};
