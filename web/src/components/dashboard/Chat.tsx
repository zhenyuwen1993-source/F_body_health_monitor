"use client";

import { useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "用大白话讲讲我今天的状态",
  "我最近睡得好吗？怎么改善？",
  "我今天适合去运动吗？",
  "我的数据里有什么需要注意的？",
];

export default function Chat({ context }: { context: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}) as Record<string, string>);
        const parts = [
          j.error ?? `请求失败 (${res.status})`,
          j.model ? `模型: ${j.model}` : "",
          j.detail ? `详情: ${j.detail}` : "",
        ].filter(Boolean);
        setError(parts.join("\n"));
        setMsgs(next);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: "assistant", content: acc }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMsgs(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          问问你的身体数据
        </div>
        <div className="mt-0.5 text-xs text-zinc-400">
          有什么看不懂的直接问。只把汇总后的数字发给 AI，原始记录不会离开你的浏览器。
        </div>
      </div>

      {msgs.length > 0 && (
        <div ref={scrollRef} className="max-h-[28rem] space-y-4 overflow-y-auto px-5 py-4">
          {msgs.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {m.content || (busy && i === msgs.length - 1 ? "思考中…" : "")}
              </div>
            </div>
          ))}
        </div>
      )}

      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs whitespace-pre-wrap text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="比如：我为什么总是很累？（回车发送）"
          className="max-h-32 flex-1 resize-none bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}
