// Follow-up questions about the user's own data. Requires an account and
// spends one unit of that account's daily AI quota.

import { DAILY_AI_LIMIT, consumeQuota, currentUserId } from "@/lib/auth";
import { resolveProvider, streamCompletion, type ChatMessage } from "@/lib/ai";
import { dbConfigured } from "@/lib/db";
import { clientIp, rateLimit, sameOrigin } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `你是一位健康与训练分析助手，服务对象是**普通用户**，不是运动员，也没有运动科学背景。

你会拿到用户 Apple Watch / iPhone 导出的健康指标摘要，请基于这些真实数据回答问题。

指标含义（用户看到的是中文名，括号里是专业叫法）：
- 今日状态：综合睡眠、心率变异性、训练负荷等算出的 0–100 分，回答"今天能不能好好练"。
- 恢复程度：身体从疲劳中恢复了多少。
- 今日消耗（Strain 0–21）：当天身体承受的总负荷。
- 体能储备（CTL）：长期积累的底子。近期疲劳（ATL）：最近一周堆积的疲劳。身体余力（TSB）＝前者减后者，正数有余力，负数偏疲劳。
- 心率变异性（HRV）：身体的放松程度，相对自己的基线看趋势，绝对值没有统一标准。
- 作息规律度：入睡和起床时间的稳定程度。

回答要求：
1. **说人话**，不要甩术语。非用不可时紧跟一句白话解释。
2. 先给结论，再给依据，用具体数字支撑。
3. 关注**趋势和相对自己基线的变化**，不要拿单日绝对值下判断。
4. 数据缺失就明说"这项没有记录"，绝不编造数值。
5. 建议要具体到能执行（"今晚十一点前上床"而不是"注意休息"）。
6. 简洁，不寒暄，不复述问题。一般 200 字以内。
7. 你不是医生。涉及疾病、用药或明显异常时提示就医，但别每次都加免责声明。`;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  // Each question costs money, so it must come from our own page, at a sane
  // rate, from an account that still has quota.
  if (!sameOrigin(req)) return Response.json({ error: "请求来源不被允许。" }, { status: 403 });

  const limit = rateLimit(clientIp(req));
  if (!limit.ok)
    return Response.json(
      { error: `提问太频繁了，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );

  if (!dbConfigured())
    return Response.json(
      { error: "AI 问答暂时不可用（服务器未连接数据库）。" },
      { status: 503 },
    );

  const userId = await currentUserId();
  if (!userId)
    return Response.json({ error: "请先登录再提问。", needAuth: true }, { status: 401 });

  let body: { messages?: IncomingMessage[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!messages.length) return Response.json({ error: "没有提问内容。" }, { status: 400 });
  const context = (body.context ?? "").slice(0, 20_000);

  const provider = resolveProvider();
  if (!provider) return Response.json({ error: "服务器未配置 AI Key。" }, { status: 503 });

  const quota = await consumeQuota(userId);
  if (!quota)
    return Response.json(
      { error: `今天的 ${DAILY_AI_LIMIT} 次提问已经用完了，明天再来吧。` },
      { status: 429 },
    );

  const payload: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `以下是该用户当前的健康数据摘要：\n\n${context}` },
    ...messages.map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 4000),
    })),
  ];

  return streamCompletion(provider, payload);
}
