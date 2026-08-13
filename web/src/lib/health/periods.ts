// Weekly and monthly roll-ups with period-over-period comparison.
// Ported from src/reports/generate.py (build_weekly_markdown / build_monthly_markdown).

import type { DailyMetrics, HealthDataset } from "./types";

export interface PeriodStats {
  key: string; // "2026-W32" / "2026-08"
  label: string; // "7月30日 - 8月5日" / "2026年8月"
  start: string;
  end: string;
  days: DailyMetrics[]; // days that actually have data
  readiness?: number;
  recovery?: number;
  sleep?: number;
  deep?: number;
  rem?: number;
  rhr?: number;
  hrv?: number;
  steps?: number;
  activeEnergy?: number;
  exercise?: number;
  mood?: number;
  spo2?: number;
  workoutCount: number;
  workoutMinutes: number;
  best?: { date: string; score: number };
  worst?: { date: string; score: number };
}

export interface PeriodComparison {
  /** e.g. "睡眠比上周多了 0.6 小时" */
  text: string;
  direction: "up" | "down" | "flat";
  good: boolean;
}

function mean(xs: (number | undefined)[]): number | undefined {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}
const r1 = (v: number | undefined) => (v == null ? undefined : Math.round(v * 10) / 10);
const r0 = (v: number | undefined) => (v == null ? undefined : Math.round(v));

/** ISO week key, e.g. 2026-W32. Weeks start Monday. */
function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // Mon = 0
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / 86_400_000 / 7 -
        ((firstThursday.getDay() + 6) % 7 > 3 ? 1 : 0),
    );
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function summarize(key: string, label: string, days: DailyMetrics[], data: HealthDataset): PeriodStats {
  const start = days[0].date;
  const end = days[days.length - 1].date;
  const inRange = (t: Date) => {
    const d = t.toISOString().slice(0, 10);
    return d >= start && d <= end;
  };
  const w = data.workouts.filter((x) => inRange(x.startDate));

  const scored = days
    .map((d) => ({ date: d.date, score: d.readiness }))
    .filter((x): x is { date: string; score: number } => x.score != null);
  scored.sort((a, b) => b.score - a.score);

  return {
    key,
    label,
    start,
    end,
    days,
    readiness: r0(mean(days.map((d) => d.readiness))),
    recovery: r0(mean(days.map((d) => d.recovery))),
    sleep: r1(mean(days.map((d) => d.sleep_asleep ?? d.sleep_inbed))),
    deep: r1(mean(days.map((d) => d.sleep_deep))),
    rem: r1(mean(days.map((d) => d.sleep_rem))),
    rhr: r0(mean(days.map((d) => d.resting_hr))),
    hrv: r0(mean(days.map((d) => d.hrv))),
    steps: r0(mean(days.map((d) => d.steps))),
    activeEnergy: r0(mean(days.map((d) => d.active_energy))),
    exercise: r0(mean(days.map((d) => d.exercise))),
    mood: r1(mean(days.map((d) => d.mood))),
    spo2: r1(mean(days.map((d) => d.spo2))),
    workoutCount: w.length,
    workoutMinutes: Math.round(w.reduce((a, x) => a + x.durationMin, 0)),
    best: scored[0],
    worst: scored[scored.length - 1],
  };
}

