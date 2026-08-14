// Core data types for parsed Apple Health data and derived metrics.

/** A single Apple Health <Record> element, normalized. */
export interface HealthRecord {
  type: string; // HKQuantityTypeIdentifier... / HKCategoryTypeIdentifier...
  sourceName: string;
  unit?: string;
  value: string; // raw value (numeric string or HKCategoryValue...)
  startDate: Date;
  endDate: Date;
  startDay: string; // YYYY-MM-DD in the record's own local offset (start)
  endDay: string; // YYYY-MM-DD in the record's own local offset (end)
  /** Extra metadata harvested from child <MetadataEntry> elements. */
  meta?: Record<string, string>;
}

/** A single Apple Health <Workout> element, normalized. */
export interface WorkoutRecord {
  activityType: string; // without the HKWorkoutActivityType prefix
  durationMin: number;
  totalDistanceKm?: number;
  totalEnergyKcal?: number;
  sourceName: string;
  startDate: Date;
  endDate: Date;
  // From <WorkoutStatistics> children, when the watch recorded them.
  hrAvg?: number;
  hrMin?: number;
  hrMax?: number;
  // From <MetadataEntry> children.
  mets?: number;
  elevationM?: number;
  indoor?: boolean;
}

/** Friendly metric keys we track. */
export type MetricKey =
  | "steps"
  | "distance"
  | "flights"
  | "active_energy"
  | "basal_energy"
  | "exercise"
  | "stand"
  | "heart_rate"
  | "resting_hr"
  | "walking_hr"
  | "hrv"
  | "spo2"
  | "weight"
  | "body_fat"
  | "mindful"
  | "headphone";

/** One day's aggregated metrics plus derived scores. */
export interface DailyMetrics {
  date: string; // YYYY-MM-DD (local day)
  steps?: number;
  distance?: number; // km
  flights?: number;
  active_energy?: number; // kcal
  basal_energy?: number; // kcal
  exercise?: number; // min
  stand?: number; // hours stood
  heart_rate?: number; // mean bpm
  resting_hr?: number; // bpm
  walking_hr?: number; // bpm
  hrv?: number; // ms
  spo2?: number; // percent (0-100)
  weight?: number; // kg
  body_fat?: number; // percent
  mindful?: number; // minutes
  wrist_temp?: number; // °C, sleeping wrist temperature (relative signal)
  resp_rate?: number; // breaths/min during sleep
  vo2max?: number; // ml/kg/min, Apple cardio fitness
  hr_recovery?: number; // bpm drop one minute after exercise
  daylight_min?: number; // minutes of daylight exposure
  ride_km?: number; // cycling distance
  swim_km?: number; // swimming distance
  // sleep (in hours)
  sleep_asleep?: number;
  sleep_inbed?: number;
  sleep_deep?: number;
  sleep_rem?: number;
  sleep_core?: number;
  sleep_awake?: number;
  sleep_start?: string; // ISO of sleep onset
  sleep_end?: string; // ISO of wake
  // mood
  mood?: number; // -1..1 valence
  // derived
  readiness?: number; // 0-100 weighted training readiness
  recovery?: number; // 0-100 recovery score
  strain?: number; // 0-21 (WHOOP-style day strain)
  sleep_consistency?: number; // 0-100
  training_load?: number; // per-day load
  ctl?: number; // chronic training load (fitness)
  atl?: number; // acute training load (fatigue)
  tsb?: number; // training stress balance (form)
}

/** Personal baselines (medians over the whole history) used for comparisons. */
export interface Baselines {
  sleep?: number;
  hrv?: number;
  rhr?: number;
  steps?: number;
  active?: number;
  exercise?: number;
}

/** Intraday samples kept aside for TRIMP-style strain. */
export interface DaySamples {
  /** heart-rate samples as [epochMs, bpm], sorted by time */
  hr: [number, number][];
  /** physical-effort samples as [epochMs, METs] */
  pe: [number, number][];
}

/** The full parsed dataset, ready for the dashboard. */
export interface HealthDataset {
  daily: DailyMetrics[]; // sorted ascending by date
  workouts: WorkoutRecord[];
  recordCount: number;
  workoutCount: number;
  dateRange: { start: string; end: string } | null;
  baselines: Baselines;
  birthYear?: number;
  sex?: string;
}
