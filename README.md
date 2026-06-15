# ❤️ F Body Health Monitor

Pull your **Apple Watch** health data onto your computer and analyze it with a
local dashboard — no cloud, no iOS coding required.

```
 Apple Watch ──(auto sync)──▶ iPhone (Apple Health / HealthKit)
                                   │
                                   │  Health Auto Export app  (POST JSON, scheduled)
                                   ▼
              ┌──────────────────────────────────────────────┐
              │  Your computer (Windows / Mac)                │
              │                                               │
              │   FastAPI ingest  ──▶  SQLite  ──▶  Streamlit │
              │   /api/ingest          health.db    dashboard │
              └──────────────────────────────────────────────┘
```

Apple does **not** let a desktop read HealthKit directly, so the bridge is the
[**Health Auto Export – JSON+CSV**](https://apps.apple.com/app/health-auto-export-json-csv/id1115567069)
iOS app, which posts your HealthKit data to this project's small ingest API on a
schedule. Everything is then stored and visualized locally.

> 🇨🇳 **快速开始**：①`pip install -e ".[dev]"` ②`python scripts/load_sample_data.py`（生成演示数据）
> ③`streamlit run dashboard/app.py` 打开仪表盘。真实数据接入见下方「Connect your iPhone」。

---

## Quick start (with demo data)

From the project root:

```bash
# 1. Install (creates the importable `health_monitor` package + deps)
python -m pip install -e ".[dev]"

# 2. Load ~120 days of realistic demo data so the dashboard isn't empty
python scripts/load_sample_data.py

# 3. Open the dashboard
streamlit run dashboard/app.py
```

The dashboard opens at <http://localhost:8501>. When you're ready for real data,
clear the demo with `python scripts/load_sample_data.py --clear`.

On Windows you can also just run the helper scripts:

```powershell
powershell -File scripts/run_dashboard.ps1     # dashboard only
powershell -File scripts/run_all.ps1           # ingest API + dashboard together
```

---

## Connect your iPhone (real data)

### 1. Start the ingest API on your computer

```bash
python -m health_monitor.api        # or:  hm-api  / scripts/run_api.ps1
```

It listens on `0.0.0.0:8000`. Sanity-check it in a browser:
<http://localhost:8000/api/health> should return `{"status": "ok", ...}`.

### 2. Find your computer's LAN IP

Your iPhone needs to reach the computer over the **same Wi-Fi**.

- **Windows:** run `ipconfig` and look for *IPv4 Address* (e.g. `192.168.1.42`).
- **Mac:** run `ipconfig getifaddr en0` (Wi-Fi) — e.g. `192.168.1.42`.

Your ingest URL is then `http://192.168.1.42:8000/api/ingest`.

> **Windows firewall:** the first time, allow Python through the firewall on
> *Private* networks (Windows will prompt), or run once in an admin terminal:
> `New-NetFirewallRule -DisplayName "Health Monitor" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`

### 3. Configure Health Auto Export on the iPhone

1. Install **Health Auto Export – JSON+CSV** from the App Store and grant it
   read access to Apple Health (this includes all your Apple Watch data).
2. Create an **Automation** with:
   - **Export type / destination:** REST API
   - **URL:** `http://<your-computer-ip>:8000/api/ingest`
   - **Method:** POST  **Format:** JSON
   - **Data / metrics:** select what you want (Heart Rate, Resting Heart Rate,
     HRV, Steps, Active Energy, Sleep Analysis, Blood Oxygen, Respiratory Rate,
     Body Mass, Workouts, …)
   - **Aggregation:** e.g. daily or hourly
   - **Schedule:** e.g. every hour (or run it manually to test first)
3. Tap **Run / Export now** once. Watch the API terminal log the POST, then
   refresh the dashboard.

### Optional: require an API key

Set `HM_API_KEY=somesecret` in a `.env` file (copy from `.env.example`), restart
the API, and add a header in the Health Auto Export automation:
`X-API-Key: somesecret`.

---

## Manual fallback: import an Apple Health export

No app, one-off snapshot: on iPhone open **Health → profile picture → Export All
Health Data**, AirDrop/share the zip to your computer, unzip, then:

```bash
python scripts/import_health_xml.py path/to/apple_health_export/export.xml
```

---

## Project layout

```
src/health_monitor/
  config.py     env-based settings (DB path, API host/port, optional key)
  models.py     SQLAlchemy models: metric_samples, workouts
  db.py         engine + session + init
  ingest.py     parse Health Auto Export JSON  (pure, unit-tested)
  api.py        FastAPI ingest server  (POST /api/ingest)
  queries.py    pandas read helpers for the dashboard
dashboard/
  app.py        Streamlit dashboard (Overview / Heart / Sleep / Activity / Workouts / Explore)
scripts/
  load_sample_data.py   generate demo data (or --via-api / --clear)
  import_health_xml.py  import Apple Health export.xml
  run_*.ps1 / run_*.sh  convenience launchers
tests/          pytest suite (parser, idempotent upsert, API)
data/           SQLite DB + exports live here (gitignored)
```

The schema keeps the **full original JSON** of every sample in an `extra`
column, so nothing is lost and new analyses can be added without re-importing.

## Tests

```bash
pytest
```

## Privacy

Your health data stays on your machine. The `data/` directory (the SQLite DB and
any exported files) is **gitignored** and never committed.

## Roadmap

The dashboard ("trends & visualization") is the first milestone. The storage
layer is built to grow into:

- **Anomaly detection & alerts** — flag resting-HR spikes, low HRV, irregular sleep.
- **ML insights** — recovery/readiness scoring, trend forecasting.
- **More sources** — direct `export.xml` sleep-stage parsing, third-party rings/scales.
