"""Parse Health Auto Export payloads and store them.

Health Auto Export (the iOS App Store app) posts a JSON document shaped like::

    {
      "data": {
        "metrics": [
          {"name": "step_count", "units": "count",
           "data": [{"date": "2026-01-01 00:00:00 +0000", "qty": 8421, "source": "Apple Watch"}]},
          {"name": "heart_rate", "units": "count/min",
           "data": [{"date": "...", "Min": 54, "Avg": 72, "Max": 131, "source": "Apple Watch"}]},
          {"name": "sleep_analysis", "units": "hr",
           "data": [{"date": "...", "totalSleep": 7.4, "deep": 1.1, "core": 4.3,
                     "rem": 1.7, "awake": 0.3, "source": "Apple Watch"}]}
        ],
        "workouts": [ ... ]
      }
    }

The parsing functions are pure (no DB) so they can be unit tested in isolation;
``store_payload`` wires them to the database with an idempotent upsert.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from dateutil import parser as dateparser
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .db import init_db, session_scope
from .models import MetricSample, Workout

# Keys that may hold the representative numeric value of a sample, in priority order.
_VALUE_KEYS: tuple[str, ...] = ("qty", "Avg", "avg", "value")
_SLEEP_FALLBACK_KEYS: tuple[str, ...] = ("totalSleep", "asleep", "inBed")
_BATCH = 500


def parse_dt(raw: Any) -> datetime | None:
    """Parse a Health Auto Export date string into a *local, naive* datetime.

    Apple emits timezone-aware strings like ``"2026-01-01 23:30:00 +0000"``.
    We convert to the machine's local time and drop the tzinfo so that daily
    grouping matches what the user sees, and storage stays simple.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = dateparser.parse(raw)
    except (ValueError, OverflowError, TypeError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def _fmt(dt: datetime) -> tuple[str, str]:
    return dt.strftime("%Y-%m-%d %H:%M:%S"), dt.strftime("%Y-%m-%d")


def _first_num(point: dict, keys: Iterable[str]) -> float | None:
    for key in keys:
        value = point.get(key)
        # bool is a subclass of int; exclude it explicitly.
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def _qty_of(obj: Any) -> float | None:
    """Extract a numeric quantity from a scalar or a ``{"qty": ...}`` object."""
    if isinstance(obj, dict):
        return _first_num(obj, ("qty", "value", "Avg", "avg"))
    if isinstance(obj, (int, float)) and not isinstance(obj, bool):
        return float(obj)
    return None


def _avg_hr(workout: dict) -> float | None:
    direct = _first_num(workout, ("avgHeartRate", "averageHeartRate"))
    if direct is not None:
        return direct
    series = workout.get("heartRateData") or workout.get("heartRate")
    if isinstance(series, list) and series:
        vals = [v for p in series if (v := _first_num(p, _VALUE_KEYS)) is not None]
        if vals:
            return sum(vals) / len(vals)
    return None


def normalize_metric_samples(payload: dict) -> list[dict]:
    """Flatten a payload's metrics into rows ready for ``metric_samples``."""
    data = payload.get("data", payload) if isinstance(payload, dict) else {}
    metrics = data.get("metrics") or []
    rows: list[dict] = []
    for metric in metrics:
        if not isinstance(metric, dict):
            continue
        name = metric.get("name")
        if not name:
            continue
        units = metric.get("units")
        for point in metric.get("data") or []:
            if not isinstance(point, dict):
                continue
            dt = parse_dt(point.get("date") or point.get("Date") or point.get("startDate"))
            if dt is None:
                continue
            ts, date = _fmt(dt)
            qty = _first_num(point, _VALUE_KEYS)
            if qty is None and name == "sleep_analysis":
                qty = _first_num(point, _SLEEP_FALLBACK_KEYS)
            rows.append(
                {
                    "metric": name,
                    "units": units,
                    "ts": ts,
                    "date": date,
                    "qty": qty,
                    "vmin": _first_num(point, ("Min", "min")),
                    "vavg": _first_num(point, ("Avg", "avg")),
                    "vmax": _first_num(point, ("Max", "max")),
                    "source": str(point.get("source") or ""),
                    "extra": json.dumps(point, ensure_ascii=False),
                }
            )
    return rows


def normalize_workouts(payload: dict) -> list[dict]:
    """Flatten a payload's workouts into rows ready for ``workouts``."""
    data = payload.get("data", payload) if isinstance(payload, dict) else {}
    workouts = data.get("workouts") or []
    rows: list[dict] = []
    for w in workouts:
        if not isinstance(w, dict):
            continue
        start = parse_dt(w.get("start") or w.get("startDate"))
        if start is None:
            continue
        end = parse_dt(w.get("end") or w.get("endDate"))
        ts, date = _fmt(start)
        rows.append(
            {
                "name": str(w.get("name") or "Workout"),
                "start": ts,
                "end": _fmt(end)[0] if end else None,
                "date": date,
                "duration_s": _first_num(w, ("duration",)),
                "distance_km": _qty_of(w.get("distance")),
                "active_energy_kcal": _qty_of(
                    w.get("activeEnergyBurned") or w.get("activeEnergy")
                ),
                "avg_hr": _avg_hr(w),
                "extra": json.dumps(w, ensure_ascii=False),
            }
        )
    return rows


def _chunks(seq: Sequence[dict], size: int) -> Iterable[Sequence[dict]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def store_metric_rows(rows: Sequence[dict]) -> int:
    """Upsert pre-normalized metric rows. Returns the number processed."""
    if not rows:
        return 0
    init_db()
    with session_scope() as session:
        for chunk in _chunks(rows, _BATCH):
            stmt = sqlite_insert(MetricSample).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["metric", "ts", "source"],
                set_={
                    "qty": stmt.excluded.qty,
                    "vmin": stmt.excluded.vmin,
                    "vavg": stmt.excluded.vavg,
                    "vmax": stmt.excluded.vmax,
                    "units": stmt.excluded.units,
                    "date": stmt.excluded.date,
                    "extra": stmt.excluded.extra,
                },
            )
            session.execute(stmt)
    return len(rows)


def store_workout_rows(rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    init_db()
    with session_scope() as session:
        for chunk in _chunks(rows, _BATCH):
            stmt = sqlite_insert(Workout).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["name", "start"],
                set_={
                    "end": stmt.excluded.end,
                    "date": stmt.excluded.date,
                    "duration_s": stmt.excluded.duration_s,
                    "distance_km": stmt.excluded.distance_km,
                    "active_energy_kcal": stmt.excluded.active_energy_kcal,
                    "avg_hr": stmt.excluded.avg_hr,
                    "extra": stmt.excluded.extra,
                },
            )
            session.execute(stmt)
    return len(rows)


def store_payload(payload: dict) -> dict[str, int]:
    """Parse and persist a full Health Auto Export payload.

    Returns a summary like ``{"metric_samples": 123, "workouts": 4}``.
    Idempotent: re-posting the same data updates rather than duplicates.
    """
    metric_rows = normalize_metric_samples(payload)
    workout_rows = normalize_workouts(payload)
    return {
        "metric_samples": store_metric_rows(metric_rows),
        "workouts": store_workout_rows(workout_rows),
    }
