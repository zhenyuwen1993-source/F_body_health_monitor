"""Pytest configuration: isolate tests onto a throwaway database.

The env var is set *before* any ``health_monitor`` module is imported, so the
engine that ``config``/``db`` build at import time points at a temp file rather
than the real ``data/health.db``.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_DB = Path(tempfile.gettempdir()) / "hm_test_health.db"
os.environ["HM_DB_PATH"] = str(_TMP_DB)
os.environ.pop("HM_API_KEY", None)

# Clean any leftovers from a previous run (including WAL/SHM sidecars).
for _suffix in ("", "-wal", "-shm"):
    p = Path(str(_TMP_DB) + _suffix)
    if p.exists():
        p.unlink()


@pytest.fixture(autouse=True)
def _clean_db():
    """Start every test from an empty database so tests stay independent."""
    from sqlalchemy import delete

    from health_monitor.db import engine, init_db
    from health_monitor.models import MetricSample, Workout

    init_db()
    with engine.begin() as conn:
        conn.execute(delete(MetricSample))
        conn.execute(delete(Workout))
    yield
