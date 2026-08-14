import "server-only";
import { db, ensureSchema } from "./db";

// Body measurements the export can't tell us. Height in particular is missing
// from most Apple Health exports, and without it there's no BMI and no decent
// basal-metabolism estimate.

let schema: Promise<void> | undefined;

export function ensureProfileSchema(): Promise<void> {
  schema ??= (async () => {
    await ensureSchema();
    await db().query(`
      CREATE TABLE IF NOT EXISTS user_profile (
        user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        height_cm    NUMERIC(5,1),
        weight_kg    NUMERIC(5,1),
        body_fat_pct NUMERIC(4,1),
        birth_year   INT,
        sex          TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  })();
  return schema;
}

export interface Profile {
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  birthYear: number | null;
  sex: string | null;
  updatedAt: string | null;
}

export const EMPTY_PROFILE: Profile = {
  heightCm: null,
  weightKg: null,
  bodyFatPct: null,
  birthYear: null,
  sex: null,
  updatedAt: null,
};

export async function loadProfile(userId: number): Promise<Profile> {
  await ensureProfileSchema();
  const res = await db().query<{
    height_cm: string | null;
    weight_kg: string | null;
    body_fat_pct: string | null;
    birth_year: number | null;
    sex: string | null;
    updated_at: Date;
  }>(
    `SELECT height_cm, weight_kg, body_fat_pct, birth_year, sex, updated_at
     FROM user_profile WHERE user_id = $1`,
    [userId],
  );
  const r = res.rows[0];
  if (!r) return EMPTY_PROFILE;
  return {
    heightCm: num(r.height_cm),
    weightKg: num(r.weight_kg),
    bodyFatPct: num(r.body_fat_pct),
    birthYear: r.birth_year ?? null,
    sex: r.sex ?? null,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

/** Partial update: fields left undefined keep their stored value. */
export async function saveProfile(
  userId: number,
  patch: Partial<Record<keyof Profile, number | string | null>>,
): Promise<Profile> {
  await ensureProfileSchema();
  await db().query(
    `INSERT INTO user_profile (user_id, height_cm, weight_kg, body_fat_pct, birth_year, sex, updated_at)
     VALUES ($1::bigint, $2::numeric, $3::numeric, $4::numeric, $5::int, $6::text, now())
     ON CONFLICT (user_id) DO UPDATE SET
       height_cm    = COALESCE($2::numeric, user_profile.height_cm),
       weight_kg    = COALESCE($3::numeric, user_profile.weight_kg),
       body_fat_pct = COALESCE($4::numeric, user_profile.body_fat_pct),
       birth_year   = COALESCE($5::int, user_profile.birth_year),
       sex          = COALESCE($6::text, user_profile.sex),
       updated_at   = now()`,
    [
      userId,
      patch.heightCm ?? null,
      patch.weightKg ?? null,
      patch.bodyFatPct ?? null,
      patch.birthYear ?? null,
      patch.sex ?? null,
    ],
  );
  return loadProfile(userId);
}

/** Clearing a field needs an explicit NULL, which COALESCE can't express. */
export async function clearProfileField(
  userId: number,
  field: "body_fat_pct" | "birth_year" | "sex",
): Promise<Profile> {
  await ensureProfileSchema();
  await db().query(
    `UPDATE user_profile SET ${field} = NULL, updated_at = now() WHERE user_id = $1`,
    [userId],
  );
  return loadProfile(userId);
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
