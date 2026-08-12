"""Daily metrics aggregation, baselines, mood inference, load & sleep consistency."""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any

from src.config import DB_PATH, DATA_START_DATE
from src.ingest.parse_export import init_db
from src.metrics.dedup import CUMULATIVE_KEYS, pick_preferred_total
from src.metrics.training_load import (
    attach_sleep_consistency,
    attach_training_load,
    daily_training_load,
    minutes_from_midnight,
)

TYPE_MAP = {
    "steps": "HKQuantityTypeIdentifierStepCount",
    "distance": "HKQuantityTypeIdentifierDistanceWalkingRunning",
    "flights": "HKQuantityTypeIdentifierFlightsClimbed",
    "active_energy": "HKQuantityTypeIdentifierActiveEnergyBurned",
    "basal_energy": "HKQuantityTypeIdentifierBasalEnergyBurned",
    "exercise": "HKQuantityTypeIdentifierAppleExerciseTime",
    "stand": "HKCategoryTypeIdentifierAppleStandHour",
    "stand_time": "HKQuantityTypeIdentifierAppleStandTime",
    "heart_rate": "HKQuantityTypeIdentifierHeartRate",
    "resting_hr": "HKQuantityTypeIdentifierRestingHeartRate",
    "walking_hr": "HKQuantityTypeIdentifierWalkingHeartRateAverage",
    "hrv": "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    "spo2": "HKQuantityTypeIdentifierOxygenSaturation",
    "sleep": "HKCategoryTypeIdentifierSleepAnalysis",
    "weight": "HKQuantityTypeIdentifierBodyMass",
    "body_fat": "HKQuantityTypeIdentifierBodyFatPercentage",
    "mindful": "HKCategoryTypeIdentifierMindfulSession",
    "headphone": "HKQuantityTypeIdentifierHeadphoneAudioExposure",
    "environmental": "HKQuantityTypeIdentifierEnvironmentalAudioExposure",
    "state_of_mind": "HKCategoryTypeIdentifierStateOfMind",
}

SLEEP_ASLEEP = {
    "HKCategoryValueSleepAnalysisAsleep",
    "HKCategoryValueSleepAnalysisAsleepUnspecified",
    "HKCategoryValueSleepAnalysisAsleepCore",
    "HKCategoryValueSleepAnalysisAsleepDeep",
    "HKCategoryValueSleepAnalysisAsleepREM",
    "Asleep",
    "1",
    "3",
    "4",
    "5",
}
SLEEP_IN_BED = {"HKCategoryValueSleepAnalysisInBed", "InBed"}
SLEEP_DEEP = {"HKCategoryValueSleepAnalysisAsleepDeep", "4"}
SLEEP_REM = {"HKCategoryValueSleepAnalysisAsleepREM", "5"}
SLEEP_CORE = {"HKCategoryValueSleepAnalysisAsleepCore", "3"}

DATE_RE = re.compile(
    r"(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})\s+(?P<H>\d{2}):(?P<M>\d{2}):(?P<S>\d{2})"
)


def parse_apple_date(s: str | None) -> datetime | None:
    if not s:
        return None
    m = DATE_RE.search(s)
    if not m:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return datetime(
        int(m["y"]), int(m["m"]), int(m["d"]), int(m["H"]), int(m["M"]), int(m["S"])
    )


def day_key(dt: datetime) -> str:
    return dt.date().isoformat()


def _to_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _hours_between(start: datetime | None, end: datetime | None) -> float:
    if not start or not end:
        return 0.0
    return max(0.0, (end - start).total_seconds() / 3600.0)


def _is_asleep(sval: str) -> bool:
    return (
        sval in SLEEP_ASLEEP
        or sval in SLEEP_DEEP
        or sval in SLEEP_REM
        or sval in SLEEP_CORE
        or "Asleep" in sval
    )


