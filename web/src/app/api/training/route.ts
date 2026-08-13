// Training log: plans, what was actually trained, and current aches.

import { currentUserId } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";
import {
  BODY_PARTS,
  addIssue,
  isBodyPart,
  listDays,
  listIssues,
  resolveIssue,
  upsertDay,
} from "@/lib/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanParts(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && isBodyPart(x));
  return [...new Set(out)];
}

export async function GET() {
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });
  const userId = await currentUserId();
  if (!userId) return Response.json({ days: [], issues: [], needAuth: true });
  try {
    const [days, issues] = await Promise.all([listDays(userId), listIssues(userId)]);
    return Response.json({ days, issues, bodyParts: BODY_PARTS });
  } catch {
    return Response.json({ error: "读取训练记录失败。" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });

  const userId = await currentUserId();
  if (!userId)
    return Response.json({ error: "请先登录。", needAuth: true }, { status: 401 });

  if (!rateLimit(`training:${clientIp(req)}`).ok)
    return Response.json({ error: "操作太频繁，稍后再试。" }, { status: 429 });

  let body: {
    action?: string;
    day?: string;
    planned?: unknown;
    actual?: unknown;
    rpe?: unknown;
    note?: unknown;
    bodyPart?: string;
    severity?: unknown;
    id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  try {
    if (body.action === "day") {
      const day = typeof body.day === "string" && DAY_RE.test(body.day) ? body.day : null;
      if (!day) return Response.json({ error: "日期格式不对。" }, { status: 400 });
      const rpeRaw = typeof body.rpe === "number" ? body.rpe : null;
      const saved = await upsertDay(userId, day, {
        planned: cleanParts(body.planned),
        actual: cleanParts(body.actual),
        rpe: rpeRaw == null ? null : Math.min(10, Math.max(1, Math.round(rpeRaw))),
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      });
      return Response.json({ day: saved });
    }

    if (body.action === "addIssue") {
      const part = typeof body.bodyPart === "string" ? body.bodyPart : "";
      if (!isBodyPart(part))
        return Response.json({ error: "部位不在列表里。" }, { status: 400 });
      const sev = typeof body.severity === "number" ? body.severity : 1;
      await addIssue(
        userId,
        part,
        sev,
        typeof body.note === "string" ? body.note.slice(0, 300) : undefined,
      );
      return Response.json({ issues: await listIssues(userId) });
    }

    if (body.action === "resolveIssue") {
      const id = typeof body.id === "number" ? body.id : NaN;
      if (!Number.isFinite(id)) return Response.json({ error: "缺少 id。" }, { status: 400 });
      await resolveIssue(userId, id);
      return Response.json({ issues: await listIssues(userId) });
    }
  } catch (e) {
    // Log the real cause: a swallowed database error is impossible to diagnose
    // from the generic message the user sees.
    console.error("[/api/training]", e);
    return Response.json({ error: "保存失败，请稍后再试。" }, { status: 500 });
  }

  return Response.json({ error: "未知操作。" }, { status: 400 });
}
