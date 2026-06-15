"""Generate realistic demo health data so the dashboard has something to show.

Usage::

    python scripts/load_sample_data.py            # ~120 days of demo data
    python scripts/load_sample_data.py --days 60
    python scripts/load_sample_data.py --clear    # wipe all data first
    python scripts/load_sample_data.py --via-api http://localhost:8000/api/ingest

The generated payload uses the same JSON shape the Health Auto Export iOS app
posts, so it exercises the exact same ingest path as real data.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from health_monitor.db import engine, init_db  # noqa: E402
from health_monitor.ingest import store_payload  # noqa: E402
from health_monitor.models import MetricSample, Workout  # noqa: E402

random.seed(42)
_OFFSET = datetime.now().astimezone().strftime("%z") or "+0000"


def _ts(dt: datetime) -> str:
    return f"{dt:%Y-%m-%d %H:%M:%S} {_OFFSET}"


def _metric(name: str, units: str, data: list[dict]) -> dict:
    return {"name": name, "units": units, "data": data}


def build_payload(days: int) -> dict:
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=days - 1)

    heart_rate, resting_hr, hrv, steps, energy, exercise = [], [], [], [], [], []
    distance, sleep, spo2, resp, weight, vo2 = [], [], [], [], [], []
    workouts: list[dict] = []

    base_weight = 71.5
    for i in range(days):
        day = start + timedelta(days=i)
        weekend = day.weekday() >= 5
        # Slow seasonal-ish wave for variety.
        wave = math.sin(i / 14.0)

        rest = round(random.gauss(59 - wave, 2.2), 1)
        resting_hr.append({"date": _ts(day.replace(hour=4)), "qty": rest, "source": "Apple Watch"})
        hrv.append({"date": _ts(day.replace(hour=4)), "qty": round(random.gauss(48 + wave * 6, 8), 1),
                    "source": "Apple Watch"})

        # A few heart-rate aggregate buckets across the day.
        for hour in (8, 12, 16, 20):
            avg = random.gauss(74 + wave * 3, 6)
            heart_rate.append({
                "date": _ts(day.replace(hour=hour)),
                "Min": round(max(48, avg - random.uniform(10, 18)), 0),
                "Avg": round(avg, 0),
                "Max": round(avg + random.uniform(25, 60), 0),
                "source": "Apple Watch",
            })

        step_total = int(random.gauss(6500 if weekend else 9200, 1800))
        step_total = max(800, step_total)
        steps.append({"date": _ts(day.replace(hour=12)), "qty": step_total, "source": "iPhone"})
        energy.append({"date": _ts(day.replace(hour=12)),
                       "qty": round(step_total * random.uniform(0.045, 0.06), 0), "source": "Apple Watch"})
        exercise.append({"date": _ts(day.replace(hour=12)),
                         "qty": max(0, int(random.gauss(35 if not weekend else 22, 15))), "source": "Apple Watch"})
        distance.append({"date": _ts(day.replace(hour=12)),
                         "qty": round(step_total * random.uniform(0.0006, 0.00075), 2), "source": "Apple Watch"})

        total_sleep = max(4.5, random.gauss(7.2 + (0.4 if weekend else 0), 0.8))
        deep = round(total_sleep * random.uniform(0.13, 0.22), 2)
        rem = round(total_sleep * random.uniform(0.18, 0.26), 2)
        awake = round(random.uniform(0.1, 0.5), 2)
        core = round(max(0.5, total_sleep - deep - rem), 2)
        bed = day.replace(hour=23) - timedelta(days=1)
        sleep.append({
            "date": _ts(bed), "sleepStart": _ts(bed),
            "sleepEnd": _ts(bed + timedelta(hours=total_sleep + awake)),
            "totalSleep": round(total_sleep, 2), "inBed": round(total_sleep + awake, 2),
            "deep": deep, "core": core, "rem": rem, "awake": awake, "source": "Apple Watch",
        })

        spo2.append({"date": _ts(day.replace(hour=4)),
                     "qty": round(min(100, random.gauss(97.5, 0.8)), 1), "source": "Apple Watch"})
        resp.append({"date": _ts(day.replace(hour=4)),
                     "qty": round(random.gauss(15, 1.2), 1), "source": "Apple Watch"})

        base_weight += random.uniform(-0.08, 0.06)
        if i % 2 == 0:
            weight.append({"date": _ts(day.replace(hour=7)), "qty": round(base_weight, 1), "source": "Health"})
        if i % 7 == 0:
            vo2.append({"date": _ts(day.replace(hour=12)),
                        "qty": round(random.gauss(43, 1.5), 1), "source": "Apple Watch"})

        # Workouts on ~half of days.
        if random.random() < 0.5:
            kind = random.choice(["Outdoor Run", "Outdoor Walk", "Cycling", "Strength Training"])
            dur_min = random.choice([25, 30, 40, 45, 60])
            wstart = day.replace(hour=random.choice([7, 12, 18]))
            dist = 0.0
            if kind in ("Outdoor Run", "Outdoor Walk", "Cycling"):
                speed = {"Outdoor Run": 0.16, "Outdoor Walk": 0.09, "Cycling": 0.33}[kind]
                dist = round(dur_min * speed * random.uniform(0.9, 1.1), 2)
            workouts.append({
                "name": kind, "start": _ts(wstart), "end": _ts(wstart + timedelta(minutes=dur_min)),
                "duration": dur_min * 60,
                "distance": {"qty": dist, "units": "km"},
                "activeEnergyBurned": {"qty": round(dur_min * random.uniform(7, 11), 0), "units": "kcal"},
                "avgHeartRate": round(random.gauss(132, 10), 0),
            })

    metrics = [
        _metric("heart_rate", "count/min", heart_rate),
        _metric("resting_heart_rate", "count/min", resting_hr),
        _metric("heart_rate_variability", "ms", hrv),
        _metric("step_count", "count", steps),
        _metric("active_energy", "kcal", energy),
        _metric("apple_exercise_time", "min", exercise),
        _metric("walking_running_distance", "km", distance),
        _metric("sleep_analysis", "hr", sleep),
        _metric("blood_oxygen_saturation", "%", spo2),
        _metric("respiratory_rate", "count/min", resp),
        _metric("weight_body_mass", "kg", weight),
        _metric("vo2_max", "ml/(kg*min)", vo2),
    ]
    return {"data": {"metrics": metrics, "workouts": workouts}}


def clear_data() -> None:
    init_db()
    from sqlalchemy import delete

    with engine.begin() as conn:
        conn.execute(delete(MetricSample))
        conn.execute(delete(Workout))
    print("Cleared all existing data.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Load demo health data.")
    parser.add_argument("--days", type=int, default=120, help="number of days to generate")
    parser.add_argument("--clear", action="store_true", help="delete existing data first")
    parser.add_argument("--via-api", metavar="URL", help="POST to a running ingest API instead of writing directly")
    args = parser.parse_args()

    if args.clear:
        clear_data()

    payload = build_payload(args.days)

    if args.via_api:
        req = urllib.request.Request(
            args.via_api, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - local trusted URL
            print(f"POST {args.via_api} -> {resp.status} {resp.read().decode()}")
    else:
        summary = store_payload(payload)
        print(f"Loaded demo data: {summary}")


if __name__ == "__main__":
    main()
