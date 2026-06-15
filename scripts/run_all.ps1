# Start the ingest API in a new window, then the dashboard in this one.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\run_api.ps1"
streamlit run "dashboard/app.py"
