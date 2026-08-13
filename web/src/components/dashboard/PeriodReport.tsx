"use client";

import { useMemo, useState } from "react";
import type { HealthDataset } from "@/lib/health";
import {
  byMonth,
  byWeek,
  compare,
  outliers,
  periodAdvice,
  type PeriodStats,
} from "@/lib/health/periods";

export default function PeriodReport({ data }: { data: HealthDataset }) {
  const [unit, setUnit] = useState<"周" | "月">("周");
  const periods = useMemo(
    () => (unit === "周" ? byWeek(data) : byMonth(data)),
    [data, unit],
  );
  const [idx, setIdx] = useState<number | null>(null);
  const active = idx ?? periods.length - 1;
  const cur = periods[active];
  const prev = periods[active - 1];

  if (!cur) return null;

  const cmp = compare(cur, prev, unit);
  const outs = outliers(cur);
  const tips = periodAdvice(cur, unit);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Unit switch */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {(["周", "月"] as const).map((u) => (
            <button
              key={u}
              onClick={() => {
                setUnit(u);
                setIdx(null);
              }}
              className={`rounded-md px-3 py-1 text-sm transition ${
                unit === u
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              按{u}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIdx(Math.max(0, active - 1))}
            disabled={active === 0}
            className="rounded px-2 py-1 text-sm text-zinc-500 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ←
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {cur.label}
          </span>
          <button
            onClick={() => setIdx(Math.min(periods.length - 1, active + 1))}
            disabled={active === periods.length - 1}
            className="rounded px-2 py-1 text-sm text-zinc-500 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            →
          </button>
        </div>
      </div>

      <p className="mb-4 text-xs text-zinc-400">
        这{unit}有 {cur.days.length} 天记录到了数据
      </p>

      {/* Averages */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`${unit}均睡眠`} value={cur.sleep} unit="小时" />
        <Stat label={`${unit}均步数`} value={cur.steps} />
        <Stat label="静息心率" value={cur.rhr} unit="次/分" />
        <Stat label="心率变异性" value={cur.hrv} unit="毫秒" />
        <Stat label={`${unit}均状态分`} value={cur.readiness} unit="/100" />
        <Stat label="锻炼时间" value={cur.exercise} unit="分钟/天" />
        <Stat label="运动次数" value={cur.workoutCount} unit="次" />
        <Stat label="运动总时长" value={cur.workoutMinutes} unit="分钟" />
      </div>

      {/* vs previous period */}
      {cmp.length > 0 && (
        <Block title={`和上一${unit}比`}>
          <div className="flex flex-wrap gap-2">
            {cmp.map((c, i) => (
              <span
                key={i}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  c.direction === "flat"
                    ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    : c.good
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                }`}
              >
                {c.text}
              </span>
            ))}
          </div>
        </Block>
      )}

      {/* Best / worst day */}
      {(cur.best || cur.worst) && cur.best?.date !== cur.worst?.date && (
        <Block title={`这${unit}的高低点`}>
          <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            {cur.best && (
              <p>
                状态最好：<b>{cur.best.date.slice(5)}</b>（{cur.best.score} 分）
              </p>
            )}
            {cur.worst && (
              <p>
                状态最差：<b>{cur.worst.date.slice(5)}</b>（{cur.worst.score} 分）
              </p>
            )}
          </div>
        </Block>
      )}

      {/* Days that stood out */}
      {outs.length > 0 && (
        <Block title="哪几天不太一样">
          <ul className="space-y-1">
            {outs.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {o}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Advice */}
      {tips.length > 0 && (
        <Block title={`下${unit}可以这样做`}>
          <ul className="space-y-1.5">
            {tips.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {t}
              </li>
            ))}
          </ul>
        </Block>
      )}

      <DailyTable p={cur} />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {value == null ? "—" : value.toLocaleString()}
        </span>
        {value != null && unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h4 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h4>
      {children}
    </div>
  );
}

function DailyTable({ p }: { p: PeriodStats }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
      >
        {open ? "收起每日明细" : `看这 ${p.days.length} 天的明细`}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-400 dark:bg-zinc-800/60">
              <tr>
                <th className="px-3 py-2 text-left font-medium">日期</th>
                <th className="px-3 py-2 text-right font-medium">睡眠</th>
                <th className="px-3 py-2 text-right font-medium">静息心率</th>
                <th className="px-3 py-2 text-right font-medium">心率变异性</th>
                <th className="px-3 py-2 text-right font-medium">步数</th>
                <th className="px-3 py-2 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {p.days.map((d) => (
                <tr key={d.date} className="text-zinc-700 dark:text-zinc-200">
                  <td className="px-3 py-1.5">{d.date.slice(5)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(d.sleep_asleep ?? d.sleep_inbed, 1)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.resting_hr, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.hrv, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.steps, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.readiness, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmt(v: number | undefined, dp: number): string {
  return v == null ? "—" : dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
}
