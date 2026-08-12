"""Morning private-training (PT) window analysis from Apple Health samples.

Apple often does not start a formal Strength workout during coach-led sessions.
We therefore aggregate HeartRate / ActiveEnergy / PhysicalEffort inside a fixed
clock window (default 07:30–08:50 from 2026-08-03).

Days with a clear morning sport workout (e.g. Tennis) are tagged as kind=sport
so they are not mistaken for sparse PT coverage.
"""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean
from typing import Any

from src.config import (
    DB_PATH,
    PT_SESSION_START_DATE,
    PT_SESSION_TIME_END,
    PT_SESSION_TIME_START,
)
from src.metrics.workouts import estimate_hr_max, hr_zone, intensity_label
from src.profile import load_profile

# Commute / incidental Apple auto-detections — not a dedicated morning session
_COMMUTE_ACTIVITIES = {
    "Walking",
    "Cycling",
    "Hiking",
    "Elliptical",  # rare auto
}

# Prefer these when present in the morning as the day's primary session
_SPORT_HINTS = {
    "Tennis",
    "TraditionalStrengthTraining",
    "FunctionalStrengthTraining",
    "CoreTraining",
    "Flexibility",
    "Yoga",
    "Pilates",
    "Swimming",
    "PoolSwim",
    "OpenWaterSwim",
    "Running",
    "Soccer",
    "Basketball",
    "Badminton",
    "TableTennis",
    "MartialArts",
    "Kickboxing",
    "Boxing",
    "HighIntensityIntervalTraining",
    "CrossTraining",
    "StairClimbing",
}


@dataclass
class PtSessionDay:
    day: str
    time_start: str
    time_end: str
    hr_n: int
    hr_avg: float | None
    hr_min: float | None
    hr_max: float | None
    active_kcal: float | None
    mets_avg: float | None
    mets_max: float | None
    mets_n: int
    hr_zone: str | None
    intensity: str | None
    coverage: str  # dense / partial / sparse / none
    apple_workouts: list[dict[str, Any]]
    note: str
    kind: str = "pt"  # pt | sport
    primary_activity: str | None = None


def _coverage(hr_n: int, span_min: int = 80) -> str:
    """Rough quality label for optical HR sampling in the window."""
    if hr_n <= 0:
        return "none"
    if hr_n >= 200:
        return "dense"
    if hr_n >= 40:
        return "partial"
    if hr_n >= 8:
        return "sparse"
    return "none"


def _activity_name(raw: str | None) -> str:
    return (raw or "").replace("HKWorkoutActivityType", "")


