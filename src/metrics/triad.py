"""WHOOP / Athlytic / Bevel-inspired Recovery · Strain · Sleep triad.

Technical notes (competitors + our constraints)
-----------------------------------------------
Recovery (Athlytic / Bevel / WHOOP / HRV4Training):
  - Morning static score from overnight/near-wake HRV + RHR vs personal baseline.
  - Apple Health exposes SDNN, not rMSSD (HRV4Training/Marco Altini prefer rMSSD from RR).
  - We use SDNN vs ~60-day median + RHR vs baseline + sleep performance blend.
  - HRV sample density here is often 1–5/day — fine for daily Recovery, not continuous curves.

Strain (WHOOP / Bevel / Banister TRIMP):
  - WHOOP: HRR zones, continuous PPG, log scale 0–21; muscular load for strength.
  - We approximate cardiovascular load via Banister TRIMP on exported HR samples
    (Δt between points, skip gaps >30 min), then map TRIMP → 0–21 with 1−exp(−k·TRIMP).
  - Apple PhysicalEffort (kcal/hr·kg ≈ METs) adds a light muscular/activity proxy.
  - Not real-time wrist Strain; day-level after export ingest.

Sleep (Oura / WHOOP / Bevel / Garmin Sleep Coach):
  - Sleep Performance ≈ f(duration vs need, stages when present, consistency).
  - This export often lacks recent sleep stages — degrade gracefully to duration/need.

Target Strain Zone (WHOOP Strain Coach / Athlytic Exertion Target):
  - Map morning Recovery → recommended day Strain range (restore / maintain / perform).

Gentler Streak: softer “balance” coaching — we expose restore days explicitly when Recovery low.
TrainingPeaks / CTL-ATL: already in daily_metrics; triad sits beside, not replaces, TSB.
"""

from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any

