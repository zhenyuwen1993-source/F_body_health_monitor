// Streaming chat endpoint backed by the DeepSeek API (OpenAI-compatible).
//
// The browser sends the user's question plus a compact metrics digest; the key
// never reaches the client.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

const SYSTEM_PROMPT = `你是一位专业、务实的健康与训练分析助手，服务于 Striortus Health。

你会收到用户由 Apple Watch / iPhone 导出的健康指标摘要。请基于这些真实数据回答问题。

指标含义：
- 就绪度 (0-100)：综合睡眠、HRV、训练负荷、恢复时间、静息心率的加权分，越高越适合高强度训练。
- 恢复 (0-100)：偏生理侧的恢复程度（HRV、静息心率、睡眠、TSB）。
- 强度 Strain (0-21)：当日身体承受的总负荷，WHOOP 风格。
- CTL：长期体能（42天指数平均）；ATL：近期疲劳（7天）；TSB = CTL - ATL，正值偏新鲜、负值偏疲劳。
- HRV (SDNN, ms)：自主神经恢复指标，相对自己的基线看趋势比绝对值重要。
- 睡眠一致性 (0-100)：入睡/起床时间的稳定程度。

回答要求：
1. 先给结论，再给依据。用具体数字支撑，不要空泛。
2. 关注**趋势和相对基线的变化**，而不是单日绝对值。
3. 数据缺失时明确说"这项没有数据"，不要编造或猜测数值。
4. 建议要具体可执行（例如"今天控制在 Z2 以下 40 分钟"），不要说"注意休息"这类废话。
5. 用中文回答，简洁直接，善用要点列表。不要寒暄。
6. 你不是医生。涉及疾病诊断、用药、明显异常指标时，提示用户就医，但不要每次都加免责声明。`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "服务器未配置 DEEPSEEK_API_KEY。请在 Vercel 项目的 Environment Variables 里添加后重新部署。",
      },
      { status: 503 },
    );
  }

  let body: { messages?: ChatMessage[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误。" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (!messages.length) {
    return Response.json({ error: "没有提问内容。" }, { status: 400 });
  }
  const context = (body.context ?? "").slice(0, 20_000);

  const payload = {
    model: MODEL,
    stream: true,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `以下是该用户当前的健康数据摘要：\n\n${context}`,
      },
      ...messages.map((m) => ({
        role: m.role,
        content: String(m.content ?? "").slice(0, 4000),
      })),
    ],
  };

  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return Response.json({ error: "无法连接 DeepSeek 服务。" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    const hint =
      upstream.status === 401
        ? "API Key 无效。"
        : upstream.status === 402
          ? "DeepSeek 账户余额不足。"
          : upstream.status === 429
            ? "请求过于频繁，稍后再试。"
            : `DeepSeek 返回 ${upstream.status}。`;
    return Response.json(
      { error: hint, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  // Re-emit the SSE stream as plain text deltas so the client can just append.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // Ignore keep-alives and partial frames.
            }
          }
        }
      } catch {
        controller.enqueue(encoder.encode("\n\n[连接中断]"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
