// Cross-references the training log with the health metrics to answer the only
// question that matters on a training day: should I train this as planned?
//
// Muscle-group recovery guidance is the common 48-72h window; this stays on the
// conservative side and always defers to how the body is actually responding.

import type { DailyMetrics, HealthDataset } from "./types";

export interface TrainingDayRecord {
  day: string;
  planned: string[];
  actual: string[];
  rpe?: number;
  note?: string;
}

export interface BodyIssueRecord {
  id: number;
  bodyPart: string;
  severity: number;
  note?: string;
  startedOn: string;
}

export type PartState = "fresh" | "ready" | "recovering" | "overworked" | "never";

export interface PartStatus {
  part: string;
  daysSince: number | null; // null = never trained in the window
  timesInWeek: number;
  state: PartState;
  label: string;
  detail: string;
  color: string;
}

const STATE_COLOR: Record<PartState, string> = {
  fresh: "#10b981",
  ready: "#10b981",
  recovering: "#f59e0b",
  overworked: "#ef4444",
  never: "#a1a1aa",
};

export function partStatuses(
  parts: readonly string[],
  days: TrainingDayRecord[],
  today = todayIso(),
): PartStatus[] {
  return parts.map((part) => {
    const trained = days
      .filter((d) => d.actual.includes(part))
      .map((d) => d.day)
      .sort();
    const last = trained[trained.length - 1];
    const daysSince = last ? daysBetween(last, today) : null;
    const weekAgo = shiftDays(today, -6);
    const timesInWeek = trained.filter((d) => d >= weekAgo).length;

    let state: PartState;
    let label: string;
    let detail: string;

    if (daysSince == null) {
      state = "never";
      label = "还没练过";
      detail = "最近的记录里没有练到这个部位。";
    } else if (timesInWeek >= 4) {
      state = "overworked";
      label = "练得太频繁";
      detail = `7 天里练了 ${timesInWeek} 次，肌肉需要时间修复，容易越练越没劲。`;
    } else if (daysSince === 0) {
      state = "recovering";
      label = "今天刚练过";
      detail = "同一部位建议隔 48 小时以上再练。";
    } else if (daysSince === 1) {
      state = "recovering";
      label = "还在恢复";
      detail = "昨天刚练过，通常还需要一天。";
    } else if (daysSince <= 4) {
      state = "ready";
      label = "可以练了";
      detail = `已经 ${daysSince} 天没练，恢复得差不多了。`;
    } else {
      state = "fresh";
      label = "该安排了";
      detail = `${daysSince} 天没练这个部位了，别落下。`;
    }

    return { part, daysSince, timesInWeek, state, label, detail, color: STATE_COLOR[state] };
  });
}

export interface PlanVerdict {
  /** Overall call for today. */
  headline: string;
  level: "good" | "ok" | "warn" | "bad";
  reasons: string[];
  /** Parts to skip today and why. */
  skip: { part: string; why: string }[];
  /** Parts worth adding, since they're rested and overdue. */
  suggest: string[];
}

/**
 * Should today's plan go ahead? Weighs the body's readiness against what the
 * plan asks for, plus any parts that currently hurt.
 */
export function evaluatePlan(
  planned: string[],
  statuses: PartStatus[],
  issues: BodyIssueRecord[],
  data: HealthDataset,
): PlanVerdict {
  const today: DailyMetrics | undefined = data.daily[data.daily.length - 1];
  const readiness = today?.readiness;
  const reasons: string[] = [];
  const skip: { part: string; why: string }[] = [];

  // 1. Body-wide readiness.
  let level: PlanVerdict["level"] = "good";
  let headline = "按计划练就行";

  if (readiness != null) {
    if (readiness < 35) {
      level = "bad";
      headline = "今天建议别练";
      reasons.push(
        `身体状态只有 ${readiness} 分，处在需要休息的区间。硬练不会有收益，还容易受伤。`,
      );
    } else if (readiness < 55) {
      level = "warn";
      headline = "今天减量练";
      reasons.push(
        `身体状态 ${readiness} 分偏低，建议把重量或组数降下来，或者改成轻松有氧。`,
      );
    } else if (readiness < 73) {
      level = "ok";
      headline = "正常练，别加量";
      reasons.push(`身体状态 ${readiness} 分，够用，但今天不是冲个人纪录的日子。`);
    } else {
      reasons.push(`身体状态 ${readiness} 分，恢复得不错，可以正常甚至加量。`);
    }
  }

  // 2. Sleep debt is the most common reason a plan should shrink.
  const sleep = today?.sleep_asleep ?? today?.sleep_inbed;
  if (sleep != null && sleep < 6) {
    if (level === "good") level = "ok";
    reasons.push(`昨晚只睡了 ${sleep.toFixed(1)} 小时，力量和专注度都会打折，注意安全。`);
  }

  // 3. Parts that hurt should not be loaded.
  for (const iss of issues) {
    if (!planned.includes(iss.bodyPart)) continue;
    const sev = iss.severity >= 3 ? "疼得厉害" : iss.severity === 2 ? "有明显不适" : "有点不舒服";
    skip.push({ part: iss.bodyPart, why: `这个部位${sev}，先别练，让它好利索。` });
    if (iss.severity >= 2 && level !== "bad") level = "warn";
  }

  // 4. Parts the plan wants but that haven't recovered.
  for (const p of planned) {
    const st = statuses.find((s) => s.part === p);
    if (!st || skip.some((s) => s.part === p)) continue;
    if (st.state === "overworked")
      skip.push({ part: p, why: `这周已经练了 ${st.timesInWeek} 次，换个部位吧。` });
    else if (st.daysSince === 0)
      skip.push({ part: p, why: "今天已经练过这个部位了。" });
    else if (st.daysSince === 1)
      skip.push({ part: p, why: "昨天刚练过，至少再隔一天。" });
  }

  // 5. Parts that are rested and overdue.
  const painful = new Set(issues.map((i) => i.bodyPart));
  const suggest = statuses
    .filter(
      (s) =>
        s.state === "fresh" &&
        !planned.includes(s.part) &&
        !painful.has(s.part) &&
        s.part !== "有氧",
    )
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))
    .slice(0, 3)
    .map((s) => s.part);

  if (planned.length === 0) {
    headline = "还没定今天练什么";
    level = "ok";
  }

  return { headline, level, reasons, skip, suggest };
}

/** How well recent plans were actually followed. */
export function adherence(days: TrainingDayRecord[]): {
  planned: number;
  done: number;
  rate: number | null;
  text: string;
} {
  const withPlan = days.filter((d) => d.planned.length > 0);
  if (withPlan.length === 0)
    return { planned: 0, done: 0, rate: null, text: "还没有记录过训练计划。" };
  const done = withPlan.filter((d) =>
    d.planned.every((p) => d.actual.includes(p)),
  ).length;
  const rate = done / withPlan.length;
  const pct = Math.round(rate * 100);
  const text =
    rate >= 0.8
      ? `最近 ${withPlan.length} 次计划完成了 ${done} 次（${pct}%），执行得很好。`
      : rate >= 0.5
        ? `最近 ${withPlan.length} 次计划完成了 ${done} 次（${pct}%），还行，但有提升空间。`
        : `最近 ${withPlan.length} 次计划只完成了 ${done} 次（${pct}%），计划可能定得太满了，不如订得少一点但做得到。`;
  return { planned: withPlan.length, done, rate, text };
}

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000,
  );
}

function shiftDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return todayIsoOf(d);
}

function todayIsoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
