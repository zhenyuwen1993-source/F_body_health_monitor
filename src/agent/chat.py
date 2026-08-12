"""Local health Q&A agent over SQLite metrics (rule-based + optional Ollama)."""

from __future__ import annotations

import json
import re
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any

from src.config import DB_PATH, DISCLAIMER
from src.ingest.parse_export import init_db
from src.web.glossary import GLOSSARY, DISCLAIMER_SHORT


@dataclass
class AgentAnswer:
    text: str
    intent: str
    used_llm: bool = False


def _fmt(v: Any, digits: int = 1, suffix: str = "") -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):.{digits}f}{suffix}"
    except (TypeError, ValueError):
        return str(v)


def _conn(db_path: Path = DB_PATH) -> sqlite3.Connection:
    conn = init_db(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _latest_rows(conn: sqlite3.Connection, n: int = 14) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM daily_metrics ORDER BY day DESC LIMIT ?", (n,)
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


def _avg(rows: list[dict], field: str) -> float | None:
    vals = [r[field] for r in rows if r.get(field) is not None]
    return mean(vals) if vals else None


def build_context(db_path: Path = DB_PATH, days: int = 14) -> str:
    conn = _conn(db_path)
    rows = _latest_rows(conn, days)
    if not rows:
        conn.close()
        return "暂无日指标数据。"
    latest = rows[-1]
    month = latest["day"][:7]
    mrows = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM daily_metrics WHERE day LIKE ? ORDER BY day", (f"{month}%",)
        )
    ]
    workout_n = conn.execute("SELECT COUNT(*) AS c FROM workouts").fetchone()["c"]
    conn.close()

    lines = [
        f"最新日期: {latest['day']}",
        f"今日综合分 {_fmt(latest.get('overall_score'), 0)} / 恢复 {_fmt(latest.get('recovery_score'), 0)} / 活动 {_fmt(latest.get('activity_score'), 0)}",
        f"步数 {_fmt(latest.get('steps'), 0)} · 锻炼 {_fmt(latest.get('exercise_minutes'), 0)} min · 训练负荷 {_fmt(latest.get('training_load'), 0)}",
        f"CTL {_fmt(latest.get('ctl'), 0)} · ATL {_fmt(latest.get('atl'), 0)} · TSB(状态) {_fmt(latest.get('tsb'), 0)}",
        f"静息心率 {_fmt(latest.get('resting_hr'), 0)} · HRV {_fmt(latest.get('hrv_sdnn_ms'), 0)} ms",
        f"睡眠 {_fmt(latest.get('sleep_hours'), 1)} h · 睡眠一致性 {_fmt(latest.get('sleep_consistency'), 0)}",
        f"心情 {_fmt(latest.get('mood_score'), 1)} /5 ({latest.get('mood_source')})",
        f"近{len(rows)}日均值: 步数 {_fmt(_avg(rows,'steps'),0)} · 睡眠 {_fmt(_avg(rows,'sleep_hours'),1)}h · HRV {_fmt(_avg(rows,'hrv_sdnn_ms'),0)} · 心情 {_fmt(_avg(rows,'mood_score'),1)} · TSB {_fmt(_avg(rows,'tsb'),1)}",
        f"本月({month}) {len(mrows)} 天 · 日均步数 {_fmt(_avg(mrows,'steps'),0)} · 训练次数合计 {_fmt(sum((r.get('workout_count') or 0) for r in mrows),0)}",
        f"库内训练记录总数: {workout_n}",
        f"说明: {DISCLAIMER}",
    ]
    return "\n".join(lines)


def _intent(question: str) -> str:
    q = question.lower()
    # advice before explain — questions like「主要问题是什么有什么建议」
    if re.search(r"建议|怎么改|改善|未达标|该怎么|怎么办|训练计划|恢复日|主要问题|怎么练|如何恢复", q, re.I):
        return "advice"
    if re.search(r"准备度|morning|晨报|今天练什么|能不能练|readiness|essentials", q, re.I):
        return "morning"
    if re.search(r"recovery|strain|铁三角|目标区|exertion|whoop|恢复百分比", q, re.I):
        return "triad"
    if re.search(r"训练心率|运动心率|心率区间|workout|场均心率|最高心率|mets", q, re.I):
        return "workout_hr"
    if re.search(r"是什么|什么意思|解释一下|怎么看|标准值|参考区间|正常.*(多少|范围)|healthy|what is", q, re.I):
        return "explain"
    rules = [
        ("diagnose", r"诊断|diagnose|数据质量|来源|去重|source"),
        ("training", r"训练|负荷|ctl|atl|tsb|恢复日|deload|网球|跑步|workout"),
        ("sleep", r"睡眠|睡|bed|wake|一致性"),
        ("heart", r"心率|hrv|心脏|静息|血氧"),
        ("mood", r"心情|情绪|心态|mood"),
        ("steps", r"步数|活动|走路|steps"),
        ("month", r"月|本月|monthly"),
        ("today", r"今天|今日|today|怎么样"),
        ("week", r"周|近7|week"),
    ]
    for name, pat in rules:
        if re.search(pat, q, re.I):
            return name
    return "general"


