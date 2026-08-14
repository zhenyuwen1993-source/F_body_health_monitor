import "server-only";
import { db, ensureSchema } from "./db";

// Daily behaviour tags — the "journal" that lets the app answer "what actually
// affects my sleep?" instead of the user guessing. One row per day per user.

export const JOURNAL_TAGS = [
  "喝酒",
  "咖啡",
  "晚饭很晚",
  "睡前刷手机",
  "压力大",
  "加班",
  "出差",
  "午睡",
  "生病",
  "冥想",
] as const;

export function isJournalTag(v: string): boolean {
  return (JOURNAL_TAGS as readonly string[]).includes(v);
}

let schema: Promise<void> | undefined;

function ensureJournalSchema(): Promise<void> {
  schema ??= (async () => {
    await ensureSchema();
    await db().query(`
      CREATE TABLE IF NOT EXISTS journal_days (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day     DATE   NOT NULL,
        tags    TEXT[] NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, day)
      );
    `);
  })();
  return schema;
}

export interface JournalDay {
  day: string;
  tags: string[];
}

export async function listJournal(userId: number, sinceDays = 120): Promise<JournalDay[]> {
  await ensureJournalSchema();
  const res = await db().query<{ day: Date; tags: string[] }>(
    `SELECT day, tags FROM journal_days
     WHERE user_id = $1 AND day >= CURRENT_DATE - $2::int
     ORDER BY day`,
    [userId, sinceDays],
  );
  return res.rows.map((r) => ({ day: iso(r.day), tags: r.tags ?? [] }));
}

export async function setJournalDay(
  userId: number,
  day: string,
  tags: string[],
): Promise<JournalDay> {
  await ensureJournalSchema();
  const res = await db().query<{ day: Date; tags: string[] }>(
    `INSERT INTO journal_days (user_id, day, tags)
     VALUES ($1::bigint, $2::date, $3::text[])
     ON CONFLICT (user_id, day) DO UPDATE SET tags = $3::text[], updated_at = now()
     RETURNING day, tags`,
    [userId, day, tags],
  );
  return { day: iso(res.rows[0].day), tags: res.rows[0].tags ?? [] };
}

function iso(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
