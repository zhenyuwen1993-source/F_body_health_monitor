// Public entry point: turn an export.xml File into a ready-to-render dataset.

import { aggregateDaily } from "./aggregate";
import { enrich } from "./metrics";
import { parseHealthXml, type ParseProgress } from "./parse";
import type { HealthDataset } from "./types";

export type { HealthDataset } from "./types";
export type { DailyMetrics, WorkoutRecord } from "./types";
export type { ParseProgress } from "./parse";
export { buildContext } from "./context";

export async function buildDataset(
  file: Blob,
  onProgress?: (p: ParseProgress) => void,
): Promise<HealthDataset> {
  const parsed = await parseHealthXml(file, onProgress);
  const daily = enrich(aggregateDaily(parsed.records), parsed.workouts);
  const dateRange =
    daily.length > 0
      ? { start: daily[0].date, end: daily[daily.length - 1].date }
      : null;
  return {
    daily,
    workouts: parsed.workouts,
    recordCount: parsed.records.length,
    workoutCount: parsed.workouts.length,
    dateRange,
    birthYear: parsed.birthYear,
    sex: parsed.sex,
  };
}
