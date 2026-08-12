"""Per-workout analytics: HR, METs, distance, intensity zones."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any

from src.config import DATA_START_DATE, DB_PATH
from src.ingest.parse_export import init_db
from src.metrics.compute import parse_apple_date
from src.profile import load_profile


@dataclass
class WorkoutInsight:
    start_date: str
    activity: str
    duration_min: float
    hr_avg: float | None = None
    hr_min: float | None = None
    hr_max: float | None = None
    active_kcal: float | None = None
    basal_kcal: float | None = None
    distance_km: float | None = None
    mets: float | None = None
    elevation_m: float | None = None
    indoor: bool | None = None
    temp_c: float | None = None
    humidity: float | None = None
    zone: str | None = None  # Z1..Z5 by avg HR
    intensity: str | None = None  # easy / steady / hard
    note: str | None = None


def estimate_hr_max(age: int | None = None, observed_max: float | None = None) -> float:
    if observed_max and observed_max > 140:
        return max(observed_max, 160.0)
    if age and 10 <= age <= 90:
        return float(220 - age)
    return 190.0  # fallback


def hr_zone(hr: float | None, hr_max: float) -> str | None:
    if hr is None or hr_max <= 0:
        return None
    pct = hr / hr_max
    if pct < 0.6:
        return "Z1 恢复"
    if pct < 0.7:
        return "Z2 有氧"
    if pct < 0.8:
        return "Z3 节奏"
    if pct < 0.9:
        return "Z4 阈值"
    return "Z5 极限"


def intensity_label(zone: str | None) -> str | None:
    if not zone:
        return None
    if zone.startswith("Z1") or zone.startswith("Z2"):
        return "轻松"
    if zone.startswith("Z3"):
        return "中等"
    return "高强度"


def _f(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_mets(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"([0-9.]+)", str(raw))
    return float(m.group(1)) if m else None


def _parse_elevation_cm(raw: str | None) -> float | None:
    v = _f(str(raw).replace(" cm", "").strip()) if raw else None
    return v / 100.0 if v is not None else None


def _parse_temp_f(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"([0-9.]+)", str(raw))
    if not m:
        return None
    f = float(m.group(1))
    return (f - 32.0) * 5.0 / 9.0


def _parse_humidity(raw: str | None) -> float | None:
    """Apple sometimes stores 8900 meaning 89.00%."""
    if not raw:
        return None
    m = re.search(r"([0-9.]+)", str(raw))
    if not m:
        return None
    v = float(m.group(1))
    if v > 100:
        return v / 100.0
    return v


def extract_from_metadata(meta: dict) -> dict[str, Any]:
    out: dict[str, Any] = {
        "mets": _parse_mets(meta.get("HKAverageMETs")),
        "elevation_m": _parse_elevation_cm(meta.get("HKElevationAscended")),
        "indoor": meta.get("HKIndoorWorkout") == "1",
        "temp_c": _parse_temp_f(meta.get("HKWeatherTemperature")),
        "humidity": _parse_humidity(meta.get("HKWeatherHumidity")),
    }
    for stat in meta.get("WorkoutStatistics") or []:
        typ = stat.get("type") or ""
        if typ.endswith("HeartRate"):
            out["hr_avg"] = _f(stat.get("average"))
            out["hr_min"] = _f(stat.get("minimum"))
            out["hr_max"] = _f(stat.get("maximum"))
        elif typ.endswith("ActiveEnergyBurned"):
            out["active_kcal"] = _f(stat.get("sum"))
        elif typ.endswith("BasalEnergyBurned"):
            out["basal_kcal"] = _f(stat.get("sum"))
        elif "Distance" in typ:
            dist = _f(stat.get("sum"))
            unit = (stat.get("unit") or "").lower()
            if dist is not None:
                if unit in {"m", "meter", "meters"}:
                    dist = dist / 1000.0
                out["distance_km"] = dist
    return out


def duration_to_min(duration: float | None, unit: str | None) -> float:
    dur = float(duration or 0.0)
    u = (unit or "min").lower()
    if u.startswith("sec"):
        return dur / 60.0
    if u.startswith("hr") or u == "h":
        return dur * 60.0
    return dur


def ensure_workout_analytics_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workout_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_rowid INTEGER UNIQUE,
            day TEXT,
            start_date TEXT,
            activity TEXT,
            duration_min REAL,
            hr_avg REAL,
            hr_min REAL,
            hr_max REAL,
            active_kcal REAL,
            basal_kcal REAL,
            distance_km REAL,
            mets REAL,
            elevation_m REAL,
            indoor INTEGER,
            temp_c REAL,
            humidity REAL,
            hr_zone TEXT,
            intensity TEXT,
            note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_wa_day ON workout_analytics(day);
        CREATE INDEX IF NOT EXISTS idx_wa_start ON workout_analytics(start_date);
        """
    )


