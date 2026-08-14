// What height, weight and body fat mean, in the same plain register as the
// rest of the app. Reference ranges are population guidance for personal
// observation, not diagnosis — individual build matters more than the number.

import type { Level } from "./interpret";

export interface BodyProfile {
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  birthYear: number | null;
  sex: string | null;
}

export interface Reading {
  value: number;
  label: string;
  detail: string;
  level: Level;
}

export function bmi(p: BodyProfile): Reading | null {
  if (!p.heightCm || !p.weightKg) return null;
  const m = p.heightCm / 100;
  const v = Math.round((p.weightKg / (m * m)) * 10) / 10;

  // WHO Asian-Pacific cut-offs, which sit lower than the international ones.
  if (v < 18.5)
    return {
      value: v,
      label: "偏瘦",
      detail: "体重相对身高偏轻。如果不是刻意减重，注意有没有吃够。",
      level: "ok",
    };
  if (v < 24)
    return { value: v, label: "正常", detail: "体重和身高的比例在常见的健康区间。", level: "good" };
  if (v < 28)
    return {
      value: v,
      label: "偏重",
      detail: "略高于常见区间。肌肉量大的人也会落在这里，结合体脂率看更准。",
      level: "ok",
    };
  return {
    value: v,
    label: "偏高",
    detail: "明显高于常见区间，长期这样和代谢、关节负担有关，值得关注。",
    level: "warn",
  };
}

export function bodyFatReading(p: BodyProfile): Reading | null {
  if (p.bodyFatPct == null) return null;
  const v = p.bodyFatPct;

  // Healthy body-fat ranges differ by roughly ten points between men and women,
  // so guessing would hand half the users a wrong verdict. Without sex we show
  // the number and say why there's no judgement attached.
  if (p.sex !== "male" && p.sex !== "female") {
    return {
      value: v,
      label: "已记录",
      detail: "男女的正常范围差别较大，填了性别才能判断这个数值算高还是低。",
      level: "unknown",
    };
  }

  const female = p.sex === "female";
  const bands: [number, string, string, Level][] = female
    ? [
        [18, "很低", "低于多数女性的常见范围，过低可能影响内分泌和月经。", "warn"],
        [25, "偏低", "偏运动员体型的区间。", "good"],
        [32, "正常", "落在女性的常见健康区间。", "good"],
        [Infinity, "偏高", "高于常见区间，可以从饮食和日常活动量入手。", "ok"],
      ]
    : [
        [8, "很低", "低于多数男性的常见范围，过低不一定更健康。", "warn"],
        [15, "偏低", "偏运动员体型的区间。", "good"],
        [21, "正常", "落在男性的常见健康区间。", "good"],
        [Infinity, "偏高", "高于常见区间，可以从饮食和日常活动量入手。", "ok"],
      ];
  for (const [max, label, detail, level] of bands) {
    if (v < max) return { value: v, label, detail, level };
  }
  return null;
}

/** Mifflin-St Jeor basal metabolic rate — what you'd burn doing nothing. */
export function bmr(p: BodyProfile): number | null {
  if (!p.heightCm || !p.weightKg) return null;
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : 30;
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age;
  return Math.round(p.sex === "female" ? base - 161 : base + 5);
}

/** Estimated max heart rate, used for training-zone talk. */
export function hrMax(p: BodyProfile): number | null {
  if (!p.birthYear) return null;
  const age = new Date().getFullYear() - p.birthYear;
  if (age < 10 || age > 100) return null;
  return Math.round(220 - age);
}

export function isComplete(p: BodyProfile): boolean {
  return p.heightCm != null && p.weightKg != null;
}
