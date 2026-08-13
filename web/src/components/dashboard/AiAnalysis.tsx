"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Auto-generated read-through of the user's data. Fires once on mount; the
 * rule-based summary above it has already rendered, so a slow or unavailable
 * model never leaves the page empty.
 */
export default function AiAnalysis({ context }: { context: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "done" | "error" | "auth">("loading");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}) as Record<string, string>);
          if (res.status === 401) {
            setState("auth");
            return;
          }
          setError(j.error ?? `分析失败 (${res.status})`);
          setState("error");
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setText(acc);
        }
        setState("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
  }, [context]);

  if (state === "auth") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center text-sm text-zinc-500 dark:border-zinc-700">
        登录后可以看 AI 对你这份数据的深度解读。往下滚到「有问题就问」注册一个账号就行。
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        AI 分析暂时不可用：{error}
        <span className="block text-amber-700/70 dark:text-amber-300/70">
          上面的总结和所有指标不受影响。
        </span>
      </div>
    );
  }

  if (state === "loading" && !text) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-5 text-sm text-zinc-400 dark:border-zinc-800">
        <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-500" />
        AI 正在读你的数据…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <Markdown text={text} />
      {state === "loading" && (
        <span className="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-500 align-middle" />
      )}
    </div>
  );
}

/** Just enough markdown for the headings and bullets the prompt asks for. */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={key} className="mb-3 ml-1 space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{b}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flush(`u${i}`);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      bullets.push(strip(line.slice(2)));
      return;
    }
    flush(`u${i}`);
    if (line.startsWith("## ")) {
      out.push(
        <h4
          key={i}
          className="mt-4 mb-1.5 text-sm font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50"
        >
          {strip(line.slice(3))}
        </h4>,
      );
      return;
    }
    if (line.startsWith("# ")) {
      out.push(
        <h3 key={i} className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {strip(line.slice(2))}
        </h3>,
      );
      return;
    }
    out.push(
      <p key={i} className="mb-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
        {strip(line)}
      </p>,
    );
  });
  flush("last");
  return <>{out}</>;
}

const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`/g, "");