def rebuild_workout_analytics(db_path: Path = DB_PATH, hr_max: float | None = None) -> int:
    conn = init_db(db_path)
    ensure_workout_analytics_table(conn)
    conn.execute("DELETE FROM workout_analytics")

    rows = conn.execute(
        """
        SELECT rowid, workout_activity_type, duration, duration_unit,
               total_energy_burned, start_date, metadata_json
        FROM workouts
        WHERE substr(start_date, 1, 10) >= ?
        ORDER BY start_date
        """,
        (DATA_START_DATE,),
    ).fetchall()

    observed = []
    parsed: list[tuple] = []
    for row in rows:
        meta = {}
        try:
            meta = json.loads(row[6] or "{}")
        except json.JSONDecodeError:
            meta = {}
        stats = extract_from_metadata(meta)
        if stats.get("hr_max"):
            observed.append(stats["hr_max"])
        activity = (row[1] or "").replace("HKWorkoutActivityType", "")
        start = row[5] or ""
        day = start[:10]
        dur = duration_to_min(row[2], row[3])
        active = stats.get("active_kcal")
        if active is None and row[4] is not None:
            active = float(row[4])
        parsed.append((row[0], day, start, activity, dur, stats, active))

    profile = load_profile()
    age = None
    if profile.birth_datetime:
        try:
            b = datetime.strptime(profile.birth_datetime.strip()[:10], "%Y-%m-%d")
            age = max(10, datetime.now().year - b.year)
        except ValueError:
            age = None
    hr_max_est = hr_max or estimate_hr_max(age, max(observed) if observed else None)

    n = 0
    for rowid, day, start, activity, dur, stats, active in parsed:
        hr_avg = stats.get("hr_avg")
        zone = hr_zone(hr_avg, hr_max_est)
        intensity = intensity_label(zone)
        note = None
        if hr_avg and zone and zone.startswith("Z5") and dur >= 10:
            note = "平均心率接近极限区，注意恢复与热身充分性。"
        elif hr_avg and zone and zone.startswith("Z4") and dur >= 30:
            note = "较长时长处在阈值区，后续安排轻松日更稳妥。"
        elif intensity == "轻松":
            note = "偏有氧/恢复强度，适合作为主动恢复。"

        conn.execute(
            """
            INSERT INTO workout_analytics (
                workout_rowid, day, start_date, activity, duration_min,
                hr_avg, hr_min, hr_max, active_kcal, basal_kcal, distance_km,
                mets, elevation_m, indoor, temp_c, humidity, hr_zone, intensity, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rowid,
                day,
                start,
                activity,
                dur,
                hr_avg,
                stats.get("hr_min"),
                stats.get("hr_max"),
                active,
                stats.get("basal_kcal"),
                stats.get("distance_km"),
                stats.get("mets"),
                stats.get("elevation_m"),
                1 if stats.get("indoor") else 0 if stats.get("indoor") is not None else None,
                stats.get("temp_c"),
                stats.get("humidity"),
                zone,
                intensity,
                note,
            ),
        )
        n += 1

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("workout_hr_max_used", str(hr_max_est)),
    )
    conn.commit()
    conn.close()
    print(f"训练分析已生成: {n} 场（HRmax≈{hr_max_est:.0f}）", flush=True)
    return n


def load_workout_analytics(db_path: Path = DB_PATH, limit: int = 200) -> list[dict]:
    conn = init_db(db_path)
    ensure_workout_analytics_table(conn)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT * FROM workout_analytics
        ORDER BY start_date DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def workout_summary(db_path: Path = DB_PATH, days: int = 14) -> dict[str, Any]:
    rows = load_workout_analytics(db_path, limit=500)
    if not rows:
        return {"count": 0}
    # filter recent by day string
    recent = rows
    if days:
        cut = None
        try:
            latest = max(r["day"] for r in rows if r.get("day"))
            from datetime import timedelta

            cut = (datetime.strptime(latest, "%Y-%m-%d") - timedelta(days=days - 1)).strftime("%Y-%m-%d")
            recent = [r for r in rows if (r.get("day") or "") >= cut]
        except Exception:
            recent = rows[: days * 2]

    hrs = [r["hr_avg"] for r in recent if r.get("hr_avg") is not None]
    hard = [r for r in recent if (r.get("intensity") == "高强度")]
    easy = [r for r in recent if (r.get("intensity") == "轻松")]
    by_type: dict[str, int] = {}
    for r in recent:
        by_type[r.get("activity") or "Unknown"] = by_type.get(r.get("activity") or "Unknown", 0) + 1

    return {
        "count": len(recent),
        "hr_avg_mean": mean(hrs) if hrs else None,
        "hr_max_peak": max((r.get("hr_max") or 0) for r in recent) if recent else None,
        "hard_count": len(hard),
        "easy_count": len(easy),
        "total_min": sum(r.get("duration_min") or 0 for r in recent),
        "total_kcal": sum(r.get("active_kcal") or 0 for r in recent),
        "by_type": by_type,
        "latest": recent[0] if recent else None,
    }


def workout_advice_lines(db_path: Path = DB_PATH) -> list[str]:
    s = workout_summary(db_path, days=14)
    if not s.get("count"):
        return ["近两周暂无训练明细；完成一场手表记录的 Workout 后再看心率分析。"]
    tips = [
        f"近两周 {s['count']} 场训练，合计约 {s['total_min']:.0f} 分钟，活动热量约 {s['total_kcal']:.0f} kcal。",
    ]
    if s.get("hr_avg_mean") is not None:
        tips.append(
            f"场均心率约 {s['hr_avg_mean']:.0f} bpm，期间最高触及 {s['hr_max_peak']:.0f} bpm。"
        )
    if s.get("hard_count", 0) >= 4 and s.get("easy_count", 0) <= 1:
        tips.append("高强度场次偏多、轻松有氧偏少：建议插入 Z1–Z2 恢复课，避免连续阈值日。")
    elif s.get("hard_count", 0) == 0 and s.get("count", 0) >= 3:
        tips.append("近期多为轻松强度：若目标是提升，可每周安排 1 次质量课（在恢复允许时）。")
    latest = s.get("latest") or {}
    if latest.get("note"):
        tips.append(f"最近一场（{latest.get('activity')}）：{latest.get('note')}")
    if latest.get("hr_zone"):
        tips.append(
            f"最近一场心率区间 {latest.get('hr_zone')}（平均 {latest.get('hr_avg'):.0f} / 最高 {latest.get('hr_max'):.0f} bpm）。"
            if latest.get("hr_avg") and latest.get("hr_max")
            else f"最近一场心率区间 {latest.get('hr_zone')}。"
        )
    return tips