from src.config import DATA_START_DATE, DB_PATH
from src.ingest.parse_export import init_db
from src.metrics.compute import parse_apple_date
from src.metrics.workouts import estimate_hr_max
from src.profile import load_profile


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _n(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        import math

        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


@dataclass
class TriadDay:
    day: str
    recovery_pct: float | None
    recovery_band: str  # green / yellow / red / unknown
    strain: float | None
    strain_trimp: float | None
    strain_from_hr: float | None
    strain_from_effort: float | None
    hr_samples: int
    sleep_performance: float | None
    sleep_need_h: float | None
    sleep_debt_h: float | None
    target_low: float | None
    target_high: float | None
    target_intent: str  # restore / maintain / perform
    hrv_ratio: float | None
    rhr_ratio: float | None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def recovery_band(pct: float | None) -> str:
    if pct is None:
        return "unknown"
    if pct >= 67:
        return "green"
    if pct >= 34:
        return "yellow"
    return "red"


def target_strain_zone(recovery_pct: float | None) -> tuple[float, float, str]:
    """WHOOP/Athlytic-style target exertion from morning recovery."""
    if recovery_pct is None:
        return 6.0, 12.0, "maintain"
    if recovery_pct < 34:
        return 0.0, 8.0, "restore"
    if recovery_pct < 67:
        return 8.0, 14.0, "maintain"
    return 12.0, 18.0, "perform"


def _rolling_median(vals: list[float], window: int = 60) -> float | None:
    use = [v for v in vals[-window:] if v is not None]
    return median(use) if use else None


def compute_recovery_pct(
    hrv: float | None,
    rhr: float | None,
    hrv_base: float | None,
    rhr_base: float | None,
    sleep_performance: float | None = None,
) -> tuple[float | None, float | None, float | None]:
    """Athlytic-like: HRV weighted slightly above RHR; optional sleep blend.

    Returns (recovery_pct, hrv_ratio, rhr_ratio).
    """
    parts: list[tuple[float, float]] = []
    hrv_ratio = None
    rhr_ratio = None

    if hrv is not None and hrv_base and hrv_base > 0:
        hrv_ratio = hrv / hrv_base
        # clip extreme single-sample spikes common in Apple SDNN exports
        hrv_ratio_clipped = max(0.55, min(1.45, hrv_ratio))
        hrv_score = _clamp(55 + (hrv_ratio_clipped - 1.0) * 150)
        parts.append((hrv_score, 0.55))

    if rhr is not None and rhr_base and rhr_base > 0:
        rhr_ratio = rhr / rhr_base
        # higher RHR worse: 1.0 → 55, 1.1 → 25, 0.95 → 70
        rhr_score = _clamp(55 - (rhr_ratio - 1.0) * 300)
        parts.append((rhr_score, 0.35))

    if sleep_performance is not None:
        parts.append((sleep_performance, 0.15))

    if not parts:
        return None, hrv_ratio, rhr_ratio
    total_w = sum(w for _, w in parts)
    pct = sum(s * w for s, w in parts) / total_w
    return round(_clamp(pct), 0), hrv_ratio, rhr_ratio


def sleep_performance_pct(
    sleep_h: float | None,
    need_h: float,
    deep_h: float | None = None,
    rem_h: float | None = None,
    consistency: float | None = None,
) -> float | None:
    if sleep_h is None and consistency is None:
        return None
    scores: list[float] = []
    if sleep_h is not None and need_h > 0:
        dur = _clamp((sleep_h / need_h) * 100.0)
        if sleep_h > need_h * 1.15:
            dur = _clamp(100 - (sleep_h - need_h * 1.15) * 8)
        scores.append(dur)
    if sleep_h and sleep_h > 0 and deep_h is not None and rem_h is not None:
        stage_frac = (deep_h + rem_h) / sleep_h
        scores.append(_clamp(stage_frac / 0.40 * 100))
    if consistency is not None:
        scores.append(consistency)
    return round(mean(scores), 0) if scores else None


def sleep_need_and_debt(rows: list[dict], latest: dict) -> tuple[float, float]:
    base = 7.5
    loads = [_n(r.get("training_load")) for r in rows[-7:]]
    loads = [x for x in loads if x is not None]
    avg_load = mean(loads) if loads else 0.0
    need = base + min(1.5, avg_load / 80.0)
    tsb = _n(latest.get("tsb"))
    if tsb is not None and tsb < -10:
        need += 0.3
    debt = 0.0
    for r in rows[-3:]:
        sh = _n(r.get("sleep_hours"))
        if sh is None:
            debt += need * 0.5
        else:
            debt += max(0.0, need - sh) * 0.5
    return round(need, 1), round(debt, 1)


def trimp_to_strain(trimp: float, scale: float = 180.0) -> float:
    """Log-like 0–21 mapping (WHOOP-shaped, not identical)."""
    return round(21.0 * (1.0 - math.exp(-max(0.0, trimp) / scale)), 2)


def banister_trimp_segment(dt_min: float, hr: float, rhr: float, hr_max: float) -> float:
    if hr_max <= rhr or dt_min <= 0:
        return 0.0
    hrr = max(0.0, min(1.0, (hr - rhr) / (hr_max - rhr)))
    return dt_min * hrr * 0.64 * math.exp(1.92 * hrr)


def strain_from_hr_samples(
    samples: list[tuple[datetime, float]],
    rhr: float,
    hr_max: float,
) -> tuple[float, float]:
    """Return (trimp, strain)."""
    if len(samples) < 5:
        return 0.0, 0.0
    trimp = 0.0
    for i in range(1, len(samples)):
        t0, _ = samples[i - 1]
        t1, hr = samples[i]
        dt_min = (t1 - t0).total_seconds() / 60.0
        if dt_min <= 0:
            continue
        if dt_min > 30:
            continue  # large gap — don't invent load
        # cap tiny intervals to avoid double-count burst samples
        dt_min = min(dt_min, 10.0)
        trimp += banister_trimp_segment(dt_min, hr, rhr, hr_max)
    return trimp, trimp_to_strain(trimp)


def strain_from_physical_effort(effort_rows: list[tuple[datetime, float]]) -> float:
    """METs-like PhysicalEffort → light secondary 0–21 proxy.

    Only count clearly active segments (METs >= 3) so sleep/rest noise does not
    dominate the Banister HR strain.
    """
    if len(effort_rows) < 5:
        return 0.0
    load = 0.0
    for i in range(1, len(effort_rows)):
        t0, _ = effort_rows[i - 1]
        t1, mets = effort_rows[i]
        if mets < 3.0:
            continue
        dt_min = (t1 - t0).total_seconds() / 60.0
        if dt_min <= 0 or dt_min > 20:
            continue
        dt_min = min(dt_min, 5.0)
        excess = mets - 1.5
        load += excess * dt_min * 0.35
    return trimp_to_strain(load, scale=260.0)


def _age_hr_max() -> float:
    profile = load_profile()
    age = None
    if profile.birth_datetime:
        try:
            b = datetime.strptime(profile.birth_datetime.strip()[:10], "%Y-%m-%d")
            age = max(10, datetime.now().year - b.year)
        except ValueError:
            age = None
    # observed max from meta if present
    return estimate_hr_max(age, None)


def ensure_triad_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS daily_triad (
            day TEXT PRIMARY KEY,
            recovery_pct REAL,
            recovery_band TEXT,
            strain REAL,
            strain_trimp REAL,
            strain_from_hr REAL,
            strain_from_effort REAL,
            hr_samples INTEGER,
            sleep_performance REAL,
            sleep_need_h REAL,
            sleep_debt_h REAL,
            target_low REAL,
            target_high REAL,
            target_intent TEXT,
            hrv_ratio REAL,
            rhr_ratio REAL,
            payload_json TEXT
        );
        """
    )


def rebuild_daily_triad(db_path: Path = DB_PATH) -> int:
    """Compute Recovery/Strain/Sleep for all daily_metrics days; store daily_triad + extras."""
    conn = init_db(db_path)
    ensure_triad_table(conn)
    conn.row_factory = sqlite3.Row
    days = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM daily_metrics WHERE day >= ? ORDER BY day", (DATA_START_DATE,)
        )
    ]
    if not days:
        conn.close()
        return 0

    # baselines from history
    hrv_hist = [_n(r["hrv_sdnn_ms"]) for r in days if _n(r.get("hrv_sdnn_ms")) is not None]
    rhr_hist = [_n(r["resting_hr"]) for r in days if _n(r.get("resting_hr")) is not None]

    # observed HR max
    row_max = conn.execute(
        """
        SELECT MAX(CAST(value AS REAL)) FROM raw_records
        WHERE record_type='HKQuantityTypeIdentifierHeartRate'
          AND substr(start_date,1,10) >= ?
        """,
        (DATA_START_DATE,),
    ).fetchone()[0]
    hr_max = estimate_hr_max(None, float(row_max) if row_max else None)
    if load_profile().birth_datetime:
        hr_max = max(hr_max, _age_hr_max())

    # Prefetch HR + PhysicalEffort into memory grouped by day
    hr_by_day: dict[str, list[tuple[datetime, float]]] = {}
    for start, val in conn.execute(
        """
        SELECT start_date, value FROM raw_records
        WHERE record_type='HKQuantityTypeIdentifierHeartRate'
          AND substr(start_date,1,10) >= ?
        ORDER BY start_date
        """,
        (DATA_START_DATE,),
    ):
        dt = parse_apple_date(start)
        hv = _n(val)
        if not dt or hv is None:
            continue
        hr_by_day.setdefault(dt.date().isoformat(), []).append((dt, hv))

    pe_by_day: dict[str, list[tuple[datetime, float]]] = {}
    for start, val in conn.execute(
        """
        SELECT start_date, value FROM raw_records
        WHERE record_type='HKQuantityTypeIdentifierPhysicalEffort'
          AND substr(start_date,1,10) >= ?
        ORDER BY start_date
        """,
        (DATA_START_DATE,),
    ):
        dt = parse_apple_date(start)
        hv = _n(val)
        if not dt or hv is None:
            continue
        pe_by_day.setdefault(dt.date().isoformat(), []).append((dt, hv))

    conn.execute("DELETE FROM daily_triad")
    n = 0
    hist_rows: list[dict] = []

    for i, row in enumerate(days):
        day = row["day"]
        hist_rows.append(row)
        # expanding baselines up to day i
        hrv_base = _rolling_median(
            [_n(r["hrv_sdnn_ms"]) for r in days[: i + 1] if _n(r.get("hrv_sdnn_ms")) is not None],
            60,
        ) or _rolling_median(hrv_hist, 60)
        rhr_base = _rolling_median(
            [_n(r["resting_hr"]) for r in days[: i + 1] if _n(r.get("resting_hr")) is not None],
            60,
        ) or _rolling_median(rhr_hist, 60)
        rhr_today = _n(row.get("resting_hr")) or rhr_base or 60.0

        need, debt = sleep_need_and_debt(hist_rows, row)
        sp = sleep_performance_pct(
            _n(row.get("sleep_hours")),
            need,
            _n(row.get("sleep_deep_hours")),
            _n(row.get("sleep_rem_hours")),
            _n(row.get("sleep_consistency")),
        )
        rec, hrv_ratio, rhr_ratio = compute_recovery_pct(
            _n(row.get("hrv_sdnn_ms")),
            _n(row.get("resting_hr")),
            hrv_base,
            rhr_base,
            sp,
        )

        samples = hr_by_day.get(day, [])
        trimp, strain_hr = strain_from_hr_samples(samples, float(rhr_today), hr_max)
        strain_pe = strain_from_physical_effort(pe_by_day.get(day, []))
        # blend: HR primary; PE is a small muscular/activity fill-in
        if samples and len(samples) >= 80:
            strain = round(0.92 * strain_hr + 0.08 * strain_pe, 2)
        elif samples:
            strain = round(0.8 * strain_hr + 0.2 * strain_pe, 2)
        else:
            strain = round(strain_pe, 2) if strain_pe else None
            if strain == 0:
                strain = None

        # fallback: training_load proxy if no sensors
        if strain is None and _n(row.get("training_load")) is not None:
            strain = trimp_to_strain(float(row["training_load"]) * 1.2, scale=160.0)

        lo, hi, intent = target_strain_zone(rec)
        notes = []
        if len(samples) < 50:
            notes.append("心率样本偏少，Strain 置信度下降。")
        if _n(row.get("sleep_hours")) is None:
            notes.append("缺少睡眠时长，Sleep Performance / Recovery 受影响。")
        if sp is None:
            notes.append("Sleep Performance 无法完整计算。")

        triad = TriadDay(
            day=day,
            recovery_pct=rec,
            recovery_band=recovery_band(rec),
            strain=strain,
            strain_trimp=round(trimp, 1) if trimp else None,
            strain_from_hr=strain_hr if samples else None,
            strain_from_effort=strain_pe or None,
            hr_samples=len(samples),
            sleep_performance=sp,
            sleep_need_h=need,
            sleep_debt_h=debt,
            target_low=lo,
            target_high=hi,
            target_intent=intent,
            hrv_ratio=round(hrv_ratio, 3) if hrv_ratio is not None else None,
            rhr_ratio=round(rhr_ratio, 3) if rhr_ratio is not None else None,
            notes=notes,
        )

        conn.execute(
            """
            INSERT INTO daily_triad (
                day, recovery_pct, recovery_band, strain, strain_trimp,
                strain_from_hr, strain_from_effort, hr_samples,
                sleep_performance, sleep_need_h, sleep_debt_h,
                target_low, target_high, target_intent, hrv_ratio, rhr_ratio, payload_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                triad.day,
                triad.recovery_pct,
                triad.recovery_band,
                triad.strain,
                triad.strain_trimp,
                triad.strain_from_hr,
                triad.strain_from_effort,
                triad.hr_samples,
                triad.sleep_performance,
                triad.sleep_need_h,
                triad.sleep_debt_h,
                triad.target_low,
                triad.target_high,
                triad.target_intent,
                triad.hrv_ratio,
                triad.rhr_ratio,
                json.dumps(triad.to_dict(), ensure_ascii=False),
            ),
        )

        # merge into extras_json
        try:
            extras = json.loads(row.get("extras_json") or "{}")
        except json.JSONDecodeError:
            extras = {}
        extras["triad"] = triad.to_dict()
        extras["triad_meta"] = {"hr_max_used": hr_max, "method": "banister_trimp_hrr+physical_effort"}
        conn.execute(
            "UPDATE daily_metrics SET extras_json=? WHERE day=?",
            (json.dumps(extras, ensure_ascii=False), day),
        )
        n += 1

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("triad_hr_max_used", str(hr_max)),
    )
    conn.commit()
    conn.close()
    print(f"铁三角已生成: {n} 天（Recovery/Strain/Sleep · HRmax≈{hr_max:.0f}）", flush=True)
    return n


