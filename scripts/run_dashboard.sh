#!/usr/bin/env bash
# Start the Streamlit dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=".venv/bin/python"; [ -x "$PY" ] || PY="python3"
"$PY" -m streamlit run dashboard/app.py
