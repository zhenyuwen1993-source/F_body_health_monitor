// Register / login / logout / session lookup for the AI quota.
//
// One route with an `action` field keeps the client simple; each branch is
// small enough that splitting into four files would just add noise.

import { dbConfigured } from "@/lib/db";
import {
  consumeQuota,
  createSession,
  createUser,
  currentUserId,
  destroySession,
  findUserByEmail,
  getQuota,
  getUser,
  isAdminEmail,
  verifyPassword,
} from "@/lib/auth";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const id = await currentUserId();
  if (!id) return Response.json({ user: null });
  try {
    const user = await getUser(id);
    if (!user) return Response.json({ user: null });
    return Response.json({
      user: { ...user, isAdmin: isAdminEmail(user.email) },
      quota: await getQuota(id),
    });
  } catch {
    return Response.json({ user: null });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });

  let body: { action?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }
  const action = body.action;

  if (action === "logout") {
    await destroySession();
    return Response.json({ ok: true });
  }

  if (action === "consume") {
    const id = await currentUserId();
    if (!id) return Response.json({ error: "请先登录。" }, { status: 401 });
    const q = await consumeQuota(id);
    if (!q)
      return Response.json(
        { error: "今天的提问次数用完了，明天再来吧。" },
        { status: 429 },
      );
    return Response.json({ quota: q });
  }

  if (!dbConfigured()) {
    return Response.json(
      { error: "服务器还没连接数据库，暂时无法注册。" },
      { status: 503 },
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!EMAIL_RE.test(email)) return Response.json({ error: "邮箱格式不对。" }, { status: 400 });
  if (password.length < 8)
    return Response.json({ error: "密码至少 8 位。" }, { status: 400 });

  // Both branches touch password hashing; throttle by IP to slow guessing.
  const limit = rateLimit(`auth:${clientIp(req)}`);
  if (!limit.ok)
    return Response.json({ error: "尝试太频繁，请稍后再试。" }, { status: 429 });

  try {
    if (action === "register") {
      const existing = await findUserByEmail(email);
      if (existing)
        return Response.json({ error: "这个邮箱已经注册过了，直接登录吧。" }, { status: 409 });
      const user = await createUser(email, password);
      await createSession(user.id);
      return Response.json({ user, quota: await getQuota(user.id) });
    }

    if (action === "login") {
      const found = await findUserByEmail(email);
      if (!found || !(await verifyPassword(password, found.passwordHash)))
        return Response.json({ error: "邮箱或密码不对。" }, { status: 401 });
      await createSession(found.id);
      return Response.json({
        user: { id: found.id, email: found.email },
        quota: await getQuota(found.id),
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "DATABASE_NOT_CONFIGURED")
      return Response.json({ error: "服务器还没连接数据库。" }, { status: 503 });
    return Response.json({ error: "服务器出错了，请稍后再试。" }, { status: 500 });
  }

  return Response.json({ error: "未知操作。" }, { status: 400 });
}
