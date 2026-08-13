import "server-only";

// Shared plumbing for the AI endpoints: pick a provider from whichever key is
// configured, and re-emit its SSE stream as plain text deltas.

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export interface Provider {
  url: string;
  key: string;
  model: string;
  via: string;
}

export function resolveProvider(): Provider | null {
  const gateway = process.env.AI_GATEWAY_API_KEY;
  if (gateway) {
    return {
      url: GATEWAY_URL,
      key: gateway,
      model: process.env.AI_MODEL || "deepseek/deepseek-v3.1",
      via: "vercel-ai-gateway",
    };
  }
  const deepseek = process.env.DEEPSEEK_API_KEY;
  if (deepseek) {
    return {
      url: DEEPSEEK_URL,
      key: deepseek,
      model: process.env.AI_MODEL || "deepseek-chat",
      via: "deepseek",
    };
  }
  return null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Call the provider and return a plain-text delta stream, or an error Response. */
export async function streamCompletion(
  provider: Provider,
  messages: ChatMessage[],
  temperature = 0.3,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({ model: provider.model, stream: true, temperature, messages }),
    });
  } catch {
    return Response.json(
      { error: `无法连接 AI 服务（${provider.via}）。` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    const hint =
      upstream.status === 401 || upstream.status === 403
        ? "API Key 无效或无权限。"
        : upstream.status === 402
          ? "账户余额/额度不足。"
          : upstream.status === 404
            ? `模型 "${provider.model}" 不存在。请在环境变量里把 AI_MODEL 设为有效的模型 ID。`
            : upstream.status === 429
              ? "请求过于频繁，稍后再试。"
              : `AI 服务返回 ${upstream.status}。`;
    return Response.json(
      { error: hint, model: provider.model, via: provider.via, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

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
