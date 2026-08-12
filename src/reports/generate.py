"""Generate daily and weekly Markdown health reports."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean
from typing import Any

from src.config import DB_PATH, DISCLAIMER, REPORTS_DIR, DATA_START_DATE
from src.ingest.parse_export import init_db


def _fmt(v: Any, digits: int = 1, suffix: str = "") -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):.{digits}f}{suffix}"
    except (TypeError, ValueError):
        return str(v)


def _delta_phrase(value: float | None, baseline: float | None, unit: str = "", higher_better: bool = True) -> str:
    if value is None or baseline is None or baseline == 0:
        return "相对基线数据不足"
    pct = (value - baseline) / baseline * 100.0
    direction = "高于" if pct >= 0 else "低于"
    abs_pct = abs(pct)
    tone = ""
    if abs_pct < 5:
        tone = "大致持平"
        return f"与基线{tone}（{_fmt(value)}{unit} vs {_fmt(baseline)}{unit}）"
    favorable = (pct > 0) == higher_better
    mood = "偏积极" if favorable else "需关注"
    return f"{direction}基线 {abs_pct:.0f}%（{_fmt(value)}{unit}），{mood}"


def _mood_label(score: float | None) -> str:
    if score is None:
        return "未知"
    if score < 1.8:
        return "很低落"
    if score < 2.6:
        return "偏低"
    if score < 3.4:
        return "平稳"
    if score < 4.2:
        return "较好"
    return "很好"


def _fetch_day(conn: sqlite3.Connection, day: str) -> dict | None:
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM daily_metrics WHERE day = ?", (day,)).fetchone()
    return dict(row) if row else None


def _fetch_range(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM daily_metrics WHERE day >= ? AND day <= ? ORDER BY day",
        (start, end),
    ).fetchall()
    return [dict(r) for r in rows]


def _workouts_on(conn: sqlite3.Connection, day: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    # Prefer analytics (HR / zones) when available
    try:
        rows = conn.execute(
            """
            SELECT activity AS workout_activity_type, duration_min AS duration,
                   'min' AS duration_unit, active_kcal AS total_energy_burned,
                   'kcal' AS total_energy_burned_unit, start_date,
                   hr_avg, hr_min, hr_max, hr_zone, intensity, mets, distance_km, note
            FROM workout_analytics
            WHERE day = ?
            ORDER BY start_date
            """,
            (day,),
        ).fetchall()
        if rows:
            return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        pass
    rows = conn.execute(
        """
        SELECT workout_activity_type, duration, duration_unit, total_energy_burned,
               total_energy_burned_unit, start_date
        FROM workouts
        WHERE start_date LIKE ?
        ORDER BY start_date
        """,
        (f"{day}%",),
    ).fetchall()
    return [dict(r) for r in rows]


def build_daily_markdown(
    day_row: dict,
    workouts: list[dict],
    baselines: dict | None = None,
    recent_rows: list[dict] | None = None,
) -> str:
    day = day_row["day"]
    baselines = baselines or {}
    lines = [
        f"# 健康日报 · {day}",
        "",
        f"> {DISCLAIMER}",
        "",
        "## 总览",
        "",
        f"- **综合观察分**：{_fmt(day_row.get('overall_score'), 0)} / 100",
        f"- **恢复**：{_fmt(day_row.get('recovery_score'), 0)} · **活动**：{_fmt(day_row.get('activity_score'), 0)} · **睡眠**：{_fmt(day_row.get('sleep_score'), 0)}",
        f"- **心情**：{_fmt(day_row.get('mood_score'), 1)} / 5（{_mood_label(day_row.get('mood_score'))}，来源：{day_row.get('mood_source') or '—'}）",
        "",
    ]
    # Morning / readiness block from extras or recompute
    try:
        from src.metrics.readiness import compute_morning_brief

        recent = recent_rows or [day_row]
        brief = compute_morning_brief(recent, day_row)
        lines.extend(
            [
                "## Morning Report（训练准备）",
                "",
                f"- **训练准备度**：{_fmt(brief.training_readiness, 0)}（{brief.readiness_label}）",
                f"- **HRV 状态**：{brief.hrv_status}",
                f"- **睡眠需求 / 债**：{_fmt(brief.sleep_need_h, 1)} h / {_fmt(brief.sleep_debt_h, 1)} h",
                f"- **能量近似 / Strain**：{_fmt(brief.body_battery, 0)} / {_fmt(brief.strain, 1)}",
                f"- **训练状态**：{brief.training_status} · 恢复约 {_fmt(brief.recovery_time_h, 1)} h",
                f"- **今日建议**：{brief.suggested_intensity} — {brief.suggested_workout}",
                "",
            ]
        )
        try:
            from src.metrics.triad import load_triad

            t = load_triad(day)
            if t:
                lines.extend(
                    [
                        "## Recovery · Strain · Sleep",
                        "",
                        f"- **Recovery**：{_fmt(t.get('recovery_pct'), 0)}%（{t.get('recovery_band')}）",
                        f"- **Strain**：{_fmt(t.get('strain'), 1)}（目标 {t.get('target_low')}–{t.get('target_high')} · {t.get('target_intent')}）",
                        f"- **Sleep Performance**：{_fmt(t.get('sleep_performance'), 0)}%",
                        f"- HR 样本 {t.get('hr_samples')} · TRIMP {_fmt(t.get('strain_trimp'), 1)}",
                        "",
                    ]
                )
        except Exception:
            pass
    except Exception:
        pass

    lines.extend(
        [
        "## 睡眠",
        "",
        f"- 睡眠时长：{_fmt(day_row.get('sleep_hours'), 1, ' h')}",
        f"- 深睡 / REM / 核心：{_fmt(day_row.get('sleep_deep_hours'), 1)} / {_fmt(day_row.get('sleep_rem_hours'), 1)} / {_fmt(day_row.get('sleep_core_hours'), 1)} h",
        f"- 对比：{_delta_phrase(day_row.get('sleep_hours'), baselines.get('sleep_hours'), ' h', True)}",
        "",
        "## 心脏与恢复",
        "",
        f"- 静息心率：{_fmt(day_row.get('resting_hr'), 0, ' bpm')}",
        f"- 平均心率：{_fmt(day_row.get('avg_hr'), 0, ' bpm')}",
        f"- HRV (SDNN)：{_fmt(day_row.get('hrv_sdnn_ms'), 0, ' ms')}",
        f"- 血氧均值：{_fmt(day_row.get('spo2_avg'), 1, '%')}",
        f"- 静息心率对比：{_delta_phrase(day_row.get('resting_hr'), baselines.get('resting_hr'), ' bpm', False)}",
        f"- HRV 对比：{_delta_phrase(day_row.get('hrv_sdnn_ms'), baselines.get('hrv_sdnn_ms'), ' ms', True)}",
        "",
        "## 活动",
        "",
        f"- 步数：{_fmt(day_row.get('steps'), 0)}",
        f"- 活动热量：{_fmt(day_row.get('active_energy_kcal'), 0, ' kcal')}",
        f"- 锻炼分钟：{_fmt(day_row.get('exercise_minutes'), 0, ' min')}",
        f"- 站立小时：{_fmt(day_row.get('stand_hours'), 0)}",
        f"- 训练次数 / 时长：{day_row.get('workout_count') or 0} / {_fmt(day_row.get('workout_minutes'), 0, ' min')}",
        "",
        ]
    )
    if workouts:
        lines.append("### 当日训练（含心率）")
        lines.append("")
        for w in workouts:
            wtype = (w.get("workout_activity_type") or "").replace("HKWorkoutActivityType", "")
            line = (
                f"- {wtype} · {_fmt(w.get('duration'), 0)} {w.get('duration_unit') or 'min'}"
                f" · {_fmt(w.get('total_energy_burned'), 0)} {w.get('total_energy_burned_unit') or 'kcal'}"
            )
            if w.get("hr_avg") is not None:
                line += f" · 均心 {_fmt(w.get('hr_avg'), 0)} / 最高 {_fmt(w.get('hr_max'), 0)} bpm"
            if w.get("hr_zone"):
                line += f" · {w.get('hr_zone')}"
            if w.get("mets") is not None:
                line += f" · METs {_fmt(w.get('mets'), 1)}"
            if w.get("note"):
                line += f" · {w.get('note')}"
            lines.append(line)
        lines.append("")

    lines.extend(
        [
            "## 身体与环境",
            "",
            f"- 体重：{_fmt(day_row.get('weight_kg'), 1, ' kg')}",
            f"- 体脂：{_fmt(day_row.get('body_fat_pct'), 1, '%')}",
            f"- 正念分钟：{_fmt(day_row.get('mindful_minutes'), 0, ' min')}",
            f"- 耳机暴露均值：{_fmt(day_row.get('headphone_db_avg'), 0, ' dB')}",
            f"- 环境声级均值：{_fmt(day_row.get('environmental_db_avg'), 0, ' dB')}",
            "",
            "## 简评",
            "",
        ]
    )

    notes: list[str] = []
    sh = day_row.get("sleep_hours")
    if sh is not None and sh < 6:
        notes.append("睡眠偏短，优先保证入睡时间与睡前减刺激。")
    elif sh is not None and 7 <= sh <= 9:
        notes.append("睡眠时长落在较理想区间。")
    if day_row.get("resting_hr") and baselines.get("resting_hr"):
        if day_row["resting_hr"] > baselines["resting_hr"] * 1.08:
            notes.append("静息心率高于基线，注意疲劳、压力或疾病征兆（非诊断）。")
    if day_row.get("hrv_sdnn_ms") and baselines.get("hrv_sdnn_ms"):
        if day_row["hrv_sdnn_ms"] < baselines["hrv_sdnn_ms"] * 0.85:
            notes.append("HRV 低于基线，恢复可能不足，可考虑降低训练强度。")
    if day_row.get("steps") and day_row["steps"] >= 8000:
        notes.append("活动量不错，有助于情绪与代谢。")
    if day_row.get("mood_source") == "inferred":
        notes.append("当日无「心态」记录，心情分为睡眠/心脏/活动推断，建议在健康 App 补记心态以提高准确度。")
    if not notes:
        notes.append("指标整体平稳，继续保持规律作息与适度运动。")
    for n in notes:
        lines.append(f"- {n}")
    lines.append("")

    # Actionable diagnosis block
    try:
        from src.insights.advice import advice_to_markdown, build_advice

        ctx = recent_rows if recent_rows else [day_row]
        bundle = build_advice(day_row, ctx)
        lines.append(advice_to_markdown(bundle))
    except Exception:
        pass
    return "\n".join(lines)


def build_weekly_markdown(rows: list[dict], start: str, end: str) -> str:
    def avg(field: str) -> float | None:
        vals = [r[field] for r in rows if r.get(field) is not None]
        return mean(vals) if vals else None

    lines = [
        f"# 健康周报 · {start} ~ {end}",
        "",
        f"> {DISCLAIMER}",
        "",
        f"覆盖 **{len(rows)}** 天有数据的日子。",
        "",
        "## 周均值",
        "",
        f"- 综合观察分：{_fmt(avg('overall_score'), 0)}",
        f"- 睡眠：{_fmt(avg('sleep_hours'), 1, ' h')}",
        f"- 静息心率：{_fmt(avg('resting_hr'), 0, ' bpm')}",
        f"- HRV：{_fmt(avg('hrv_sdnn_ms'), 0, ' ms')}",
        f"- 步数：{_fmt(avg('steps'), 0)}",
        f"- 活动热量：{_fmt(avg('active_energy_kcal'), 0, ' kcal')}",
        f"- 心情：{_fmt(avg('mood_score'), 1)} / 5（{_mood_label(avg('mood_score'))}）",
        "",
        "## 每日一览",
        "",
        "| 日期 | 睡眠(h) | 静息HR | HRV | 步数 | 心情 | 综合 |",
        "|------|---------|--------|-----|------|------|------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['day']} | {_fmt(r.get('sleep_hours'), 1)} | {_fmt(r.get('resting_hr'), 0)} "
            f"| {_fmt(r.get('hrv_sdnn_ms'), 0)} | {_fmt(r.get('steps'), 0)} "
            f"| {_fmt(r.get('mood_score'), 1)} | {_fmt(r.get('overall_score'), 0)} |"
        )
    lines.append("")

    # Simple anomaly flags vs week mean
    lines.append("## 相对本周的波动")
    lines.append("")
    for field, name, higher_better in [
        ("sleep_hours", "睡眠", True),
        ("resting_hr", "静息心率", False),
        ("hrv_sdnn_ms", "HRV", True),
        ("mood_score", "心情", True),
    ]:
        m = avg(field)
        if m is None:
            continue
        flagged = []
        for r in rows:
            v = r.get(field)
            if v is None:
                continue
            if higher_better and v < m * 0.85:
                flagged.append(f"{r['day']} 偏低（{_fmt(v)}）")
            if not higher_better and v > m * 1.1:
                flagged.append(f"{r['day']} 偏高（{_fmt(v)}）")
        if flagged:
            lines.append(f"- **{name}**：{'; '.join(flagged)}")
        else:
            lines.append(f"- **{name}**：波动温和")
    lines.extend(["", "## 下周建议", ""])
    sleep_avg = avg("sleep_hours")
    if sleep_avg is not None and sleep_avg < 6.5:
        lines.append("- 把固定入睡时间作为第一优先级。")
    else:
        lines.append("- 维持当前睡眠节奏，避免周末大幅补觉错位。")
    if avg("exercise_minutes") is not None and (avg("exercise_minutes") or 0) < 20:
        lines.append("- 增加轻度有氧或步行，目标每天累计锻炼接近 30 分钟。")
    else:
        lines.append("- 训练后关注 HRV/静息心率，避免连续高强度日。")
    lines.append("- 每天在健康 App 记录一次「心态」，报告心情会更准。")
    lines.append("")
    return "\n".join(lines)


def _avg(rows: list[dict], field: str) -> float | None:
    vals = [r[field] for r in rows if r.get(field) is not None]
    return mean(vals) if vals else None


def _sum(rows: list[dict], field: str) -> float | None:
    vals = [r[field] for r in rows if r.get(field) is not None]
    return float(sum(vals)) if vals else None


def build_monthly_markdown(
    rows: list[dict],
    year_month: str,
    prev_rows: list[dict] | None = None,
    workouts: list[dict] | None = None,
) -> str:
    """year_month like 2026-07."""
    prev_rows = prev_rows or []
    workouts = workouts or []

    def mom(field: str, higher_better: bool = True) -> str:
        cur = _avg(rows, field)
        prev = _avg(prev_rows, field)
        if cur is None:
            return "—"
        if prev is None or prev == 0:
            return f"{_fmt(cur)}（无上月对比）"
        pct = (cur - prev) / prev * 100.0
        arrow = "↑" if pct >= 0 else "↓"
        tone = "改善" if (pct >= 0) == higher_better else "变差"
        if abs(pct) < 5:
            tone = "持平"
        return f"{_fmt(cur)}（较上月 {arrow}{abs(pct):.0f}% · {tone}）"

    start = rows[0]["day"] if rows else f"{year_month}-01"
    end = rows[-1]["day"] if rows else year_month

    # Workout type breakdown
    type_counts: dict[str, int] = {}
    for w in workouts:
        wtype = (w.get("workout_activity_type") or "Unknown").replace("HKWorkoutActivityType", "")
        type_counts[wtype] = type_counts.get(wtype, 0) + 1
    top_types = sorted(type_counts.items(), key=lambda x: -x[1])[:8]

    lines = [
        f"# 健康月报 · {year_month}",
        "",
        f"> {DISCLAIMER}",
        "",
        f"覆盖 **{len(rows)}** 天有数据（{start} ~ {end}）。",
        "",
        "## 月度总览",
        "",
        f"- **综合观察分均值**：{mom('overall_score', True)}",
        f"- **心情均值**：{mom('mood_score', True)} / 5（{_mood_label(_avg(rows, 'mood_score'))}）",
        f"- **恢复 / 活动 / 睡眠分**：{_fmt(_avg(rows, 'recovery_score'), 0)} / {_fmt(_avg(rows, 'activity_score'), 0)} / {_fmt(_avg(rows, 'sleep_score'), 0)}",
        "",
        "## 睡眠",
        "",
        f"- 日均睡眠：{mom('sleep_hours', True)}",
        f"- 深睡 / REM / 核心日均：{_fmt(_avg(rows, 'sleep_deep_hours'), 1)} / {_fmt(_avg(rows, 'sleep_rem_hours'), 1)} / {_fmt(_avg(rows, 'sleep_core_hours'), 1)} h",
        "",
        "## 心脏与恢复",
        "",
        f"- 静息心率：{mom('resting_hr', False)}",
        f"- HRV (SDNN)：{mom('hrv_sdnn_ms', True)}",
        f"- 平均心率：{_fmt(_avg(rows, 'avg_hr'), 0, ' bpm')}",
        f"- 血氧均值：{_fmt(_avg(rows, 'spo2_avg'), 1, '%')}",
        "",
        "## 活动与训练",
        "",
        f"- 日均步数：{mom('steps', True)}",
        f"- 日均活动热量：{mom('active_energy_kcal', True)}",
        f"- 日均锻炼分钟：{mom('exercise_minutes', True)}",
        f"- 本月训练总次数：{_fmt(_sum(rows, 'workout_count'), 0)}",
        f"- 本月训练总时长：{_fmt(_sum(rows, 'workout_minutes'), 0, ' min')}",
        "",
    ]
    if top_types:
        lines.append("### 训练类型")
        lines.append("")
        for name, cnt in top_types:
            lines.append(f"- {name}：{cnt} 次")
        lines.append("")

    # Best / worst days
    scored = [r for r in rows if r.get("overall_score") is not None]
    lines.append("## 高光与需关注日")
    lines.append("")
    if scored:
        best = max(scored, key=lambda r: r["overall_score"])
        worst = min(scored, key=lambda r: r["overall_score"])
        lines.append(
            f"- 综合分最高：{best['day']}（{_fmt(best['overall_score'], 0)}）"
            f" · 步数 {_fmt(best.get('steps'), 0)} · 心情 {_fmt(best.get('mood_score'), 1)}"
        )
        lines.append(
            f"- 综合分最低：{worst['day']}（{_fmt(worst['overall_score'], 0)}）"
            f" · 步数 {_fmt(worst.get('steps'), 0)} · 心情 {_fmt(worst.get('mood_score'), 1)}"
        )
    else:
        lines.append("- 本月综合分数据不足")
    lines.append("")

    lines.append("## 每日一览")
    lines.append("")
    lines.append("| 日期 | 睡眠(h) | 静息HR | HRV | 步数 | 训练 | 心情 | 综合 |")
    lines.append("|------|---------|--------|-----|------|------|------|------|")
    for r in rows:
        lines.append(
            f"| {r['day']} | {_fmt(r.get('sleep_hours'), 1)} | {_fmt(r.get('resting_hr'), 0)} "
            f"| {_fmt(r.get('hrv_sdnn_ms'), 0)} | {_fmt(r.get('steps'), 0)} "
            f"| {r.get('workout_count') or 0} | {_fmt(r.get('mood_score'), 1)} "
            f"| {_fmt(r.get('overall_score'), 0)} |"
        )
    lines.append("")

    lines.extend(["## 月度建议", ""])
    sleep_avg = _avg(rows, "sleep_hours")
    if sleep_avg is not None and sleep_avg < 6.5:
        lines.append("- 本月睡眠整体偏短，优先固定入睡窗口。")
    elif sleep_avg is None:
        lines.append("- 本月睡眠分期数据较少，建议夜间佩戴手表以补齐睡眠记录。")
    else:
        lines.append("- 睡眠节奏尚可，继续避免周末大幅错位。")

    hrv = _avg(rows, "hrv_sdnn_ms")
    prev_hrv = _avg(prev_rows, "hrv_sdnn_ms")
    if hrv is not None and prev_hrv is not None and hrv < prev_hrv * 0.9:
        lines.append("- HRV 较上月下降，注意训练负荷与压力管理。")
    steps = _avg(rows, "steps")
    if steps is not None and steps < 6000:
        lines.append("- 日均步数偏低，可把步行嵌入通勤或会议间隙。")
    elif steps is not None and steps >= 10000:
        lines.append("- 活动量充足，注意高强度日后的恢复。")
    lines.append("- 在健康 App 坚持记录「心态」，月报心情会更贴近主观感受。")
    lines.append("")
    return "\n".join(lines)


def build_overview_markdown(rows: list[dict], workouts_total: int) -> str:
    if not rows:
        return f"# 健康全部总览\n\n> {DISCLAIMER}\n\n暂无数据。\n"

    start, end = rows[0]["day"], rows[-1]["day"]
    # Month rollup
    by_month: dict[str, list[dict]] = {}
    for r in rows:
        by_month.setdefault(r["day"][:7], []).append(r)

    lines = [
        "# 健康全部总览",
        "",
        f"> {DISCLAIMER}",
        "",
        f"数据跨度：**{start} ~ {end}** · 有数据天数 **{len(rows)}** · 训练记录 **{workouts_total}** 次",
        "",
        "## 全期均值",
        "",
        f"- 综合观察分：{_fmt(_avg(rows, 'overall_score'), 0)}",
        f"- 心情：{_fmt(_avg(rows, 'mood_score'), 1)} / 5（{_mood_label(_avg(rows, 'mood_score'))}）",
        f"- 睡眠：{_fmt(_avg(rows, 'sleep_hours'), 1, ' h')}",
        f"- 静息心率：{_fmt(_avg(rows, 'resting_hr'), 0, ' bpm')}",
        f"- HRV：{_fmt(_avg(rows, 'hrv_sdnn_ms'), 0, ' ms')}",
        f"- 日均步数：{_fmt(_avg(rows, 'steps'), 0)}",
        f"- 日均活动热量：{_fmt(_avg(rows, 'active_energy_kcal'), 0, ' kcal')}",
        f"- 日均锻炼：{_fmt(_avg(rows, 'exercise_minutes'), 0, ' min')}",
        "",
        "## 按月汇总",
        "",
        "| 月份 | 天数 | 步数 | 睡眠(h) | 静息HR | HRV | 心情 | 综合 | 训练次数 |",
        "|------|------|------|---------|--------|-----|------|------|----------|",
    ]
    for month in sorted(by_month.keys(), reverse=True):
        mrows = by_month[month]
        lines.append(
            f"| {month} | {len(mrows)} | {_fmt(_avg(mrows, 'steps'), 0)} "
            f"| {_fmt(_avg(mrows, 'sleep_hours'), 1)} | {_fmt(_avg(mrows, 'resting_hr'), 0)} "
            f"| {_fmt(_avg(mrows, 'hrv_sdnn_ms'), 0)} | {_fmt(_avg(mrows, 'mood_score'), 1)} "
            f"| {_fmt(_avg(mrows, 'overall_score'), 0)} | {_fmt(_sum(mrows, 'workout_count'), 0)} |"
        )
    lines.append("")
    return "\n".join(lines)


def _workouts_between(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT workout_activity_type, duration, duration_unit, total_energy_burned,
               total_energy_burned_unit, start_date
        FROM workouts
        WHERE substr(start_date, 1, 10) >= ? AND substr(start_date, 1, 10) <= ?
        ORDER BY start_date
        """,
        (start, end),
    ).fetchall()
    return [dict(r) for r in rows]


