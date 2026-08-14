// Early-warning heuristics: is the body fighting something?
//
// The pattern is well documented — resting heart rate creeping above baseline,
// HRV sagging below it, sleeping wrist temperature and respiratory rate rising
// together often precede felt symptoms by one to three days. The watch already
// collects every one of these; nothing surfaces them. This does, with rules
// only: no AI call, and honest about not being a diagnosis.

import type { DailyMetrics, HealthDataset } from "./types";

export interface AlertSignal {
  /** e.g. "静息心率" */
  name: string;
  /** e.g. "连续 2 天比平时快 5 次/分" */
  text: string;
}

export interface BodyAlert {
  level: "none" | "watch" | "warn";
  title: string;
  paragraphs: string[];
  signals: AlertSignal[];
}

const md = (xs: number[]): number | undefined => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Baseline from days 28→8 back, so a brewing illness doesn't drag it along. */
function baselineOf(
  days: DailyMetrics[],
  pick: (d: DailyMetrics) => number | undefined,
): number | undefined {
  const window = days.slice(-28, -7).map(pick).filter((v): v is number => v != null);
  if (window.length < 5) return undefined;
  return md(window);
}

/** Values for the most recent `n` days that actually have the metric. */
function recentVals(
  days: DailyMetrics[],
  pick: (d: DailyMetrics) => number | undefined,
  n: number,
): number[] {
  const out: number[] = [];
  for (let i = days.length - 1; i >= 0 && out.length < n; i--) {
    const v = pick(days[i]);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function bodyAlert(data: HealthDataset): BodyAlert {
  const days = data.daily;
  if (days.length < 14) {
    return { level: "none", title: "", paragraphs: [], signals: [] };
  }

  const signals: AlertSignal[] = [];
  let score = 0;

  // 1. Resting heart rate — the most reliable single tell.
  {
    const base = baselineOf(days, (d) => d.resting_hr);
    const recent = recentVals(days, (d) => d.resting_hr, 2);
    if (base != null && recent.length === 2) {
      const diffs = recent.map((v) => v - base);
      if (diffs.every((d) => d >= 5)) {
        score += 2;
        signals.push({
          name: "静息心率",
          text: `连续 2 天比平时快 ${Math.round(Math.min(...diffs))} 次/分以上`,
        });
      } else if (diffs.every((d) => d >= 3)) {
        score += 1;
        signals.push({
          name: "静息心率",
          text: `连续 2 天比平时快 ${Math.round(Math.min(...diffs))} 次/分`,
        });
      }
    }
  }

  // 2. HRV sagging.
  {
    const base = baselineOf(days, (d) => d.hrv);
    const recent = recentVals(days, (d) => d.hrv, 2);
    if (base != null && base > 0 && recent.length === 2) {
      const drops = recent.map((v) => (1 - v / base) * 100);
      if (drops.every((d) => d >= 25)) {
        score += 2;
        signals.push({
          name: "心率变异性",
          text: `连续 2 天比平时低 ${Math.round(Math.min(...drops))}% 以上`,
        });
      } else if (drops.every((d) => d >= 15)) {
        score += 1;
        signals.push({
          name: "心率变异性",
          text: `连续 2 天比平时低约 ${Math.round(Math.min(...drops))}%`,
        });
      }
    }
  }

  // 3. Sleeping wrist temperature — small absolute shifts matter.
  {
    const base = baselineOf(days, (d) => d.wrist_temp);
    const recent = recentVals(days, (d) => d.wrist_temp, 2);
    if (base != null && recent.length >= 1) {
      const rises = recent.map((v) => v - base);
      if (rises.every((r) => r >= 0.5)) {
        score += 2;
        signals.push({
          name: "睡眠腕温",
          text: `比平时高 ${Math.min(...rises).toFixed(1)}°C 以上`,
        });
      } else if (rises.every((r) => r >= 0.3)) {
        score += 1;
        signals.push({
          name: "睡眠腕温",
          text: `比平时高约 ${Math.min(...rises).toFixed(1)}°C`,
        });
      }
    }
  }

  // 4. Respiratory rate during sleep.
  {
    const base = baselineOf(days, (d) => d.resp_rate);
    const recent = recentVals(days, (d) => d.resp_rate, 2);
    if (base != null && recent.length === 2) {
      const rises = recent.map((v) => v - base);
      if (rises.every((r) => r >= 1.5)) {
        score += 1;
        signals.push({
          name: "睡眠呼吸频率",
          text: `比平时快 ${Math.min(...rises).toFixed(1)} 次/分`,
        });
      }
    }
  }

  if (score === 0 || signals.length === 0) {
    return { level: "none", title: "", paragraphs: [], signals: [] };
  }

  // Things that mimic illness — flag them instead of crying wolf.
  const caveats: string[] = [];
  const yesterday = days[days.length - 2];
  if (yesterday?.strain != null && yesterday.strain >= 14)
    caveats.push("昨天的运动量很大，剧烈运动后的一两天也会出现类似变化");
  if ((yesterday?.training_load ?? 0) >= 60)
    caveats.push("昨天训练负荷偏高");

  if (score >= 3) {
    return {
      level: "warn",
      title: "你的身体可能在对抗什么",
      paragraphs: [
        "几个信号同时偏离了你的正常范围——这种组合常出现在感冒、感染或过度疲劳发作的前一两天，往往比你自己感觉到要早。",
        caveats.length
          ? `不过：${caveats.join("；")}。如果是这个原因，休息一两天这些数字就会回来。`
          : "这几天建议：别安排高强度运动，多睡，多喝水。如果开始出现症状或持续三天以上，去看医生。",
        "这只是数据观察，不是诊断。",
      ],
      signals,
    };
  }

  return {
    level: "watch",
    title: "有个信号值得留意",
    paragraphs: [
      "还不到警报的程度，但你的身体最近有点偏离平时的状态。今天可以照常生活，晚上早点睡，明天再看看这些数字有没有回来。",
      ...(caveats.length ? [`可能的解释：${caveats.join("；")}。`] : []),
    ],
    signals,
  };
}
