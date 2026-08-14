// "What actually moves my numbers?" — compares nights after tagged days with
// nights after untagged days, in plain sentences.
//
// A tag describes daytime behaviour on day D; its effect shows in that night's
// sleep, which wake-day attribution files under day D+1. So every comparison
// reads the metrics of the day AFTER the tag.
//
// Honesty rules: minimum sample sizes before claiming anything, minimum effect
// sizes before reporting a difference, and the sample counts are always shown.
// This is an observed association in one person's data, not causality — the
// copy says so.

import type { DailyMetrics, HealthDataset } from "./types";

export interface TagEffect {
  metric: string; // e.g. "睡眠"
  text: string; // e.g. "当晚平均少睡 48 分钟"
  /** negative = worse for the user */
  direction: "worse" | "better";
}

export interface TagInsight {
  tag: string;
  taggedDays: number;
  effects: TagEffect[];
}

export interface CorrelationReport {
  insights: TagInsight[];
  /** Tags logged but without enough data yet, with how many more days needed. */
  pending: { tag: string; have: number; need: number }[];
}

const MIN_TAGGED = 5;
const MIN_CONTROL = 5;

const mean = (xs: number[]): number | undefined =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

interface MetricDef {
  name: string;
  pick: (d: DailyMetrics) => number | undefined;
  /** Smallest difference worth mentioning, in the metric's own unit. */
  threshold: number;
  /** Turn a signed diff (tagged − control) into a sentence. */
  phrase: (diff: number) => { text: string; direction: "worse" | "better" };
}

const METRICS: MetricDef[] = [
  {
    name: "睡眠",
    pick: (d) => d.sleep_asleep ?? d.sleep_inbed,
    threshold: 20 / 60, // 20 minutes
    phrase: (diff) => {
      const min = Math.round(Math.abs(diff) * 60);
      return diff < 0
        ? { text: `当晚平均少睡 ${min} 分钟`, direction: "worse" }
        : { text: `当晚平均多睡 ${min} 分钟`, direction: "better" };
    },
  },
  {
    name: "心率变异性",
    pick: (d) => d.hrv,
    threshold: 0, // handled as percentage below via relative check
    phrase: (diff) =>
      diff < 0
        ? { text: `第二天心率变异性平均低 ${Math.abs(diff).toFixed(0)} 毫秒（身体更紧张）`, direction: "worse" }
        : { text: `第二天心率变异性平均高 ${diff.toFixed(0)} 毫秒（身体更放松）`, direction: "better" },
  },
  {
    name: "静息心率",
    pick: (d) => d.resting_hr,
    threshold: 2,
    phrase: (diff) =>
      diff > 0
        ? { text: `第二天静息心率平均快 ${diff.toFixed(0)} 次/分`, direction: "worse" }
        : { text: `第二天静息心率平均慢 ${Math.abs(diff).toFixed(0)} 次/分`, direction: "better" },
  },
  {
    name: "状态",
    pick: (d) => d.readiness,
    threshold: 5,
    phrase: (diff) =>
      diff < 0
        ? { text: `第二天状态分平均低 ${Math.abs(diff).toFixed(0)} 分`, direction: "worse" }
        : { text: `第二天状态分平均高 ${diff.toFixed(0)} 分`, direction: "better" },
  },
];

export function correlate(
  data: HealthDataset,
  journal: { day: string; tags: string[] }[],
): CorrelationReport {
  const byDate = new Map(data.daily.map((d) => [d.date, d]));
  const nextOf = new Map<string, DailyMetrics>();
  for (let i = 0; i < data.daily.length - 1; i++) {
    nextOf.set(data.daily[i].date, data.daily[i + 1]);
  }

  // Only journal days that sit inside the health data and have a next day.
  const usable = journal.filter((j) => byDate.has(j.day) && nextOf.has(j.day));
  const allTags = new Set(usable.flatMap((j) => j.tags));

  const insights: TagInsight[] = [];
  const pending: { tag: string; have: number; need: number }[] = [];

  for (const tag of allTags) {
    const tagged = usable.filter((j) => j.tags.includes(tag));
    const control = usable.filter((j) => !j.tags.includes(tag));

    if (tagged.length < MIN_TAGGED || control.length < MIN_CONTROL) {
      pending.push({
        tag,
        have: tagged.length,
        need: Math.max(0, MIN_TAGGED - tagged.length),
      });
      continue;
    }

    const effects: TagEffect[] = [];
    for (const m of METRICS) {
      const tv = tagged
        .map((j) => m.pick(nextOf.get(j.day)!))
        .filter((v): v is number => v != null);
      const cv = control
        .map((j) => m.pick(nextOf.get(j.day)!))
        .filter((v): v is number => v != null);
      if (tv.length < MIN_TAGGED || cv.length < MIN_CONTROL) continue;

      const tm = mean(tv)!;
      const cm = mean(cv)!;
      const diff = tm - cm;

      // HRV threshold is relative — 8% of the control mean.
      const threshold = m.name === "心率变异性" ? Math.max(3, cm * 0.08) : m.threshold;
      if (Math.abs(diff) < threshold) continue;

      effects.push({ metric: m.name, ...m.phrase(diff) });
    }

    if (effects.length) insights.push({ tag, taggedDays: tagged.length, effects });
  }

  // Worst offenders first — that's what people came to find out.
  insights.sort(
    (a, b) =>
      b.effects.filter((e) => e.direction === "worse").length -
      a.effects.filter((e) => e.direction === "worse").length,
  );
  pending.sort((a, b) => a.need - b.need);

  return { insights, pending };
}
