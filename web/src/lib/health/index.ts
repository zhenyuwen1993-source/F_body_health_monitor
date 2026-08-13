// Public entry point: turn an Apple Health export into a ready-to-render
// dataset. Accepts either the raw export.xml or the export.zip straight from
// the Health app.

import { aggregateDaily } from "./aggregate";
import { enrich } from "./metrics";
import { parseHealthXmlStream, type ParseProgress, type ParseResult } from "./parse";
import type { HealthDataset } from "./types";
import { listZipEntries, openZipEntry, pickHealthXml } from "./zip";

export type { HealthDataset } from "./types";
export type { DailyMetrics, WorkoutRecord } from "./types";
export type { ParseProgress } from "./parse";
export { buildContext } from "./context";

function isZip(file: Blob & { name?: string }): boolean {
  return (file.name ?? "").toLowerCase().endsWith(".zip");
}

export async function buildDataset(
  file: Blob & { name?: string },
  onProgress?: (p: ParseProgress) => void,
): Promise<HealthDataset> {
  let parsed: ParseResult;

  if (isZip(file)) {
    const entries = await listZipEntries(file);
    const entry = pickHealthXml(entries);
    if (!entry) {
      throw new Error(
        "这个 zip 里没找到 export.xml。请确认是健康 App 导出的「导出.zip」。",
      );
    }
    const stream = await openZipEntry(file, entry);
    parsed = await parseHealthXmlStream(stream, entry.uncompressedSize, onProgress);
  } else {
    parsed = await parseHealthXmlStream(
      file.stream() as ReadableStream<Uint8Array>,
      file.size || 0,
      onProgress,
    );
  }

  const { daily, baselines } = enrich(aggregateDaily(parsed.records), parsed.workouts);
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
    baselines,
    birthYear: parsed.birthYear,
    sex: parsed.sex,
  };
}