def _pick_primary_sport(workouts: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Choose a dedicated morning sport over commute fragments."""
    sports = [
        w
        for w in workouts
        if w["activity"] in _SPORT_HINTS or (w["activity"] not in _COMMUTE_ACTIVITIES and w["duration_min"] >= 15)
    ]
    if not sports:
        return None
    # Prefer known sport hints, then longest
    sports.sort(
        key=lambda w: (1 if w["activity"] in _SPORT_HINTS else 0, w["duration_min"]),
        reverse=True,
    )
    return sports[0]


def _note(
    *,
    kind: str,
    activity: str | None,
    cov: str,
    hr_avg: float | None,
    zone: str | None,
    kcal: float | None,
    time_start: str,
    time_end: str,
) -> str:
    parts: list[str] = []
    if kind == "sport" and activity:
        parts.append(f"今日晨间为「{activity}」（{_hm(time_start)}–{_hm(time_end)}），非私教课。")
    elif cov == "none":
        parts.append("该时段几乎无连续心率，可能未戴表或未开训练记录。")
    elif cov == "sparse":
        parts.append("心率采样很稀，强度判断仅供参考；建议私教课开「力量训练」记录。")
    elif cov == "partial":
        parts.append("有部分心率覆盖，中间可能有断档。")
    else:
        parts.append("心率覆盖较好。")
    if hr_avg is not None and zone:
        parts.append(f"场均约 {hr_avg:.0f} bpm（{zone}）。")
    if kcal is not None:
        parts.append(f"活跃热量约 {kcal:.0f} kcal。")
    return " ".join(parts)


def _hm(ts: str) -> str:
    """Accept 'HH:MM' or full Apple date string."""
    if len(ts) >= 16 and ts[10:11] == " ":
        return ts[11:16]
    return ts[:5]


def _estimate_hr_max(observed: float | None) -> float:
    profile = load_profile()
    age = None
    if profile.birth_datetime:
        try:
            from datetime import datetime

            b = datetime.strptime(profile.birth_datetime.strip()[:10], "%Y-%m-%d")
            age = max(10, datetime.now().year - b.year)
        except ValueError:
            age = None
    return estimate_hr_max(age, observed)


def list_pt_days(
    db_path: Path = DB_PATH,
    *,
    since: str = PT_SESSION_START_DATE,
) -> list[str]:
    conn = sqlite3.connect(db_path)
    try:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_records' LIMIT 1"
        ).fetchone()
        if not exists:
            return []
        rows = conn.execute(
            """
            SELECT DISTINCT substr(start_date, 1, 10) AS day
            FROM raw_records
            WHERE substr(start_date, 1, 10) >= ?
            ORDER BY day
            """,
            (since,),
        ).fetchall()
        return [r[0] for r in rows]
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def _window_stats(
    conn: sqlite3.Connection,
    day: str,
    time_start: str,
    time_end: str,
) -> tuple[list[float], float | None, tuple | None]:
    hr_rows = conn.execute(
        """
        SELECT CAST(value AS REAL) FROM raw_records
        WHERE record_type = 'HKQuantityTypeIdentifierHeartRate'
          AND substr(start_date, 1, 10) = ?
          AND substr(start_date, 12, 5) BETWEEN ? AND ?
        """,
        (day, time_start, time_end),
    ).fetchall()
    hrs = [r[0] for r in hr_rows if r[0] is not None]

    ae = conn.execute(
        """
        SELECT SUM(CAST(value AS REAL)) FROM raw_records
        WHERE record_type = 'HKQuantityTypeIdentifierActiveEnergyBurned'
          AND substr(start_date, 1, 10) = ?
          AND substr(start_date, 12, 5) BETWEEN ? AND ?
        """,
        (day, time_start, time_end),
    ).fetchone()[0]

    pe = conn.execute(
        """
        SELECT AVG(CAST(value AS REAL)), MAX(CAST(value AS REAL)), COUNT(*)
        FROM raw_records
        WHERE record_type = 'HKQuantityTypeIdentifierPhysicalEffort'
          AND substr(start_date, 1, 10) = ?
          AND substr(start_date, 12, 5) BETWEEN ? AND ?
        """,
        (day, time_start, time_end),
    ).fetchone()
    return hrs, (float(ae) if ae is not None else None), pe


def analyze_pt_day(
    day: str,
    db_path: Path = DB_PATH,
    *,
    time_start: str = PT_SESSION_TIME_START,
    time_end: str = PT_SESSION_TIME_END,
    hr_max: float | None = None,
) -> PtSessionDay:
    conn = sqlite3.connect(db_path)
    try:
        has_raw = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_records' LIMIT 1"
        ).fetchone()
        has_wo = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workouts' LIMIT 1"
        ).fetchone()
        workouts = []
        if has_wo:
            workouts = conn.execute(
                """
                SELECT start_date, end_date, workout_activity_type, duration, duration_unit,
                       total_energy_burned
                FROM workouts
                WHERE substr(start_date, 1, 10) = ?
                  AND substr(start_date, 12, 5) BETWEEN '06:30' AND '11:00'
                ORDER BY start_date
                """,
                (day,),
            ).fetchall()
        apple_wos = [
            {
                "start": w[0],
                "end": w[1],
                "activity": _activity_name(w[2]),
                "duration_min": float(w[3] or 0),
                "energy": float(w[5]) if w[5] is not None else None,
            }
            for w in workouts
        ]
        primary = _pick_primary_sport(apple_wos)
        if primary:
            kind = "sport"
            win_start = _hm(primary["start"])
            win_end = _hm(primary["end"])
            activity = primary["activity"]
        else:
            kind = "pt"
            win_start, win_end = time_start, time_end
            activity = None

        if has_raw:
            hrs, kcal, pe = _window_stats(conn, day, win_start, win_end)
        else:
            hrs, kcal, pe = [], None, None

        if primary and primary.get("energy") is not None:
            kcal = primary["energy"]
        wa = None
        if primary:
            has_wa = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workout_analytics' LIMIT 1"
            ).fetchone()
            if has_wa:
                wa = conn.execute(
                    """
                    SELECT hr_avg, hr_min, hr_max, active_kcal, hr_zone, intensity, mets
                    FROM workout_analytics
                    WHERE day = ? AND activity = ?
                    ORDER BY start_date DESC LIMIT 1
                    """,
                    (day, primary["activity"]),
                ).fetchone()
    finally:
        conn.close()

    if wa and wa[0] is not None:
        hr_avg = float(wa[0])
        hr_min = float(wa[1]) if wa[1] is not None else (min(hrs) if hrs else None)
        hr_max_obs = float(wa[2]) if wa[2] is not None else (max(hrs) if hrs else None)
        if wa[3] is not None:
            kcal = float(wa[3])
        zone = wa[4] or hr_zone(hr_avg, hr_max or _estimate_hr_max(hr_max_obs))
        intensity = wa[5] or intensity_label(zone)
        mets_avg = float(wa[6]) if wa[6] is not None else (round(float(pe[0]), 2) if pe and pe[2] else None)
    else:
        if hr_max is None:
            hr_max = _estimate_hr_max(max(hrs) if hrs else None)
        hr_avg = mean(hrs) if hrs else None
        hr_min = min(hrs) if hrs else None
        hr_max_obs = max(hrs) if hrs else None
        zone = hr_zone(hr_avg, hr_max)
        intensity = intensity_label(zone)
        mets_avg = round(float(pe[0]), 2) if pe and pe[2] else None

    cov = _coverage(len(hrs))
    mets_max = round(float(pe[1]), 2) if pe and pe[2] else None
    mets_n = int(pe[2] or 0) if pe else 0

    return PtSessionDay(
        day=day,
        time_start=win_start,
        time_end=win_end,
        hr_n=len(hrs),
        hr_avg=round(hr_avg, 1) if hr_avg is not None else None,
        hr_min=hr_min,
        hr_max=hr_max_obs,
        active_kcal=round(kcal, 1) if kcal is not None else None,
        mets_avg=mets_avg,
        mets_max=mets_max,
        mets_n=mets_n,
        hr_zone=zone,
        intensity=intensity,
        coverage=cov,
        apple_workouts=apple_wos,
        note=_note(
            kind=kind,
            activity=activity,
            cov=cov,
            hr_avg=hr_avg,
            zone=zone,
            kcal=kcal,
            time_start=win_start,
            time_end=win_end,
        ),
        kind=kind,
        primary_activity=activity,
    )


def load_pt_sessions(
    db_path: Path = DB_PATH,
    *,
    since: str = PT_SESSION_START_DATE,
    time_start: str = PT_SESSION_TIME_START,
    time_end: str = PT_SESSION_TIME_END,
) -> list[PtSessionDay]:
    days = list_pt_days(db_path, since=since)
    return [analyze_pt_day(d, db_path, time_start=time_start, time_end=time_end) for d in days]


def hr_series_for_day(
    day: str,
    db_path: Path = DB_PATH,
    *,
    time_start: str = PT_SESSION_TIME_START,
    time_end: str = PT_SESSION_TIME_END,
    bucket_min: int = 5,
) -> list[dict[str, Any]]:
    """5-minute HR buckets for charting one morning window."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT start_date, CAST(value AS REAL) FROM raw_records
            WHERE record_type = 'HKQuantityTypeIdentifierHeartRate'
              AND substr(start_date, 1, 10) = ?
              AND substr(start_date, 12, 5) BETWEEN ? AND ?
            ORDER BY start_date
            """,
            (day, time_start, time_end),
        ).fetchall()
    finally:
        conn.close()

    buckets: dict[str, list[float]] = {}
    for sd, v in rows:
        if v is None:
            continue
        hh = int(sd[11:13])
        mm = int(sd[14:16])
        bm = (mm // bucket_min) * bucket_min
        key = f"{hh:02d}:{bm:02d}"
        buckets.setdefault(key, []).append(float(v))

    series = []
    for key in sorted(buckets):
        vs = buckets[key]
        series.append(
            {
                "bucket": key,
                "hr_avg": round(mean(vs), 1),
                "hr_max": max(vs),
                "hr_min": min(vs),
                "n": len(vs),
            }
        )
    return series


def pt_sessions_as_dicts(**kwargs: Any) -> list[dict[str, Any]]:
    return [asdict(s) for s in load_pt_sessions(**kwargs)]