def _match_glossary(question: str):
    q = question.lower()
    # direct keyword hits
    aliases = {
        "hrv": "hrv_sdnn_ms",
        "心率变异": "hrv_sdnn_ms",
        "静息": "resting_hr",
        "血氧": "spo2_avg",
        "tsb": "tsb",
        "ctl": "ctl",
        "atl": "atl",
        "训练负荷": "training_load",
        "综合分": "overall_score",
        "深睡": "sleep_deep_hours",
        "rem": "sleep_rem_hours",
        "步数": "steps",
        "锻炼": "exercise_minutes",
        "心情": "mood_score",
        "睡眠一致性": "sleep_consistency",
    }
    for word, key in aliases.items():
        if word in q:
            return GLOSSARY.get(key)
    for info in GLOSSARY.values():
        if info.name.lower() in q or info.key.lower() in q:
            return info
    return None


def _answer_rules(intent: str, rows: list[dict], question: str) -> str:
    if not rows:
        return "还没有计算出日指标。请先运行 `python scripts/run_pipeline.py`。"
    latest = rows[-1]
    week = rows[-7:] if len(rows) >= 7 else rows

    if intent == "explain":
        info = _match_glossary(question)
        if info:
            lines = [
                f"【{info.name}】",
                f"- 是什么：{info.what}",
                f"- 为什么重要：{info.why}",
                f"- 常见参考：{info.healthy}",
            ]
            if info.notes:
                lines.append(f"- 补充：{info.notes}")
            lines.append("")
            lines.append(DISCLAIMER_SHORT)
            return "\n".join(lines)
        return (
            "你可以问「HRV 是什么」「TSB 正常多少」「静息心率标准」等。\n"
            "完整词典也在仪表盘「指标词典」页。\n"
            f"{DISCLAIMER_SHORT}"
        )

    if intent == "advice":
        from src.insights.advice import advice_to_markdown, build_advice

        bundle = build_advice(latest, week)
        return advice_to_markdown(bundle)

    if intent == "morning":
        from src.metrics.readiness import compute_morning_brief

        conn = _conn()
        rows = _latest_rows(conn, 28)
        conn.close()
        brief = compute_morning_brief(rows, rows[-1] if rows else latest)
        lines = [
            f"## Morning Report · {brief.day}",
            "",
            f"**{brief.narrative}**",
            "",
            f"- 训练准备度：{_fmt(brief.training_readiness, 0)}（{brief.readiness_label}）",
            f"- HRV 状态：{brief.hrv_status} — {brief.hrv_status_detail}",
            f"- 睡眠分：{_fmt(brief.sleep_score, 0)} · 需求 {_fmt(brief.sleep_need_h, 1)}h · 债 {_fmt(brief.sleep_debt_h, 1)}h",
            f"- 能量近似：{_fmt(brief.body_battery, 0)} · Strain {_fmt(brief.strain, 1)}",
            f"- 训练状态：{brief.training_status} · 恢复时间约 {_fmt(brief.recovery_time_h, 1)}h",
            f"- 今日建议强度：{brief.suggested_intensity}",
            f"- {brief.suggested_workout}",
            "",
            "### 因子",
            "",
        ]
        for f in brief.factors:
            lines.append(f"- {f.name}：{_fmt(f.score, 0)}（{f.label}）— {f.detail}")
        lines.append(f"\n{DISCLAIMER}")
        return "\n".join(lines)

    if intent == "triad":
        from src.metrics.triad import load_triad, triad_advice_lines

        t = load_triad()
        lines = ["## Recovery · Strain · Sleep", ""]
        lines.extend(f"- {x}" for x in triad_advice_lines())
        if t:
            lines.extend(
                [
                    "",
                    f"- HR 样本：{t.get('hr_samples')} · TRIMP {_fmt(t.get('strain_trimp'), 1)}",
                    f"- Strain(HR) {_fmt(t.get('strain_from_hr'), 1)} · Strain(Effort) {_fmt(t.get('strain_from_effort'), 1)}",
                    f"- HRV 比基线 {_fmt(t.get('hrv_ratio'), 2)} · RHR 比基线 {_fmt(t.get('rhr_ratio'), 2)}",
                    "",
                    "方法：Banister TRIMP（心率储备）→ 0–21；Recovery≈Athlytic（SDNN+RHR 基线）。",
                ]
            )
        lines.append(f"\n{DISCLAIMER}")
        return "\n".join(lines)

    if intent == "workout_hr":
        from src.metrics.workouts import load_workout_analytics, workout_advice_lines

        lines = ["## 训练心率分析（近两周）", ""]
        lines.extend(f"- {t}" for t in workout_advice_lines())
        rows = load_workout_analytics(limit=8)
        if rows:
            lines.extend(["", "### 最近训练", ""])
            for r in rows:
                dur = r.get("duration_min") or 0
                base = f"- {r.get('day')} {r.get('activity')} · {dur:.0f} min"
                if r.get("hr_avg") is not None and r.get("hr_max") is not None:
                    base += (
                        f" · 均心 {r['hr_avg']:.0f} / 最高 {r['hr_max']:.0f}"
                        f" · {r.get('hr_zone') or ''}"
                    )
                elif r.get("hr_avg") is not None:
                    base += f" · 均心 {r['hr_avg']:.0f} · {r.get('hr_zone') or ''}"
                else:
                    base += " · 无心率"
                if r.get("note"):
                    base += f" · {r['note']}"
                lines.append(base)
        lines.append(f"\n{DISCLAIMER}")
        return "\n".join(lines)

    if intent == "diagnose":
        src = latest.get("preferred_sources_json")
        try:
            preferred = json.loads(src) if src else {}
        except json.JSONDecodeError:
            preferred = {}
        lines = [
            f"数据诊断（{latest['day']}）",
            f"- 步数/活动等累计指标按「Watch > 手动 Health > iPhone > 其他」择优，避免双计。",
            f"- 今日选用的来源: {preferred or '—'}",
            f"- 训练负荷 CTL/ATL/TSB 已写入日表；TSB>0 偏新鲜，<0 偏疲劳。",
            f"- {DISCLAIMER}",
        ]
        return "\n".join(lines)

    if intent == "today":
        return (
            f"{latest['day']} 快照：综合 {_fmt(latest.get('overall_score'),0)}，"
            f"步数 {_fmt(latest.get('steps'),0)}，睡眠 {_fmt(latest.get('sleep_hours'),1)}h，"
            f"静息心率 {_fmt(latest.get('resting_hr'),0)}，HRV {_fmt(latest.get('hrv_sdnn_ms'),0)}ms，"
            f"心情 {_fmt(latest.get('mood_score'),1)}，"
            f"TSB {_fmt(latest.get('tsb'),0)}（CTL {_fmt(latest.get('ctl'),0)} / ATL {_fmt(latest.get('atl'),0)}）。\n"
            f"{DISCLAIMER}"
        )

    if intent == "training":
        tsb = latest.get("tsb")
        tip = "可正常训练" if tsb is not None and tsb >= 0 else "建议偏恢复/低强度"
        if tsb is not None and tsb < -10:
            tip = "疲劳累积明显，优先恢复日或轻量有氧"
        return (
            f"训练负荷：今日 load {_fmt(latest.get('training_load'),0)}，"
            f"CTL(体能) {_fmt(latest.get('ctl'),0)}，ATL(疲劳) {_fmt(latest.get('atl'),0)}，"
            f"TSB(状态) {_fmt(tsb,0)} → {tip}。\n"
            f"近一周日均 load {_fmt(_avg(week,'training_load'),0)}，"
            f"训练次数合计 {_fmt(sum((r.get('workout_count') or 0) for r in week),0)}。\n"
            f"{DISCLAIMER}"
        )

    if intent == "sleep":
        return (
            f"睡眠：今日 {_fmt(latest.get('sleep_hours'),1)}h "
            f"(深/REM/核心 {_fmt(latest.get('sleep_deep_hours'),1)}/"
            f"{_fmt(latest.get('sleep_rem_hours'),1)}/{_fmt(latest.get('sleep_core_hours'),1)})，"
            f"7 日睡眠一致性 {_fmt(latest.get('sleep_consistency'),0)}/100"
            f"（越高作息越稳）。近一周日均睡眠 {_fmt(_avg(week,'sleep_hours'),1)}h。\n"
            f"若睡眠经常为空，请夜间佩戴手表。\n{DISCLAIMER}"
        )

    if intent == "heart":
        return (
            f"心脏：静息 {_fmt(latest.get('resting_hr'),0)} bpm，"
            f"平均 {_fmt(latest.get('avg_hr'),0)}，HRV {_fmt(latest.get('hrv_sdnn_ms'),0)} ms，"
            f"血氧 {_fmt(latest.get('spo2_avg'),1)}%。\n"
            f"近一周静息均值 {_fmt(_avg(week,'resting_hr'),0)}，HRV 均值 {_fmt(_avg(week,'hrv_sdnn_ms'),0)}。\n"
            f"{DISCLAIMER}"
        )

    if intent == "mood":
        return (
            f"心情：今日 {_fmt(latest.get('mood_score'),1)}/5（来源 {latest.get('mood_source')}）。"
            f"近一周均值 {_fmt(_avg(week,'mood_score'),1)}。\n"
            f"建议在健康 App 记录「心态」以提高准确度。\n{DISCLAIMER}"
        )

    if intent == "steps":
        return (
            f"活动：今日步数 {_fmt(latest.get('steps'),0)}，活动热量 {_fmt(latest.get('active_energy_kcal'),0)} kcal，"
            f"锻炼 {_fmt(latest.get('exercise_minutes'),0)} min。\n"
            f"近一周日均步数 {_fmt(_avg(week,'steps'),0)}。\n{DISCLAIMER}"
        )

    if intent == "week":
        return (
            f"近 {len(week)} 日：综合 {_fmt(_avg(week,'overall_score'),0)}，"
            f"步数 {_fmt(_avg(week,'steps'),0)}，睡眠 {_fmt(_avg(week,'sleep_hours'),1)}h，"
            f"HRV {_fmt(_avg(week,'hrv_sdnn_ms'),0)}，心情 {_fmt(_avg(week,'mood_score'),1)}，"
            f"TSB {_fmt(_avg(week,'tsb'),1)}。\n{DISCLAIMER}"
        )

    if intent == "month":
        return (
            f"以最近数据日 {latest['day']} 所在月为参考：请打开仪表盘「月度分析」查看图表与月报；"
            f"今日综合 {_fmt(latest.get('overall_score'),0)}，本周均综合 {_fmt(_avg(week,'overall_score'),0)}。\n"
            f"{DISCLAIMER}"
        )

    # general
    return (
        f"我可以回答：今天怎么样、睡眠、心率/HRV、训练负荷(CTL/ATL/TSB)、步数、心情、近一周、数据诊断。\n"
        f"基于 {latest['day']}：综合 {_fmt(latest.get('overall_score'),0)}，"
        f"TSB {_fmt(latest.get('tsb'),0)}，心情 {_fmt(latest.get('mood_score'),1)}。\n"
        f"你的问题：「{question}」\n{DISCLAIMER}"
    )


