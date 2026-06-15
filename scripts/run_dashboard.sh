#!/usr/bin/env bash
# Start the Streamlit dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."
streamlit run dashboard/app.py
