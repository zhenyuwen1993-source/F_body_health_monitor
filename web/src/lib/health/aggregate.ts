// Daily aggregation of raw Apple Health records into per-day metrics.
//
// Ported from src/metrics/compute.py + dedup.py. Deviation from the Python
// original: we do NOT apply the hardcoded DATA_START_DATE cutoff (that constant
// was specific to one person's export); a multi-user product keeps all days.

import type { DailyMetrics, DaySamples, HealthRecord } from "./types";

// HK identifier -> friendly key
const TYPE_MAP: Record<string, string> = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "distance",
  HKQuantityTypeIdentifierFlightsClimbed: "flights",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active_energy",
  HKQuantityTypeIdentifierBasalEnergyBurned: "basal_energy",
  HKQuantityTypeIdentifierAppleExerciseTime: "exercise",
  HKCategoryTypeIdentifierAppleStandHour: "stand",
  HKQuantityTypeIdentifierHeartRate: "heart_rate",
  HKQuantityTypeIdentifierRestingHeartRate: "resting_hr",
  HKQuantityTypeIdentifierWalkingHeartRateAverage: "walking_hr",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv",
  HKQuantityTypeIdentifierOxygenSaturation: "spo2",
  HKCategoryTypeIdentifierSleepAnalysis: "sleep",
  HKQuantityTypeIdentifierBodyMass: "weight",
  HKQuantityTypeIdentifierBodyFatPercentage: "body_fat",
  HKCategoryTypeIdentifierMindfulSession: "mindful",
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: "wrist_temp",
  HKQuantityTypeIdentifierRespiratoryRate: "resp_rate",
  HKQuantityTypeIdentifierVO2Max: "vo2max",
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: "hr_recovery",
  HKQuantityTypeIdentifierTimeInDaylight: "daylight",
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: "environmental",
  HKQuantityTypeIdentifierPhysicalEffort: "physical_effort",
  HKQuantityTypeIdentifierDistanceCycling: "ride",
  HKQuantityTypeIdentifierDistanceSwimming: "swim",
  HKQuantityTypeIdentifierHeadphoneAudioExposure: "headphone",
  HKCategoryTypeIdentifierStateOfMind: "state_of_mind",
};

const CUMULATIVE = new Set([
  "steps",
  "distance",
  "flights",
  "active_energy",
  "basal_energy",
  "exercise",
  "daylight",
  "ride",
  "swim",
]);
const MEAN_KEYS = new Set([
  "heart_rate",
  "walking_hr",
  "hrv",
  "spo2",
  "headphone",
  "environmental",
  "wrist_temp",
  "resp_rate",
  "vo2max",
]);
const MAX_KEYS = new Set(["hr_recovery"]);
const MEDIAN_KEYS = new Set(["resting_hr", "weight", "body_fat"]);

function sourcePriority(name: string): number {
  const n = name.toLowerCase();
  if (/watch/.test(n)) return 100;
  if (/health|手动|manual/.test(n) && !/iphone|ipad/.test(n)) return 80;
  if (/iphone|ipad/.test(n)) return 50;
  return 20;
}

/** Pick the winning source total: highest priority, tie-break larger value. */
function pickPreferred(bySource: Map<string, number>): number | undefined {
  let best: number | undefined;
  let bestPri = -1;
  let bestVal = -Infinity;
  for (const [src, val] of bySource) {
    const pri = sourcePriority(src);
    if (pri > bestPri || (pri === bestPri && val > bestVal)) {
      bestPri = pri;
      bestVal = val;
      best = val;
    }
  }
  return best;
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}
export function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Sleep value classification
const isDeep = (v: string) => v.endsWith("AsleepDeep") || v === "4";
const isRem = (v: string) => v.endsWith("AsleepREM") || v === "5";
const isCore = (v: string) => v.endsWith("AsleepCore") || v === "3";
const isAsleep = (v: string) =>
  v.includes("Asleep") ||
  ["Asleep", "1", "3", "4", "5"].includes(v) ||
  isDeep(v) ||
  isRem(v) ||
  isCore(v);
const isInBed = (v: string) => v.endsWith("InBed") || v === "InBed";