def load_triad(day: str | None = None, db_path: Path = DB_PATH) -> dict | None:
    conn = init_db(db_path)
    ensure_triad_table(conn)
    conn.row_factory = sqlite3.Row
    if day:
        row = conn.execute("SELECT * FROM daily_triad WHERE day=?", (day,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM daily_triad ORDER BY day DESC LIMIT 1").fetchone()
    conn.close()
    return dict(row) if row else None


def load_triad_series(limit: int = 28, db_path: Path = DB_PATH) -> list[dict]:
    conn = init_db(db_path)
    ensure_triad_table(conn)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM daily_triad ORDER BY day DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


def triad_advice_lines(db_path: Path = DB_PATH) -> list[str]:
    t = load_triad(db_path=db_path)
    if not t:
        return ["尚无 Recovery/Strain/Sleep 铁三角，请先跑 pipeline。"]
    lines = [
        f"Recovery {t.get('recovery_pct') or '—'}%（{t.get('recovery_band')}）· "
        f"Strain {t.get('strain') or '—'} · Sleep Performance {t.get('sleep_performance') or '—'}%",
        f"今日目标 Strain 区：{t.get('target_low')}–{t.get('target_high')}（{t.get('target_intent')}）",
    ]
    strain = _n(t.get("strain"))
    lo, hi = _n(t.get("target_low")), _n(t.get("target_high"))
    if strain is not None and lo is not None and hi is not None:
        if strain < lo:
            lines.append(f"当前 Strain {strain} 低于目标区，若 Recovery 允许可适当增加活动。")
        elif strain > hi:
            lines.append(f"当前 Strain {strain} 已超过目标区上限，建议收工或只做轻松活动。")
        else:
            lines.append(f"Strain {strain} 落在目标区内，节奏合理。")
    if t.get("sleep_need_h"):
        lines.append(f"今晚睡眠需求约 {t['sleep_need_h']} h（债 {t.get('sleep_debt_h')} h）。")
    return lines


if __name__ == "__main__":
    rebuild_daily_triad()
