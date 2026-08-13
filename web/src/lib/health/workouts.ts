// Per-workout analysis: heart-rate zones, intensity, and a rolling summary.
// Ported from src/metrics/workouts.py, with the zone labels rewritten so a
// non-athlete can tell what each one is for.

import type { WorkoutRecord } from "./types";

export interface ZoneInfo {
  zone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5";
  /** Short plain-language name shown to the user. */
  name: string;
  /** What this zone does for you, in one sentence. */
  what: string;
  intensity: "轻松" | "中等" | "高强度";
  color: string;
}

export const ZONES: Record<ZoneInfo["zone"], ZoneInfo> = {
  Z1: {
    zone: "Z1",
    name: "恢复",
    what: "很轻松，能正常聊天。帮助身体恢复，不制造疲劳。",
    intensity: "轻松",
    color: "#22c55e",
  },
  Z2: {
    zone: "Z2",
    name: "有氧",
    what: "稍微喘但还能说整句话。打底子最有效的区间，多数训练应该在这里。",
    intensity: "轻松",
    color: "#84cc16",
  },
  Z3: {
    zone: "Z3",
    name: "节奏",
    what: "有点吃力，说话开始断断续续。介于轻松和硬练之间。",
    intensity: "中等",
    color: "#eab308",
  },
  Z4: {
    zone: "Z4",
    name: "阈值",
    what: "很吃力，只能蹦单词。提升耐力上限，但很消耗，别天天练。",
    intensity: "高强度",
    color: "#f97316",
  },
  Z5: {
    zone: "Z5",
    name: "极限",
    what: "接近拼尽全力，撑不了几分钟。刺激最大，恢复也最久。",
    intensity: "高强度",
    color: "#ef4444",
  },
};

/** Max heart rate estimate: observed peak, else age-based, else a safe default. */
export function estimateHrMax(age?: number, observedMax?: number): number {
  if (observedMax != null && observedMax > 140) return Math.max(observedMax, 160);
  if (age != null && age >= 10 && age <= 90) return 220 - age;
  return 190;
}

export function hrZone(hr: number | undefined, hrMax: number): ZoneInfo | undefined {
  if (hr == null || !Number.isFinite(hr) || hrMax <= 0) return undefined;
  const pct = hr / hrMax;
  if (pct < 0.6) return ZONES.Z1;
  if (pct < 0.7) return ZONES.Z2;
  if (pct < 0.8) return ZONES.Z3;
  if (pct < 0.9) return ZONES.Z4;
  return ZONES.Z5;
}

export interface AnalyzedWorkout extends WorkoutRecord {
  zoneInfo?: ZoneInfo;
  /** Auto note when the session is unusually hard for its length. */
  note?: string;
}

export interface WorkoutSummary {
  windowDays: number;
  count: number;
  totalMinutes: number;
  totalKcal: number;
  hardCount: number;
  easyCount: number;
  hrAvgMean?: number;
  hrMaxPeak?: number;
  byType: { type: string; count: number; minutes: number }[];
  hrMaxUsed: number;
  /** Plain-language observations about the recent block of training. */
  advice: string[];
}

export function analyzeWorkouts(
  workouts: WorkoutRecord[],
  opts: { age?: number; windowDays?: number; now?: Date } = {},
): { analyzed: AnalyzedWorkout[]; summary: WorkoutSummary } {
  const windowDays = opts.windowDays ?? 14;
  const observedMax = workouts.reduce<number | undefined>(
    (m, w) => (w.hrMax != null && (m == null || w.hrMax > m) ? w.hrMax : m),
    undefined,
  );
  const hrMax = estimateHrMax(opts.age, observedMax);

  const analyzed: AnalyzedWorkout[] = workouts.map((w) => {
    const zoneInfo = hrZone(w.hrAvg, hrMax);
    let note: string | undefined;
    if (zoneInfo?.zone === "Z5" && w.durationMin >= 10)
      note = "这场强度很高且时间不短，之后至少留一天轻松日。";
    else if (zoneInfo?.zone === "Z4" && w.durationMin >= 30)
      note = "长时间维持在阈值强度，很吃身体，注意补觉。";
    else if (zoneInfo?.intensity === "轻松")
      note = "轻松强度，适合当作恢复训练。";
    return { ...w, zoneInfo, note };
  });

  // Recent window, measured back from the latest workout (not "today", since
  // an export can be days old).
  const latest = workouts.reduce<number>(
    (m, w) => Math.max(m, w.startDate.getTime()),
    0,
  );
  const anchor = opts.now?.getTime() ?? latest;
  const cutoff = anchor - windowDays * 86_400_000;
  const recent = analyzed.filter((w) => w.startDate.getTime() >= cutoff);

  const hrAvgs = recent.map((w) => w.hrAvg).filter((v): v is number => v != null);
  const hrMaxes = recent.map((w) => w.hrMax).filter((v): v is number => v != null);
  const hardCount = recent.filter((w) => w.zoneInfo?.intensity === "高强度").length;
  const easyCount = recent.filter((w) => w.zoneInfo?.intensity === "轻松").length;

  const byTypeMap = new Map<string, { count: number; minutes: number }>();
  for (const w of recent) {
    const cur = byTypeMap.get(w.activityType) ?? { count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += w.durationMin;
    byTypeMap.set(w.activityType, cur);
  }

  const advice: string[] = [];
  if (recent.length === 0) {
    advice.push(`最近 ${windowDays} 天没有运动记录。`);
  } else {
    if (hardCount >= 4 && easyCount <= 1)
      advice.push(
        `最近 ${windowDays} 天里有 ${hardCount} 场高强度、只有 ${easyCount} 场轻松的。建议插入几次能正常聊天的慢速有氧，身体才有时间修复。`,
      );
    if (hardCount === 0 && recent.length >= 3)
      advice.push(
        "最近都是轻松强度。如果想提升体能，可以每周安排一次稍微吃力的训练。",
      );
    if (hrAvgs.length === 0)
      advice.push("这些训练没有心率数据，无法判断强度——运动时戴着表会准很多。");
  }

  return {
    analyzed,
    summary: {
      windowDays,
      count: recent.length,
      totalMinutes: Math.round(recent.reduce((a, w) => a + w.durationMin, 0)),
      totalKcal: Math.round(recent.reduce((a, w) => a + (w.totalEnergyKcal ?? 0), 0)),
      hardCount,
      easyCount,
      hrAvgMean: hrAvgs.length
        ? Math.round(hrAvgs.reduce((a, b) => a + b, 0) / hrAvgs.length)
        : undefined,
      hrMaxPeak: hrMaxes.length ? Math.round(Math.max(...hrMaxes)) : undefined,
      byType: [...byTypeMap.entries()]
        .map(([type, v]) => ({ type, count: v.count, minutes: Math.round(v.minutes) }))
        .sort((a, b) => b.count - a.count),
      hrMaxUsed: Math.round(hrMax),
      advice,
    },
  };
}
