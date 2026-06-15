# Start the ingest API (Health Auto Export posts here).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
python -m health_monitor.api
