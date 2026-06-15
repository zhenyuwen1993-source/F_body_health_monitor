from __future__ import annotations

from fastapi.testclient import TestClient

from health_monitor.api import app

client = TestClient(app)

MINIMAL = {
    "data": {
        "metrics": [
            {"name": "step_count", "units": "count",
             "data": [{"date": "2026-02-01 12:00:00 +0000", "qty": 5000, "source": "iPhone"}]}
        ]
    }
}


def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "counts" in body


def test_ingest_endpoint_stores_data():
    resp = client.post("/api/ingest", json=MINIMAL)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["stored"]["metric_samples"] == 1


def test_ingest_rejects_non_object():
    resp = client.post("/api/ingest", json=[1, 2, 3])
    assert resp.status_code == 400
