import "server-only";
import { db, ensureSchema } from "./db";

// Saved copy of a user's computed daily metrics, so returning visitors see
// their dashboard without re-uploading the export every time.
//
// Only the per-day aggregates are stored — the numbers already on screen. The
// raw HealthKit records (hundreds of thousands of rows, including timestamps
// and device identifiers) are still parsed in the browser and never sent.

let schema: Promise<void> | undefined;

export function ensureHealthSchema(): Promise<void> {
  schema ??= (async () => {
    await ensureSchema();
    await db().query(`
      CREATE TABLE IF NOT EXISTS health_days (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day     DATE   NOT NULL,
        metrics JSONB  NOT NULL,
        PRIMARY KEY (user_id, day)
      );
      CREATE TABLE IF NOT EXISTS health_meta (
        user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        baselines    JSONB,
        workouts     JSONB,
        record_count INT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  })();
  return schema;
}

export interface StoredHealth {
  days: Record<string, unknown>[];
  baselines: Record<string, number> | null;
  workouts: Record<string, unknown>[];
  recordCount: number;
  updatedAt: string | null;
}

export async function loadHealth(userId: number): Promise<StoredHealth | null> {
  await ensureHealthSchema();
  const sql = db();
  const [days, meta] = await Promise.all([
    sql.query<{ metrics: Record<string, unknown> }>(
      "SELECT metrics FROM health_days WHERE user_id = $1 ORDER BY day",
      [userId],
    ),
    sql.query<{
      baselines: Record<string, number> | null;
      workouts: Record<string, unknown>[] | null;
      record_count: number | null;
      updated_at: Date;
    }>(
      "SELECT baselines, workouts, record_count, updated_at FROM health_meta WHERE user_id = $1",
      [userId],
    ),
  ]);
  if (days.rows.length === 0) return null;
  const m = meta.rows[0];
  return {
    days: days.rows.map((r) => r.metrics),
    baselines: m?.baselines ?? null,
    workouts: m?.workouts ?? [],
    recordCount: m?.record_count ?? 0,
    updatedAt: m?.updated_at ? m.updated_at.toISOString() : null,
  };
}

/**
 * Merge an upload into whatever is already stored. Days are upserted by date so
 * an older export never erases days a newer one covered — re-uploading a short
 * export after a long one keeps the history.
 */
export async function saveHealth(
  userId: number,
  days: { date: string; [k: string]: unknown }[],
  baselines: Record<string, number>,
  workouts: Record<string, unknown>[],
  recordCount: number,
): Promise<number> {
  await ensureHealthSchema();
  const sql = db();
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    // One statement for the whole upload: unnest the arrays server-side rather
    // than issuing a round trip per day.
    const dates = days.map((d) => d.date);
    const blobs = days.map((d) => JSON.stringify(d));
    await client.query(
      `INSERT INTO health_days (user_id, day, metrics)
       SELECT $1::bigint, d::date, m::jsonb
       FROM unnest($2::text[], $3::text[]) AS t(d, m)
       ON CONFLICT (user_id, day) DO UPDATE SET metrics = EXCLUDED.metrics`,
      [userId, dates, blobs],
    );
    await client.query(
      `INSERT INTO health_meta (user_id, baselines, workouts, record_count, updated_at)
       VALUES ($1::bigint, $2::jsonb, $3::jsonb, $4::int, now())
       ON CONFLICT (user_id) DO UPDATE SET
         baselines = EXCLUDED.baselines,
         workouts = EXCLUDED.workouts,
         record_count = EXCLUDED.record_count,
         updated_at = now()`,
      [userId, JSON.stringify(baselines), JSON.stringify(workouts), recordCount],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return days.length;
}

export async function deleteHealth(userId: number): Promise<void> {
  await ensureHealthSchema();
  const sql = db();
  await sql.query("DELETE FROM health_days WHERE user_id = $1", [userId]);
  await sql.query("DELETE FROM health_meta WHERE user_id = $1", [userId]);
}