interface DayAccum {
  cum: Map<string, Map<string, number>>; // metric -> source -> total
  means: Map<string, number[]>;
  medians: Map<string, number[]>;
  standBySrc: Map<string, number>;
  mindfulMin: number;
  moodScores: number[];
  // sleep, per source
  asleepSrc: Map<string, number>;
  deepSrc: Map<string, number>;
  remSrc: Map<string, number>;
  coreSrc: Map<string, number>;
  inBedSrc: Map<string, number>;
  bedStarts: Date[];
  wakeEnds: Date[];
}

function newAccum(): DayAccum {
  return {
    cum: new Map(),
    means: new Map(),
    medians: new Map(),
    standBySrc: new Map(),
    mindfulMin: 0,
    moodScores: [],
    asleepSrc: new Map(),
    deepSrc: new Map(),
    remSrc: new Map(),
    coreSrc: new Map(),
    inBedSrc: new Map(),
    bedStarts: [],
    wakeEnds: [],
  };
}

function addTo(m: Map<string, number>, key: string, v: number) {
  m.set(key, (m.get(key) ?? 0) + v);
}

const VALENCE: Record<string, number> = {
  VeryUnpleasant: 1,
  Unpleasant: 2,
  SlightlyUnpleasant: 2.5,
  Neutral: 3,
  SlightlyPleasant: 3.5,
  Pleasant: 4,
  VeryPleasant: 5,
};

function stateOfMindScore(rec: HealthRecord): number | undefined {
  const raw =
    rec.meta?.HKStateOfMindValence ?? rec.value ?? "";
  // valence keyword
  for (const [k, v] of Object.entries(VALENCE)) {
    if (raw.includes(k) || raw.toLowerCase().includes(k.toLowerCase())) return v;
  }
  const num = parseFloat(raw);
  if (!isNaN(num)) {
    if (num >= -1 && num <= 1) return Math.round(((num + 1) * 2 + 1) * 100) / 100;
    if (num >= 1 && num <= 5) return num;
  }
  return undefined;
}

