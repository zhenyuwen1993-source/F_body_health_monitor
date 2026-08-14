// Turns numbers into plain Chinese a non-athlete can act on.
//
// Everything here is rule-based and runs instantly in the browser — no AI call,
// no cost. The AI chat is for follow-up questions, not for the basics.

import type { Baselines, DailyMetrics, HealthDataset } from "./types";

export type Level = "good" | "ok" | "warn" | "bad" | "unknown";

export interface Verdict {
  /** Plain-language headline, e.g. "状态不错". */
  label: string;
  /** One sentence explaining what the number means for the user today. */
  detail?: string;
  level: Level;
}

const pct = (v: number, base: number) => (v / base - 1) * 100;
const fmt1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// --- Headline scores ---------------------------------------------------------

export function readinessVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "数据不足", level: "unknown" };
  if (v >= 73)
    return {
      label: "状态很好",
      detail: "身体恢复得不错，今天可以正常训练，想加量也扛得住。",
      level: "good",
    };
  if (v >= 55)
    return {
      label: "状态还行",
      detail: "可以练，但别冲太狠，保持平时的强度就好。",
      level: "ok",
    };
  if (v >= 35)
    return {
      label: "有点疲劳",
      detail: "身体还没缓过来，今天适合做点轻松的活动，比如散步或拉伸。",
      level: "warn",
    };
  return {
    label: "需要休息",
    detail: "身体明显还没恢复，今天最好别练，早点睡。",
    level: "bad",
  };
}

export function recoveryVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "数据不足", level: "unknown" };
  if (v >= 67) return { label: "恢复得好", detail: "身体各项都回到了正常水平。", level: "good" };
  if (v >= 34)
    return { label: "恢复一般", detail: "还没完全缓过来，注意今晚早点睡。", level: "ok" };
  return {
    label: "恢复不足",
    detail: "身体还在疲劳状态，建议减量并保证睡眠。",
    level: "bad",
  };
}

export function strainVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "数据不足", level: "unknown" };
  if (v >= 15)
    return { label: "今天很累", detail: "身体承受了很大负荷，记得好好恢复。", level: "warn" };
  if (v >= 10) return { label: "练得不少", detail: "中等偏上的活动量。", level: "good" };
  if (v >= 5) return { label: "适中", detail: "正常的日常活动量。", level: "good" };
  return { label: "很轻松", detail: "今天基本没怎么动。", level: "ok" };
}

// --- Individual metrics ------------------------------------------------------

export function sleepVerdict(h: number | undefined): Verdict {
  if (h == null) return { label: "没有记录", level: "unknown" };
  if (h >= 7 && h <= 9)
    return { label: "睡得不错", detail: `${fmt1(h)} 小时，正好在理想区间。`, level: "good" };
  if (h >= 6 && h < 7)
    return { label: "略微不足", detail: `${fmt1(h)} 小时，比理想的 7-9 小时少一点。`, level: "ok" };
  if (h > 9 && h <= 11)
    return { label: "睡得偏多", detail: `${fmt1(h)} 小时，可能是在补觉。`, level: "ok" };
  if (h < 6)
    return { label: "睡眠不足", detail: `只睡了 ${fmt1(h)} 小时，今天注意补觉。`, level: "bad" };
  return { label: "睡得过多", detail: `${fmt1(h)} 小时，长期这样也要留意。`, level: "warn" };
}

export function hrvVerdict(v: number | undefined, base: number | undefined): Verdict {
  if (v == null) return { label: "没有记录", level: "unknown" };
  if (base == null) return { label: `${fmt1(v)} ms`, level: "unknown" };
  const d = pct(v, base);
  if (d >= 5)
    return {
      label: "比平时好",
      detail: `比你平时高 ${Math.round(Math.abs(d))}%，说明身体挺放松的。`,
      level: "good",
    };
  if (d >= -10)
    return { label: "和平时差不多", detail: "在你自己的正常范围内。", level: "good" };
  if (d >= -20)
    return {
      label: "略低于平时",
      detail: `比平时低 ${Math.round(Math.abs(d))}%，可能有点累或压力大。`,
      level: "ok",
    };
  return {
    label: "明显偏低",
    detail: `比平时低 ${Math.round(Math.abs(d))}%，身体可能在硬扛，注意休息。`,
    level: "warn",
  };
}

