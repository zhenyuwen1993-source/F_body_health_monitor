#!/usr/bin/env bash
# Start the ingest API (Health Auto Export posts here).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=".venv/bin/python"; [ -x "$PY" ] || PY="python3"
"$PY" -m health_monitor.api
