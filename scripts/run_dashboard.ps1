# Start the Streamlit dashboard.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
streamlit run "dashboard/app.py"