export function rhrVerdict(v: number | undefined, base: number | undefined): Verdict {
  if (v == null) return { label: "没有记录", level: "unknown" };
  if (base == null) return { label: `${Math.round(v)} 次/分`, level: "unknown" };
  const diff = v - base;
  if (diff <= -3)
    return {
      label: "比平时低",
      detail: `比平时慢 ${Math.round(Math.abs(diff))} 次，通常是恢复得好的信号。`,
      level: "good",
    };
  if (diff <= 3) return { label: "和平时一样", detail: "在你的正常范围。", level: "good" };
  if (diff <= 7)
    return {
      label: "略高于平时",
      detail: `比平时快 ${Math.round(diff)} 次，可能没睡好、喝了酒或有点累。`,
      level: "ok",
    };
  return {
    label: "明显偏高",
    detail: `比平时快 ${Math.round(diff)} 次，如果还伴随不舒服，注意休息或就医。`,
    level: "warn",
  };
}

export function stepsVerdict(v: number | undefined, base: number | undefined): Verdict {
  if (v == null) return { label: "没有记录", level: "unknown" };
  if (v >= 10000) return { label: "走得很多", level: "good" };
  if (v >= 6000) return { label: "还算活跃", level: "good" };
  if (v >= 3000) return { label: "偏少", detail: "可以找机会多走走。", level: "ok" };
  const cmp = base && v < base * 0.5 ? "，比你平时少很多" : "";
  return { label: "几乎没动", detail: `今天走得很少${cmp}。`, level: "warn" };
}

export function consistencyVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "数据不足", level: "unknown" };
  if (v >= 70)
    return { label: "作息很规律", detail: "每天上床和起床时间比较固定，对身体很好。", level: "good" };
  if (v >= 45)
    return { label: "作息一般", detail: "睡觉时间有点飘，尽量固定下来会更好。", level: "ok" };
  return {
    label: "作息很乱",
    detail: "每天睡觉起床时间差别很大，这会影响恢复和精神状态。",
    level: "warn",
  };
}

export function tsbVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "数据不足", level: "unknown" };
  if (v >= 10)
    return { label: "很有余力", detail: "最近练得少，身体储备充足，可以加量了。", level: "good" };
  if (v >= -10)
    return { label: "平衡", detail: "训练和恢复大致平衡，保持就好。", level: "good" };
  if (v >= -25)
    return { label: "累积了疲劳", detail: "最近练得比较猛，注意安排休息日。", level: "ok" };
  return {
    label: "疲劳偏重",
    detail: "短期练得太多了，建议减量几天，否则容易受伤或生病。",
    level: "warn",
  };
}

export function vo2maxVerdict(
  v: number | undefined,
  sex?: string | null,
  age?: number | null,
): Verdict {
  if (v == null) return { label: "没有记录", level: "unknown" };
  // Rough population bands (ml/kg/min), nudged by age decade. Watch estimates
  // skew low for non-runners, so the copy stays gentle.
  const a = age ?? 35;
  const shift = Math.max(0, (a - 30) / 10) * 2.5;
  const female = sex === "female";
  const lo = (female ? 30 : 35) - shift;
  const mid = (female ? 37 : 42) - shift;
  const hi = (female ? 44 : 50) - shift;
  if (v >= hi)
    return { label: "心肺很强", detail: "在同龄人里属于优秀水平，说明心肺引擎很好。", level: "good" };
  if (v >= mid)
    return { label: "不错", detail: "高于同龄人的平均水平，保持规律有氧就好。", level: "good" };
  if (v >= lo)
    return {
      label: "一般",
      detail: "在常见范围内。每周多一点快走或慢跑，这个数字会慢慢上去。",
      level: "ok",
    };
  return {
    label: "偏低",
    detail: "低于同龄人常见水平。别灰心——它对训练的反应很快，从每周三次快走开始。",
    level: "warn",
  };
}