def _month_bounds(year_month: str) -> tuple[str, str]:
    y, m = map(int, year_month.split("-"))
    start = f"{y:04d}-{m:02d}-01"
    if m == 12:
        end = f"{y:04d}-12-31"
    else:
        from datetime import date as date_cls

        end = (date_cls(y, m + 1, 1) - timedelta(days=1)).isoformat()
    return start, end


def _prev_year_month(year_month: str) -> str:
    y, m = map(int, year_month.split("-"))
    if m == 1:
        return f"{y - 1:04d}-12"
    return f"{y:04d}-{m - 1:02d}"


def _save_report(
    conn: sqlite3.Connection,
    report_type: str,
    period_start: str,
    period_end: str,
    title: str,
    body: str,
    file_path: Path,
    *,
    reports_dir: Path | None = None,
) -> Path:
    out_dir = reports_dir or REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    file_path.write_text(body, encoding="utf-8")
    conn.execute(
        """
        INSERT INTO reports(report_type, period_start, period_end, title, body_md, file_path)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(report_type, period_start, period_end)
        DO UPDATE SET title=excluded.title, body_md=excluded.body_md,
                      file_path=excluded.file_path, created_at=datetime('now')
        """,
        (report_type, period_start, period_end, title, body, str(file_path)),
    )
    return file_path


