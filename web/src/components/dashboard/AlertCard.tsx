"use client";

import type { BodyAlert } from "@/lib/health/alerts";

const STYLE = {
  warn: "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30",
  watch: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/25",
} as const;

/** Shown only when the early-warning rules fire; absent otherwise. */
export default function AlertCard({ alert }: { alert: BodyAlert }) {
  if (alert.level === "none") return null;
  return (
    <section className={`rounded-2xl border p-5 ${STYLE[alert.level]}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{alert.level === "warn" ? "🤒" : "👀"}</span>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {alert.title}
        </h2>
      </div>
      <div className="mt-2 space-y-1.5">
        {alert.paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
            {p}
          </p>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {alert.signals.map((s) => (
          <span
            key={s.name}
            className="rounded-full bg-white/70 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200"
          >
            <b>{s.name}</b> · {s.text}
          </span>
        ))}
      </div>
    </section>
  );
}
