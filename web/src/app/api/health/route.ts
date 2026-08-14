// Load / save / delete the signed-in user's computed daily metrics.

import { currentUserId } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { deleteHealth, loadHealth, saveHealth } from "@/lib/healthStore";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 20_000; // ~54 years; a sanity bound, not a real limit

export async function GET() {
  if (!dbConfigured()) return Response.json({ data: null });
  const userId = await currentUserId();
  if (!userId) return Response.json({ data: null, needAuth: true }, { status: 401 });
  try {
    return Response.json({ data: await loadHealth(userId) });
  } catch (e) {
    console.error("[/api/health GET]", e);
    return Response.json({ error: "读取失败。" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });

  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!rateLimit(`health:${clientIp(req)}`).ok)
    return Response.json({ error: "操作太频繁，稍后再试。" }, { status: 429 });

  let body: {
    days?: unknown;
    baselines?: unknown;
    workouts?: unknown;
    recordCount?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  if (!Array.isArray(body.days) || body.days.length === 0)
    return Response.json({ error: "没有可保存的数据。" }, { status: 400 });
  if (body.days.length > MAX_DAYS)
    return Response.json({ error: "数据量超出上限。" }, { status: 413 });

  const days = body.days.filter(
    (d): d is { date: string } =>
      !!d && typeof d === "object" && typeof (d as { date?: unknown }).date === "string" &&
      DAY_RE.test((d as { date: string }).date),
  );
  if (days.length === 0)
    return Response.json({ error: "数据格式不对。" }, { status: 400 });

  try {
    const saved = await saveHealth(
      userId,
      days,
      (body.baselines ?? {}) as Record<string, number>,
      Array.isArray(body.workouts) ? (body.workouts as Record<string, unknown>[]) : [],
      typeof body.recordCount === "number" ? body.recordCount : 0,
    );
    return Response.json({ saved });
  } catch (e) {
    console.error("[/api/health POST]", e);
    return Response.json({ error: "保存失败，请稍后再试。" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    await deleteHealth(userId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[/api/health DELETE]", e);
    return Response.json({ error: "删除失败。" }, { status: 500 });
  }
}