/** Build sorted daily metrics from raw records, plus intraday HR/effort samples. */
export function aggregateDaily(records: HealthRecord[]): {
  daily: DailyMetrics[];
  samples: Map<string, DaySamples>;
} {
  const days = new Map<string, DayAccum>();
  const samples = new Map<string, DaySamples>();
  const sampleOf = (d: string) => {
    let x = samples.get(d);
    if (!x) samples.set(d, (x = { hr: [], pe: [] }));
    return x;
  };
  const get = (d: string) => {
    let a = days.get(d);
    if (!a) days.set(d, (a = newAccum()));
    return a;
  };

  for (const r of records) {
    const key = TYPE_MAP[r.type];
    if (!key) continue;
    const src = r.sourceName || "Unknown";
    const fval = parseFloat(r.value);

    if (key === "sleep") {
      const a = get(r.endDay); // wake-day attribution
      const h = hoursBetween(r.startDate, r.endDate);
      const v = r.value;
      if (isDeep(v)) {
        addTo(a.deepSrc, src, h);
        addTo(a.asleepSrc, src, h);
      } else if (isRem(v)) {
        addTo(a.remSrc, src, h);
        addTo(a.asleepSrc, src, h);
      } else if (isCore(v)) {
        addTo(a.coreSrc, src, h);
        addTo(a.asleepSrc, src, h);
      } else if (isAsleep(v)) {
        addTo(a.asleepSrc, src, h);
      } else if (isInBed(v)) {
        addTo(a.inBedSrc, src, h);
      }
      if (isAsleep(v)) {
        a.bedStarts.push(r.startDate);
        a.wakeEnds.push(r.endDate);
      }
      continue;
    }

    const a = get(r.startDay);

    if (key === "heart_rate" && !isNaN(fval)) {
      sampleOf(r.startDay).hr.push([r.startDate.getTime(), fval]);
    }
    if (key === "physical_effort") {
      if (!isNaN(fval)) sampleOf(r.startDay).pe.push([r.startDate.getTime(), fval]);
      continue; // intraday only; no daily column
    }

    if (key === "state_of_mind") {
      const s = stateOfMindScore(r);
      if (s != null) a.moodScores.push(s);
      continue;
    }
    if (key === "stand") {
      if (fval === 1 || r.value.endsWith("Stood") || r.value === "1")
        addTo(a.standBySrc, src, 1);
      continue;
    }
    if (key === "mindful") {
      a.mindfulMin += hoursBetween(r.startDate, r.endDate) * 60;
      continue;
    }
    if (isNaN(fval)) continue;

    let amount = fval;
    if (key === "distance" || key === "ride" || key === "swim")
      amount =
        r.unit === "m" || r.unit === "meter" || r.unit === "meters" || fval > 100
          ? fval / 1000
          : fval;
    if (key === "hrv") amount = fval < 10 ? fval * 1000 : fval;
    if (key === "spo2") amount = fval <= 1 ? fval * 100 : fval;
    if (key === "weight")
      amount = r.unit === "lb" || r.unit === "lbs" ? fval * 0.453592 : fval;
    if (key === "body_fat") amount = fval <= 1 ? fval * 100 : fval;
    if (key === "wrist_temp" && (r.unit === "degF" || fval > 45)) amount = ((fval - 32) * 5) / 9;

    if (MAX_KEYS.has(key)) {
      const arr = a.medians.get(key) ?? a.medians.set(key, []).get(key)!;
      arr.push(amount);
      continue;
    }
    if (CUMULATIVE.has(key)) {
      let bySrc = a.cum.get(key);
      if (!bySrc) a.cum.set(key, (bySrc = new Map()));
      addTo(bySrc, src, amount);
    } else if (MEAN_KEYS.has(key)) {
      (a.means.get(key) ?? a.means.set(key, []).get(key)!).push(amount);
    } else if (MEDIAN_KEYS.has(key)) {
      (a.medians.get(key) ?? a.medians.set(key, []).get(key)!).push(amount);
    }
  }

  const out: DailyMetrics[] = [];
  for (const [date, a] of days) {
    const d: DailyMetrics = { date };
    for (const [key, bySrc] of a.cum) {
      const v = pickPreferred(bySrc);
      if (v != null) (d as unknown as Record<string, number>)[remap(key)] = round(v, 2);
    }
    for (const [key, xs] of a.means) {
      const v = mean(xs);
      if (v != null) (d as unknown as Record<string, number>)[remap(key)] = round(v, 2);
    }
    for (const [key, xs] of a.medians) {
      const v = MAX_KEYS.has(key) ? Math.max(...xs) : median(xs);
      if (v != null && Number.isFinite(v))
        (d as unknown as Record<string, number>)[remap(key)] = round(v, 2);
    }
    const stand = pickPreferred(a.standBySrc);
    if (stand != null) d.stand = stand;
    if (a.mindfulMin > 0) d.mindful = round(a.mindfulMin, 1);
    if (a.moodScores.length) d.mood = round(mean(a.moodScores)!, 2);

    // sleep
    const asleep = pickPreferred(a.asleepSrc);
    const inBed = pickPreferred(a.inBedSrc);
    if (asleep != null) {
      d.sleep_asleep = round(asleep, 2);
      // stages from the winning source
      const winSrc = bestSource(a.asleepSrc);
      if (winSrc) {
        if (a.deepSrc.get(winSrc)) d.sleep_deep = round(a.deepSrc.get(winSrc)!, 2);
        if (a.remSrc.get(winSrc)) d.sleep_rem = round(a.remSrc.get(winSrc)!, 2);
        if (a.coreSrc.get(winSrc)) d.sleep_core = round(a.coreSrc.get(winSrc)!, 2);
      }
    }
    if (inBed != null) d.sleep_inbed = round(inBed, 2);
    if (a.bedStarts.length && a.wakeEnds.length) {
      const bed = new Date(Math.min(...a.bedStarts.map((x) => x.getTime())));
      const wake = new Date(Math.max(...a.wakeEnds.map((x) => x.getTime())));
      d.sleep_start = bed.toISOString();
      d.sleep_end = wake.toISOString();
    }
    out.push(d);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of samples.values()) {
    s.hr.sort((x, y) => x[0] - y[0]);
    s.pe.sort((x, y) => x[0] - y[0]);
  }
  return { daily: out, samples };
}

// mean/median metric keys map to their output column name
const REMAP: Record<string, string> = {
  daylight: "daylight_min",
  ride: "ride_km",
  swim: "swim_km",
  environmental: "environmental_db",
};
function remap(key: string): string {
  return REMAP[key] ?? key;
}

function bestSource(bySource: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestPri = -1;
  let bestVal = -Infinity;
  for (const [src, val] of bySource) {
    const pri = sourcePriority(src);
    if (pri > bestPri || (pri === bestPri && val > bestVal)) {
      bestPri = pri;
      bestVal = val;
      best = src;
    }
  }
  return best;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
