from __future__ import annotations

import pytest

from health_monitor import ingest
from health_monitor.queries import daily_hr_band, daily_metric, sleep_stages, table_counts

PAYLOAD = {
    "data": {
        "metrics": [
            {
                "name": "step_count",
                "units": "count",
                "data": [
                    {"date": "2026-01-01 12:00:00 +0000", "qty": 8421, "source": "Apple Watch"},
                    {"date": "2026-01-02 12:00:00 +0000", "qty": 10010, "source": "Apple Watch"},
                ],
            },
            {
                "name": "heart_rate",
                "units": "count/min",
                "data": [
                    {"date": "2026-01-01 09:00:00 +0000", "Min": 54, "Avg": 72, "Max": 131,
                     "source": "Apple Watch"},
                ],
            },
            {
                "name": "sleep_analysis",
                "units": "hr",
                "data": [
                    {"date": "2026-01-01 23:00:00 +0000", "totalSleep": 7.4, "deep": 1.1,
                     "core": 4.3, "rem": 1.7, "awake": 0.3, "source": "Apple Watch"},
                ],
            },
        ],
        "workouts": [
            {
                "name": "Outdoor Run",
                "start": "2026-01-02 07:00:00 +0000",
                "end": "2026-01-02 07:35:00 +0000",
                "duration": 2100,
                "distance": {"qty": 5.2, "units": "km"},
                "activeEnergyBurned": {"qty": 312, "units": "kcal"},
                "heartRateData": [{"date": "2026-01-02 07:10:00 +0000", "qty": 140}],
            }
        ],
    }
}


def test_parse_dt_converts_offset_to_naive_local():
    dt = ingest.parse_dt("2026-01-01 12:00:00 +0000")
    assert dt is not None
    assert dt.tzinfo is None  # stored as naive local time


def test_parse_dt_rejects_garbage():
    assert ingest.parse_dt("not a date") is None
    assert ingest.parse_dt(None) is None
    assert ingest.parse_dt("") is None


def test_normalize_metric_samples_extracts_values():
    rows = ingest.normalize_metric_samples(PAYLOAD)
    by_metric = {(r["metric"], r["ts"]): r for r in rows}
    assert len(rows) == 4

    hr = next(r for r in rows if r["metric"] == "heart_rate")
    assert (hr["vmin"], hr["vavg"], hr["vmax"], hr["qty"]) == (54.0, 72.0, 131.0, 72.0)

    sleep = next(r for r in rows if r["metric"] == "sleep_analysis")
    assert sleep["qty"] == pytest.approx(7.4)  # totalSleep used as representative qty
    assert by_metric  # smoke


def test_normalize_workouts():
    rows = ingest.normalize_workouts(PAYLOAD)
    assert len(rows) == 1
    w = rows[0]
    assert w["name"] == "Outdoor Run"
    assert w["distance_km"] == pytest.approx(5.2)
    assert w["active_energy_kcal"] == pytest.approx(312)
    assert w["avg_hr"] == pytest.approx(140)


def test_store_payload_is_idempotent():
    first = ingest.store_payload(PAYLOAD)
    counts_after_first = table_counts()
    second = ingest.store_payload(PAYLOAD)
    counts_after_second = table_counts()

    assert first["metric_samples"] == 4
    assert first["workouts"] == 1
    # Re-ingesting the same payload upserts, it does not duplicate.
    assert counts_after_first == counts_after_second


def test_queries_aggregate_correctly():
    ingest.store_payload(PAYLOAD)
    steps = daily_metric("step_count", agg="sum")
    assert steps["value"].sum() == pytest.approx(8421 + 10010)

    band = daily_hr_band()
    assert band.iloc[0]["lo"] == 54
    assert band.iloc[0]["hi"] == 131

    sleep = sleep_stages()
    assert not sleep.empty
    assert sleep.iloc[0]["deep"] == pytest.approx(1.1)
