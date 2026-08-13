// One-shot health read-through of the user's metrics, generated right after
// upload. The rule-based summary renders instantly; this arrives behind it with
// the cross-metric reading that templates can't do.

import { DAILY_AI_LIMIT, consumeQuota, currentUserId } from "@/lib/auth";
import { resolveProvider, streamCompletion } from "@/lib/ai";
import { dbConfigured } from "@/lib/db";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `你是一位健康与训练分析师，正在给一位**普通用户**（不是运动员、没有运动科学背景）解读他的 Apple Watch 数据。

写作要求：
1. **说人话**。禁止直接抛出 HRV、CTL、TSB、SDNN、Z2 这类术语；如果非提不可，必须紧跟一句大白话解释（例如"心率变异性（简单说就是身体的放松程度）"）。
2. **要串起来看**。单个指标的高低用户自己能看到；你的价值在于把多个指标连起来讲出一个因果故事，比如"连续三天睡不到 6 小时 → 静息心率在爬 → 身体在硬扛"。
3. **给能执行的建议**。"注意休息"是废话；"今晚十一点前上床，明天把跑步换成散步 30 分钟"才有用。
4. **诚实**。数据缺失就说没有，不要编。指标正常就说正常，不要为了显得有用而制造焦虑。
5. **不要下医学诊断**。出现明显异常时，建议去看医生，但不要吓唬人。

输出格式（严格遵守，用中文）：

## 一句话总结
（20 字以内，直给结论）

## 我看到了什么
（2–4 句，把关键指标串成一个故事。引用具体数字。）

## 今天建议这么做
- （2–4 条，每条都具体可执行）

## 值得留意
（1–2 句。没有值得留意的就写"暂时没有需要特别注意的地方。"）

全文控制在 400 字以内。不要写开场白和客套话，直接从标题开始。`;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });

  const limit = rateLimit(clientIp(req));
  if (!limit.ok)
    return Response.json({ error: "请求太频繁了，稍后再试。" }, { status: 429 });

  if (!dbConfigured())
    return Response.json(
      { error: "AI 分析暂时不可用（服务器未连接数据库）。" },
      { status: 503 },
    );

  const userId = await currentUserId();
  if (!userId)
    return Response.json({ error: "登录后可以看 AI 分析。", needAuth: true }, { status: 401 });

  let body: { context?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }
  const context = (body.context ?? "").slice(0, 20_000);
  if (!context) return Response.json({ error: "没有可分析的数据。" }, { status: 400 });

  const provider = resolveProvider();
  if (!provider)
    return Response.json({ error: "服务器未配置 AI Key。" }, { status: 503 });

  const quota = await consumeQuota(userId);
  if (!quota)
    return Response.json(
      { error: `今天的 ${DAILY_AI_LIMIT} 次 AI 额度已经用完了，明天再来吧。` },
      { status: 429 },
    );

  return streamCompletion(provider, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `这是我的健康数据：\n\n${context}\n\n请按格式分析。` },
  ]);
}