export function hrRecoveryVerdict(v: number | undefined): Verdict {
  if (v == null) return { label: "没有记录", level: "unknown" };
  if (v >= 30) return { label: "恢复很快", detail: "运动后心率降得快，是心脏健康的好信号。", level: "good" };
  if (v >= 18) return { label: "正常", detail: "运动后一分钟的心率下降在健康范围。", level: "good" };
  if (v >= 12)
    return { label: "偏慢", detail: "运动后心率降得比较慢，多做有氧会改善。", level: "ok" };
  return {
    label: "明显偏慢",
    detail: "如果多次都这么慢，值得和医生聊聊心肺健康。",
    level: "warn",
  };
}

// --- Whole-day narrative -----------------------------------------------------

/**
 * The paragraph shown at the top of the dashboard: what happened, what it
 * means, what to do. Built from whichever signals are present.
 */
export function dailySummary(data: HealthDataset): {
  greeting: string;
  paragraphs: string[];
  level: Level;
} {
  const days = data.daily;
  const today = days[days.length - 1];
  const base = data.baselines;

  const r = readinessVerdict(today.readiness);
  const paragraphs: string[] = [];

  // 1. Headline
  const greeting = r.label;
  if (r.detail) paragraphs.push(r.detail);

  // 2. Sleep — the thing normal people care about most.
  const sleepDay = lastWith(days, (d) => d.sleep_asleep ?? d.sleep_inbed);
  if (sleepDay) {
    const sv = sleepVerdict(sleepDay.value);
    const when = sleepDay.isToday ? "昨晚" : `${sleepDay.date.slice(5)} 那晚`;
    let s = `${when}睡了 ${fmt1(sleepDay.value)} 小时`;
    const d = days.find((x) => x.date === sleepDay.date);
    if (d?.sleep_deep && d?.sleep_rem)
      s += `（深睡 ${fmt1(d.sleep_deep)} 小时、快速眼动 ${fmt1(d.sleep_rem)} 小时）`;
    s += `，${sv.label}。`;
    if (sv.level === "bad" || sv.level === "warn") s += "睡眠是恢复的基础，今晚尽量早点上床。";
    paragraphs.push(s);
  }

  // 3. Load / fatigue trend
  if (today.tsb != null) {
    const tv = tsbVerdict(today.tsb);
    paragraphs.push(`最近的训练和恢复：${tv.label}。${tv.detail ?? ""}`);
  }

  // 4. Anything notably off baseline
  const flags: string[] = [];
  if (today.resting_hr != null && base.rhr != null && today.resting_hr - base.rhr > 5)
    flags.push(
      `静息心率比平时快了 ${Math.round(today.resting_hr - base.rhr)} 次/分`,
    );
  if (today.hrv != null && base.hrv != null && pct(today.hrv, base.hrv) < -20)
    flags.push("心率变异性明显低于平时");
  if (today.sleep_consistency != null && today.sleep_consistency < 45)
    flags.push("作息不太规律");
  if (flags.length)
    paragraphs.push(`需要留意：${flags.join("；")}。这些通常和没睡好、压力大或快生病有关。`);

  return { greeting, paragraphs, level: r.level };
}

function lastWith(
  days: DailyMetrics[],
  pick: (d: DailyMetrics) => number | undefined,
): { value: number; date: string; isToday: boolean } | undefined {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = pick(days[i]);
    if (v != null && Number.isFinite(v))
      return { value: v, date: days[i].date, isToday: i === days.length - 1 };
  }
  return undefined;
}

export const LEVEL_COLOR: Record<Level, string> = {
  good: "#10b981",
  ok: "#f59e0b",
  warn: "#f97316",
  bad: "#ef4444",
  unknown: "#a1a1aa",
};

export type { Baselines };
