"""Garmin-inspired readiness stack: HRV Status, Sleep Need, Recovery Time,
Training Readiness, Body Battery proxy, Training Status, suggested workout.

All scores are personal-observation heuristics from Apple Health daily rollups —
not medical diagnosis and not Garmin's proprietary algorithms.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from statistics import mean, median
from typing import Any


def _n(row: dict | None, key: str) -> float | None:
    if not row:
        return None
    v = row.get(key)
    if v is None:
        return None
    try:
        # pandas/SQLite path often yields float('nan') for NULL
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _finite(x: float | None) -> float | None:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _baselines_from_row(row: dict) -> dict:
    try:
        extras = json.loads(row.get("extras_json") or "{}")
        return extras.get("baselines") or {}
    except (TypeError, json.JSONDecodeError):
        return {}


def rolling_baseline(rows: list[dict], key: str, days: int = 28) -> float | None:
    vals = [_n(r, key) for r in rows[-days:]]
    vals = [v for v in vals if v is not None]
    return median(vals) if vals else None


@dataclass
class FactorScore:
    key: str
    name: str
    score: float | None
    label: str
    detail: str


@dataclass
class MorningBrief:
    day: str
    training_readiness: float | None
    readiness_label: str
    hrv_status: str
    hrv_status_detail: str
    sleep_score: float | None
    sleep_need_h: float | None
    sleep_debt_h: float | None
    body_battery: float | None
    recovery_time_h: float | None
    strain: float | None
    training_status: str
    suggested_workout: str
    suggested_intensity: str  # 恢复 / 有氧 / 质量
    target_load_low: float | None
    target_load_high: float | None
    factors: list[FactorScore] = field(default_factory=list)
    essentials: dict[str, Any] = field(default_factory=dict)
    narrative: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def hrv_status(hrv: float | None, baseline: float | None) -> tuple[str, str, float | None]:
    """Return (status, detail, factor_score 0-100)."""
    if hrv is None or baseline is None or baseline <= 0:
        return "未知", "缺少 HRV 或基线，无法判断状态。", None
    ratio = hrv / baseline
    if ratio >= 1.05:
        return "偏高", f"今日 HRV {hrv:.0f} 高于基线 {baseline:.0f}（+{(ratio-1)*100:.0f}%），副交感偏活跃。", _clamp(70 + (ratio - 1) * 100)
    if ratio >= 0.90:
        return "平衡", f"今日 HRV {hrv:.0f} 接近基线 {baseline:.0f}，自主神经状态较稳。", _clamp(50 + (ratio - 0.9) * 200)
    if ratio >= 0.80:
        return "偏低", f"今日 HRV {hrv:.0f} 低于基线约 {(1-ratio)*100:.0f}%，恢复压力偏大。", _clamp(35 + (ratio - 0.8) * 150)
    return "明显偏低", f"今日 HRV {hrv:.0f} 显著低于基线 {baseline:.0f}，建议优先恢复。", _clamp(ratio / 0.8 * 35)


def sleep_need_hours(rows: list[dict], latest: dict) -> tuple[float, float]:
    """Personalized sleep need + current debt (hours)."""
    base = 7.5
    loads = [_n(r, "training_load") for r in rows[-7:]]
    loads = [x for x in loads if x is not None]
    avg_load = mean(loads) if loads else 0.0
    # harder week → need more sleep
    need = base + min(1.5, avg_load / 80.0) + (0.3 if (_n(latest, "tsb") or 0) < -10 else 0.0)

    slept = []
    for r in rows[-3:]:
        sh = _n(r, "sleep_hours")
        if sh is not None:
            slept.append(sh)
        else:
            slept.append(0.0)  # missing counts as debt
    debt = max(0.0, sum(max(0.0, need - s) for s in slept) * 0.5)  # partial carry
    return round(need, 1), round(debt, 1)


def recovery_time_hours(latest: dict, recent: list[dict]) -> float:
    """Rough remaining recovery hours after recent hard load."""
    load = _n(latest, "training_load") or 0.0
    tsb = _n(latest, "tsb")
    intens = 0.0
    # peek last hard-ish day
    for r in reversed(recent[-3:]):
        tl = _n(r, "training_load") or 0
        intens = max(intens, tl)
    hours = max(0.0, (intens - 40) / 8.0)  # load 80 → ~5h, 120 → 10h
    if tsb is not None and tsb < -10:
        hours += abs(tsb) / 4.0
    if load >= 60:
        hours = max(hours, load / 12.0)
    return round(min(72.0, hours), 1)


def body_battery_proxy(latest: dict, sleep_score: float | None, hrv_factor: float | None) -> float | None:
    """Daily energy proxy (not continuous Garmin Body Battery)."""
    parts = []
    if sleep_score is not None:
        parts.append(sleep_score)
    if hrv_factor is not None:
        parts.append(hrv_factor)
    rec = _n(latest, "recovery_score")
    if rec is not None:
        parts.append(rec)
    tsb = _n(latest, "tsb")
    if tsb is not None:
        parts.append(_clamp(55 + tsb))
    # daytime drain proxy from activity
    steps = _n(latest, "steps") or 0
    load = _n(latest, "training_load") or 0
    drain = min(35.0, steps / 400.0 + load / 4.0)
    if not parts:
        return None
    return round(_clamp(mean(parts) - drain * 0.35), 0)


def strain_score(latest: dict) -> float | None:
    """WHOOP-like 0–21 strain proxy from daily load + steps."""
    load = _n(latest, "training_load")
    steps = _n(latest, "steps") or 0
    if load is None and steps == 0:
        return None
    base = (load or 0) / 8.0 + steps / 2500.0
    return round(min(21.0, max(0.0, base)), 1)


def training_status(rows: list[dict], latest: dict) -> str:
    if len(rows) < 7:
        return "数据不足"
    ctl_now = _n(latest, "ctl")
    ctl_week = _n(rows[-8], "ctl") if len(rows) >= 8 else _n(rows[0], "ctl")
    tsb = _n(latest, "tsb")
    atl = _n(latest, "atl")
    if ctl_now is None:
        return "数据不足"
    rising = ctl_week is not None and ctl_now > ctl_week + 2
    falling = ctl_week is not None and ctl_now < ctl_week - 2
    if tsb is not None and tsb < -15 and (atl or 0) > (ctl_now or 0):
        return "过度负荷"
    if tsb is not None and tsb < -8:
        return "恢复中"
    if rising and tsb is not None and tsb >= -5:
        return "高效提升"
    if falling and (ctl_now or 0) < 20:
        return "脱训风险"
    if abs((tsb or 0)) <= 8:
        return "维持水平"
    return "调整中"


def suggested_session(readiness: float | None, tsb: float | None, recovery_h: float) -> tuple[str, str, float | None, float | None]:
    """Return workout text, intensity, target load low/high."""
    r = readiness if readiness is not None else 50.0
    if r < 35 or (tsb is not None and tsb < -12) or recovery_h >= 24:
        return (
            "恢复日：20–40 分钟轻松步行/骑行，或完全休息 + 轻度拉伸。避免网球/间歇。",
            "恢复",
            5.0,
            25.0,
        )
    if r < 55 or (tsb is not None and tsb < -5):
        return (
            "有氧日：Z1–Z2 持续 30–50 分钟（骑行/游泳/慢跑），可加技术轻打，不要冲刺。",
            "有氧",
            20.0,
            45.0,
        )
    if r < 73:
        return (
            "稳态质量：热身后主课 1 个重点（节奏跑或中等强度网球），总体积适中。",
            "质量",
            35.0,
            70.0,
        )
    return (
        "高质量日：可安排强度课（间歇/比赛强度网球），热身充分，课后重视睡眠与营养。",
        "质量",
        45.0,
        90.0,
    )


def readiness_label(score: float | None) -> str:
    if score is None:
        return "未知"
    if score >= 73:
        return "就绪"
    if score >= 55:
        return "尚可"
    if score >= 35:
        return "偏低"
    return "需休息"


def compute_morning_brief(rows: list[dict], latest: dict | None = None) -> MorningBrief:
    if not rows and not latest:
        return MorningBrief(
            day="—",
            training_readiness=None,
            readiness_label="未知",
            hrv_status="未知",
            hrv_status_detail="无数据",
            sleep_score=None,
            sleep_need_h=None,
            sleep_debt_h=None,
            body_battery=None,
            recovery_time_h=None,
            strain=None,
            training_status="数据不足",
            suggested_workout="先导入健康数据。",
            suggested_intensity="恢复",
            target_load_low=None,
            target_load_high=None,
            narrative="暂无日指标。",
        )

    latest = latest or rows[-1]
    day = str(latest.get("day") or "—")
    base = _baselines_from_row(latest)
    hrv_b = base.get("hrv_sdnn_ms") or rolling_baseline(rows, "hrv_sdnn_ms", 28)
    hrv = _n(latest, "hrv_sdnn_ms")
    status, status_detail, hrv_factor = hrv_status(hrv, hrv_b)

    sleep_score = _n(latest, "sleep_score")
    sleep_h = _n(latest, "sleep_hours")
    need, debt = sleep_need_hours(rows, latest)

    # sleep factor: duration vs need + existing sleep_score
    sleep_factor = sleep_score
    if sleep_h is not None:
        dur_ratio = sleep_h / need if need else 1.0
        dur_score = _clamp(dur_ratio * 80)
        sleep_factor = mean([x for x in (sleep_score, dur_score) if x is not None]) if sleep_score is not None else dur_score
    if debt >= 2:
        sleep_factor = _clamp((sleep_factor or 50) - debt * 5)

    # acute load factor: high ATL relative to CTL hurts readiness
    ctl, atl, tsb = _n(latest, "ctl"), _n(latest, "atl"), _n(latest, "tsb")
    load_factor = None
    if tsb is not None:
        load_factor = _clamp(55 + tsb * 1.2)
    elif ctl is not None and atl is not None and ctl > 0:
        load_factor = _clamp(100 - max(0, (atl / ctl - 1) * 80))

    rec_h = recovery_time_hours(latest, rows)
    rec_factor = _clamp(100 - rec_h * 2.5)

    rhr = _n(latest, "resting_hr")
    rhr_b = base.get("resting_hr") or rolling_baseline(rows, "resting_hr", 28)
    rhr_factor = None
    if rhr is not None and rhr_b:
        # higher RHR worse
        rhr_factor = _score_rhr(rhr, rhr_b)

    # stress proxy: low sleep consistency + elevated RHR
    stress_factor = _n(latest, "sleep_consistency")
    if rhr_factor is not None and stress_factor is not None:
        stress_factor = mean([stress_factor, rhr_factor])
    elif rhr_factor is not None:
        stress_factor = rhr_factor

    factors = [
        FactorScore("sleep", "睡眠", round(sleep_factor, 0) if _finite(sleep_factor) is not None else None,
                    _band(_finite(sleep_factor)), f"时长 {_fmt(sleep_h)}h / 需求 {need}h · 债 {debt}h"),
        FactorScore("hrv", "HRV 状态", round(hrv_factor, 0) if _finite(hrv_factor) is not None else None,
                    status, status_detail),
        FactorScore("load", "急性负荷", round(load_factor, 0) if _finite(load_factor) is not None else None,
                    _band(_finite(load_factor)), f"TSB {_fmt(tsb)} · ATL {_fmt(atl)} / CTL {_fmt(ctl)}"),
        FactorScore("recovery_time", "恢复时间", round(rec_factor, 0) if _finite(rec_factor) is not None else None,
                    _band(_finite(rec_factor)), f"估计剩余恢复约 {rec_h} 小时"),
        FactorScore("stress", "压力/作息", round(stress_factor, 0) if _finite(stress_factor) is not None else None,
                    _band(_finite(stress_factor)), f"睡眠一致性 {_fmt(_n(latest,'sleep_consistency'))} · 静息 {_fmt(rhr)}"),
        FactorScore("rhr", "静息心率", round(rhr_factor, 0) if _finite(rhr_factor) is not None else None,
                    _band(_finite(rhr_factor)), f"{_fmt(rhr)} vs 基线 {_fmt(rhr_b)}"),
    ]

    weighted: list[tuple[float, float]] = []
    weights = {"sleep": 0.28, "hrv": 0.22, "load": 0.18, "recovery_time": 0.14, "stress": 0.10, "rhr": 0.08}
    for f in factors:
        score = _finite(f.score)
        if score is not None:
            weighted.append((score, weights.get(f.key, 0.1)))
    readiness = None
    if weighted:
        readiness = _finite(round(sum(s * w for s, w in weighted) / sum(w for _, w in weighted), 0))

    bb = body_battery_proxy(latest, sleep_score, hrv_factor)
    strain = strain_score(latest)
    status_train = training_status(rows, latest)
    workout, intensity, lo, hi = suggested_session(readiness, tsb, rec_h)

    label = readiness_label(readiness)
    ready_txt = str(int(readiness)) if readiness is not None else "—"
    narrative = (
        f"训练准备度 {ready_txt}（{label}）。"
        f"HRV {status}。建议「{intensity}」：{workout}"
    )

    essentials = {
        "training_readiness": readiness,
        "readiness_label": label,
        "sleep_score": sleep_score,
        "hrv_status": status,
        "body_battery": bb,
        "strain": strain,
        "tsb": tsb,
    }

    return MorningBrief(
        day=day,
        training_readiness=readiness,
        readiness_label=label,
        hrv_status=status,
        hrv_status_detail=status_detail,
        sleep_score=sleep_score,
        sleep_need_h=need,
        sleep_debt_h=debt,
        body_battery=bb,
        recovery_time_h=rec_h,
        strain=strain,
        training_status=status_train,
        suggested_workout=workout,
        suggested_intensity=intensity,
        target_load_low=lo,
        target_load_high=hi,
        factors=factors,
        essentials=essentials,
        narrative=narrative,
    )


def _score_rhr(rhr: float, baseline: float) -> float:
    ratio = rhr / baseline if baseline else 1.0
    # 1.0 → 70, 1.1 → 40, 0.95 → 85
    return _clamp(70 - (ratio - 1.0) * 300)


def _band(score: float | None) -> str:
    if score is None:
        return "未知"
    if score >= 70:
        return "良好"
    if score >= 50:
        return "一般"
    if score >= 35:
        return "偏弱"
    return "差"


def _fmt(v: float | None, digits: int = 0) -> str:
    if v is None:
        return "—"
    return f"{v:.{digits}f}"


def brief_from_db_rows(rows: list[dict]) -> MorningBrief:
    return compute_morning_brief(rows)


def attach_readiness_to_extras(rows_out: list[dict], baselines: dict) -> None:
    """Mutate rows_out in place: each row gets readiness dict for extras_json later."""
    # temporarily stamp baselines into a fake extras for factor calc
    hist: list[dict] = []
    for r in rows_out:
        fake = dict(r)
        fake["extras_json"] = json.dumps({"baselines": baselines}, ensure_ascii=False)
        hist.append(fake)
        brief = compute_morning_brief(hist, fake)
        r["_readiness"] = brief.to_dict()
