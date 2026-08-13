// Streaming parser for Apple Health `export.xml`.
//
// Apple's export.xml can be hundreds of MB, so we never build a DOM. We stream
// the file, decode it chunk-by-chunk, and tokenize `<Record>`, `<Workout>`,
// `<MetadataEntry>` and `<Me>` tags with a tiny quote-aware scanner that works
// across chunk boundaries.

import type { HealthRecord, WorkoutRecord } from "./types";

export interface ParseResult {
  records: HealthRecord[];
  workouts: WorkoutRecord[];
  birthYear?: number;
  sex?: string;
}

export interface ParseProgress {
  bytesRead: number;
  totalBytes: number;
  records: number;
  workouts: number;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  isClose: boolean;
  selfClose: boolean;
}

const ATTR_RE = /([:\w-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) out[m[1]] = m[2];
  return out;
}

function appleDate(s: string | undefined): Date | null {
  if (!s) return null;
  // "2026-08-02 08:00:00 +0800" -> ISO "2026-08-02T08:00:00+08:00"
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/,
  );
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}:${m[8]}`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Pull complete `<...>` tags out of `buf`. Returns the tags found plus the
 * unconsumed tail (a partial tag awaiting more input). Quote-aware so `>`
 * inside an attribute value never terminates a tag early.
 */
function drainTags(buf: string): { tags: Tag[]; rest: string } {
  const tags: Tag[] = [];
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const lt = buf.indexOf("<", i);
    if (lt === -1) {
      i = n;
      break;
    }
    // Find the matching '>' honoring quotes.
    let j = lt + 1;
    let inQuote = false;
    let gt = -1;
    for (; j < n; j++) {
      const c = buf[j];
      if (c === '"') inQuote = !inQuote;
      else if (c === ">" && !inQuote) {
        gt = j;
        break;
      }
    }
    if (gt === -1) {
      // Incomplete tag — keep from `lt` for next round.
      i = lt;
      break;
    }
    const raw = buf.slice(lt + 1, gt).trim();
    i = gt + 1;
    // Skip comments / doctype / xml declaration / CDATA.
    if (raw.startsWith("!") || raw.startsWith("?")) continue;

    const isClose = raw.startsWith("/");
    const selfClose = raw.endsWith("/");
    const body = raw.replace(/^\//, "").replace(/\/$/, "").trim();
    const sp = body.search(/\s/);
    const name = sp === -1 ? body : body.slice(0, sp);
    const attrs = sp === -1 ? {} : parseAttrs(body.slice(sp + 1));
    tags.push({ name, attrs, isClose, selfClose });
  }
  return { tags, rest: buf.slice(i) };
}

/** Parse a File/Blob of export.xml, streaming, with optional progress callback. */
export async function parseHealthXml(
  file: Blob,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseResult> {
  return parseHealthXmlStream(
    file.stream() as ReadableStream<Uint8Array>,
    file.size || 0,
    onProgress,
  );
}

/**
 * Parse export.xml from a byte stream. `totalBytes` is only used to report
 * progress; pass 0 when the length isn't known.
 */
export async function parseHealthXmlStream(
  stream: ReadableStream<Uint8Array>,
  totalBytes = 0,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseResult> {
  const records: HealthRecord[] = [];
  const workouts: WorkoutRecord[] = [];
  let birthYear: number | undefined;
  let sex: string | undefined;

  // Assembly state for the currently-open <Record> / <Workout>, so their child
  // <MetadataEntry> / <WorkoutStatistics> elements attach to the right parent.
  let openRecord: HealthRecord | null = null;
  let openWorkout: WorkoutRecord | null = null;

  const emitRecordTag = (t: Tag) => {
    const a = t.attrs;
    const start = appleDate(a.startDate);
    const end = appleDate(a.endDate) ?? start;
    if (!a.type || !start) return null;
    const rec: HealthRecord = {
      type: a.type,
      sourceName: a.sourceName ?? "",
      unit: a.unit,
      value: a.value ?? "",
      startDate: start,
      endDate: end ?? start,
      startDay: a.startDate.slice(0, 10),
      endDay: (a.endDate ?? a.startDate).slice(0, 10),
    };
    records.push(rec);
    return rec;
  };

  const handleTag = (t: Tag) => {
    if (t.name === "Record") {
      if (t.isClose) {
        openRecord = null;
        return;
      }
      const rec = emitRecordTag(t);
      openRecord = t.selfClose ? null : rec;
    } else if (t.name === "MetadataEntry") {
      if (openRecord && t.attrs.key) {
        (openRecord.meta ??= {})[t.attrs.key] = t.attrs.value ?? "";
      } else if (openWorkout && t.attrs.key) {
        applyWorkoutMeta(openWorkout, t.attrs.key, t.attrs.value ?? "");
      }
    } else if (t.name === "WorkoutStatistics") {
      if (openWorkout) applyWorkoutStat(openWorkout, t.attrs);
    } else if (t.name === "Workout") {
      if (t.isClose) {
        openWorkout = null;
        return;
      }
      const a = t.attrs;
      const start = appleDate(a.startDate);
      const end = appleDate(a.endDate) ?? start;
      if (start) {
        const w: WorkoutRecord = {
          activityType: (a.workoutActivityType ?? "").replace(
            "HKWorkoutActivityType",
            "",
          ),
          durationMin: durationToMin(num(a.duration) ?? 0, a.durationUnit),
          totalDistanceKm: distanceToKm(num(a.totalDistance), a.totalDistanceUnit),
          totalEnergyKcal: num(a.totalEnergyBurned),
          sourceName: a.sourceName ?? "",
          startDate: start,
          endDate: end ?? start,
        };
        workouts.push(w);
        openWorkout = t.selfClose ? null : w;
      }
    } else if (t.name === "Me") {
      const dob = t.attrs.HKCharacteristicTypeIdentifierDateOfBirth;
      if (dob) {
        const y = parseInt(dob.slice(0, 4), 10);
        if (!isNaN(y)) birthYear = y;
      }
      sex = (t.attrs.HKCharacteristicTypeIdentifierBiologicalSex ?? "").replace(
        "HKBiologicalSex",
        "",
      );
    }
  };

  const total = totalBytes;
  let bytesRead = 0;
  let buffer = "";
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let sinceProgress = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const { tags, rest } = drainTags(buffer);
    buffer = rest;
    for (const t of tags) handleTag(t);
    sinceProgress += value.byteLength;
    if (onProgress && sinceProgress > 4_000_000) {
      sinceProgress = 0;
      onProgress({
        bytesRead,
        totalBytes: total,
        records: records.length,
        workouts: workouts.length,
      });
    }
  }
  buffer += decoder.decode();
  const { tags } = drainTags(buffer);
  for (const t of tags) handleTag(t);

  onProgress?.({
    bytesRead,
    totalBytes: total,
    records: records.length,
    workouts: workouts.length,
  });

  return { records, workouts, birthYear, sex };
}

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const v = parseFloat(s);
  return isNaN(v) ? undefined : v;
}

function durationToMin(value: number, unit: string | undefined): number {
  const u = (unit ?? "min").toLowerCase();
  if (u.startsWith("sec") || u === "s") return value / 60;
  if (u.startsWith("hr") || u === "h" || u.startsWith("hour")) return value * 60;
  return value;
}

function distanceToKm(
  value: number | undefined,
  unit: string | undefined,
): number | undefined {
  if (value == null) return undefined;
  const u = (unit ?? "km").toLowerCase();
  if (u === "m" || u.startsWith("meter")) return value / 1000;
  if (u === "mi" || u.startsWith("mile")) return value * 1.609344;
  return value;
}

/** `<WorkoutStatistics type=... average=... minimum=... maximum=... sum=...>` */
function applyWorkoutStat(w: WorkoutRecord, a: Record<string, string>) {
  const type = a.type ?? "";
  if (type.endsWith("HeartRate")) {
    w.hrAvg = num(a.average) ?? w.hrAvg;
    w.hrMin = num(a.minimum) ?? w.hrMin;
    w.hrMax = num(a.maximum) ?? w.hrMax;
  } else if (type.endsWith("ActiveEnergyBurned")) {
    w.totalEnergyKcal = num(a.sum) ?? w.totalEnergyKcal;
  } else if (type.includes("Distance")) {
    const km = distanceToKm(num(a.sum), a.unit);
    if (km != null) w.totalDistanceKm = km;
  }
}

function applyWorkoutMeta(w: WorkoutRecord, key: string, value: string) {
  if (key === "HKAverageMETs") {
    const m = value.match(/[\d.]+/);
    if (m) w.mets = parseFloat(m[0]);
  } else if (key === "HKElevationAscended") {
    // Apple stores this in centimetres, e.g. "5300 cm".
    const m = value.match(/[\d.]+/);
    if (m) w.elevationM = parseFloat(m[0]) / 100;
  } else if (key === "HKIndoorWorkout") {
    w.indoor = value === "1";
  }
}