def generate_reports(
    db_path: Path = DB_PATH,
    *,
    as_of: str | None = None,
    months: int = 12,
    reports_dir: Path | None = None,
) -> list[Path]:
    out_dir = reports_dir or REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    conn = init_db(db_path)
    conn.row_factory = sqlite3.Row

    if as_of is None:
        row = conn.execute("SELECT day FROM daily_metrics ORDER BY day DESC LIMIT 1").fetchone()
        if not row:
            conn.close()
            print("无日指标，跳过报告生成", flush=True)
            return []
        as_of = row["day"]

    day_row = _fetch_day(conn, as_of)
    if not day_row:
        conn.close()
        print(f"找不到日期 {as_of} 的指标", flush=True)
        return []

    # Baselines from extras or recompute lightly
    baselines = {}
    import json

    try:
        extras = json.loads(day_row.get("extras_json") or "{}")
        baselines = extras.get("baselines") or {}
    except json.JSONDecodeError:
        baselines = {}

    workouts = _workouts_on(conn, as_of)
    week_start = (datetime.strptime(as_of, "%Y-%m-%d").date() - timedelta(days=13)).isoformat()
    recent_rows = _fetch_range(conn, max(week_start, DATA_START_DATE), as_of)
    daily_md = build_daily_markdown(day_row, workouts, baselines, recent_rows=recent_rows)
    daily_path = out_dir / f"{as_of}.md"
    paths = [
        _save_report(
            conn, "daily", as_of, as_of, f"健康日报 {as_of}", daily_md, daily_path, reports_dir=out_dir
        )
    ]

    end_dt = datetime.strptime(as_of, "%Y-%m-%d").date()
    start_dt = end_dt - timedelta(days=6)
    start = start_dt.isoformat()
    week_rows = _fetch_range(conn, start, as_of)
    weekly_md = build_weekly_markdown(week_rows, start, as_of)
    weekly_path = out_dir / f"week_{start}_{as_of}.md"
    paths.append(
        _save_report(
            conn,
            "weekly",
            start,
            as_of,
            f"健康周报 {start}~{as_of}",
            weekly_md,
            weekly_path,
            reports_dir=out_dir,
        )
    )

    # Monthly reports for recent months with data
    month_rows = conn.execute(
        """
        SELECT DISTINCT substr(day, 1, 7) AS ym
        FROM daily_metrics
        WHERE day <= ? AND day >= ?
        ORDER BY ym DESC
        LIMIT ?
        """,
        (as_of, DATA_START_DATE, months),
    ).fetchall()
    for mrow in month_rows:
        ym = mrow["ym"]
        m_start, m_end = _month_bounds(ym)
        m_end = min(m_end, as_of)
        cur_rows = _fetch_range(conn, m_start, m_end)
        if not cur_rows:
            continue
        prev_ym = _prev_year_month(ym)
        p_start, p_end = _month_bounds(prev_ym)
        prev = _fetch_range(conn, p_start, p_end)
        m_workouts = _workouts_between(conn, m_start, m_end)
        monthly_md = build_monthly_markdown(cur_rows, ym, prev, m_workouts)
        monthly_path = out_dir / f"month_{ym}.md"
        paths.append(
            _save_report(
                conn,
                "monthly",
                m_start,
                m_end,
                f"健康月报 {ym}",
                monthly_md,
                monthly_path,
                reports_dir=out_dir,
            )
        )

    # Full overview (from DATA_START_DATE)
    all_rows = _fetch_range(conn, DATA_START_DATE, as_of)
    workout_total = conn.execute(
        "SELECT COUNT(*) AS c FROM workouts WHERE substr(start_date, 1, 10) >= ?",
        (DATA_START_DATE,),
    ).fetchone()["c"]
    overview_md = build_overview_markdown(all_rows, int(workout_total or 0))
    overview_path = out_dir / "overview_all.md"
    paths.append(
        _save_report(
            conn,
            "overview",
            all_rows[0]["day"] if all_rows else as_of,
            as_of,
            "健康全部总览",
            overview_md,
            overview_path,
            reports_dir=out_dir,
        )
    )

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        ("last_report_at", datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    conn.close()
    print(f"报告已生成: {[str(p) for p in paths]}", flush=True)
    return paths


if __name__ == "__main__":
    generate_reports()
