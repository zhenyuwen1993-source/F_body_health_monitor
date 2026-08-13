import "server-only";
import { db, ensureSchema } from "./db";

// Training log: what the user planned to train, what they actually trained, and
// which body parts currently hurt. Unlike the health metrics (which never leave
// the browser) this is user-entered and has to persist across devices.

export const BODY_PARTS = [
  "胸",
  "背",
  "肩",
  "二头",
  "三头",
  "腿",
  "臀",
  "核心",
  "小腿",
  "前臂",
  "有氧",
] as const;

export type BodyPart = (typeof BODY_PARTS)[number];

export function isBodyPart(v: string): v is BodyPart {
  return (BODY_PARTS as readonly string[]).includes(v);
}

let trainingSchema: Promise<void> | undefined;

export function ensureTrainingSchema(): Promise<void> {
  trainingSchema ??= (async () => {
    await ensureSchema();
    await db().query(`
      CREATE TABLE IF NOT EXISTS training_days (
        user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day      DATE   NOT NULL,
        planned  TEXT[] NOT NULL DEFAULT '{}',
        actual   TEXT[] NOT NULL DEFAULT '{}',
        rpe      INT,
        note     TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, day)
      );
      CREATE TABLE IF NOT EXISTS body_issues (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body_part  TEXT   NOT NULL,
        severity   INT    NOT NULL,
        note       TEXT,
        started_on DATE   NOT NULL DEFAULT CURRENT_DATE,
        resolved_on DATE
      );
      CREATE INDEX IF NOT EXISTS body_issues_user_open
        ON body_issues (user_id) WHERE resolved_on IS NULL;
    `);
  })();
  return trainingSchema;
}

export interface TrainingDay {
  day: string;
  planned: string[];
  actual: string[];
  rpe?: number;
  note?: string;
}

export interface BodyIssue {
  id: number;
  bodyPart: string;
  severity: number; // 1 mild .. 3 severe
  note?: string;
  startedOn: string;
}

export async function listDays(userId: number, sinceDays = 60): Promise<TrainingDay[]> {
  await ensureTrainingSchema();
  const res = await db().query<{
    day: Date;
    planned: string[];
    actual: string[];
    rpe: number | null;
    note: string | null;
  }>(
    `SELECT day, planned, actual, rpe, note FROM training_days
     WHERE user_id = $1 AND day >= CURRENT_DATE - $2::int
     ORDER BY day`,
    [userId, sinceDays],
  );
  return res.rows.map((r) => ({
    day: isoDay(r.day),
    planned: r.planned ?? [],
    actual: r.actual ?? [],
    rpe: r.rpe ?? undefined,
    note: r.note ?? undefined,
  }));
}

export async function upsertDay(
  userId: number,
  day: string,
  patch: { planned?: string[]; actual?: string[]; rpe?: number | null; note?: string | null },
): Promise<TrainingDay> {
  await ensureTrainingSchema();
  const res = await db().query<{
    day: Date;
    planned: string[];
    actual: string[];
    rpe: number | null;
    note: string | null;
  }>(
    // Every parameter is cast explicitly: Postgres can't infer the type of a
    // NULL placeholder, and these are NULL whenever a field isn't being changed.
    `INSERT INTO training_days (user_id, day, planned, actual, rpe, note)
     VALUES ($1::bigint, $2::date, COALESCE($3::text[], '{}'), COALESCE($4::text[], '{}'),
             $5::int, $6::text)
     ON CONFLICT (user_id, day) DO UPDATE SET
       planned = COALESCE($3::text[], training_days.planned),
       actual  = COALESCE($4::text[], training_days.actual),
       rpe     = COALESCE($5::int, training_days.rpe),
       note    = COALESCE($6::text, training_days.note),
       updated_at = now()
     RETURNING day, planned, actual, rpe, note`,
    [
      userId,
      day,
      patch.planned ?? null,
      patch.actual ?? null,
      patch.rpe ?? null,
      patch.note ?? null,
    ],
  );
  const r = res.rows[0];
  return {
    day: isoDay(r.day),
    planned: r.planned ?? [],
    actual: r.actual ?? [],
    rpe: r.rpe ?? undefined,
    note: r.note ?? undefined,
  };
}

export async function listIssues(userId: number): Promise<BodyIssue[]> {
  await ensureTrainingSchema();
  const res = await db().query<{
    id: string;
    body_part: string;
    severity: number;
    note: string | null;
    started_on: Date;
  }>(
    `SELECT id, body_part, severity, note, started_on FROM body_issues
     WHERE user_id = $1 AND resolved_on IS NULL ORDER BY started_on DESC`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    bodyPart: r.body_part,
    severity: r.severity,
    note: r.note ?? undefined,
    startedOn: isoDay(r.started_on),
  }));
}

export async function addIssue(
  userId: number,
  bodyPart: string,
  severity: number,
  note?: string,
): Promise<void> {
  await ensureTrainingSchema();
  await db().query(
    "INSERT INTO body_issues (user_id, body_part, severity, note) VALUES ($1, $2, $3, $4)",
    [userId, bodyPart, Math.min(3, Math.max(1, severity)), note ?? null],
  );
}

export async function resolveIssue(userId: number, id: number): Promise<void> {
  await ensureTrainingSchema();
  await db().query(
    "UPDATE body_issues SET resolved_on = CURRENT_DATE WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
}

function isoDay(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
