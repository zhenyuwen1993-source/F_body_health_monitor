// Daily behaviour tags (喝酒 / 咖啡 / 压力大 …) used for the correlation view.

import { currentUserId } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { JOURNAL_TAGS, isJournalTag, listJournal, setJournalDay } from "@/lib/journal";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  if (!dbConfigured()) return Response.json({ days: [], tags: JOURNAL_TAGS });
  const userId = await currentUserId();
  if (!userId) return Response.json({ days: [], tags: JOURNAL_TAGS, needAuth: true });
  try {
    return Response.json({ days: await listJournal(userId), tags: JOURNAL_TAGS });
  } catch (e) {
    console.error("[/api/journal GET]", e);
    return Response.json({ error: "读取失败。" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });

  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!rateLimit(`journal:${clientIp(req)}`).ok)
    return Response.json({ error: "操作太频繁，稍后再试。" }, { status: 429 });

  let body: { day?: unknown; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  const day = typeof body.day === "string" && DAY_RE.test(body.day) ? body.day : null;
  if (!day) return Response.json({ error: "日期格式不对。" }, { status: 400 });
  // Journalling the future would poison the correlations.
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (day > localToday) return Response.json({ error: "不能记未来的日子。" }, { status: 400 });

  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.filter((t): t is string => typeof t === "string" && isJournalTag(t)))]
    : [];

  try {
    return Response.json({ day: await setJournalDay(userId, day, tags) });
  } catch (e) {
    console.error("[/api/journal POST]", e);
    return Response.json({ error: "保存失败，请稍后再试。" }, { status: 500 });
  }
}
