"use client";

import { useMemo, useState } from "react";
import AiAnalysis from "@/components/dashboard/AiAnalysis";
import Chat from "@/components/dashboard/Chat";
import FitnessSection from "@/components/dashboard/FitnessSection";
import Gauge from "@/components/dashboard/Gauge";
import MetricCard from "@/components/dashboard/MetricCard";
import PeriodReport from "@/components/dashboard/PeriodReport";
import Shell, { type TabDef } from "@/components/dashboard/Shell";
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

const TABS: TabDef[] = [
  {
    id: "today",
    label: "今日",
    icon: <Icon d="M12 3v1.5m0 15V21M4.5 12H3m18 0h-1.5M5.6 5.6l1.1 1.1m10.6 10.6l1.1 1.1m0-12.8l-1.1 1.1M6.7 17.3l-1.1 1.1M16 12a4 4 0 11-8 0 4 4 0 018 0z" />,
  },
  {
    id: "period",
    label: "周 / 月",
    icon: <Icon d="M8 2v4m8-4v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />,
  },
  { id: "fitness", label: "健身", icon: <Icon d="M6.5 6v12M17.5 6v12M3 9.5v5m18-5v5M6.5 12h11" /> },
  { id: "trends", label: "趋势", icon: <Icon d="M3 17l6-6 4 4 7-7M21 8v5h-5" /> },
  { id: "ask", label: "问 AI", icon: <Icon d="M8 10h8M8 14h5M21 12a9 9 0 11-3.5-7.1L21 3v9z" /> },
];

export default function DashboardView({
  data,
  onReset,
}: {
  data: HealthDataset;
  onReset: () => void;
}) {
  const [tab, setTab] = useState("today");
  const context = useMemo(() => buildContext(data), [data]);
  const meta = `${data.dateRange?.start} 至 ${data.dateRange?.end} · ${data.daily.length} 天`;

  return (
    <Shell tabs={TABS} active={tab} onSelect={setTab} meta={meta} onReset={onReset}>
      {tab === "today" && <TodayTab data={data} context={context} />}
      {tab === "period" && (
        <Section title="周 / 月报告" sub="每周和每月的变化，以及和上一期的对比。">
          <PeriodReport data={data} />
        </Section>
      )}
      {tab === "fitness" && <FitnessSection data={data} />}
      {tab === "trends" && <TrendsTab data={data} />}
      {tab === "ask" && (
        <Section title="问 AI" sub="有什么看不懂的直接问，它知道你这份数据。">
          <Chat context={context} />
        </Section>
      )}
      <footer className="mt-10 space-y-1 pb-6 text-center text-xs text-zinc-400">
        <p>{DISCLAIMER_SHORT}</p>
        <p>健康数据只在你的浏览器里处理，刷新页面即清除。</p>
      </footer>
    </Shell>
  );
}

// --- Tabs --------------------------------------------------------------------

function TodayTab({ data, context }: { data: HealthDataset; context: string }) {
  const today = data.daily[data.daily.length - 1];
  const base = data.baselines;
  const summary = useMemo(() => dailySummary(data), [data]);

  // Exports usually happen mid-day, so the final day is partial: fall back to
  // the most recent day that has each value, and label which day that was.
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
  const sleepDay = data.daily.find((d) => d.date === sleep.day);

  return (
    <div className="space-y-8">
      <SummaryHero
        greeting={summary.greeting}
        paragraphs={summary.paragraphs}
        level={summary.level}
        date={today.date}
      />

      <Section title="AI 深度解读" sub="把几个指标串起来看，给出今天该怎么做。">
        <AiAnalysis context={context} />
      </Section>

      <Section title="三个关键指标">
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
      </Section>

      <Section title="身体状况">
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
          <MetricCard metricKey="tsb" value={today.tsb} verdict={tsbVerdict(today.tsb)} />
        </div>
      </Section>

      {sleepDay && (sleepDay.sleep_deep || sleepDay.sleep_rem || sleepDay.sleep_core) && (
        <Section title="那晚睡得怎么样">
          <SleepBar day={sleepDay} />
        </Section>
      )}
    </div>
  );
}

function TrendsTab({ data }: { data: HealthDataset }) {
  const recent = useMemo(() => data.daily.slice(-60), [data.daily]);
  const today = data.daily[data.daily.length - 1];
  const series = (pick: (d: DailyMetrics) => number | undefined) =>
    recent.map((d) => ({ label: d.date.slice(5), value: pick(d) ?? null }));

  return (
    <div className="space-y-8">
      <Section title={`最近 ${recent.length} 天趋势`} sub="看变化方向比看单日数字更有意义。">
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
            <Sparkline
              data={series((d) => d.sleep_asleep ?? d.sleep_inbed)}
              stroke="#6366f1"
              fill="rgba(99,102,241,0.12)"
              unit=" 小时"
              zeroBased
            />
          </Trend>
          <Trend title="步数">
            <Sparkline data={series((d) => d.steps)} stroke="#f59e0b" fill="rgba(245,158,11,0.12)" zeroBased />
          </Trend>
        </div>
      </Section>

      <Section title="其他指标">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard metricKey="active_energy_kcal" value={today.active_energy} unit="千卡" />
          <MetricCard metricKey="exercise_minutes" value={today.exercise} unit="分钟" />
          <MetricCard metricKey="spo2_avg" value={lastOf(data, (d) => d.spo2)} unit="%" />
          <MetricCard metricKey="weight_kg" value={lastOf(data, (d) => d.weight)} unit="kg" />
          <MetricCard metricKey="mood_score" value={today.mood} unit="/5" />
          <MetricCard metricKey="ctl" value={today.ctl} />
        </div>
      </Section>
    </div>
  );
}

// --- Shared bits -------------------------------------------------------------

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
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

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-current" strokeWidth={1.8}>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function lastOf(
  data: HealthDataset,
  pick: (d: DailyMetrics) => number | undefined,
): number | undefined {
  for (let i = data.daily.length - 1; i >= 0; i--) {
    const v = pick(data.daily[i]);
    if (v != null && Number.isFinite(v)) return v;
  }
  return undefined;
}
