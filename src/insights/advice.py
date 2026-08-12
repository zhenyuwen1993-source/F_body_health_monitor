"""Actionable health insights: gaps, main problems, lifestyle advice.

Includes optional TCM-inspired constitution hints and BaZi lifestyle references.
These are cultural/wellness observations — not medical or fortune-telling claims.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from statistics import mean, median
from typing import Any

from src.config import DISCLAIMER
from src.profile import UserProfile, load_profile


@dataclass
class MetricFlag:
    key: str
    name: str
    status: str  # miss | warn | ok | unknown
    value_text: str
    target_text: str
    detail: str


@dataclass
class AdviceBundle:
    headline: str
    main_problems: list[str] = field(default_factory=list)
    flags: list[MetricFlag] = field(default_factory=list)
    exercise: list[str] = field(default_factory=list)
    recovery: list[str] = field(default_factory=list)
    lifestyle: list[str] = field(default_factory=list)
    tcm: list[str] = field(default_factory=list)
    bazi: list[str] = field(default_factory=list)
    disclaimer: str = DISCLAIMER


def _n(row: dict, key: str) -> float | None:
    v = row.get(key)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _baselines(row: dict) -> dict:
    try:
        extras = json.loads(row.get("extras_json") or "{}")
        return extras.get("baselines") or {}
    except json.JSONDecodeError:
        return {}


def _avg(rows: list[dict], key: str) -> float | None:
    vals = [_n(r, key) for r in rows]
    vals = [v for v in vals if v is not None]
    return mean(vals) if vals else None


def evaluate_flags(latest: dict, recent: list[dict]) -> list[MetricFlag]:
    base = _baselines(latest)
    flags: list[MetricFlag] = []

    sleep = _n(latest, "sleep_hours")
    if sleep is None:
        flags.append(
            MetricFlag(
                "sleep_hours",
                "睡眠时长",
                "miss",
                "—",
                "7–9 小时",
                "近几天缺少睡眠分期数据，核心恢复指标无法闭环。夜间佩戴手表是第一优先。",
            )
        )
    elif sleep < 6:
        flags.append(MetricFlag("sleep_hours", "睡眠时长", "miss", f"{sleep:.1f}h", "7–9 小时", "明显偏短，恢复与情绪通常会受影响。"))
    elif sleep < 7:
        flags.append(MetricFlag("sleep_hours", "睡眠时长", "warn", f"{sleep:.1f}h", "7–9 小时", "略少，尽量提前 30–60 分钟入睡。"))
    else:
        flags.append(MetricFlag("sleep_hours", "睡眠时长", "ok", f"{sleep:.1f}h", "7–9 小时", "时长落在常见推荐区间。"))

    hrv = _n(latest, "hrv_sdnn_ms")
    hrv_b = base.get("hrv_sdnn_ms")
    week_hrv = _avg(recent, "hrv_sdnn_ms")
    if hrv is None:
        flags.append(MetricFlag("hrv", "HRV", "unknown", "—", "相对个人基线", "今日无 HRV，参考近周趋势。"))
    elif hrv_b and hrv < hrv_b * 0.85:
        flags.append(
            MetricFlag(
                "hrv",
                "HRV",
                "miss",
                f"{hrv:.0f} ms",
                f"个人基线约 {hrv_b:.0f} ms",
                f"低于基线约 {(1 - hrv / hrv_b) * 100:.0f}%，恢复弹性偏弱。",
            )
        )
    elif hrv_b and hrv < hrv_b * 0.95:
        flags.append(MetricFlag("hrv", "HRV", "warn", f"{hrv:.0f} ms", f"基线约 {hrv_b:.0f} ms", "略低于个人基线，留意压力与睡眠。"))
    else:
        flags.append(MetricFlag("hrv", "HRV", "ok", f"{hrv:.0f} ms", "接近或高于个人基线", "相对自身基线尚可。"))

    rhr = _n(latest, "resting_hr")
    rhr_b = base.get("resting_hr")
    if rhr is None:
        flags.append(MetricFlag("rhr", "静息心率", "unknown", "—", "相对个人基线", "暂无静息心率。"))
    elif rhr_b and rhr > rhr_b * 1.08:
        flags.append(
            MetricFlag(
                "rhr",
                "静息心率",
                "warn",
                f"{rhr:.0f} bpm",
                f"基线约 {rhr_b:.0f} bpm",
                "高于个人基线，常见于疲劳、压力或睡眠不足。",
            )
        )
    else:
        flags.append(MetricFlag("rhr", "静息心率", "ok", f"{rhr:.0f} bpm", "接近个人基线", "相对自身基线平稳。"))

    steps = _n(latest, "steps")
    if steps is None:
        flags.append(MetricFlag("steps", "步数", "unknown", "—", "≥7000 步", "无步数记录。"))
    elif steps < 4000:
        flags.append(MetricFlag("steps", "步数", "miss", f"{steps:.0f}", "≥7000 步", "活动量偏低，久坐风险上升。"))
    elif steps < 7000:
        flags.append(MetricFlag("steps", "步数", "warn", f"{steps:.0f}", "≥7000 步", "未达日常活动建议线，可加一节步行。"))
    else:
        flags.append(MetricFlag("steps", "步数", "ok", f"{steps:.0f}", "≥7000 步", "日常活动量达标。"))

    tsb = _n(latest, "tsb")
    week_tsb = _avg(recent, "tsb")
    if tsb is None:
        flags.append(MetricFlag("tsb", "TSB 状态", "unknown", "—", "≥ -10（不过度疲劳）", "暂无训练状态。"))
    elif tsb <= -15 or (week_tsb is not None and week_tsb <= -10):
        flags.append(
            MetricFlag(
                "tsb",
                "TSB 状态",
                "miss",
                f"{tsb:.0f}",
                "≥ -10",
                f"持续偏疲劳（近周均值 {week_tsb:.0f}）" if week_tsb is not None else "深度疲劳区，不宜再堆高强度。",
            )
        )
    elif tsb < -5:
        flags.append(MetricFlag("tsb", "TSB 状态", "warn", f"{tsb:.0f}", "≥ -10", "轻度疲劳累积，强度课要挑感觉好的日子。"))
    else:
        flags.append(MetricFlag("tsb", "TSB 状态", "ok", f"{tsb:.0f}", "≥ -10", "状态相对新鲜。"))

    mood = _n(latest, "mood_score")
    if mood is None:
        flags.append(MetricFlag("mood", "心情", "unknown", "—", "≥ 3.5 /5", "无心情记录。"))
    elif mood < 2.6:
        flags.append(MetricFlag("mood", "心情", "miss", f"{mood:.1f}", "≥ 3.5 /5", "主观状态偏低，优先睡眠与减压。"))
    elif mood < 3.5:
        flags.append(MetricFlag("mood", "心情", "warn", f"{mood:.1f}", "≥ 3.5 /5", "中等偏好，可主动安排放松与社交恢复。"))
    else:
        flags.append(MetricFlag("mood", "心情", "ok", f"{mood:.1f}", "≥ 3.5 /5", "情绪观察尚可。"))

    recovery = _n(latest, "recovery_score")
    if recovery is not None:
        if recovery < 45:
            flags.append(MetricFlag("recovery", "恢复分", "miss", f"{recovery:.0f}", "≥70", "恢复不足，今天更适合主动恢复。"))
        elif recovery < 70:
            flags.append(MetricFlag("recovery", "恢复分", "warn", f"{recovery:.0f}", "≥70", "恢复一般，控制训练上限。"))
        else:
            flags.append(MetricFlag("recovery", "恢复分", "ok", f"{recovery:.0f}", "≥70", "恢复较好。"))

    cons = _n(latest, "sleep_consistency")
    if cons is not None:
        if cons < 45:
            flags.append(MetricFlag("sleep_consistency", "睡眠一致性", "miss", f"{cons:.0f}", "≥70", "作息波动大，生物钟不稳。"))
        elif cons < 70:
            flags.append(MetricFlag("sleep_consistency", "睡眠一致性", "warn", f"{cons:.0f}", "≥70", "作息还不够稳。"))
        else:
            flags.append(MetricFlag("sleep_consistency", "睡眠一致性", "ok", f"{cons:.0f}", "≥70", "作息较规律。"))

    return flags


def _main_problems(flags: list[MetricFlag], latest: dict, recent: list[dict]) -> list[str]:
    problems: list[str] = []
    miss = [f for f in flags if f.status == "miss"]
    warn = [f for f in flags if f.status == "warn"]

    # Prioritized narrative
    sleep_f = next((f for f in flags if f.key == "sleep_hours"), None)
    if sleep_f and sleep_f.status == "miss" and sleep_f.value_text == "—":
        problems.append("【主问题】睡眠数据缺口：没有可靠睡眠记录，恢复判断不准——请夜间戴表睡觉。")
    elif sleep_f and sleep_f.status in {"miss", "warn"}:
        problems.append(f"【主问题】睡眠不足或不稳：{sleep_f.detail}")

    hrv_f = next((f for f in flags if f.key == "hrv"), None)
    tsb_f = next((f for f in flags if f.key == "tsb"), None)
    if (hrv_f and hrv_f.status == "miss") or (tsb_f and tsb_f.status == "miss"):
        problems.append("【主问题】恢复跟不上负荷：HRV/TSB 显示疲劳累积，继续高强度容易越练越疲。")
    elif tsb_f and tsb_f.status == "warn":
        problems.append(f"【次要】训练状态偏紧：{tsb_f.detail}")

    steps_f = next((f for f in flags if f.key == "steps"), None)
    if steps_f and steps_f.status in {"miss", "warn"}:
        # Only elevate if not a heavy training fatigue day
        problems.append(f"【次要】日常活动量未达标：{steps_f.detail}")

    mood_f = next((f for f in flags if f.key == "mood"), None)
    if mood_f and mood_f.status in {"miss", "warn"}:
        problems.append(f"【次要】心情观察一般：{mood_f.detail}")

    if not problems:
        if warn:
            problems.append("整体尚可，但仍有需留意项：" + "；".join(f.name for f in warn[:3]))
        else:
            problems.append("今日核心指标大体达标，保持节奏即可。")

    # Cap
    return problems[:4]


def _exercise_tips(flags: list[MetricFlag], latest: dict) -> list[str]:
    tips: list[str] = []
    tsb = _n(latest, "tsb")
    hrv_bad = any(f.key == "hrv" and f.status == "miss" for f in flags)
    recovery = _n(latest, "recovery_score") or 50

    if (tsb is not None and tsb <= -10) or hrv_bad or recovery < 45:
        tips.append("今天定位「主动恢复日」：停高强度（网球/间歇跑），改 20–40 分钟轻松步行或骑行，心率保持能聊天的强度。")
        tips.append("若仍想动，只做技术轻打或活动度/拉伸 15 分钟，把「练完更累」当成失败信号。")
    elif tsb is not None and tsb < -5:
        tips.append("可维持有氧，但去掉最后一组冲刺；训练体积先减 20–30%。")
        tips.append("强度课放到 HRV 回到基线附近或 TSB > -5 的日子。")
    else:
        tips.append("状态允许质量课：先热身，主课 1 个重点（速度或力量二选一），避免同一天堆两项高强度。")

    steps_f = next((f for f in flags if f.key == "steps"), None)
    if steps_f and steps_f.status in {"miss", "warn"}:
        tips.append("日常步数缺口用「通勤多走一站 + 饭后 15 分钟」补，不靠晚上补虐训练。")

    tips.append("连续训练 2–3 天后安排 1 个真正轻松日，比每周随机硬刚更不容易垮。")
    try:
        from src.metrics.workouts import workout_advice_lines

        tips.extend(workout_advice_lines()[:2])
    except Exception:
        pass
    return tips[:6]


def _recovery_tips(flags: list[MetricFlag], latest: dict) -> list[str]:
    tips: list[str] = []
    sleep_f = next((f for f in flags if f.key == "sleep_hours"), None)
    if sleep_f and sleep_f.value_text == "—":
        tips.append("今晚必须戴表睡觉，否则恢复监控是瞎的；目标上床时间固定，先求「有数据」。")
    elif sleep_f and sleep_f.status in {"miss", "warn"}:
        tips.append("回补睡眠：今晚提前 45–60 分钟上床，咖啡因截止到下午 2 点，睡前 1 小时降亮度。")

    if any(f.key == "hrv" and f.status in {"miss", "warn"} for f in flags):
        tips.append("HRV 偏低时：今晚不做晚间剧烈运动；可尝试 5–10 分钟缓慢呼吸（吸 4 秒呼 6 秒）。")

    tips.append("恢复清单三件套：蛋白质+蔬果一餐、补水、睡够；酒精会显著拖 HRV，这两天尽量少喝。")
    tips.append("如果连续 3 天恢复分 <45 或 TSB < -15，主动删掉一场比赛/高强度局。")
    return tips[:4]


def _lifestyle_tips(flags: list[MetricFlag], latest: dict) -> list[str]:
    tips = [
        "作息锚点：固定起床时间比周末补觉更重要；闹钟后 30 分钟内见自然光。",
        "工作块之间站起来走 2–3 分钟，比一次补一万步更利于久坐代谢。",
    ]
    if any(f.key == "mood" and f.status in {"miss", "warn"} for f in flags):
        tips.append("心情一般时，优先「社交/户外短走」而不是刷手机到深夜；并在健康 App 打卡一次心态。")
    tips.append("耳机音量保守听：疲劳日主观音量容易开更大，注意听力保护。")
    return tips[:4]


def tcm_constitution_hints(latest: dict, recent: list[dict], flags: list[MetricFlag]) -> list[str]:
    """Very light TCM-inspired wellness mapping — not diagnosis."""
    hints: list[str] = [
        "以下为中医体质/养生视角的「倾向观察」，只供生活调养参考，不能替代中医师面诊。",
    ]
    sleep_missing = any(f.key == "sleep_hours" and f.value_text == "—" for f in flags)
    hrv_low = any(f.key == "hrv" and f.status == "miss" for f in flags)
    tsb_low = any(f.key == "tsb" and f.status in {"miss", "warn"} for f in flags)
    rhr = _n(latest, "resting_hr")
    steps = _n(latest, "steps")
    mood = _n(latest, "mood_score")

    # Crude pattern mapping
    if sleep_missing or hrv_low or tsb_low:
        hints.append(
            "倾向「气虚/阴不足」样态（疲劳累积、恢复慢）：少耗散、早睡、避免大汗淋漓的死磕训练；可偏温润饮食（粥、蛋、蔬果），少冰饮。"
        )
    if rhr and rhr >= 70 and (mood is not None and mood < 3.3):
        hints.append(
            "心神偏亢/压力样信号：减少夜间兴奋性刺激（咖啡、激烈比赛回放、刷短视频），可练安神呼吸或短暂冥想。"
        )
    if steps is not None and steps < 4000 and (mood is not None and mood < 3.2):
        hints.append(
            "「久坐气滞」样：每小时起身、饭后缓行；情志上避免闷在室内，短户外比硬练更合适。"
        )
    if any(f.key == "steps" and f.status == "ok" for f in flags) and tsb_low:
        hints.append(
            "动得不少但恢复不够：中医说「形劳则气耗」——活动改为和缓，重点养神与睡眠，而不是再加量。"
        )

    hour = datetime.now().hour
    if hour >= 21 or hour < 5:
        hints.append("子时前后宜渐静：若还在强光/训练，易耗阴血；尽量进入洗漱-暗光-上床流程。")
    else:
        hints.append("白天可「微微取汗」式活动（轻走）疏通气机，但以不端着累进下一场高强度为准。")

    hints.append("若要系统中医调理，请携带症状与作息记录线下就诊；此处不做方药推荐。")
    return hints


def bazi_lifestyle_hints(profile: UserProfile | None = None) -> list[str]:
    profile = profile or load_profile()
    lines: list[str] = [
        "生辰八字仅作传统文化作息/性情参考，与健康数据交叉时请保持审慎，不作命运或医疗判断。",
    ]

    pillars = None
    day_master = None
    if profile.bazi_manual:
        pillars = profile.bazi_manual.strip()
        lines.append(f"手填四柱：{pillars}")
    elif profile.birth_datetime:
        pillars, day_master, detail = _compute_bazi(profile.birth_datetime, profile.sex)
        if pillars:
            lines.append(f"排盘四柱：{pillars}")
            if day_master:
                lines.append(f"日主：{day_master}")
            if detail:
                lines.extend(detail)
        else:
            lines.append("未能自动排盘，请检查 profile.json 的 birth_datetime，或手填 bazi_manual。")
    else:
        lines.append(
            "尚未配置生辰：编辑 data/profile.json，填写 birth_datetime（如 \"1992-05-18 08:30\"）与 sex（男/女）。"
        )
        lines.append("配置后可结合日主阴阳五行，给出作息与训练节奏的文化侧参考。")
        return lines

    # Generic day-master lifestyle overlays
    tips = _day_master_tips(day_master or "")
    lines.extend(tips)
    lines.append("八字参考应让位于客观指标：HRV/睡眠/TSB 明显差时，优先休息，不因「今日宜练」硬上。")
    return lines


def _compute_bazi(birth_datetime: str, sex: str | None) -> tuple[str | None, str | None, list[str]]:
    try:
        from lunar_python import Solar
    except ImportError:
        return None, None, ["未安装 lunar_python，可 pip install lunar-python 后自动排盘。"]

    try:
        dt = datetime.strptime(birth_datetime.strip(), "%Y-%m-%d %H:%M")
    except ValueError:
        try:
            dt = datetime.strptime(birth_datetime.strip(), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None, None, ["birth_datetime 格式应为 YYYY-MM-DD HH:MM"]

    solar = Solar.fromYmdHms(dt.year, dt.month, dt.day, dt.hour, dt.minute, 0)
    lunar = solar.getLunar()
    ec = lunar.getEightChar()
    pillars = f"{ec.getYear()} {ec.getMonth()} {ec.getDay()} {ec.getTime()}"
    day_master = ec.getDayGan()  # 日干
    detail = [
        f"农历：{lunar.toString()}",
        f"性别标注：{sex or '未填'}（仅档案用）",
    ]
    return pillars, day_master, detail


def _day_master_tips(gan: str) -> list[str]:
    mapping = {
        "甲": ["日主甲木：宜有规律伸展与户外，忌长期压抑不动；训练注重节奏而非蛮干。"],
        "乙": ["日主乙木：适合柔韧、持续有氧；压力大时用散步疏肝，避免闷头硬扛。"],
        "丙": ["日主丙火：精力外放，注意别过午后还高强度；护睡眠即护「火神」。"],
        "丁": ["日主丁火：细火慢功型，适合技术练习；睡眠与情绪波动时减刺激。"],
        "戊": ["日主戊土：稳扎稳打，恢复日也要真正停高强度；饮食规律比极端饮食更合适。"],
        "己": ["日主己土：重脾胃作息，少暴饮暴食与深夜进食；训练循序渐进。"],
        "庚": ["日主庚金：执行力强但易过度，必须设置强制轻松日，防「透支硬刚」。"],
        "辛": ["日主辛金：精细恢复很重要，睡眠与放松仪式感能帮你保持锋芒。"],
        "壬": ["日主壬水：流动变化大，固定睡眠锚点；水性喜动，但忌连续大负荷不休。"],
        "癸": ["日主癸水：怕耗阴，晚睡杀伤大；偏好温和有氧与规律早睡。"],
    }
    for k, tips in mapping.items():
        if k in gan:
            return tips
    return ["已排盘，但日主未识别到常用天干映射；仍以客观恢复指标为主。"]


def build_advice(latest: dict, recent: list[dict] | None = None, profile: UserProfile | None = None) -> AdviceBundle:
    recent = recent or [latest]
    flags = evaluate_flags(latest, recent)
    problems = _main_problems(flags, latest, recent)

    brief = None
    try:
        from src.metrics.readiness import compute_morning_brief

        brief = compute_morning_brief(recent, latest)
    except Exception:
        brief = None

    miss_n = sum(1 for f in flags if f.status == "miss")
    warn_n = sum(1 for f in flags if f.status == "warn")
    if brief and brief.training_readiness is not None:
        headline = (
            f"训练准备度 {int(brief.training_readiness)}（{brief.readiness_label}）· "
            f"今日建议「{brief.suggested_intensity}」· HRV {brief.hrv_status}"
        )
    elif miss_n >= 2:
        headline = f"今日优先处理 {miss_n} 个未达标核心项：先睡眠与恢复，再谈加量"
    elif miss_n == 1:
        headline = "有 1 个核心缺口要补，其他项控制强度即可"
    elif warn_n:
        headline = "没有大崩，但有几项在警戒线——用主动恢复把趋势扳回来"
    else:
        headline = "核心指标大体达标，保持节奏，避免得意加量"

    exercise = _exercise_tips(flags, latest)
    if brief:
        exercise = [
            f"【Morning】{brief.suggested_workout}",
            f"目标负荷区间约 {brief.target_load_low:.0f}–{brief.target_load_high:.0f}"
            if brief.target_load_low is not None
            else f"强度定位：{brief.suggested_intensity}",
            f"训练状态：{brief.training_status} · 预计恢复尚需约 {brief.recovery_time_h} h",
            *exercise,
        ][:6]

    recovery = _recovery_tips(flags, latest)
    if brief and brief.sleep_need_h:
        recovery = [
            f"今晚睡眠需求约 {brief.sleep_need_h} h（近几日睡眠债约 {brief.sleep_debt_h} h）。",
            *recovery,
        ][:5]

    lifestyle = _lifestyle_tips(flags, latest)
    try:
        from src.insights.journal import impact_hints

        lifestyle = [*lifestyle, *impact_hints()[:1]][:5]
    except Exception:
        pass

    try:
        from src.metrics.triad import triad_advice_lines

        exercise = [*triad_advice_lines()[:2], *exercise][:7]
    except Exception:
        pass

    return AdviceBundle(
        headline=headline,
        main_problems=problems,
        flags=flags,
        exercise=exercise,
        recovery=recovery,
        lifestyle=lifestyle,
        tcm=tcm_constitution_hints(latest, recent, flags),
        bazi=bazi_lifestyle_hints(profile),
    )


def advice_to_markdown(bundle: AdviceBundle) -> str:
    status_cn = {"miss": "未达标", "warn": "需留意", "ok": "达标", "unknown": "缺数据"}
    lines = [
        f"## 今日诊断与建议",
        "",
        f"**{bundle.headline}**",
        "",
        f"> {bundle.disclaimer}",
        "",
        "### 主要问题",
        "",
    ]
    for p in bundle.main_problems:
        lines.append(f"- {p}")
    lines.extend(["", "### 核心指标打标", ""])
    lines.append("| 指标 | 状态 | 今日 | 目标/参考 | 说明 |")
    lines.append("|------|------|------|-----------|------|")
    for f in bundle.flags:
        lines.append(
            f"| {f.name} | {status_cn.get(f.status, f.status)} | {f.value_text} | {f.target_text} | {f.detail} |"
        )
    lines.extend(["", "### 运动建议", ""])
    for t in bundle.exercise:
        lines.append(f"- {t}")
    lines.extend(["", "### 恢复建议", ""])
    for t in bundle.recovery:
        lines.append(f"- {t}")
    lines.extend(["", "### 生活习惯", ""])
    for t in bundle.lifestyle:
        lines.append(f"- {t}")
    lines.extend(["", "### 中医养生参考", ""])
    for t in bundle.tcm:
        lines.append(f"- {t}")
    lines.extend(["", "### 生辰八字参考", ""])
    for t in bundle.bazi:
        lines.append(f"- {t}")
    lines.append("")
    return "\n".join(lines)
