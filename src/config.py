"""Shared paths and constants for the health monitor."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
REPORTS_DIR = DATA_DIR / "reports"
DB_PATH = DATA_DIR / "health.db"
DEFAULT_EXPORT = DATA_DIR / "export.xml"
SCHEMA_PATH = ROOT / "src" / "ingest" / "schema.sql"

# Only aggregate / show metrics on or after this date (keeps export history in raw tables)
DATA_START_DATE = "2026-01-01"

# Morning private-training window (local clock, Apple Health +0800 strings)
PT_SESSION_START_DATE = "2026-08-03"
PT_SESSION_TIME_START = "07:30"
PT_SESSION_TIME_END = "08:50"

DISCLAIMER = "个人健康观察，非医疗诊断。如有不适请咨询专业医生。"