export function byWeek(data: HealthDataset): PeriodStats[] {
  const groups = new Map<string, DailyMetrics[]>();
  for (const d of data.daily) {
    const k = weekKey(d.date);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  return [...groups.entries()]
    .map(([k, days]) =>
      summarize(k, `${fmtDate(days[0].date)} - ${fmtDate(days[days.length - 1].date)}`, days, data),
    )
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function byMonth(data: HealthDataset): PeriodStats[] {
  const groups = new Map<string, DailyMetrics[]>();
  for (const d of data.daily) {
    const k = d.date.slice(0, 7);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  return [...groups.entries()]
    .map(([k, days]) => {
      const [y, m] = k.split("-");
      return summarize(k, `${y}年${Number(m)}月`, days, data);
    })
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/**
 * Period-over-period comparisons, phrased so the direction and whether it's
 * good are both obvious without knowing which way each metric "should" go.
 */
export function compare(
  cur: PeriodStats,
  prev: PeriodStats | undefined,
  unit: "周" | "月",
): PeriodComparison[] {
  if (!prev) return [];
  const out: PeriodComparison[] = [];
  const last = `上${unit}`;

  const push = (
    label: string,
    a: number | undefined,
    b: number | undefined,
    fmt: (v: number) => string,
    threshold: number,
    higherIsBetter: boolean,
    suffix = "",
  ) => {
    if (a == null || b == null) return;
    const diff = a - b;
    if (Math.abs(diff) < threshold) {
      out.push({ text: `${label}和${last}差不多`, direction: "flat", good: true });
      return;
    }
    const up = diff > 0;
    const word = up ? "多了" : "少了";
    out.push({
      text: `${label}比${last}${word} ${fmt(Math.abs(diff))}${suffix}`,
      direction: up ? "up" : "down",
      good: up === higherIsBetter,
    });
  };

  push("睡眠", cur.sleep, prev.sleep, (v) => v.toFixed(1), 0.3, true, " 小时");
  push("步数", cur.steps, prev.steps, (v) => Math.round(v).toLocaleString(), 500, true, " 步");
  push("锻炼时间", cur.exercise, prev.exercise, (v) => String(Math.round(v)), 5, true, " 分钟");

  // For resting HR, lower is better and the wording flips to 快/慢.
  if (cur.rhr != null && prev.rhr != null) {
    const diff = cur.rhr - prev.rhr;
    if (Math.abs(diff) < 2)
      out.push({ text: `静息心率和${last}差不多`, direction: "flat", good: true });
    else
      out.push({
        text: `静息心率比${last}${diff > 0 ? "快" : "慢"}了 ${Math.abs(Math.round(diff))} 次/分`,
        direction: diff > 0 ? "up" : "down",
        good: diff < 0,
      });
  }
  push("心率变异性", cur.hrv, prev.hrv, (v) => String(Math.round(v)), 3, true, " 毫秒");

  return out;
}

/**
 * Days that stood out against this period's own average. Uses the original
 * app's thresholds: 0.85x for metrics where higher is better, 1.1x where lower
 * is better — predictable, and it works on short periods where a standard
 * deviation would be meaningless.
 */
export function outliers(p: PeriodStats): string[] {
  const out: string[] = [];
  const check = (
    label: string,
    pick: (d: DailyMetrics) => number | undefined,
    fmt: (v: number) => string,
    higherIsBetter: boolean,
  ) => {
    const vals = p.days
      .map((d) => ({ date: d.date, v: pick(d) }))
      .filter((x): x is { date: string; v: number } => x.v != null);
    if (vals.length < 3) return;
    const avg = vals.reduce((a, b) => a + b.v, 0) / vals.length;
    for (const x of vals) {
      if (higherIsBetter && x.v < avg * 0.85)
        out.push(`${fmtDate(x.date)} 的${label}偏低（${fmt(x.v)}）`);
      else if (!higherIsBetter && x.v > avg * 1.1)
        out.push(`${fmtDate(x.date)} 的${label}偏高（${fmt(x.v)}）`);
    }
  };

  check("睡眠", (d) => d.sleep_asleep ?? d.sleep_inbed, (v) => `${v.toFixed(1)} 小时`, true);
  check("静息心率", (d) => d.resting_hr, (v) => `${Math.round(v)} 次/分`, false);
  check("心率变异性", (d) => d.hrv, (v) => `${Math.round(v)} 毫秒`, true);
  return out.slice(0, 5);
}

/** Two or three concrete suggestions for the coming period. */
export function periodAdvice(p: PeriodStats, unit: "周" | "月"): string[] {
  const next = `下${unit}`;
  const tips: string[] = [];

  if (p.sleep != null && p.sleep < 7)
    tips.push(
      `${unit}均睡眠只有 ${p.sleep.toFixed(1)} 小时，${next}试着把上床时间提前 30 分钟。`,
    );
  else if (p.sleep != null)
    tips.push(`睡眠时长保持得不错（${unit}均 ${p.sleep.toFixed(1)} 小时），继续。`);

  const consAvg = mean(p.days.map((d) => d.sleep_consistency));
  if (consAvg != null && consAvg < 50)
    tips.push("作息不太规律，固定起床时间比补觉更有用，周末也别差太多。");

  if (p.steps != null && p.steps < 6000)
    tips.push(`日均 ${p.steps.toLocaleString()} 步偏少，可以从饭后走 15 分钟开始加。`);

  if (p.workoutCount === 0)
    tips.push(`这${unit}没有运动记录，${next}先安排两次能正常聊天强度的有氧。`);

  if (!p.days.some((d) => d.mood != null))
    tips.push("在健康 App 里记录一下「心态」，情绪这块的分析会更准。");

  return tips.slice(0, 4);
}