@dataclass
class DayBucket:
    # cumulative: metric -> source -> sum
    cum: dict[str, dict[str, float]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(float)))
    stand_by_source: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    hrs: list[float] = field(default_factory=list)
    resting_hrs: list[float] = field(default_factory=list)
    walking_hrs: list[float] = field(default_factory=list)
    hrvs: list[float] = field(default_factory=list)
    spo2s: list[float] = field(default_factory=list)
    # sleep by source
    sleep_asleep_src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sleep_deep_src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sleep_rem_src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sleep_core_src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sleep_in_bed_src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sleep_bed_starts: list[datetime] = field(default_factory=list)
    sleep_wake_ends: list[datetime] = field(default_factory=list)
    weights: list[float] = field(default_factory=list)
    body_fats: list[float] = field(default_factory=list)
    mindful_min: float = 0.0
    headphone_dbs: list[float] = field(default_factory=list)
    env_dbs: list[float] = field(default_factory=list)
    mood_scores: list[float] = field(default_factory=list)
    mood_labels: list[str] = field(default_factory=list)


def _state_of_mind_score(value: str | None, metadata_json: str | None) -> tuple[float | None, str | None]:
    labels = None
    valence = None
    if metadata_json:
        try:
            meta = json.loads(metadata_json)
            labels = meta.get("HKStateOfMindLabels") or meta.get("attrs", {}).get("HKStateOfMindLabels")
            valence = meta.get("HKStateOfMindValence") or meta.get("attrs", {}).get("HKStateOfMindValence")
        except json.JSONDecodeError:
            pass

    v = (value or valence or "").strip()
    mapping = {
        "HKCategoryValueStateOfMindValenceVeryUnpleasant": 1.0,
        "HKCategoryValueStateOfMindValenceUnpleasant": 2.0,
        "HKCategoryValueStateOfMindValenceSlightlyUnpleasant": 2.5,
        "HKCategoryValueStateOfMindValenceNeutral": 3.0,
        "HKCategoryValueStateOfMindValenceSlightlyPleasant": 3.5,
        "HKCategoryValueStateOfMindValencePleasant": 4.0,
        "HKCategoryValueStateOfMindValenceVeryPleasant": 5.0,
        "veryUnpleasant": 1.0,
        "unpleasant": 2.0,
        "slightlyUnpleasant": 2.5,
        "neutral": 3.0,
        "slightlyPleasant": 3.5,
        "pleasant": 4.0,
        "veryPleasant": 5.0,
    }
    if v in mapping:
        return mapping[v], labels if isinstance(labels, str) else None
    num = _to_float(v)
    if num is not None:
        if -1.0 <= num <= 1.0:
            return round((num + 1.0) * 2.0 + 1.0, 2), labels if isinstance(labels, str) else None
        if 1.0 <= num <= 5.0:
            return num, labels if isinstance(labels, str) else None
    return None, labels if isinstance(labels, str) else None


def _score_from_baseline(value: float | None, baseline: float | None, *, higher_better: bool) -> float | None:
    if value is None or baseline is None or baseline == 0:
        return None
    ratio = value / baseline
    if not higher_better:
        ratio = baseline / value if value else 0
    score = 50 + (ratio - 1.0) * 100
    return max(0.0, min(100.0, score))


def _add_sleep(bucket: DayBucket, src: str, sval: str, hours: float, start: datetime, end: datetime) -> None:
    if sval in SLEEP_DEEP or sval.endswith("AsleepDeep"):
        bucket.sleep_deep_src[src] += hours
        bucket.sleep_asleep_src[src] += hours
    elif sval in SLEEP_REM or sval.endswith("AsleepREM"):
        bucket.sleep_rem_src[src] += hours
        bucket.sleep_asleep_src[src] += hours
    elif sval in SLEEP_CORE or sval.endswith("AsleepCore"):
        bucket.sleep_core_src[src] += hours
        bucket.sleep_asleep_src[src] += hours
    elif sval in SLEEP_ASLEEP or "Asleep" in sval:
        bucket.sleep_asleep_src[src] += hours
    elif sval in SLEEP_IN_BED or sval.endswith("InBed"):
        bucket.sleep_in_bed_src[src] += hours
    if _is_asleep(sval):
        bucket.sleep_bed_starts.append(start)
        bucket.sleep_wake_ends.append(end)


