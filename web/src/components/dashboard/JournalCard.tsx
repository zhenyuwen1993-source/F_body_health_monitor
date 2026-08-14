"use client";

import { useEffect, useMemo, useState } from "react";
import type { HealthDataset } from "@/lib/health";
import { correlate } from "@/lib/health/correlate";

interface JDay {
  day: string;
  tags: string[];
}

function localIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/**
 * One-tap daily journal plus the payoff: once a tag has enough days, the app
 * says what that habit is doing to sleep, HRV, resting HR and readiness.
 */
export default function JournalCard({ data }: { data: HealthDataset }) {
  const [days, setDays] = useState<JDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [which, setWhich] = useState<"today" | "yesterday">("today");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/journal")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.days) setDays(j.days);
        if (j.tags) setTags(j.tags);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const day = which === "today" ? localIso() : localIso(-1);
  const current = days.find((d) => d.day === day)?.tags ?? [];

  const toggle = async (tag: string) => {
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    setDays((ds) => [...ds.filter((d) => d.day !== day), { day, tags: next }]);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, tags: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `保存失败 (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const report = useMemo(() => correlate(data, days), [data, days]);
  const loggedDays = days.filter((d) => d.tags.length > 0).length;

  if (!loaded) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {which === "today" ? "今天有这些吗？" : "补记昨天"}
        </h3>
        <button
          onClick={() => setWhich((w) => (w === "today" ? "yesterday" : "today"))}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
        >
          {which === "today" ? "补记昨天" : "回到今天"}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-zinc-400">
        随手点一下就行。记上几天，下面会告诉你哪些习惯真的在影响你的睡眠和状态。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => {
          const on = current.includes(t);
          return (
            <button
              key={t}
              disabled={saving}
              onClick={() => toggle(t)}
              className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-60 ${
                on
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* The payoff */}
      {report.insights.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            你的规律
          </h4>
          {report.insights.map((ins) => (
            <div key={ins.tag} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                「{ins.tag}」的日子
                <span className="ml-1.5 text-xs font-normal text-zinc-400">
                  记了 {ins.taggedDays} 天
                </span>
              </p>
              <ul className="mt-1.5 space-y-1">
                {ins.effects.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className={e.direction === "worse" ? "text-orange-500" : "text-emerald-500"}>
                      {e.direction === "worse" ? "▼" : "▲"}
                    </span>
                    {e.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[11px] leading-4 text-zinc-400">
            这是你自己数据里的对比（有标签的日子 vs 没有的日子），说明相关，不一定是因果。
          </p>
        </div>
      )}

      {report.insights.length === 0 && loggedDays > 0 && (
        <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
          已记 {loggedDays} 天。
          {report.pending.length > 0
            ? `「${report.pending[0].tag}」再记 ${report.pending[0].need} 天就能看出规律了。`
            : "每个标签记满 5 天，就能看出它对你的影响。"}
        </p>
      )}
    </div>
  );
}
