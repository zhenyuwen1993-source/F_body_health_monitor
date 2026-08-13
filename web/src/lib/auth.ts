import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db, ensureSchema } from "./db";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const COOKIE = "sh_session";
const MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days
export const DAILY_AI_LIMIT = 10;

/** Owners listed in ADMIN_EMAILS get a bigger allowance and the /admin page. */
export function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS ?? "";
  if (!raw.trim()) return false;
  const set = new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.trim().toLowerCase());
}

function adminLimit(): number {
  const n = Number(process.env.ADMIN_AI_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

/** The daily AI allowance for one account. */
export async function limitForUser(userId: number): Promise<number> {
  const user = await getUser(userId);
  return user && isAdminEmail(user.email) ? adminLimit() : DAILY_AI_LIMIT;
}

function secret(): string {
  // Falls back to the DB URL so sessions still sign in preview environments
  // where no explicit secret was set; both are server-only values.
  return process.env.AUTH_SECRET || process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

// --- passwords ---------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// --- session cookie ----------------------------------------------------------

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function createSession(userId: number) {
  const exp = Date.now() + MAX_AGE_S * 1000;
  const payload = `${userId}.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Returns the signed-in user id, or null. Verifies signature and expiry. */
export async function currentUserId(): Promise<number | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expect = sign(payload);
  if (sig.length !== expect.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const [idStr, expStr] = payload.split(".");
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isFinite(id) || !Number.isFinite(exp) || Date.now() > exp) return null;
  return id;
}

// --- users -------------------------------------------------------------------

export interface User {
  id: number;
  email: string;
}

export async function createUser(email: string, password: string): Promise<User> {
  await ensureSchema();
  const hash = await hashPassword(password);
  const res = await db().query<{ id: string; email: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [email.toLowerCase().trim(), hash],
  );
  return { id: Number(res.rows[0].id), email: res.rows[0].email };
}

export async function findUserByEmail(
  email: string,
): Promise<(User & { passwordHash: string }) | null> {
  await ensureSchema();
  const res = await db().query<{ id: string; email: string; password_hash: string }>(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email.toLowerCase().trim()],
  );
  const r = res.rows[0];
  return r ? { id: Number(r.id), email: r.email, passwordHash: r.password_hash } : null;
}

export async function getUser(id: number): Promise<User | null> {
  await ensureSchema();
  const res = await db().query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE id = $1",
    [id],
  );
  const r = res.rows[0];
  return r ? { id: Number(r.id), email: r.email } : null;
}

// --- AI quota ----------------------------------------------------------------

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
}

export async function getQuota(userId: number): Promise<Quota> {
  await ensureSchema();
  const limit = await limitForUser(userId);
  const res = await db().query<{ count: number }>(
    "SELECT count FROM ai_usage WHERE user_id = $1 AND day = CURRENT_DATE",
    [userId],
  );
  const used = res.rows[0]?.count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Atomically consume one unit. Returns null when the daily limit is already
 * reached — the increment and the check happen in one statement so concurrent
 * requests can't slip past the limit.
 */
export async function consumeQuota(userId: number): Promise<Quota | null> {
  await ensureSchema();
  const limit = await limitForUser(userId);
  const res = await db().query<{ count: number }>(
    `INSERT INTO ai_usage (user_id, day, count) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = ai_usage.count + 1
     WHERE ai_usage.count < $2
     RETURNING count`,
    [userId, limit],
  );
  if (res.rows.length === 0) return null;
  const used = res.rows[0].count;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** True when the signed-in account is an owner. */
export async function currentUserIsAdmin(): Promise<boolean> {
  const id = await currentUserId();
  if (!id) return false;
  const user = await getUser(id);
  return !!user && isAdminEmail(user.email);
}
