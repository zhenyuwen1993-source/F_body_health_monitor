// The user's body measurements: height, weight, optional body fat.

import { currentUserId } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { EMPTY_PROFILE, clearProfileField, loadProfile, saveProfile } from "@/lib/profile";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ranges wide enough for anyone real, tight enough to catch a slipped decimal
// point or centimetres typed into the weight box.
const RANGE = {
  heightCm: [80, 250],
  weightKg: [25, 350],
  bodyFatPct: [3, 70],
  birthYear: [1900, new Date().getFullYear()],
} as const;

function check(name: keyof typeof RANGE, v: unknown): number | null | undefined {
  if (v === null || v === "") return null; // explicit clear
  if (v === undefined) return undefined; // leave alone
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  const [lo, hi] = RANGE[name];
  if (n < lo || n > hi) return undefined;
  return Math.round(n * 10) / 10;
}

export async function GET() {
  if (!dbConfigured()) return Response.json({ profile: EMPTY_PROFILE });
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    return Response.json({ profile: await loadProfile(userId) });
  } catch (e) {
    console.error("[/api/profile GET]", e);
    return Response.json({ error: "读取失败。" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });

  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!rateLimit(`profile:${clientIp(req)}`).ok)
    return Response.json({ error: "操作太频繁，稍后再试。" }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  const heightCm = check("heightCm", body.heightCm);
  const weightKg = check("weightKg", body.weightKg);
  const bodyFatPct = check("bodyFatPct", body.bodyFatPct);
  const birthYear = check("birthYear", body.birthYear);
  const sex =
    body.sex === "male" || body.sex === "female" || body.sex === null
      ? (body.sex as string | null)
      : undefined;

  if (
    heightCm === undefined &&
    weightKg === undefined &&
    bodyFatPct === undefined &&
    birthYear === undefined &&
    sex === undefined
  ) {
    return Response.json({ error: "没有可保存的内容，或数值超出合理范围。" }, { status: 400 });
  }

  try {
    // COALESCE keeps existing values, so an explicit clear needs its own pass.
    let profile = await saveProfile(userId, {
      heightCm: heightCm ?? undefined,
      weightKg: weightKg ?? undefined,
      bodyFatPct: bodyFatPct ?? undefined,
      birthYear: birthYear ?? undefined,
      sex: sex ?? undefined,
    });
    if (bodyFatPct === null) profile = await clearProfileField(userId, "body_fat_pct");
    if (birthYear === null) profile = await clearProfileField(userId, "birth_year");
    if (sex === null) profile = await clearProfileField(userId, "sex");
    return Response.json({ profile });
  } catch (e) {
    console.error("[/api/profile POST]", e);
    return Response.json({ error: "保存失败，请稍后再试。" }, { status: 500 });
  }
}
