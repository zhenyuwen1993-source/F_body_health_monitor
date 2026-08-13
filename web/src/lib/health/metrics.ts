// Derived scores: training load, CTL/ATL/TSB, sleep consistency, baselines,
// recovery / readiness / strain, and mood inference.
// Ported from src/metrics/{training_load,readiness,triad,compute}.py.

import { minutesFromMidnight } from "./aggregate";
import type { Baselines, DailyMetrics, WorkoutRecord } from "./types";

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round = (v: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
function mean(xs: number[]): number | undefined {
  const f = xs.filter((x) => Number.isFinite(x));
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : undefined;
}
function median(xs: number[]): number | undefined {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- Training load -----------------------------------------------------------

const WORKOUT_FACTORS: [string, number][] = [
  ["running", 1.0],
  ["traditionalstrengthtraining", 0.85],
  ["functionalstrengthtraining", 0.85],
  ["tennis", 0.9],
  ["basketball", 0.9],
  ["soccer", 0.95],
  ["swimming", 0.95],
  ["cycling", 0.75],
  ["hiking", 0.7],
  ["walking", 0.4],
  ["yoga", 0.35],
  ["mindandbody", 0.3],
  ["cooldown", 0.55],
];

function workoutFactor(activity: string): number {
  const a = activity.toLowerCase();
  for (const [k, f] of WORKOUT_FACTORS) if (a.includes(k)) return f;
  return 0.6;
}

/** Per-day training load and workout roll-up from workouts. */
function dailyLoad(workouts: WorkoutRecord[]): Map<
  string,
  { load: number; minutes: number; count: number }
> {
  const m = new Map<string, { load: number; minutes: number; count: number }>();
  for (const w of workouts) {
    const day = isoDay(w.startDate);
    const cur = m.get(day) ?? { load: 0, minutes: 0, count: 0 };
    cur.load += w.durationMin * workoutFactor(w.activityType);
    cur.minutes += w.durationMin;
    cur.count += 1;
    m.set(day, cur);
  }
  return m;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** EMA series seeded on values[0], smoothing the first element too. */
function emaSeries(values: number[], tau: number): number[] {
  const alpha = 1 - Math.exp(-1 / tau);
  const out: number[] = [];
  let prev = values.length ? values[0] : 0;
  for (const v of values) {
    prev += alpha * (v - prev);
    out.push(prev);
  }
  return out;
}

// --- Sleep consistency (circular stats) --------------------------------------

function circularMean(vals: number[], period = 1440): number | undefined {
  let s = 0;
  let c = 0;
  for (const v of vals) {
    s += Math.sin((2 * Math.PI * v) / period);
    c += Math.cos((2 * Math.PI * v) / period);
  }
  if (s === 0 && c === 0) return undefined;
  let ang = Math.atan2(s, c);
  if (ang < 0) ang += 2 * Math.PI;
  return (ang / (2 * Math.PI)) * period;
}

function circularStd(vals: number[], period = 1440): number | undefined {
  const m = circularMean(vals, period);
  if (m == null) return undefined;
  const half = period / 2;
  let sq = 0;
  for (const v of vals) {
    let dev = v - m;
    while (dev > half) dev -= period;
    while (dev < -half) dev += period;
    sq += dev * dev;
  }
  return Math.sqrt(sq / vals.length);
}

function sleepConsistencyScore(
  bedStd?: number,
  wakeStd?: number,
): number | undefined {
  const parts = [bedStd, wakeStd].filter((x): x is number => x != null);
  if (!parts.length) return undefined;
  const std = mean(parts)!;
  return clamp(100 * (1 - (std - 20) / 100));
}

// --- Generic baseline scorer -------------------------------------------------

function scoreFromBaseline(
  value: number | undefined,
  baseline: number | undefined,
  higherBetter: boolean,
): number | undefined {
  if (value == null || baseline == null || baseline === 0) return undefined;
  const ratio = higherBetter ? value / baseline : baseline / value;
  return clamp(50 + (ratio - 1) * 100);
}

// --- Main enrichment ---------------------------------------------------------

export function enrich(
  daily: DailyMetrics[],
  workouts: WorkoutRecord[],
): { daily: DailyMetrics[]; baselines: Baselines } {
  if (!daily.length) return { daily, baselines: {} };
  const loadByDay = dailyLoad(workouts);

  // training load per day
  const loads = daily.map((d) => {
    const w = loadByDay.get(d.date);
    return w ? w.load : 0;
  });
  const ctl = emaSeries(loads, 42);
  const atl = emaSeries(loads, 7);
  const tsb = ctl.map((c, i) => round(c - atl[i], 2));

  // sleep bedtime/wake minutes for consistency
  const bedMin = daily.map((d) =>
    d.sleep_start ? minutesFromMidnight(new Date(d.sleep_start)) : null,
  );
  const wakeMin = daily.map((d) =>
    d.sleep_end ? minutesFromMidnight(new Date(d.sleep_end)) : null,
  );
  const consistency: (number | undefined)[] = daily.map((_, i) => {
    const bw: number[] = [];
    const ww: number[] = [];
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      if (bedMin[j] != null) bw.push(bedMin[j]!);
      if (wakeMin[j] != null) ww.push(wakeMin[j]!);
    }
    const bedStd = bw.length >= 3 ? circularStd(bw) : undefined;
    const wakeStd = ww.length >= 3 ? circularStd(ww) : undefined;
    return sleepConsistencyScore(bedStd, wakeStd);
  });

  // global baselines: median over all days
  const base = {
    sleep: median(daily.map((d) => d.sleep_asleep ?? d.sleep_inbed).filter(nn)),
    hrv: median(daily.map((d) => d.hrv).filter(nn)),
    rhr: median(daily.map((d) => d.resting_hr).filter(nn)),
    steps: median(daily.map((d) => d.steps).filter(nn)),
    active: median(daily.map((d) => d.active_energy).filter(nn)),
    exercise: median(daily.map((d) => d.exercise).filter(nn)),
  };

  daily.forEach((d, i) => {
    const load = loads[i];
    d.strain = round(clamp(load / 8 + (d.steps ?? 0) / 2500, 0, 21), 1);

    const sleepH = d.sleep_asleep ?? d.sleep_inbed;
    let sleepScore = scoreFromBaseline(sleepH, base.sleep, true);
    if (sleepH != null) {
      if (sleepH >= 7 && sleepH <= 9) sleepScore = Math.max(sleepScore ?? 0, 80);
      else if (sleepH < 5 || sleepH > 11) sleepScore = Math.min(sleepScore ?? 50, 40);
    }
    const cons = consistency[i];
    if (cons != null && sleepScore != null) sleepScore = 0.7 * sleepScore + 0.3 * cons;
    else if (cons != null) sleepScore = cons;

    const hrvScore = scoreFromBaseline(d.hrv, base.hrv, true);
    const rhrScore = scoreFromBaseline(d.resting_hr, base.rhr, false);
    const tsbScore = clamp(55 + tsb[i]);

    const recovery = mean(
      [hrvScore, rhrScore, sleepScore, tsbScore].filter(nn) as number[],
    );
    const activity = mean(
      [
        scoreFromBaseline(d.steps, base.steps, true),
        scoreFromBaseline(d.active_energy, base.active, true),
        scoreFromBaseline(d.exercise, base.exercise, true),
      ].filter(nn) as number[],
    );

    // readiness (weighted) — sleep, hrv, load, recovery-time, stress, rhr
    const factors: { score?: number; w: number }[] = [];
    const hrvBase = base.hrv;
    const hrvFactor =
      d.hrv != null && hrvBase ? clamp(50 + (d.hrv / hrvBase - 0.9) * 200) : undefined;
    const loadFactor = clamp(55 + tsb[i] * 1.2);
    const recentLoads = loads.slice(Math.max(0, i - 2), i + 1);
    const intens = Math.max(0, ...recentLoads);
    let recH = Math.max(0, (intens - 40) / 8);
    if (tsb[i] < -10) recH += Math.abs(tsb[i]) / 4;
    if (load >= 60) recH = Math.max(recH, load / 12);
    recH = Math.min(72, recH);
    const recFactor = clamp(100 - recH * 2.5);
    const rhrFactor =
      d.resting_hr != null && base.rhr
        ? clamp(70 - (d.resting_hr / base.rhr - 1) * 300)
        : undefined;
    let stress = cons;
    if (rhrFactor != null && stress != null) stress = mean([stress, rhrFactor]);
    else if (rhrFactor != null) stress = rhrFactor;

    factors.push({ score: sleepScore, w: 0.28 });
    factors.push({ score: hrvFactor, w: 0.22 });
    factors.push({ score: loadFactor, w: 0.18 });
    factors.push({ score: recFactor, w: 0.14 });
    factors.push({ score: stress, w: 0.1 });
    factors.push({ score: rhrFactor, w: 0.08 });
    let wsum = 0;
    let acc = 0;
    for (const f of factors)
      if (f.score != null && Number.isFinite(f.score)) {
        acc += f.score * f.w;
        wsum += f.w;
      }
    const readiness = wsum > 0 ? round(acc / wsum, 0) : undefined;

    d.readiness = readiness;
    d.recovery = recovery != null ? round(recovery, 0) : undefined;

    // mood inference when none explicit
    if (d.mood == null && recovery != null && activity != null) {
      const blend = 0.6 * recovery + 0.4 * activity;
      d.mood = round(1 + (blend / 100) * 4, 2);
    }

    d.training_load = round(load, 1);
    d.ctl = round(ctl[i], 1);
    d.atl = round(atl[i], 1);
    d.tsb = tsb[i];
    d.sleep_consistency = cons != null ? round(cons, 1) : undefined;
  });

  return { daily, baselines: base };
}

function nn<T>(x: T | undefined | null): x is T {
  return x != null && Number.isFinite(x as unknown as number);
}