def _ollama_chat(prompt: str, model: str = "llama3.1") -> str | None:
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是个人健康数据分析助手。只根据提供的本地指标回答，"
                    "不要编造数字，不要给出医疗诊断。用简洁中文。"
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return (data.get("message") or {}).get("content")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
        return None


def ask(question: str, db_path: Path = DB_PATH, *, use_llm: bool = True) -> AgentAnswer:
    conn = _conn(db_path)
    rows = _latest_rows(conn, 30)
    conn.close()
    intent = _intent(question)
    base = _answer_rules(intent, rows, question)

    if use_llm:
        ctx = build_context(db_path)
        prompt = f"本地健康上下文:\n{ctx}\n\n用户问题: {question}\n\n请给简洁可执行建议（非医疗诊断）。"
        llm = _ollama_chat(prompt)
        if llm:
            return AgentAnswer(text=llm.strip() + f"\n\n---\n本地规则摘要：\n{base}", intent=intent, used_llm=True)

    return AgentAnswer(text=base, intent=intent, used_llm=False)


def chat_loop(db_path: Path = DB_PATH) -> None:
    print("健康 Agent（输入 exit 退出）。可选：本机 Ollama 增强回答。")
    print(DISCLAIMER)
    print()
    print(build_context(db_path))
    print()
    while True:
        try:
            q = input("你 › ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not q:
            continue
        if q.lower() in {"exit", "quit", "/exit", "q"}:
            break
        ans = ask(q, db_path)
        tag = "LLM" if ans.used_llm else ans.intent
        print(f"\n助手[{tag}] ›\n{ans.text}\n")


if __name__ == "__main__":
    chat_loop()
