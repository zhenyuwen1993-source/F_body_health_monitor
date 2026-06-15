#!/usr/bin/env bash
# Start the ingest API (Health Auto Export posts here).
set -euo pipefail
cd "$(dirname "$0")/.."
python -m health_monitor.api
