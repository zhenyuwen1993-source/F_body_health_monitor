// Derived scores: training load, CTL/ATL/TSB, sleep consistency, baselines,
// recovery / readiness / strain, and mood inference.
// Ported from src/metrics/{training_load,readiness,triad,compute}.py.

import { minutesFromMidnight } from "./aggregate";
import type { Baselines, DailyMetrics, DaySamples, WorkoutRecord } from "./types";

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

// --- WHOOP-style strain from intraday heart rate (Banister TRIMP) ------------
// Ported from the original Python triad module: per-segment TRIMP over the
// day's HR samples, blended with a METs-based effort load, on a 0-21 log scale.

function trimpToStrain(trimp: number, scale: number): number {
  return round(21 * (1 - Math.exp(-Math.max(0, trimp) / scale)), 2);
}

function banisterSegment(dtMin: number, hr: number, rhr: number, hrMax: number): number {
  if (hrMax <= rhr || dtMin <= 0) return 0;
  const hrr = Math.min(1, Math.max(0, (hr - rhr) / (hrMax - rhr)));
  return dtMin * hrr * 0.64 * Math.exp(1.92 * hrr);
}

function strainFromHr(samples: [number, number][], rhr: number, hrMax: number): number | undefined {
  if (samples.length < 5) return undefined;
  let trimp = 0;
  for (let i = 1; i < samples.length; i++) {
    let dt = (samples[i][0] - samples[i - 1][0]) / 60_000;
    if (dt > 30) continue; // gap — watch off the wrist
    if (dt > 10) dt = 10;
    trimp += banisterSegment(dt, samples[i - 1][1], rhr, hrMax);
  }
  return trimpToStrain(trimp, 180);
}

function strainFromEffort(samples: [number, number][]): number | undefined {
  if (samples.length < 5) return undefined;
  let load = 0;
  for (let i = 1; i < samples.length; i++) {
    let dt = (samples[i][0] - samples[i - 1][0]) / 60_000;
    const mets = samples[i - 1][1];
    if (mets < 3 || dt <= 0 || dt > 20) continue;
    if (dt > 5) dt = 5;
    load += (mets - 1.5) * dt * 0.35;
  }
  return trimpToStrain(load, 260);
}

/** hr_max: observed day maximum if credible, else age formula, else 190. */
function estimateHrMax(observedMax: number | undefined, birthYear?: number): number {
  if (observedMax != null && observedMax > 140) return Math.max(observedMax, 160);
  if (birthYear) {
    const age = new Date().getFullYear() - birthYear;
    if (age >= 10 && age <= 90) return 220 - age;
  }
  return 190;
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
  samples?: Map<string, DaySamples>,
  birthYear?: number,
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

  // One hr-max for the whole dataset, from the highest credible sample.
  let observedMax: number | undefined;
  if (samples) {
    for (const s of samples.values())
      for (const [, v] of s.hr) if (observedMax == null || v > observedMax) observedMax = v;
  }
  const hrMax = estimateHrMax(observedMax, birthYear);

  daily.forEach((d, i) => {
    const load = loads[i];

    // Strain: real TRIMP when the day has heart-rate samples; METs effort as
    // a secondary signal; the old steps proxy only when neither exists.
    const day = samples?.get(d.date);
    const rhr = d.resting_hr ?? base.rhr ?? 60;
    const sHr = day ? strainFromHr(day.hr, rhr, hrMax) : undefined;
    const sPe = day ? strainFromEffort(day.pe) : undefined;
    if (sHr != null && day) {
      const w = day.hr.length >= 80 ? 0.92 : 0.8;
      d.strain = round(sPe != null ? w * sHr + (1 - w) * sPe : sHr, 1);
    } else if (sPe != null && sPe > 0) {
      d.strain = round(sPe, 1);
    } else if (load > 0) {
      d.strain = trimpToStrain(load * 1.2, 160);
    } else {
      d.strain = round(clamp(load / 8 + (d.steps ?? 0) / 2500, 0, 21), 1);
    }

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
