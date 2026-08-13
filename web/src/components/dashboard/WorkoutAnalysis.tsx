"use client";

import { useMemo, useState } from "react";
import type { HealthDataset } from "@/lib/health";
import { ZONES, analyzeWorkouts, type ZoneInfo } from "@/lib/health/workouts";

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
  Badminton: "羽毛球",
  Basketball: "篮球",
  Soccer: "足球",
  Elliptical: "椭圆机",
  Rowing: "划船机",
  StairClimbing: "爬楼",
  CoreTraining: "核心训练",
  Cooldown: "放松",
  Flexibility: "拉伸",
  MindAndBody: "身心练习",
  Pilates: "普拉提",
  Dance: "跳舞",
  Other: "其他",
};
const cn = (a: string) => ACTIVITY_CN[a] ?? a;

export default function WorkoutAnalysis({ data }: { data: HealthDataset }) {
  const age = data.birthYear ? new Date().getFullYear() - data.birthYear : undefined;
  const { analyzed, summary } = useMemo(
    () => analyzeWorkouts(data.workouts, { age }),
    [data.workouts, age],
  );
  const [showAll, setShowAll] = useState(false);

  if (data.workouts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        这份数据里没有运动记录。用 Apple Watch 的「体能训练」App 记录运动后，这里会显示每场训练的强度分析。
      </div>
    );
  }

  // Distribution across zones, over the summary window.
  const recent = analyzed.filter(
    (w) => w.startDate.getTime() >= latestTime(analyzed) - summary.windowDays * 86_400_000,
  );
  const zoneMinutes = new Map<string, number>();
  for (const w of recent) {
    if (!w.zoneInfo) continue;
    zoneMinutes.set(w.zoneInfo.zone, (zoneMinutes.get(w.zoneInfo.zone) ?? 0) + w.durationMin);
  }
  const totalZoned = [...zoneMinutes.values()].reduce((a, b) => a + b, 0);
  const list = showAll ? analyzed : analyzed.slice().reverse().slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          最近 {summary.windowDays} 天
        </h4>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="运动次数" value={summary.count} unit="次" />
          <Mini label="总时长" value={summary.totalMinutes} unit="分钟" />
          <Mini label="轻松 / 高强度" value={`${summary.easyCount} / ${summary.hardCount}`} />
          <Mini label="平均心率" value={summary.hrAvgMean} unit="次/分" />
        </div>

        {summary.byType.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            主要项目：
            {summary.byType
              .slice(0, 4)
              .map((t) => `${cn(t.type)} ${t.count} 次`)
              .join("、")}
          </p>
        )}

        {summary.advice.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {summary.advice.map((a, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Zone distribution */}
      {totalZoned > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            强度分布
          </h4>
          <p className="mt-0.5 text-xs text-zinc-400">
            按心率把训练分成 5 档。理想情况下大部分时间应该在「有氧」这一档。
          </p>
          <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full">
            {(Object.keys(ZONES) as ZoneInfo["zone"][]).map((z) => {
              const m = zoneMinutes.get(z) ?? 0;
              if (m === 0) return null;
              return (
                <div
                  key={z}
                  style={{ width: `${(m / totalZoned) * 100}%`, backgroundColor: ZONES[z].color }}
                  title={`${ZONES[z].name} ${Math.round(m)} 分钟`}
                />
              );
            })}
          </div>
          <div className="mt-3 space-y-2">
            {(Object.keys(ZONES) as ZoneInfo["zone"][]).map((z) => {
              const m = zoneMinutes.get(z) ?? 0;
              if (m === 0) return null;
              const info = ZONES[z];
              return (
                <div key={z} className="flex gap-2 text-sm">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: info.color }}
                  />
                  <div>
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">
                      {info.name}
                    </span>
                    <span className="ml-2 tabular-nums text-zinc-500">
                      {Math.round(m)} 分钟
                    </span>
                    <p className="text-xs leading-5 text-zinc-400">{info.what}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">
            强度按最大心率约 {summary.hrMaxUsed} 次/分估算
            {data.birthYear ? "（结合你的年龄和历史最高心率）" : "（根据历史最高心率推算）"}。
          </p>
        </div>
      )}

      {/* Per-workout list */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-400 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium">日期</th>
              <th className="px-3 py-2 text-left font-medium">项目</th>
              <th className="px-3 py-2 text-right font-medium">时长</th>
              <th className="px-3 py-2 text-right font-medium">平均心率</th>
              <th className="px-3 py-2 text-left font-medium">强度</th>
              <th className="px-3 py-2 text-right font-medium">消耗</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((w, i) => (
              <tr key={i} className="text-zinc-700 dark:text-zinc-200">
                <td className="px-3 py-2">{isoDay(w.startDate).slice(5)}</td>
                <td className="px-3 py-2">{cn(w.activityType)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Math.round(w.durationMin)} 分
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {w.hrAvg ? Math.round(w.hrAvg) : "—"}
                </td>
                <td className="px-3 py-2">
                  {w.zoneInfo ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs text-white"
                      style={{ backgroundColor: w.zoneInfo.color }}
                    >
                      {w.zoneInfo.name}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">无心率</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {w.totalEnergyKcal ? `${Math.round(w.totalEnergyKcal)} 千卡` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analyzed.length > 8 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-sm text-zinc-500 underline underline-offset-2 hover:text-emerald-600"
        >
          {showAll ? "只看最近 8 场" : `看全部 ${analyzed.length} 场`}
        </button>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | string | undefined;
  unit?: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {value ?? "—"}
        </span>
        {value != null && unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

function latestTime(ws: { startDate: Date }[]): number {
  return ws.reduce((m, w) => Math.max(m, w.startDate.getTime()), 0);
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