def compute_daily_metrics(db_path: Path = DB_PATH) -> int:
    conn = init_db(db_path)
    conn.row_factory = sqlite3.Row

    buckets: dict[str, DayBucket] = defaultdict(DayBucket)
    types = list(TYPE_MAP.values())
    placeholders = ",".join("?" * len(types))
    cur = conn.execute(
        f"""
        SELECT record_type, source_name, start_date, end_date, value, unit, metadata_json
        FROM raw_records
        WHERE record_type IN ({placeholders})
        """,
        types,
    )
    type_by_id = {v: k for k, v in TYPE_MAP.items()}

    for row in cur:
        key = type_by_id.get(row["record_type"])
        start = parse_apple_date(row["start_date"])
        end = parse_apple_date(row["end_date"]) or start
        if not start or not key:
            continue
        src = row["source_name"] or "Unknown"
        day = day_key(start)
        b = buckets[day]
        val = row["value"]
        fval = _to_float(val)

        if key in CUMULATIVE_KEYS and fval is not None:
            amount = fval
            if key == "distance":
                unit = (row["unit"] or "").lower()
                amount = fval / 1000.0 if unit in {"m", "meter", "meters"} or fval > 100 else fval
            b.cum[key][src] += amount
        elif key == "stand":
            if fval == 1 or str(val).endswith("Stood") or str(val) == "1":
                b.stand_by_source[src] += 1
        elif key == "heart_rate" and fval is not None:
            b.hrs.append(fval)
        elif key == "resting_hr" and fval is not None:
            b.resting_hrs.append(fval)
        elif key == "walking_hr" and fval is not None:
            b.walking_hrs.append(fval)
        elif key == "hrv" and fval is not None:
            b.hrvs.append(fval * 1000.0 if fval < 10 else fval)
        elif key == "spo2" and fval is not None:
            b.spo2s.append(fval * 100.0 if fval <= 1.0 else fval)
        elif key == "sleep":
            hours = _hours_between(start, end)
            sval = str(val or "")
            # Prefer attributing overnight sleep to wake day
            wake_day = day_key(end) if end else day
            target = buckets[wake_day] if wake_day != day else b
            if wake_day != day:
                # only credit wake-day bucket
                _add_sleep(target, src, sval, hours, start, end or start)
            else:
                _add_sleep(b, src, sval, hours, start, end or start)
        elif key == "weight" and fval is not None:
            unit = (row["unit"] or "").lower()
            kg = fval * 0.453592 if unit in {"lb", "lbs"} else fval
            b.weights.append(kg)
        elif key == "body_fat" and fval is not None:
            b.body_fats.append(fval * 100.0 if fval <= 1.0 else fval)
        elif key == "mindful":
            b.mindful_min += _hours_between(start, end) * 60.0
        elif key == "headphone" and fval is not None:
            b.headphone_dbs.append(fval)
        elif key == "environmental" and fval is not None:
            b.env_dbs.append(fval)
        elif key == "state_of_mind":
            score, labels = _state_of_mind_score(val, row["metadata_json"])
            if score is not None:
                b.mood_scores.append(score)
            if labels:
                b.mood_labels.append(labels)

    # Workouts per day (keep list for load)
    workouts_by_day: dict[str, list[dict]] = defaultdict(list)
    workout_count: dict[str, int] = defaultdict(int)
    workout_minutes: dict[str, float] = defaultdict(float)
    for w in conn.execute(
        "SELECT start_date, duration, duration_unit, workout_activity_type, total_energy_burned FROM workouts"
    ):
        start = parse_apple_date(w["start_date"])
        if not start:
            continue
        day = day_key(start)
        wdict = dict(w)
        workouts_by_day[day].append(wdict)
        workout_count[day] += 1
        dur = w["duration"] or 0.0
        unit = (w["duration_unit"] or "min").lower()
        if unit.startswith("sec"):
            dur = dur / 60.0
        elif unit.startswith("hr") or unit == "h":
            dur = dur * 60.0
        workout_minutes[day] += float(dur)

    manual_moods: dict[str, float] = {}
    for m in conn.execute(
        "SELECT entry_date, score FROM mood_entries WHERE source = 'manual' AND score IS NOT NULL"
    ):
        manual_moods[m["entry_date"][:10]] = float(m["score"])

    rows_out: list[dict[str, Any]] = []
    for day in sorted(buckets.keys()):
        if day < DATA_START_DATE:
            continue
        b = buckets[day]
        preferred: dict[str, str] = {}

        def cum_pick(metric: str) -> float | None:
            total, src = pick_preferred_total(dict(b.cum.get(metric, {})))
            if src:
                preferred[metric] = src
            return total

        steps = cum_pick("steps")
        distance_km = cum_pick("distance")
        flights = cum_pick("flights")
        active_kcal = cum_pick("active_energy")
        basal_kcal = cum_pick("basal_energy")
        exercise_min = cum_pick("exercise")
        stand_hours, stand_src = pick_preferred_total(dict(b.stand_by_source))
        if stand_src:
            preferred["stand"] = stand_src

        sleep_asleep, sleep_src = pick_preferred_total(dict(b.sleep_asleep_src))
        sleep_in_bed, _ = pick_preferred_total(dict(b.sleep_in_bed_src))
        if sleep_src:
            preferred["sleep"] = sleep_src
            sleep_deep = b.sleep_deep_src.get(sleep_src) or None
            sleep_rem = b.sleep_rem_src.get(sleep_src) or None
            sleep_core = b.sleep_core_src.get(sleep_src) or None
        else:
            sleep_deep = sleep_rem = sleep_core = None
            # fallback any in-bed
            sleep_asleep = sleep_asleep
        sleep_hours = sleep_asleep if sleep_asleep else sleep_in_bed

        bed_min = None
        wake_min = None
        if b.sleep_bed_starts and b.sleep_wake_ends:
            # bedtime = earliest asleep start that night (often previous calendar evening)
            bed_dt = min(b.sleep_bed_starts)
            wake_dt = max(b.sleep_wake_ends)
            bed_min = minutes_from_midnight(bed_dt)
            wake_min = minutes_from_midnight(wake_dt)

        mood_score = None
        mood_source = None
        if day in manual_moods:
            mood_score = manual_moods[day]
            mood_source = "manual"
        elif b.mood_scores:
            mood_score = mean(b.mood_scores)
            mood_source = "state_of_mind"

        load = daily_training_load(workout_minutes.get(day), workouts_by_day.get(day))

        rows_out.append(
            {
                "day": day,
                "steps": steps,
                "distance_km": distance_km,
                "flights_climbed": flights,
                "active_energy_kcal": active_kcal,
                "basal_energy_kcal": basal_kcal,
                "exercise_minutes": exercise_min,
                "stand_hours": stand_hours,
                "resting_hr": median(b.resting_hrs) if b.resting_hrs else None,
                "avg_hr": mean(b.hrs) if b.hrs else None,
                "walking_hr_avg": mean(b.walking_hrs) if b.walking_hrs else None,
                "hrv_sdnn_ms": mean(b.hrvs) if b.hrvs else None,
                "spo2_avg": mean(b.spo2s) if b.spo2s else None,
                "sleep_hours": sleep_hours,
                "sleep_asleep_hours": sleep_asleep,
                "sleep_deep_hours": sleep_deep,
                "sleep_rem_hours": sleep_rem,
                "sleep_core_hours": sleep_core,
                "sleep_bedtime_min": bed_min,
                "sleep_wake_min": wake_min,
                "weight_kg": median(b.weights) if b.weights else None,
                "body_fat_pct": median(b.body_fats) if b.body_fats else None,
                "mindful_minutes": b.mindful_min or None,
                "headphone_db_avg": mean(b.headphone_dbs) if b.headphone_dbs else None,
                "environmental_db_avg": mean(b.env_dbs) if b.env_dbs else None,
                "workout_count": workout_count.get(day, 0),
                "workout_minutes": workout_minutes.get(day) or None,
                "training_load": load,
                "mood_score": mood_score,
                "mood_source": mood_source,
                "mood_labels": ",".join(b.mood_labels) if b.mood_labels else None,
                "preferred_sources": preferred,
            }
        )

    attach_training_load(rows_out)
    attach_sleep_consistency(rows_out)

    def collect(field: str) -> list[float]:
        return [r[field] for r in rows_out if r.get(field) is not None]

    baselines = {
        "sleep_hours": median(collect("sleep_hours")) if collect("sleep_hours") else None,
        "hrv_sdnn_ms": median(collect("hrv_sdnn_ms")) if collect("hrv_sdnn_ms") else None,
        "resting_hr": median(collect("resting_hr")) if collect("resting_hr") else None,
        "steps": median(collect("steps")) if collect("steps") else None,
        "active_energy_kcal": median(collect("active_energy_kcal")) if collect("active_energy_kcal") else None,
        "exercise_minutes": median(collect("exercise_minutes")) if collect("exercise_minutes") else None,
    }

    from src.metrics.readiness import attach_readiness_to_extras

    # Precompute readiness using sleep_score placeholders after we score each day —
    # first pass scores, second attach uses scored fields. Do scoring inline then attach.
    conn.execute("DELETE FROM daily_metrics")
    conn.execute("DELETE FROM mood_entries WHERE source IN ('inferred', 'state_of_mind')")

    scored_rows: list[dict] = []
    inserted = 0
    for r in rows_out:
        sleep_score = _score_from_baseline(r["sleep_hours"], baselines["sleep_hours"], higher_better=True)
        if r["sleep_hours"] is not None:
            sh = r["sleep_hours"]
            if 7 <= sh <= 9:
                sleep_score = max(sleep_score or 0, 80.0)
            elif sh < 5 or sh > 11:
                sleep_score = min(sleep_score or 50, 40.0)
        # blend sleep consistency into sleep score when present
        if r.get("sleep_consistency") is not None and sleep_score is not None:
            sleep_score = 0.7 * sleep_score + 0.3 * float(r["sleep_consistency"])
        elif r.get("sleep_consistency") is not None and sleep_score is None:
            sleep_score = float(r["sleep_consistency"])

        hrv_score = _score_from_baseline(r["hrv_sdnn_ms"], baselines["hrv_sdnn_ms"], higher_better=True)
        rhr_score = _score_from_baseline(r["resting_hr"], baselines["resting_hr"], higher_better=False)
        # TSB: positive form helps recovery perception
        tsb_score = None
        if r.get("tsb") is not None:
            # map tsb roughly: +20 → 80, 0 → 55, -20 → 30
            tsb_score = max(0.0, min(100.0, 55 + float(r["tsb"])))
        recovery_parts = [x for x in (hrv_score, rhr_score, sleep_score, tsb_score) if x is not None]
        recovery_score = mean(recovery_parts) if recovery_parts else None

        act_parts = [
            _score_from_baseline(r["steps"], baselines["steps"], higher_better=True),
            _score_from_baseline(r["active_energy_kcal"], baselines["active_energy_kcal"], higher_better=True),
            _score_from_baseline(r["exercise_minutes"], baselines["exercise_minutes"], higher_better=True),
        ]
        act_parts = [x for x in act_parts if x is not None]
        activity_score = mean(act_parts) if act_parts else None

        mood_score = r["mood_score"]
        mood_source = r["mood_source"]
        if mood_score is None and recovery_score is not None and activity_score is not None:
            blend = 0.6 * recovery_score + 0.4 * activity_score
            mood_score = round(1.0 + (blend / 100.0) * 4.0, 2)
            mood_source = "inferred"
        elif mood_score is None and recovery_score is not None:
            mood_score = round(1.0 + (recovery_score / 100.0) * 4.0, 2)
            mood_source = "inferred"

        overall_parts = [x for x in (recovery_score, activity_score, sleep_score) if x is not None]
        if mood_score is not None:
            overall_parts.append((mood_score - 1.0) / 4.0 * 100.0)
        overall_score = mean(overall_parts) if overall_parts else None

        scored = dict(r)
        scored.update(
            {
                "sleep_score": sleep_score,
                "recovery_score": recovery_score,
                "activity_score": activity_score,
                "overall_score": overall_score,
                "mood_score": mood_score,
                "mood_source": mood_source,
            }
        )
        scored_rows.append(scored)

    attach_readiness_to_extras(scored_rows, baselines)

    for scored in scored_rows:
        r = scored
        extras = {
            "baselines": baselines,
            "mood_labels": r.get("mood_labels"),
            "dedup": "preferred_source_per_metric",
            "readiness": r.get("_readiness") or {},
        }
        conn.execute(
            """
            INSERT INTO daily_metrics (
                day, steps, distance_km, flights_climbed, active_energy_kcal, basal_energy_kcal,
                exercise_minutes, stand_hours, resting_hr, avg_hr, walking_hr_avg, hrv_sdnn_ms,
                spo2_avg, sleep_hours, sleep_asleep_hours, sleep_deep_hours, sleep_rem_hours,
                sleep_core_hours, sleep_bedtime_min, sleep_wake_min, sleep_consistency,
                weight_kg, body_fat_pct, mindful_minutes, headphone_db_avg,
                environmental_db_avg, workout_count, workout_minutes,
                training_load, ctl, atl, tsb,
                mood_score, mood_source,
                recovery_score, activity_score, sleep_score, overall_score,
                preferred_sources_json, extras_json
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                r["day"],
                r["steps"],
                r["distance_km"],
                r["flights_climbed"],
                r["active_energy_kcal"],
                r["basal_energy_kcal"],
                r["exercise_minutes"],
                r["stand_hours"],
                r["resting_hr"],
                r["avg_hr"],
                r["walking_hr_avg"],
                r["hrv_sdnn_ms"],
                r["spo2_avg"],
                r["sleep_hours"],
                r["sleep_asleep_hours"],
                r["sleep_deep_hours"],
                r["sleep_rem_hours"],
                r["sleep_core_hours"],
                r.get("sleep_bedtime_min"),
                r.get("sleep_wake_min"),
                r.get("sleep_consistency"),
                r["weight_kg"],
                r["body_fat_pct"],
                r["mindful_minutes"],
                r["headphone_db_avg"],
                r["environmental_db_avg"],
                r["workout_count"],
                r["workout_minutes"],
                r.get("training_load"),
                r.get("ctl"),
                r.get("atl"),
                r.get("tsb"),
                r.get("mood_score"),
                r.get("mood_source"),
                r.get("recovery_score"),
                r.get("activity_score"),
                r.get("sleep_score"),
                r.get("overall_score"),
                json.dumps(r.get("preferred_sources") or {}, ensure_ascii=False),
                json.dumps(extras, ensure_ascii=False),
            ),
        )
        if r.get("mood_score") is not None and r.get("mood_source") in {"inferred", "state_of_mind"}:
            conn.execute(
                """
                INSERT OR REPLACE INTO mood_entries(entry_date, score, valence, labels, source, note)
                VALUES (?, ?, NULL, ?, ?, NULL)
                """,
                (r["day"], r.get("mood_score"), r.get("mood_labels"), r.get("mood_source")),
            )
        inserted += 1

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("last_metrics_at", datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    conn.close()
    print(
        f"日指标已计算: {inserted} 天（自 {DATA_START_DATE} 起；含去重/负荷/准备度）",
        flush=True,
    )
    return inserted


def load_daily_df(db_path: Path = DB_PATH, days: int | None = None):
    conn = init_db(db_path)
    conn.row_factory = sqlite3.Row
    sql = "SELECT * FROM daily_metrics ORDER BY day DESC"
    params: tuple = ()
    if days is not None:
        sql = "SELECT * FROM daily_metrics ORDER BY day DESC LIMIT ?"
        params = (days,)
    rows = [dict(r) for r in conn.execute(sql, params)]
    conn.close()
    return list(reversed(rows))


def latest_day(db_path: Path = DB_PATH) -> str | None:
    conn = init_db(db_path)
    row = conn.execute("SELECT day FROM daily_metrics ORDER BY day DESC LIMIT 1").fetchone()
    conn.close()
    return row[0] if row else None


def upsert_manual_mood(entry_date: str, score: float, note: str | None = None, db_path: Path = DB_PATH) -> None:
    conn = init_db(db_path)
    conn.execute(
        """
        INSERT INTO mood_entries(entry_date, score, source, note)
        VALUES (?, ?, 'manual', ?)
        ON CONFLICT(entry_date, source) DO UPDATE SET score=excluded.score, note=excluded.note
        """,
        (entry_date, score, note),
    )
    conn.execute(
        "UPDATE daily_metrics SET mood_score = ?, mood_source = 'manual' WHERE day = ?",
        (score, entry_date),
    )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    compute_daily_metrics()
