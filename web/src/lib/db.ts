import "server-only";
import { Pool } from "pg";

// Whichever Postgres the project is connected to (Neon, Supabase, Prisma
// Postgres, …) injects its connection string under one of these names.
const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "PRISMA_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
];

export function databaseUrl(): string | undefined {
  for (const k of URL_VARS) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

export const dbConfigured = () => databaseUrl() != null;

// Reused across invocations on a warm instance; serverless keeps this small.
let pool: Pool | undefined;

export function db(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

let ensured: Promise<void> | undefined;

/** Create tables on first use so there's no separate migration step to run. */
export function ensureSchema(): Promise<void> {
  ensured ??= (async () => {
    const sql = db();
    await sql.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            BIGSERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ai_usage (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day     DATE   NOT NULL,
        count   INT    NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);
  })();
  return ensured;
}
