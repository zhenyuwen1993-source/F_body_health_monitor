"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HealthDataset } from "@/lib/health";
import {
  adherence,
  evaluatePlan,
  partStatuses,
  todayIso,
  type BodyIssueRecord,
  type TrainingDayRecord,
} from "@/lib/health/trainingAdvice";

const PARTS = [
  "胸",
  "背",
  "肩",
  "二头",
  "三头",
  "腿",
  "臀",
  "核心",
  "小腿",
  "前臂",
  "有氧",
];

const LEVEL_STYLE: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
  ok: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
  warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  bad: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
};

export default function TrainingPlanner({ data }: { data: HealthDataset }) {
  const [days, setDays] = useState<TrainingDayRecord[]>([]);
  const [issues, setIssues] = useState<BodyIssueRecord[]>([]);
  const [needAuth, setNeedAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const todayRecord = days.find((d) => d.day === today);
  // Memoised so the analysis below doesn't recompute on every render.
  const planned = useMemo(() => todayRecord?.planned ?? [], [todayRecord]);
  const actual = useMemo(() => todayRecord?.actual ?? [], [todayRecord]);

  useEffect(() => {
    fetch("/api/training")
      .then((r) => r.json())
      .then((j) => {
        if (j.needAuth) setNeedAuth(true);
        if (j.days) setDays(j.days);
        if (j.issues) setIssues(j.issues);
        if (j.error) setError(j.error);
      })
      .catch(() => setError("读取训练记录失败。"))
      .finally(() => setLoading(false));
  }, []);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setNeedAuth(true);
        setError(j.error ?? `保存失败 (${res.status})`);
        return null;
      }
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const toggle = async (field: "planned" | "actual", part: string) => {
    const cur = field === "planned" ? planned : actual;
    const next = cur.includes(part) ? cur.filter((p) => p !== part) : [...cur, part];
    // Optimistic, so tapping chips feels instant.
    setDays((ds) => {
      const others = ds.filter((d) => d.day !== today);
      const base = ds.find((d) => d.day === today) ?? { day: today, planned: [], actual: [] };
      return [...others, { ...base, [field]: next }].sort((a, b) => (a.day < b.day ? -1 : 1));
    });
    const j = await post({ action: "day", day: today, [field]: next });
    if (j?.day) {
      setDays((ds) => [...ds.filter((d) => d.day !== today), j.day].sort((a, b) => (a.day < b.day ? -1 : 1)));
    }
  };

  const statuses = useMemo(() => partStatuses(PARTS, days, today), [days, today]);
  const verdict = useMemo(
    () => evaluatePlan(planned, statuses, issues, data),
    [planned, statuses, issues, data],
  );
  const adh = useMemo(() => adherence(days), [days]);

  if (loading)
    return (
      <div className="rounded-xl border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-400 dark:border-zinc-800">
        载入中…
      </div>
    );

  if (needAuth)
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        登录状态好像失效了，刷新一下页面重新登录即可。
      </div>
    );

  return (
    <div className="space-y-5">
      {/* Today's call */}
      <div className={`rounded-xl border p-5 ${LEVEL_STYLE[verdict.level]}`}>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {verdict.headline}
        </h3>
        {verdict.reasons.map((r, i) => (
          <p key={i} className="mt-1.5 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
            {r}
          </p>
        ))}

        {verdict.skip.length > 0 && (
          <div className="mt-3 space-y-1">
            {verdict.skip.map((s, i) => (
              <p key={i} className="text-sm text-zinc-700 dark:text-zinc-200">
                <b>{s.part}</b> — {s.why}
              </p>
            ))}
          </div>
        )}

        {verdict.suggest.length > 0 && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            这几个部位好久没练了，可以考虑加进来：<b>{verdict.suggest.join("、")}</b>
          </p>
        )}
      </div>

      {/* Plan / actual */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Row
          title="今天打算练"
          parts={PARTS}
          selected={planned}
          onToggle={(p) => toggle("planned", p)}
          disabled={saving}
        />
        <div className="mt-5">
          <Row
            title="实际练了"
            parts={PARTS}
            selected={actual}
            onToggle={(p) => toggle("actual", p)}
            disabled={saving}
            accent="emerald"
          />
        </div>
        {planned.length > 0 && (
          <p className="mt-4 text-xs text-zinc-500">
            {planned.every((p) => actual.includes(p))
              ? "计划全部完成 ✓"
              : `还差：${planned.filter((p) => !actual.includes(p)).join("、")}`}
          </p>
        )}
        {adh.rate != null && (
          <p className="mt-1 text-xs text-zinc-400">{adh.text}</p>
        )}
      </div>

      {/* Per-part recovery state */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          各部位恢复情况
        </h4>
        <p className="mt-0.5 text-xs text-zinc-400">
          同一块肌肉一般需要 48 小时以上才能恢复，练太密反而长不了。
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {statuses
            .filter((s) => s.part !== "有氧")
            .map((s) => (
              <div key={s.part} className="flex items-start gap-2.5 rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800/50">
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <div className="min-w-0">
                  <div className="text-sm">
                    <b className="text-zinc-800 dark:text-zinc-100">{s.part}</b>
                    <span className="ml-2 text-zinc-500">{s.label}</span>
                  </div>
                  <p className="text-xs leading-5 text-zinc-400">{s.detail}</p>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Aches */}
      <IssuePanel
        issues={issues}
        onAdd={async (part, sev, note) => {
          const j = await post({ action: "addIssue", bodyPart: part, severity: sev, note });
          if (j?.issues) setIssues(j.issues);
        }}
        onResolve={async (id) => {
          const j = await post({ action: "resolveIssue", id });
          if (j?.issues) setIssues(j.issues);
        }}
        disabled={saving}
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      <p className="text-[11px] text-zinc-400">
        训练计划和伤痛记录保存在服务器上（这样换设备也能看到）。健康数据仍然只在你的浏览器里，不会上传。
      </p>
    </div>
  );
}

function Row({
  title,
  parts,
  selected,
  onToggle,
  disabled,
  accent = "zinc",
}: {
  title: string;
  parts: string[];
  selected: string[];
  onToggle: (p: string) => void;
  disabled?: boolean;
  accent?: "zinc" | "emerald";
}) {
  const on =
    accent === "emerald"
      ? "bg-emerald-600 text-white border-emerald-600"
      : "bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white";
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h4>
      <div className="flex flex-wrap gap-2">
        {parts.map((p) => {
          const active = selected.includes(p);
          return (
            <button
              key={p}
              disabled={disabled}
              onClick={() => onToggle(p)}
              className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                active
                  ? on
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IssuePanel({
  issues,
  onAdd,
  onResolve,
  disabled,
}: {
  issues: BodyIssueRecord[];
  onAdd: (part: string, severity: number, note?: string) => void;
  onResolve: (id: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState(PARTS[0]);
  const [sev, setSev] = useState(1);
  const [note, setNote] = useState("");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          哪里不舒服
        </h4>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
        >
          {open ? "收起" : "记一个"}
        </button>
      </div>

      {issues.length === 0 && !open && (
        <p className="mt-2 text-xs text-zinc-400">
          目前没有记录疼痛。有哪里不对劲就记一下，安排训练时会自动避开。
        </p>
      )}

      {issues.length > 0 && (
        <div className="mt-3 space-y-2">
          {issues.map((i) => (
            <div
              key={i.id}
              className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/30"
            >
              <div className="min-w-0 text-sm">
                <b className="text-zinc-800 dark:text-zinc-100">{i.bodyPart}</b>
                <span className="ml-2 text-zinc-600 dark:text-zinc-300">
                  {i.severity >= 3 ? "疼得厉害" : i.severity === 2 ? "有明显不适" : "有点不舒服"}
                </span>
                {i.note && <p className="text-xs text-zinc-500">{i.note}</p>}
                <p className="text-[11px] text-zinc-400">从 {i.startedOn.slice(5)} 开始</p>
              </div>
              <button
                disabled={disabled}
                onClick={() => onResolve(i.id)}
                className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                已经好了
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            {PARTS.map((p) => (
              <button
                key={p}
                onClick={() => setPart(p)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  part === p
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[
              { v: 1, t: "有点不舒服" },
              { v: 2, t: "有明显不适" },
              { v: 3, t: "疼得厉害" },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setSev(s.v)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  sev === s.v
                    ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {s.t}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充一句（可选），比如「深蹲后左膝外侧」"
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-amber-500 dark:border-zinc-700"
          />
          <button
            disabled={disabled}
            onClick={() => {
              onAdd(part, sev, note || undefined);
              setNote("");
              setOpen(false);
            }}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            记下来
          </button>
          <p className="text-[11px] text-zinc-400">
            持续疼痛、肿胀或影响日常活动，请去看医生——这里只是帮你安排训练，不能替代诊断。
          </p>
        </div>
      )}
    </div>
  );
}
