"""Training load (CTL/ATL/TSB) and sleep consistency."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any


# Approximate intensity factors for Banister-style daily load proxy
WORKOUT_FACTORS = {
    "Running": 1.0,
    "TraditionalStrengthTraining": 0.85,
    "FunctionalStrengthTraining": 0.85,
    "Tennis": 0.9,
    "Basketball": 0.9,
    "Soccer": 0.95,
    "Swimming": 0.95,
    "Cycling": 0.75,
    "Hiking": 0.7,
    "Walking": 0.4,
    "Yoga": 0.35,
    "MindAndBody": 0.3,
    "Cooldown": 0.55,
}


def workout_type_factor(activity_type: str | None) -> float:
    raw = (activity_type or "").replace("HKWorkoutActivityType", "")
    if raw in WORKOUT_FACTORS:
        return WORKOUT_FACTORS[raw]
    # fuzzy
    for key, factor in WORKOUT_FACTORS.items():
        if key.lower() in raw.lower():
            return factor
    return 0.6


def daily_training_load(workout_minutes: float | None, workouts: list[dict] | None = None) -> float:
    """
    Load ≈ sum(duration_min * intensity_factor).
    If per-workout rows given, use them; else fall back to minutes * 0.6.
    """
    if workouts:
        total = 0.0
        for w in workouts:
            dur = w.get("duration") or 0.0
            unit = (w.get("duration_unit") or "min").lower()
            if unit.startswith("sec"):
                dur = dur / 60.0
            elif unit.startswith("hr") or unit == "h":
                dur = dur * 60.0
            total += float(dur) * workout_type_factor(w.get("workout_activity_type"))
        return total
    if workout_minutes:
        return float(workout_minutes) * 0.6
    return 0.0


def ema_series(values: list[float], time_constant_days: float) -> list[float]:
    """Banister EMA: CTL~42d, ATL~7d."""
    if not values:
        return []
    alpha = 1.0 - math.exp(-1.0 / time_constant_days)
    out: list[float] = []
    prev = values[0]
    for v in values:
        prev = prev + alpha * (v - prev)
        out.append(prev)
    return out


def attach_training_load(rows: list[dict[str, Any]]) -> None:
    """Mutate rows in chronological order with training_load, ctl, atl, tsb."""
    loads = [float(r.get("training_load") or 0.0) for r in rows]
    ctl = ema_series(loads, 42.0)
    atl = ema_series(loads, 7.0)
    for i, r in enumerate(rows):
        r["ctl"] = round(ctl[i], 2) if ctl else None
        r["atl"] = round(atl[i], 2) if atl else None
        if ctl and atl:
            r["tsb"] = round(ctl[i] - atl[i], 2)  # form: positive = fresh
        else:
            r["tsb"] = None


def minutes_from_midnight(dt: datetime) -> float:
    return dt.hour * 60 + dt.minute + dt.second / 60.0


def circular_mean_minutes(values: list[float]) -> float | None:
    """Mean of clock times treating 24h as circle (for bedtimes near midnight)."""
    if not values:
        return None
    # map to radians on 24h
    s = sum(math.sin(2 * math.pi * (v / 1440.0)) for v in values)
    c = sum(math.cos(2 * math.pi * (v / 1440.0)) for v in values)
    if s == 0 and c == 0:
        return None
    ang = math.atan2(s, c)
    if ang < 0:
        ang += 2 * math.pi
    return (ang / (2 * math.pi)) * 1440.0


def circular_std_minutes(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean_m = circular_mean_minutes(values)
    if mean_m is None:
        return None
    # approximate linear std after unwrapping around mean
    diffs = []
    for v in values:
        d = v - mean_m
        while d > 720:
            d -= 1440
        while d < -720:
            d += 1440
        diffs.append(d)
    var = sum(x * x for x in diffs) / len(diffs)
    return math.sqrt(var)


def sleep_consistency_score(bed_std_min: float | None, wake_std_min: float | None) -> float | None:
    """
    100 = very consistent (<20 min std), 0 = chaotic (>120 min std).
    Uses average of bed/wake std when both available.
    """
    parts = [x for x in (bed_std_min, wake_std_min) if x is not None]
    if not parts:
        return None
    std = sum(parts) / len(parts)
    # map 20→100, 120→0
    score = 100.0 * (1.0 - (std - 20.0) / 100.0)
    return max(0.0, min(100.0, score))


def attach_sleep_consistency(rows: list[dict[str, Any]], window: int = 7) -> None:
    """Rolling 7-day sleep schedule consistency on each row."""
    beds: list[float | None] = []
    wakes: list[float | None] = []
    for r in rows:
        beds.append(r.get("sleep_bedtime_min"))
        wakes.append(r.get("sleep_wake_min"))

    for i, r in enumerate(rows):
        start = max(0, i - window + 1)
        bed_win = [b for b in beds[start : i + 1] if b is not None]
        wake_win = [w for w in wakes[start : i + 1] if w is not None]
        bed_std = circular_std_minutes(bed_win) if len(bed_win) >= 3 else None
        wake_std = circular_std_minutes(wake_win) if len(wake_win) >= 3 else None
        r["sleep_bed_std_min"] = round(bed_std, 1) if bed_std is not None else None
        r["sleep_wake_std_min"] = round(wake_std, 1) if wake_std is not None else None
        r["sleep_consistency"] = (
            round(sleep_consistency_score(bed_std, wake_std), 1)
            if bed_std is not None or wake_std is not None
            else None
        )
