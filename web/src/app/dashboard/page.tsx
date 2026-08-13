"use client";

import { useCallback, useMemo, useState } from "react";
import Chat from "@/components/dashboard/Chat";
import Gauge from "@/components/dashboard/Gauge";
import Sparkline from "@/components/dashboard/Sparkline";
import StatCard from "@/components/dashboard/StatCard";
import {
  buildContext,
  buildDataset,
  type DailyMetrics,
  type HealthDataset,
  type ParseProgress,
} from "@/lib/health";

type Phase = "idle" | "parsing" | "done" | "error";

export default function DashboardPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [data, setData] = useState<HealthDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setPhase("parsing");
    setError(null);
    setProgress(null);
    try {
      const ds = await buildDataset(file, (p) => setProgress({ ...p }));
      if (ds.daily.length === 0) {
        setError("没有解析到可用数据。请确认这是 Apple Health 导出的 export.xml。");
        setPhase("error");
        return;
      }
      setData(ds);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  if (phase === "done" && data) {
    return <Dashboard data={data} onReset={() => setPhase("idle")} />;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 py-20">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          上传你的 Apple Health 数据
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
          健康 App → 头像 → 导出所有健康数据 → 把得到的 <code>导出.zip</code>{" "}
          直接拖进来（也可以拖解压后的 <code>export.xml</code>）。全部在你浏览器本地解析，
          <b>不会上传到服务器</b>。
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 transition ${
          dragOver
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-zinc-300 hover:border-emerald-400 dark:border-zinc-700"
        }`}
      >
        <div className="h-10 w-10 rounded-full bg-emerald-500/10 p-2.5">
          <svg viewBox="0 0 24 24" fill="none" className="h-full w-full stroke-emerald-500" strokeWidth={2}>
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          点击选择或拖入 导出.zip / export.xml
        </span>
        <span className="text-xs text-zinc-400">支持较大文件（流式解析，不占满内存）</span>
        <input
          type="file"
          accept=".zip,.xml,text/xml,application/xml,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {phase === "parsing" && (
        <div className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300">
            <span>解析中…</span>
            {progress && (
              <span className="tabular-nums text-zinc-400">
                {progress.records.toLocaleString()} 条记录 · {progress.workouts} 次训练
              </span>
            )}
          </div>
          {progress && progress.totalBytes > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, (progress.bytesRead / progress.totalBytes) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {phase === "error" && error && (
        <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Dashboard({ data, onReset }: { data: HealthDataset; onReset: () => void }) {
  const today = data.daily[data.daily.length - 1];
  const recent = useMemo(() => data.daily.slice(-60), [data.daily]);
  const context = useMemo(() => buildContext(data), [data]);

  const series = (pick: (d: DailyMetrics) => number | undefined) =>
    recent.map((d) => ({ label: d.date.slice(5), value: pick(d) ?? null }));

  // The export usually happens mid-day, so the final day is partial. Fall back
  // to the most recent day that actually has the value, and say which day.
  const latest = (pick: (d: DailyMetrics) => number | undefined) => {
    for (let i = data.daily.length - 1; i >= 0; i--) {
      const v = pick(data.daily[i]);
      if (v != null && Number.isFinite(v))
        return { value: v, day: data.daily[i].date, stale: i !== data.daily.length - 1 };
    }
    return { value: undefined, day: "", stale: false };
  };
  const asOf = (r: { day: string; stale: boolean }, extra?: string) =>
    [r.stale ? `${r.day.slice(5)} 数据` : undefined, extra].filter(Boolean).join(" · ") ||
    undefined;

  const sleep = latest((d) => d.sleep_asleep ?? d.sleep_inbed);
  const cons = latest((d) => d.sleep_consistency);
  const hrv = latest((d) => d.hrv);
  const rhr = latest((d) => d.resting_hr);
  const spo2 = latest((d) => d.spo2);
  const weight = latest((d) => d.weight);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.6)]" />
          <div>
            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Striortus Health
            </div>
            <div className="text-xs text-zinc-400">
              {data.dateRange?.start} → {data.dateRange?.end} · {data.daily.length} 天 ·{" "}
              {data.recordCount.toLocaleString()} 条记录
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

      {/* Today */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          今日 · {today.date}
        </h2>
        <div className="grid grid-cols-1 gap-6 rounded-2xl border border-zinc-200 bg-white p-6 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Gauge value={today.readiness} label="就绪度" suffix="/100" />
          <Gauge value={today.recovery} label="恢复" suffix="/100" />
          <Gauge value={today.strain} max={21} label="强度" suffix="/21" color="#0ea5e9" />
        </div>
      </section>

      {/* Sleep + vitals */}
      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="睡眠"
          value={sleep.value}
          unit="h"
          hint={asOf(sleep, sleepBreakdown(data.daily.find((d) => d.date === sleep.day)))}
        />
        <StatCard label="睡眠一致性" value={cons.value} unit="/100" hint={asOf(cons)} />
        <StatCard label="HRV" value={hrv.value} unit="ms" hint={asOf(hrv)} />
        <StatCard label="静息心率" value={rhr.value} unit="bpm" hint={asOf(rhr)} />
        <StatCard label="步数" value={today.steps} />
        <StatCard label="活动能量" value={today.active_energy} unit="kcal" />
        <StatCard label="运动时间" value={today.exercise} unit="min" />
        <StatCard label="血氧" value={spo2.value} unit="%" hint={asOf(spo2)} />
        <StatCard label="体重" value={weight.value} unit="kg" hint={asOf(weight)} />
        <StatCard label="心情" value={today.mood} unit="/5" />
        <StatCard label="Fitness (CTL)" value={today.ctl} />
        <StatCard label="Form (TSB)" value={today.tsb} hint={today.tsb != null && today.tsb >= 0 ? "偏新鲜" : "偏疲劳"} />
      </section>

      {/* AI chat */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          AI 分析
        </h2>
        <Chat context={context} />
      </section>

      {/* Trends */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          趋势 · 最近 {recent.length} 天
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <TrendCard title="就绪度" unit="">
            <Sparkline data={series((d) => d.readiness)} stroke="#10b981" fill="rgba(16,185,129,0.12)" />
          </TrendCard>
          <TrendCard title="强度 (Strain)" unit="">
            <Sparkline data={series((d) => d.strain)} stroke="#0ea5e9" fill="rgba(14,165,233,0.12)" zeroBased />
          </TrendCard>
          <TrendCard title="HRV" unit="ms">
            <Sparkline data={series((d) => d.hrv)} stroke="#8b5cf6" fill="rgba(139,92,246,0.12)" unit="ms" />
          </TrendCard>
          <TrendCard title="静息心率" unit="bpm">
            <Sparkline data={series((d) => d.resting_hr)} stroke="#ef4444" fill="rgba(239,68,68,0.10)" unit="bpm" />
          </TrendCard>
          <TrendCard title="睡眠" unit="h">
            <Sparkline data={series((d) => d.sleep_asleep ?? d.sleep_inbed)} stroke="#6366f1" fill="rgba(99,102,241,0.12)" unit="h" zeroBased />
          </TrendCard>
          <TrendCard title="步数" unit="">
            <Sparkline data={series((d) => d.steps)} stroke="#f59e0b" fill="rgba(245,158,11,0.12)" zeroBased />
          </TrendCard>
        </div>
      </section>

      {/* Workouts */}
      {data.workouts.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
            近期训练 · 共 {data.workoutCount} 次
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-400 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">日期</th>
                  <th className="px-4 py-2 text-left font-medium">类型</th>
                  <th className="px-4 py-2 text-right font-medium">时长</th>
                  <th className="px-4 py-2 text-right font-medium">距离</th>
                  <th className="px-4 py-2 text-right font-medium">能量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {[...data.workouts]
                  .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
                  .slice(0, 12)
                  .map((w, i) => (
                    <tr key={i} className="text-zinc-700 dark:text-zinc-200">
                      <td className="px-4 py-2">{w.startDate.toISOString().slice(0, 10)}</td>
                      <td className="px-4 py-2">{w.activityType}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Math.round(w.durationMin)} min</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {w.totalDistanceKm ? `${w.totalDistanceKm.toFixed(2)} km` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {w.totalEnergyKcal ? `${Math.round(w.totalEnergyKcal)} kcal` : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="pb-8 text-center text-xs text-zinc-400">
        数据仅存在于你的浏览器 · 刷新页面即清除
      </footer>
    </div>
  );
}

function TrendCard({ title, children }: { title: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</div>
      {children}
    </div>
  );
}

function sleepBreakdown(d: DailyMetrics | undefined): string | undefined {
  if (!d) return undefined;
  const parts: string[] = [];
  if (d.sleep_deep) parts.push(`深 ${d.sleep_deep.toFixed(1)}h`);
  if (d.sleep_rem) parts.push(`REM ${d.sleep_rem.toFixed(1)}h`);
  if (d.sleep_core) parts.push(`核心 ${d.sleep_core.toFixed(1)}h`);
  return parts.length ? parts.join(" · ") : undefined;
}
