"use client";

import { useMemo, useState } from "react";
import Chat from "@/components/dashboard/Chat";
import Gauge from "@/components/dashboard/Gauge";
import MetricCard from "@/components/dashboard/MetricCard";
import Sparkline from "@/components/dashboard/Sparkline";
import SummaryHero from "@/components/dashboard/SummaryHero";
import { buildContext, type DailyMetrics, type HealthDataset } from "@/lib/health";
import { DISCLAIMER_SHORT, metricInfo } from "@/lib/health/glossary";
import {
  LEVEL_COLOR,
  type Verdict,
  consistencyVerdict,
  dailySummary,
  hrvVerdict,
  readinessVerdict,
  recoveryVerdict,
  rhrVerdict,
  sleepVerdict,
  stepsVerdict,
  strainVerdict,
  tsbVerdict,
} from "@/lib/health/interpret";

export default function DashboardView({
  data,
  onReset,
}: {
  data: HealthDataset;
  onReset: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const today = data.daily[data.daily.length - 1];
  const base = data.baselines;
  const recent = useMemo(() => data.daily.slice(-60), [data.daily]);
  const context = useMemo(() => buildContext(data), [data]);
  const summary = useMemo(() => dailySummary(data), [data]);

  const series = (pick: (d: DailyMetrics) => number | undefined) =>
    recent.map((d) => ({ label: d.date.slice(5), value: pick(d) ?? null }));

  // Exports usually happen mid-day, so the last day is partial; fall back to
  // the most recent day that has each value and say which day it came from.
  const latest = (pick: (d: DailyMetrics) => number | undefined) => {
    for (let i = data.daily.length - 1; i >= 0; i--) {
      const v = pick(data.daily[i]);
      if (v != null && Number.isFinite(v))
        return { value: v, day: data.daily[i].date, stale: i !== data.daily.length - 1 };
    }
    return { value: undefined, day: "", stale: false };
  };
  const asOf = (r: { day: string; stale: boolean }) =>
    r.stale ? `${r.day.slice(5)} 的数据` : undefined;

  const sleep = latest((d) => d.sleep_asleep ?? d.sleep_inbed);
  const cons = latest((d) => d.sleep_consistency);
  const hrv = latest((d) => d.hrv);
  const rhr = latest((d) => d.resting_hr);
  const spo2 = latest((d) => d.spo2);
  const weight = latest((d) => d.weight);
  const sleepDay = data.daily.find((d) => d.date === sleep.day);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <div>
            <div className="font-semibold text-zinc-900 dark:text-zinc-50">
              Striortus Health
            </div>
            <div className="text-xs text-zinc-400">
              {data.dateRange?.start} 至 {data.dateRange?.end} · 共 {data.daily.length} 天
            </div>
          </div>
        </div>
        <button
          onClick={onReset}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          换个文件
        </button>
      </header>

      <SummaryHero
        greeting={summary.greeting}
        paragraphs={summary.paragraphs}
        level={summary.level}
        date={today.date}
      />

      {/* The three headline numbers, each with a plain-language label. */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          三个关键指标
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <GaugeCard
            metricKey="training_readiness"
            value={today.readiness}
            max={100}
            verdict={readinessVerdict(today.readiness)}
          />
          <GaugeCard
            metricKey="recovery_pct"
            value={today.recovery}
            max={100}
            verdict={recoveryVerdict(today.recovery)}
          />
          <GaugeCard
            metricKey="strain"
            value={today.strain}
            max={21}
            color="#0ea5e9"
            verdict={strainVerdict(today.strain)}
          />
        </div>
      </section>

      {/* Everyday metrics people actually recognise. */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          身体状况
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard
            metricKey="sleep_hours"
            value={sleep.value}
            unit="小时"
            verdict={sleepVerdict(sleep.value)}
            asOf={asOf(sleep)}
          />
          <MetricCard
            metricKey="sleep_consistency"
            value={cons.value}
            unit="/100"
            verdict={consistencyVerdict(cons.value)}
            asOf={asOf(cons)}
          />
          <MetricCard
            metricKey="hrv_sdnn_ms"
            value={hrv.value}
            unit="毫秒"
            verdict={hrvVerdict(hrv.value, base.hrv)}
            asOf={asOf(hrv)}
          />
          <MetricCard
            metricKey="resting_hr"
            value={rhr.value}
            unit="次/分"
            verdict={rhrVerdict(rhr.value, base.rhr)}
            asOf={asOf(rhr)}
          />
          <MetricCard
            metricKey="steps"
            value={today.steps}
            unit="步"
            verdict={stepsVerdict(today.steps, base.steps)}
          />
          <MetricCard
            metricKey="tsb"
            value={today.tsb}
            verdict={tsbVerdict(today.tsb)}
          />
        </div>
      </section>

      {/* Sleep stage breakdown, only when the watch recorded it. */}
      {sleepDay && (sleepDay.sleep_deep || sleepDay.sleep_rem || sleepDay.sleep_core) && (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            那晚睡得怎么样
          </h2>
          <SleepBar day={sleepDay} />
        </section>
      )}

      {/* AI */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          有问题就问
        </h2>
        <Chat context={context} />
      </section>

      {/* Everything numeric hides behind one click. */}
      <section className="mt-8">
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <span>{showDetail ? "收起详细数据" : "查看详细数据和趋势图"}</span>
          <span className="text-zinc-400">{showDetail ? "▲" : "▼"}</span>
        </button>

        {showDetail && (
          <div className="mt-5 space-y-8">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                其他指标
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetricCard metricKey="active_energy_kcal" value={today.active_energy} unit="千卡" />
                <MetricCard metricKey="exercise_minutes" value={today.exercise} unit="分钟" />
                <MetricCard metricKey="spo2_avg" value={spo2.value} unit="%" asOf={asOf(spo2)} />
                <MetricCard metricKey="weight_kg" value={weight.value} unit="kg" asOf={asOf(weight)} />
                <MetricCard metricKey="mood_score" value={today.mood} unit="/5" />
                <MetricCard metricKey="ctl" value={today.ctl} />
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                最近 {recent.length} 天趋势
              </h3>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Trend title="今日状态">
                  <Sparkline data={series((d) => d.readiness)} stroke="#10b981" fill="rgba(16,185,129,0.12)" />
                </Trend>
                <Trend title="今日消耗">
                  <Sparkline data={series((d) => d.strain)} stroke="#0ea5e9" fill="rgba(14,165,233,0.12)" zeroBased />
                </Trend>
                <Trend title="心率变异性">
                  <Sparkline data={series((d) => d.hrv)} stroke="#8b5cf6" fill="rgba(139,92,246,0.12)" unit=" 毫秒" />
                </Trend>
                <Trend title="静息心率">
                  <Sparkline data={series((d) => d.resting_hr)} stroke="#ef4444" fill="rgba(239,68,68,0.10)" unit=" 次/分" />
                </Trend>
                <Trend title="睡眠时长">
                  <Sparkline data={series((d) => d.sleep_asleep ?? d.sleep_inbed)} stroke="#6366f1" fill="rgba(99,102,241,0.12)" unit=" 小时" zeroBased />
                </Trend>
                <Trend title="步数">
                  <Sparkline data={series((d) => d.steps)} stroke="#f59e0b" fill="rgba(245,158,11,0.12)" zeroBased />
                </Trend>
              </div>
            </div>

            {data.workouts.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  近期训练 · 共 {data.workoutCount} 次
                </h3>
                <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-zinc-50 text-xs text-zinc-400 dark:bg-zinc-900">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">日期</th>
                        <th className="px-4 py-2 text-left font-medium">类型</th>
                        <th className="px-4 py-2 text-right font-medium">时长</th>
                        <th className="px-4 py-2 text-right font-medium">距离</th>
                        <th className="px-4 py-2 text-right font-medium">消耗</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {[...data.workouts]
                        .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
                        .slice(0, 12)
                        .map((w, i) => (
                          <tr key={i} className="text-zinc-700 dark:text-zinc-200">
                            <td className="px-4 py-2">{w.startDate.toISOString().slice(0, 10)}</td>
                            <td className="px-4 py-2">{translateActivity(w.activityType)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{Math.round(w.durationMin)} 分钟</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {w.totalDistanceKm ? `${w.totalDistanceKm.toFixed(2)} km` : "—"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {w.totalEnergyKcal ? `${Math.round(w.totalEnergyKcal)} 千卡` : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="mt-10 space-y-1 pb-10 text-center text-xs text-zinc-400">
        <p>{DISCLAIMER_SHORT}</p>
        <p>数据只存在于你的浏览器，刷新页面就清除。</p>
      </footer>
    </div>
  );
}

function GaugeCard({
  metricKey,
  value,
  max,
  color,
  verdict,
}: {
  metricKey: string;
  value: number | undefined;
  max: number;
  color?: string;
  verdict: Verdict;
}) {
  const [open, setOpen] = useState(false);
  const info = metricInfo(metricKey);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {info?.name ?? metricKey}
        </span>
        {info && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={`${info.name}是什么`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] leading-none text-zinc-400 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-zinc-700"
          >
            ?
          </button>
        )}
      </div>

      <div className="mt-1 flex justify-center">
        <Gauge value={value} max={max} label="" suffix={`满分 ${max}`} color={color} size={112} />
      </div>

      <div className="mt-1 text-center">
        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: LEVEL_COLOR[verdict.level] }}
        >
          {verdict.label}
        </span>
        {verdict.detail && (
          <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {verdict.detail}
          </p>
        )}
      </div>

      {open && info && (
        <div className="mt-3 space-y-2 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          <p>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">这是什么：</span>
            {info.what}
          </p>
          <p>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">为什么重要：</span>
            {info.why}
          </p>
          <p>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">参考范围：</span>
            {info.healthy}
          </p>
        </div>
      )}
    </div>
  );
}

function Trend({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</div>
      {children}
    </div>
  );
}

function SleepBar({ day }: { day: DailyMetrics }) {
  const deep = day.sleep_deep ?? 0;
  const rem = day.sleep_rem ?? 0;
  const core = day.sleep_core ?? 0;
  const total = deep + rem + core;
  if (total <= 0) return null;
  const seg = [
    { label: "深睡", h: deep, color: "#4338ca", desc: "身体修复的阶段" },
    { label: "快速眼动", h: rem, color: "#8b5cf6", desc: "整理记忆和情绪" },
    { label: "核心睡眠", h: core, color: "#c4b5fd", desc: "占比最大的基础睡眠" },
  ].filter((s) => s.h > 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {seg.map((s) => (
          <div key={s.label} style={{ width: `${(s.h / total) * 100}%`, backgroundColor: s.color }} />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {seg.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-zinc-700 dark:text-zinc-200">{s.label}</span>
            <span className="tabular-nums text-zinc-500">{s.h.toFixed(1)} 小时</span>
            <span className="text-xs text-zinc-400">· {s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTIVITY_CN: Record<string, string> = {
  Running: "跑步",
  Walking: "步行",
  Cycling: "骑行",
  Swimming: "游泳",
  Hiking: "徒步",
  Yoga: "瑜伽",
  TraditionalStrengthTraining: "力量训练",
  FunctionalStrengthTraining: "功能性力量",
  HighIntensityIntervalTraining: "高强度间歇",
  Tennis: "网球",
  Basketball: "篮球",
  Soccer: "足球",
  Elliptical: "椭圆机",
  Rowing: "划船机",
  CoreTraining: "核心训练",
  Cooldown: "放松",
  MindAndBody: "身心练习",
  Other: "其他",
};

function translateActivity(a: string): string {
  return ACTIVITY_CN[a] ?? a;
}
