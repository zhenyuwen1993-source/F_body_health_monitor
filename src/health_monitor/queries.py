"""Read-side helpers returning pandas DataFrames for the dashboard."""

from __future__ import annotations

import json

import pandas as pd
from sqlalchemy import text

from .db import engine, init_db

# Candidate metric names for each concept. Health Auto Export naming has varied
# across app versions, so we try several and use whichever exists in the data.
METRIC_ALIASES: dict[str, list[str]] = {
    "resting_heart_rate": ["resting_heart_rate"],
    "heart_rate": ["heart_rate"],
    "hrv": ["heart_rate_variability", "heart_rate_variability_sdnn"],
    "walking_hr": ["walking_heart_rate_average"],
    "steps": ["step_count", "steps"],
    "active_energy": ["active_energy", "active_energy_burned"],
    "exercise_time": ["apple_exercise_time", "exercise_time"],
    "stand_time": ["apple_stand_time", "stand_time"],
    "distance": ["walking_running_distance", "distance_walking_running"],
    "flights": ["flights_climbed"],
    "sleep": ["sleep_analysis"],
    "spo2": ["blood_oxygen_saturation", "oxygen_saturation", "blood_oxygen"],
    "respiratory_rate": ["respiratory_rate"],
    "weight": ["weight_body_mass", "body_mass", "weight"],
    "body_fat": ["body_fat_percentage"],
    "vo2_max": ["vo2_max"],
}


def _read_sql(sql: str, params: dict | None = None) -> pd.DataFrame:
    init_db()
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params or {})


def available_metrics() -> list[str]:
    df = _read_sql("SELECT DISTINCT metric FROM metric_samples ORDER BY metric")
    return df["metric"].tolist() if not df.empty else []


def resolve_metric(concept: str, available: list[str] | None = None) -> str | None:
    """Return the first existing metric name for a high-level concept."""
    available = available if available is not None else available_metrics()
    have = set(available)
    for candidate in METRIC_ALIASES.get(concept, [concept]):
        if candidate in have:
            return candidate
    return None


def date_bounds() -> tuple[str | None, str | None]:
    df = _read_sql("SELECT MIN(date) AS lo, MAX(date) AS hi FROM metric_samples")
    if df.empty or pd.isna(df.loc[0, "lo"]):
        return None, None
    return str(df.loc[0, "lo"]), str(df.loc[0, "hi"])


def metric_samples(metric: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
    """Raw samples for a metric within an optional [start, end] date range."""
    sql = (
        "SELECT ts, date, qty, vmin, vavg, vmax, units, source, extra "
        "FROM metric_samples WHERE metric = :metric"
    )
    params: dict = {"metric": metric}
    if start:
        sql += " AND date >= :start"
        params["start"] = start
    if end:
        sql += " AND date <= :end"
        params["end"] = end
    sql += " ORDER BY ts"
    df = _read_sql(sql, params)
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts"])
    return df


def daily_metric(
    metric: str,
    agg: str = "mean",
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame:
    """Per-day aggregate of a metric. ``agg`` is one of sum/mean/min/max/last."""
    agg = agg.lower()
    if agg == "sum":
        expr = "SUM(qty)"
    elif agg == "min":
        expr = "MIN(COALESCE(vmin, qty))"
    elif agg == "max":
        expr = "MAX(COALESCE(vmax, qty))"
    elif agg == "last":
        expr = "qty"  # handled by GROUP BY + MAX(ts) below
    else:
        expr = "AVG(COALESCE(vavg, qty))"

    params: dict = {"metric": metric}
    where = "metric = :metric"
    if start:
        where += " AND date >= :start"
        params["start"] = start
    if end:
        where += " AND date <= :end"
        params["end"] = end

    if agg == "last":
        sql = (
            "SELECT date, qty AS value FROM metric_samples m "
            f"WHERE {where} AND ts = ("
            "  SELECT MAX(ts) FROM metric_samples x "
            "  WHERE x.metric = m.metric AND x.date = m.date) "
            "GROUP BY date ORDER BY date"
        )
    else:
        sql = (
            f"SELECT date, {expr} AS value FROM metric_samples "
            f"WHERE {where} GROUP BY date ORDER BY date"
        )
    df = _read_sql(sql, params)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def daily_hr_band(start: str | None = None, end: str | None = None) -> pd.DataFrame:
    """Per-day heart-rate min/avg/max band."""
    params: dict = {}
    where = "metric = 'heart_rate'"
    if start:
        where += " AND date >= :start"
        params["start"] = start
    if end:
        where += " AND date <= :end"
        params["end"] = end
    sql = (
        "SELECT date, "
        "MIN(COALESCE(vmin, qty)) AS lo, "
        "AVG(COALESCE(vavg, qty)) AS avg, "
        "MAX(COALESCE(vmax, qty)) AS hi "
        f"FROM metric_samples WHERE {where} GROUP BY date ORDER BY date"
    )
    df = _read_sql(sql, params)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def sleep_stages(start: str | None = None, end: str | None = None) -> pd.DataFrame:
    """Per-night sleep totals and stage breakdown, parsed from stored JSON."""
    metric = resolve_metric("sleep")
    if metric is None:
        return pd.DataFrame()
    raw = metric_samples(metric, start, end)
    if raw.empty:
        return pd.DataFrame()
    records = []
    for _, row in raw.iterrows():
        extra = {}
        if isinstance(row.get("extra"), str) and row["extra"]:
            try:
                extra = json.loads(row["extra"])
            except json.JSONDecodeError:
                extra = {}
        total = extra.get("totalSleep") or extra.get("asleep") or row.get("qty")
        records.append(
            {
                "date": row["date"],
                "total": total,
                "deep": extra.get("deep"),
                "core": extra.get("core") or extra.get("light"),
                "rem": extra.get("rem"),
                "awake": extra.get("awake"),
                "in_bed": extra.get("inBed"),
            }
        )
    df = pd.DataFrame(records)
    # One row per night (sum if multiple sleep records share a date).
    numeric = ["total", "deep", "core", "rem", "awake", "in_bed"]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.groupby("date", as_index=False)[numeric].sum(min_count=1)
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date")


def workouts(start: str | None = None, end: str | None = None) -> pd.DataFrame:
    sql = (
        "SELECT name, start, end, date, duration_s, distance_km, "
        "active_energy_kcal, avg_hr FROM workouts WHERE 1=1"
    )
    params: dict = {}
    if start:
        sql += " AND date >= :start"
        params["start"] = start
    if end:
        sql += " AND date <= :end"
        params["end"] = end
    sql += " ORDER BY start DESC"
    df = _read_sql(sql, params)
    if not df.empty:
        df["start"] = pd.to_datetime(df["start"])
    return df


def latest(metric: str) -> tuple[float | None, str | None]:
    """Latest non-null quantity for a metric and its timestamp."""
    df = _read_sql(
        "SELECT ts, qty FROM metric_samples WHERE metric = :m AND qty IS NOT NULL "
        "ORDER BY ts DESC LIMIT 1",
        {"m": metric},
    )
    if df.empty:
        return None, None
    return float(df.loc[0, "qty"]), str(df.loc[0, "ts"])


def table_counts() -> dict[str, int]:
    out: dict[str, int] = {}
    for table in ("metric_samples", "workouts"):
        df = _read_sql(f"SELECT COUNT(*) AS n FROM {table}")
        out[table] = int(df.loc[0, "n"]) if not df.empty else 0
    return out
