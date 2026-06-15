# Start the ingest API in a new window, then the dashboard in this one.
$ErrorActionPreference = "Stop"
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\run_api.ps1"
& "$PSScriptRoot\run_dashboard.ps1"
