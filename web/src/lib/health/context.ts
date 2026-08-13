// Build a compact text summary of the user's metrics to send to the LLM.
// Only this digest leaves the browser — never the raw health records.

import type { HealthDataset, DailyMetrics } from "./types";

const f = (v: number | undefined | null, d = 1, suffix = ""): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}${suffix}`;

function avg(rows: DailyMetrics[], key: keyof DailyMetrics): number | undefined {
  const vals = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
}

/** Most recent day that actually has data for a given field. */
function latestWith(
  rows: DailyMetrics[],
  key: keyof DailyMetrics,
): { day: string; value: number } | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (typeof v === "number" && Number.isFinite(v))
      return { day: rows[i].date, value: v };
  }
  return undefined;
}

export function buildContext(data: HealthDataset, days = 14): string {
  const all = data.daily;
  if (!all.length) return "暂无日指标数据。";
  const rows = all.slice(-days);
  const latest = all[all.length - 1];
  const month = latest.date.slice(0, 7);
  const mrows = all.filter((r) => r.date.startsWith(month));

  const sleepLatest = latestWith(all, "sleep_asleep");
  const weightLatest = latestWith(all, "weight");
  const spo2Latest = latestWith(all, "spo2");

  const recentWorkouts = [...data.workouts]
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .slice(0, 8)
    .map(
      (w) =>
        `${w.startDate.toISOString().slice(0, 10)} ${w.activityType} ${Math.round(
          w.durationMin,
        )}min${w.totalDistanceKm ? ` ${w.totalDistanceKm.toFixed(1)}km` : ""}${
          w.totalEnergyKcal ? ` ${Math.round(w.totalEnergyKcal)}kcal` : ""
        }`,
    );

  const lines = [
    `数据范围: ${data.dateRange?.start} → ${data.dateRange?.end}（${all.length} 天，${data.recordCount.toLocaleString()} 条记录，${data.workoutCount} 次训练）`,
    `最新日期: ${latest.date}`,
    `今日 就绪度 ${f(latest.readiness, 0)} / 恢复 ${f(latest.recovery, 0)} / 强度 ${f(latest.strain, 1)}(满分21)`,
    `步数 ${f(latest.steps, 0)} · 活动能量 ${f(latest.active_energy, 0)}kcal · 锻炼 ${f(latest.exercise, 0)}min · 训练负荷 ${f(latest.training_load, 0)}`,
    `CTL(体能) ${f(latest.ctl, 1)} · ATL(疲劳) ${f(latest.atl, 1)} · TSB(状态) ${f(latest.tsb, 1)}`,
    `静息心率 ${f(latest.resting_hr, 0)}bpm · HRV ${f(latest.hrv, 1)}ms`,
    sleepLatest
      ? `最近睡眠(${sleepLatest.day}) ${f(sleepLatest.value, 1)}h · 一致性 ${f(latest.sleep_consistency, 0)}`
      : `睡眠: 无记录`,
    `心情 ${f(latest.mood, 1)}/5`,
    spo2Latest ? `血氧(${spo2Latest.day}) ${f(spo2Latest.value, 1)}%` : "",
    weightLatest ? `体重(${weightLatest.day}) ${f(weightLatest.value, 1)}kg` : "",
    ``,
    `近${rows.length}日均值: 步数 ${f(avg(rows, "steps"), 0)} · 睡眠 ${f(avg(rows, "sleep_asleep"), 1)}h · HRV ${f(avg(rows, "hrv"), 1)}ms · 静息心率 ${f(avg(rows, "resting_hr"), 0)} · 就绪度 ${f(avg(rows, "readiness"), 0)} · 强度 ${f(avg(rows, "strain"), 1)} · TSB ${f(avg(rows, "tsb"), 1)}`,
    `本月(${month}) ${mrows.length} 天 · 日均步数 ${f(avg(mrows, "steps"), 0)} · 日均睡眠 ${f(avg(mrows, "sleep_asleep"), 1)}h`,
    ``,
    recentWorkouts.length ? `近期训练:\n${recentWorkouts.join("\n")}` : "近期无训练记录",
    ``,
    `逐日明细(最近${rows.length}天，缺失为—):`,
    `日期 | 就绪 | 恢复 | 强度 | 睡眠h | HRV | 静息HR | 步数 | TSB`,
    ...rows.map(
      (r) =>
        `${r.date} | ${f(r.readiness, 0)} | ${f(r.recovery, 0)} | ${f(r.strain, 1)} | ${f(
          r.sleep_asleep,
          1,
        )} | ${f(r.hrv, 0)} | ${f(r.resting_hr, 0)} | ${f(r.steps, 0)} | ${f(r.tsb, 1)}`,
    ),
  ];
  return lines.filter((l) => l !== "").join("\n");
}
