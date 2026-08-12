"""Stream-parse Apple Health export.xml into SQLite."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Iterator
from xml.etree.ElementTree import Element

from lxml import etree

from src.config import DB_PATH, DEFAULT_EXPORT, SCHEMA_PATH

BATCH_SIZE = 5000

# Attributes commonly found on Record / Workout that we store as columns
RECORD_ATTRS = (
    "type",
    "sourceName",
    "sourceVersion",
    "unit",
    "creationDate",
    "startDate",
    "endDate",
    "value",
    "device",
)

WORKOUT_ATTRS = (
    "workoutActivityType",
    "duration",
    "durationUnit",
    "totalDistance",
    "totalDistanceUnit",
    "totalEnergyBurned",
    "totalEnergyBurnedUnit",
    "sourceName",
    "sourceVersion",
    "creationDate",
    "startDate",
    "endDate",
    "device",
)


def init_db(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema)
    _migrate_daily_metrics(conn)
    return conn


def _migrate_daily_metrics(conn: sqlite3.Connection) -> None:
    """Add columns introduced after first schema version."""
    existing = {
        row[1] for row in conn.execute("PRAGMA table_info(daily_metrics)").fetchall()
    }
    alters = {
        "sleep_bedtime_min": "REAL",
        "sleep_wake_min": "REAL",
        "sleep_consistency": "REAL",
        "training_load": "REAL",
        "ctl": "REAL",
        "atl": "REAL",
        "tsb": "REAL",
        "preferred_sources_json": "TEXT",
    }
    for col, typ in alters.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE daily_metrics ADD COLUMN {col} {typ}")
    conn.commit()


def _extra_attrs(elem: Element, known: set[str]) -> dict[str, str]:
    return {k: v for k, v in elem.attrib.items() if k not in known}


def _metadata_from_children(elem: Element) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    for child in elem:
        tag = child.tag
        if tag == "MetadataEntry":
            key = child.get("key")
            if key:
                meta[key] = child.get("value")
        elif tag == "HeartRateData":
            # Collect compact samples if present
            samples = meta.setdefault("HeartRateData", [])
            samples.append(dict(child.attrib))
        elif tag in {"WorkoutEvent", "WorkoutStatistics", "WorkoutRoute", "FileReference"}:
            bucket = meta.setdefault(tag, [])
            bucket.append(dict(child.attrib))
    return meta


def _clear_element(elem: Element) -> None:
    elem.clear()
    while elem.getprevious() is not None:
        del elem.getparent()[0]


def iter_health_elements(xml_path: Path) -> Iterator[tuple[str, Element]]:
    """Yield (tag, element) for Record, Workout, Correlation, ClinicalRecord, ActivitySummary."""
    interesting = {
        "Record",
        "Workout",
        "Correlation",
        "ClinicalRecord",
        "ActivitySummary",
        "Me",
    }
    context = etree.iterparse(
        str(xml_path),
        events=("end",),
        tag=list(interesting),
        huge_tree=True,
        recover=True,
    )
    for _event, elem in context:
        yield elem.tag, elem
        _clear_element(elem)


def _record_row(elem: Element) -> tuple:
    known = set(RECORD_ATTRS)
    extras = _extra_attrs(elem, known)
    child_meta = _metadata_from_children(elem)
    if extras:
        child_meta["attrs"] = extras
    meta_json = json.dumps(child_meta, ensure_ascii=False) if child_meta else None
    return (
        elem.get("type") or "Unknown",
        elem.get("sourceName"),
        elem.get("sourceVersion"),
        elem.get("unit"),
        elem.get("creationDate"),
        elem.get("startDate"),
        elem.get("endDate"),
        elem.get("value"),
        elem.get("device"),
        meta_json,
    )


def _activity_summary_row(elem: Element) -> tuple:
    """Store ActivitySummary as a synthetic record type."""
    meta = dict(elem.attrib)
    day = elem.get("dateComponents") or elem.get("startDate") or ""
    return (
        "ActivitySummary",
        None,
        None,
        None,
        None,
        day,
        day,
        json.dumps(meta, ensure_ascii=False),
        None,
        json.dumps({"attrs": meta}, ensure_ascii=False),
    )


def _correlation_row(elem: Element) -> tuple:
    known = {"type", "sourceName", "sourceVersion", "unit", "creationDate", "startDate", "endDate", "device"}
    extras = _extra_attrs(elem, known)
    child_meta = _metadata_from_children(elem)
    records = []
    for child in elem:
        if child.tag == "Record":
            records.append(dict(child.attrib))
    if records:
        child_meta["records"] = records
    if extras:
        child_meta["attrs"] = extras
    return (
        elem.get("type") or "Correlation",
        elem.get("sourceName"),
        elem.get("sourceVersion"),
        elem.get("unit"),
        elem.get("creationDate"),
        elem.get("startDate"),
        elem.get("endDate"),
        None,
        elem.get("device"),
        json.dumps(child_meta, ensure_ascii=False) if child_meta else None,
    )


def _workout_row(elem: Element) -> tuple:
    known = set(WORKOUT_ATTRS)
    extras = _extra_attrs(elem, known)
    child_meta = _metadata_from_children(elem)
    if extras:
        child_meta["attrs"] = extras

    def _f(name: str) -> float | None:
        v = elem.get(name)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except ValueError:
            return None

    return (
        elem.get("workoutActivityType"),
        _f("duration"),
        elem.get("durationUnit"),
        _f("totalDistance"),
        elem.get("totalDistanceUnit"),
        _f("totalEnergyBurned"),
        elem.get("totalEnergyBurnedUnit"),
        elem.get("sourceName"),
        elem.get("sourceVersion"),
        elem.get("creationDate"),
        elem.get("startDate"),
        elem.get("endDate"),
        elem.get("device"),
        json.dumps(child_meta, ensure_ascii=False) if child_meta else None,
    )


def reset_data_tables(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM raw_records")
    conn.execute("DELETE FROM workouts")
    # Keep manual mood entries; clear export-sourced moods
    conn.execute("DELETE FROM mood_entries WHERE source != 'manual'")
    conn.execute("DELETE FROM daily_metrics")
    conn.execute("DELETE FROM reports")
    conn.commit()


def ingest_export(
    xml_path: Path = DEFAULT_EXPORT,
    db_path: Path = DB_PATH,
    *,
    reset: bool = True,
) -> dict[str, int]:
    if not xml_path.exists():
        raise FileNotFoundError(
            f"找不到导出文件: {xml_path}\n"
            "请将 Apple 健康 export.xml 放到 data/export.xml（见 README）"
        )

    conn = init_db(db_path)
    if reset:
        reset_data_tables(conn)

    record_buf: list[tuple] = []
    workout_buf: list[tuple] = []
    counts = {
        "Record": 0,
        "Workout": 0,
        "Correlation": 0,
        "ActivitySummary": 0,
        "ClinicalRecord": 0,
        "Me": 0,
        "other": 0,
    }
    started = time.time()

    def flush_records() -> None:
        if not record_buf:
            return
        conn.executemany(
            """
            INSERT INTO raw_records (
                record_type, source_name, source_version, unit,
                creation_date, start_date, end_date, value, device, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            record_buf,
        )
        record_buf.clear()

    def flush_workouts() -> None:
        if not workout_buf:
            return
        conn.executemany(
            """
            INSERT INTO workouts (
                workout_activity_type, duration, duration_unit,
                total_distance, total_distance_unit,
                total_energy_burned, total_energy_burned_unit,
                source_name, source_version, creation_date,
                start_date, end_date, device, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            workout_buf,
        )
        workout_buf.clear()

    print(f"开始解析: {xml_path} ({xml_path.stat().st_size / 1e6:.1f} MB)", flush=True)

    for tag, elem in iter_health_elements(xml_path):
        if tag == "Record":
            record_buf.append(_record_row(elem))
            counts["Record"] += 1
            if len(record_buf) >= BATCH_SIZE:
                flush_records()
                conn.commit()
                print(f"  records={counts['Record']:,} workouts={counts['Workout']:,}", flush=True)
        elif tag == "Workout":
            workout_buf.append(_workout_row(elem))
            counts["Workout"] += 1
            if len(workout_buf) >= BATCH_SIZE:
                flush_workouts()
                conn.commit()
        elif tag == "Correlation":
            record_buf.append(_correlation_row(elem))
            counts["Correlation"] += 1
        elif tag == "ActivitySummary":
            record_buf.append(_activity_summary_row(elem))
            counts["ActivitySummary"] += 1
        elif tag == "ClinicalRecord":
            # Store clinical payloads as opaque records
            record_buf.append(
                (
                    "ClinicalRecord",
                    elem.get("sourceName"),
                    None,
                    None,
                    elem.get("creationDate"),
                    elem.get("startDate") or elem.get("creationDate"),
                    elem.get("endDate") or elem.get("creationDate"),
                    elem.get("type"),
                    None,
                    json.dumps(dict(elem.attrib), ensure_ascii=False),
                )
            )
            counts["ClinicalRecord"] += 1
        elif tag == "Me":
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                ("me", json.dumps(dict(elem.attrib), ensure_ascii=False)),
            )
            counts["Me"] += 1
        else:
            counts["other"] += 1

    flush_records()
    flush_workouts()
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("last_ingest_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("last_export_path", str(xml_path)),
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("ingest_counts", json.dumps(counts)),
    )
    conn.commit()
    elapsed = time.time() - started
    print(f"入库完成，用时 {elapsed:.1f}s: {counts}", flush=True)
    conn.close()
    return counts


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    path = Path(argv[0]) if argv else DEFAULT_EXPORT
    ingest_export(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
