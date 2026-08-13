// Owner-only view of who signed up and how much AI they're spending.
// Membership comes from the ADMIN_EMAILS environment variable, so there's no
// bootstrap problem and no privilege to accidentally grant through the UI.

import { currentUserIsAdmin, isAdminEmail } from "@/lib/auth";
import { db, dbConfigured, ensureSchema } from "@/lib/db";
import { sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });
  if (!(await currentUserIsAdmin()))
    return Response.json({ error: "没有权限。" }, { status: 403 });

  await ensureSchema();
  const sql = db();

  const [users, totals, daily] = await Promise.all([
    sql.query<{
      id: string;
      email: string;
      created_at: Date;
      today: number | null;
      total: number | null;
      last_used: Date | null;
    }>(
      `SELECT u.id, u.email, u.created_at,
              (SELECT count FROM ai_usage a WHERE a.user_id = u.id AND a.day = CURRENT_DATE) AS today,
              (SELECT COALESCE(SUM(count), 0) FROM ai_usage a WHERE a.user_id = u.id) AS total,
              (SELECT MAX(day) FROM ai_usage a WHERE a.user_id = u.id) AS last_used
       FROM users u
       ORDER BY u.created_at DESC
       LIMIT 500`,
    ),
    sql.query<{ users: string; calls_today: string; calls_total: string }>(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COALESCE(SUM(count), 0) FROM ai_usage WHERE day = CURRENT_DATE) AS calls_today,
              (SELECT COALESCE(SUM(count), 0) FROM ai_usage) AS calls_total`,
    ),
    sql.query<{ day: Date; calls: string }>(
      `SELECT day, SUM(count) AS calls FROM ai_usage
       WHERE day >= CURRENT_DATE - 29 GROUP BY day ORDER BY day`,
    ),
  ]);

  return Response.json({
    stats: {
      users: Number(totals.rows[0]?.users ?? 0),
      callsToday: Number(totals.rows[0]?.calls_today ?? 0),
      callsTotal: Number(totals.rows[0]?.calls_total ?? 0),
    },
    daily: daily.rows.map((r) => ({ day: iso(r.day), calls: Number(r.calls) })),
    users: users.rows.map((r) => ({
      id: Number(r.id),
      email: r.email,
      createdAt: iso(r.created_at),
      today: Number(r.today ?? 0),
      total: Number(r.total ?? 0),
      lastUsed: r.last_used ? iso(r.last_used) : null,
      isAdmin: isAdminEmail(r.email),
    })),
  });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "未连接数据库。" }, { status: 503 });
  if (!(await currentUserIsAdmin()))
    return Response.json({ error: "没有权限。" }, { status: 403 });

  let body: { action?: string; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  const id = typeof body.id === "number" ? body.id : NaN;
  if (!Number.isFinite(id)) return Response.json({ error: "缺少 id。" }, { status: 400 });

  await ensureSchema();

  if (body.action === "resetQuota") {
    await db().query("DELETE FROM ai_usage WHERE user_id = $1 AND day = CURRENT_DATE", [id]);
    return Response.json({ ok: true });
  }

  if (body.action === "deleteUser") {
    // Owners can't delete themselves or each other by accident.
    const target = await db().query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [id],
    );
    const email = target.rows[0]?.email;
    if (!email) return Response.json({ error: "用户不存在。" }, { status: 404 });
    if (isAdminEmail(email))
      return Response.json({ error: "不能删除管理员账号。" }, { status: 400 });
    await db().query("DELETE FROM users WHERE id = $1", [id]);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "未知操作。" }, { status: 400 });
}

function iso(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
