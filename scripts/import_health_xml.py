"""Import an Apple Health *Export All Health Data* file (export.xml).

This is the manual fallback for getting data in without the Health Auto Export
app. On iPhone: Health app -> profile picture -> "Export All Health Data" ->
share the zip to your computer, unzip, then::

    python scripts/import_health_xml.py path/to/apple_health_export/export.xml

The file can be very large (hundreds of MB), so it is streamed with iterparse.
Quantity records (heart rate, steps, weight, ...) are imported. Categorical
records such as detailed sleep stages are summarized as nightly "asleep" hours.
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from health_monitor.ingest import parse_dt, store_metric_rows  # noqa: E402

# Explicit aliases so names line up with the dashboard's expectations.
_ALIASES = {
    "HeartRate": "heart_rate",
    "RestingHeartRate": "resting_heart_rate",
    "HeartRateVariabilitySDNN": "heart_rate_variability",
    "WalkingHeartRateAverage": "walking_heart_rate_average",
    "StepCount": "step_count",
    "DistanceWalkingRunning": "walking_running_distance",
    "ActiveEnergyBurned": "active_energy",
    "BasalEnergyBurned": "basal_energy_burned",
    "AppleExerciseTime": "apple_exercise_time",
    "AppleStandTime": "apple_stand_time",
    "FlightsClimbed": "flights_climbed",
    "OxygenSaturation": "blood_oxygen_saturation",
    "RespiratoryRate": "respiratory_rate",
    "BodyMass": "weight_body_mass",
    "BodyMassIndex": "body_mass_index",
    "BodyFatPercentage": "body_fat_percentage",
    "VO2Max": "vo2_max",
}


def _snake(identifier: str) -> str:
    name = identifier.split("Identifier", 1)[-1]
    if name in _ALIASES:
        return _ALIASES[name]
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and not name[i - 1].isupper():
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def _fmt(dt: datetime) -> tuple[str, str]:
    return dt.strftime("%Y-%m-%d %H:%M:%S"), dt.strftime("%Y-%m-%d")


def import_xml(path: Path) -> dict[str, int]:
    rows: list[dict] = []
    sleep_by_night: dict[str, float] = defaultdict(float)
    skipped = 0

    context = ET.iterparse(str(path), events=("end",))
    for _event, elem in context:
        if elem.tag != "Record":
            continue
        rtype = elem.get("type", "")
        dt = parse_dt(elem.get("startDate"))
        if dt is None:
            elem.clear()
            continue
        ts, date = _fmt(dt)

        if rtype == "HKCategoryTypeIdentifierSleepAnalysis":
            value = elem.get("value", "")
            if "Asleep" in value:
                end = parse_dt(elem.get("endDate"))
                if end:
                    sleep_by_night[date] += (end - dt).total_seconds() / 3600.0
            elem.clear()
            continue

        raw = elem.get("value")
        try:
            qty = float(raw) if raw is not None else None
        except ValueError:
            qty = None
        if qty is None:
            skipped += 1
            elem.clear()
            continue

        rows.append({
            "metric": _snake(rtype),
            "units": elem.get("unit"),
            "ts": ts,
            "date": date,
            "qty": qty,
            "vmin": None,
            "vavg": qty,
            "vmax": None,
            "source": str(elem.get("sourceName") or ""),
            "extra": None,
        })
        elem.clear()

    for date, hours in sleep_by_night.items():
        rows.append({
            "metric": "sleep_analysis",
            "units": "hr",
            "ts": f"{date} 23:00:00",
            "date": date,
            "qty": round(hours, 2),
            "vmin": None,
            "vavg": None,
            "vmax": None,
            "source": "AppleHealthExport",
            "extra": json.dumps({"totalSleep": round(hours, 2)}),
        })

    stored = store_metric_rows(rows)
    return {"records": stored, "sleep_nights": len(sleep_by_night), "skipped_non_numeric": skipped}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Apple Health export.xml")
    parser.add_argument("xml_path", type=Path, help="path to export.xml")
    args = parser.parse_args()
    if not args.xml_path.exists():
        raise SystemExit(f"File not found: {args.xml_path}")
    print(f"Importing {args.xml_path} (this can take a while for large files)...")
    print(import_xml(args.xml_path))


if __name__ == "__main__":
    main()
