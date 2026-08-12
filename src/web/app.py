"""Streamlit dashboard for Apple Health local monitor."""

from __future__ import annotations

import html
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import (
    DATA_START_DATE,
    DISCLAIMER,
    PT_SESSION_START_DATE,
    PT_SESSION_TIME_END,
    PT_SESSION_TIME_START,
)
from src.metrics.compute import upsert_manual_mood
from src.web.glossary import (
    DISCLAIMER_SHORT,
    GLOSSARY,
    info_for_label,
    localized_metric,
    render_glossary_markdown,
)
from src.workspace import Workspace, migrate_legacy_if_needed, workspace_for
from src.profile import set_profile_path
from src.web.i18n import band_label, get_lang, intent_label, normalize_lang, tr

st.set_page_config(
    page_title="健康监控",
    page_icon="H",
    layout="wide",
)

# Teal / coral / amber palette — vivid but not purple-AI default
COLORS = {
    "teal": "#0D9488",
    "teal_deep": "#0F766E",
    "coral": "#E11D48",
    "amber": "#D97706",
    "sky": "#0284C7",
    "lime": "#65A30D",
    "violet": "#7C3AED",  # sparingly
    "ink": "#134E4A",
    "mute": "#64748B",
    "good_bg": "#CCFBF1",
    "warn_bg": "#FEF3C7",
    "bad_bg": "#FFE4E6",
    "info_bg": "#E0F2FE",
    "chart": ["#0D9488", "#E11D48", "#D97706", "#0284C7", "#65A30D", "#F97316", "#0891B2"],
}

CHART_COLOR_MAP = {
    "overall_score": COLORS["teal"],
    "steps": COLORS["lime"],
    "sleep_hours": COLORS["sky"],
    "sleep_consistency": COLORS["sky"],
    "resting_hr": COLORS["coral"],
    "hrv_sdnn_ms": COLORS["teal_deep"],
    "active_energy_kcal": COLORS["amber"],
    "training_load": COLORS["amber"],
    "ctl": COLORS["teal"],
    "atl": COLORS["coral"],
    "tsb": COLORS["lime"],
    "mood_score": "#F59E0B",
}


def inject_css() -> None:
    st.markdown(
        f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;700&family=IBM+Plex+Sans:wght@400;600&display=swap');

html, body, [class*="css"]  {{
  font-family: 'IBM Plex Sans', sans-serif;
}}
h1, h2, h3, .dash-title {{
  font-family: 'DM Sans', sans-serif !important;
  color: {COLORS['ink']} !important;
}}
.stApp {{
  background:
    radial-gradient(1200px 500px at 10% -10%, #99F6E4 0%, transparent 55%),
    radial-gradient(900px 400px at 100% 0%, #FECACA 0%, transparent 50%),
    linear-gradient(180deg, #F0FDFA 0%, #FFF7ED 45%, #F8FAFC 100%);
}}
.block-container {{
  padding-top: 1.2rem;
  max-width: 1200px;
}}
div[data-testid="stTabs"] button[data-baseweb="tab"] {{
  font-weight: 600;
}}
div[data-testid="stTabs"] button[aria-selected="true"] {{
  color: {COLORS['teal_deep']} !important;
  border-bottom-color: {COLORS['teal']} !important;
}}
.hero-banner {{
  border-radius: 18px;
  padding: 1.1rem 1.35rem;
  margin: 0.2rem 0 1.1rem 0;
  border: 1px solid rgba(15, 118, 110, 0.18);
  box-shadow: 0 10px 30px rgba(13, 148, 136, 0.08);
}}
.hero-banner h2 {{
  margin: 0 0 0.35rem 0;
  font-size: 1.45rem;
}}
.hero-banner p {{
  margin: 0;
  opacity: 0.92;
  font-size: 0.95rem;
}}
.hl-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin: 0.6rem 0 1.1rem 0;
  overflow: visible;
  position: relative;
  z-index: 1;
}}
.hl-card {{
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(6px);
  min-height: 100px;
  z-index: 1;
}}
.hl-card .label {{
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: {COLORS['mute']};
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}}
.hl-card .ico {{
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  opacity: 0.9;
}}
.hl-card .value {{
  font-family: 'DM Sans', sans-serif;
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.2;
  margin-top: 0.25rem;
  color: {COLORS['ink']};
}}
.hl-card .hint {{
  font-size: 0.75rem;
  margin-top: 0.2rem;
  font-weight: 600;
}}
.hl-card .advice {{
  font-size: 0.72rem;
  margin-top: 0.4rem;
  color: {COLORS['mute']};
  line-height: 1.4;
  font-weight: 500;
}}
.rec-box {{
  margin: 0.4rem 0 1rem 0;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  background: linear-gradient(120deg, {COLORS['info_bg']}, #fff);
  border: 1px solid rgba(14, 165, 233, 0.25);
}}
.rec-box h3 {{
  margin: 0 0 0.45rem 0;
  font-family: 'DM Sans', sans-serif;
  font-size: 1rem;
}}
.rec-box ul {{
  margin: 0;
  padding-left: 1.1rem;
}}
.rec-box li {{
  margin: 0.2rem 0;
  line-height: 1.45;
}}
.hl-good {{ border-left: 5px solid {COLORS['teal']}; background: linear-gradient(135deg, {COLORS['good_bg']}, #fff); }}
.hl-warn {{ border-left: 5px solid {COLORS['amber']}; background: linear-gradient(135deg, {COLORS['warn_bg']}, #fff); }}
.hl-bad  {{ border-left: 5px solid {COLORS['coral']}; background: linear-gradient(135deg, {COLORS['bad_bg']}, #fff); }}
.hl-info {{ border-left: 5px solid {COLORS['sky']}; background: linear-gradient(135deg, {COLORS['info_bg']}, #fff); }}
.hl-good .hint {{ color: {COLORS['teal_deep']}; }}
.hl-warn .hint {{ color: {COLORS['amber']}; }}
.hl-bad .hint {{ color: {COLORS['coral']}; }}
.hl-info .hint {{ color: {COLORS['sky']}; }}
.section-chip {{
  display: inline-block;
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 0.28rem 0.7rem;
  border-radius: 999px;
  margin: 0.8rem 0 0.55rem 0;
  color: white;
}}
.chip-teal {{ background: {COLORS['teal']}; }}
.chip-coral {{ background: {COLORS['coral']}; }}
.chip-amber {{ background: {COLORS['amber']}; }}
.chip-sky {{ background: {COLORS['sky']}; }}
.chip-lime {{ background: {COLORS['lime']}; }}
.disclaimer {{
  color: {COLORS['mute']};
  font-size: 0.82rem;
  margin-bottom: 0.6rem;
}}
div[data-testid="stMetric"] {{
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(13,148,136,0.12);
  border-radius: 12px;
  padding: 0.55rem 0.7rem;
}}
div[data-testid="stMetric"] label {{
  color: {COLORS['mute']} !important;
}}
</style>
        """,
        unsafe_allow_html=True,
    )


def _num(value) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt_val(value, digits: int = 1, suffix: str = "") -> str:
    n = _num(value)
    if n is None:
        return "—"
    if abs(n) >= 1000 or digits == 0:
        return f"{n:.0f}{suffix}"
    return f"{n:.{digits}f}{suffix}"


def tone_for_score(value, *, high_good: bool = True, good=70, warn=45) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if not high_good:
        # e.g. resting HR relative — caller passes already-scored values mostly
        n = 100 - n
    if n >= good:
        return "good"
    if n >= warn:
        return "warn"
    return "bad"


def tone_for_tsb(value) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if n >= 5:
        return "good"
    if n >= -8:
        return "warn"
    return "bad"


def tone_for_rhr(value) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if n <= 62:
        return "good"
    if n <= 75:
        return "warn"
    return "bad"


def tone_for_mood(value) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if n >= 3.8:
        return "good"
    if n >= 2.8:
        return "warn"
    return "bad"


def tone_for_steps(value) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if n >= 8000:
        return "good"
    if n >= 4000:
        return "warn"
    return "bad"


def tone_for_sleep(value) -> str:
    n = _num(value)
    if n is None:
        return "info"
    if 7 <= n <= 9:
        return "good"
    if 5.5 <= n < 7 or 9 < n <= 10:
        return "warn"
    return "bad"


HINTS = {
    "good": "状态不错",
    "warn": "需要留意",
    "bad": "重点关注",
    "info": "数据不足",
}


# Inline SVG icons for metric cards (no emoji dependency)
_ICONS = {
    "recovery": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M20.8 8.6a5.5 5.5 0 0 0-9.8-3.5A5.5 5.5 0 0 0 1.2 8.6C1.2 15 11 21 11 21s9.8-6 9.8-12.4z"/></svg>',
    "strain": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2"><path d="M13 2 4 14h7l-1 8 10-14h-7l0-6z"/></svg>',
    "sleep": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#0EA5E9" stroke-width="2"><path d="M21 14.5A8.5 8.5 0 1 1 11.5 4 7 7 0 0 0 21 14.5z"/></svg>',
    "hrv": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/></svg>',
    "rhr": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    "steps": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#84CC16" stroke-width="2"><path d="M4 16c2 0 3-2 5-2s3 2 5 2 3-2 5-2"/><path d="M4 10c2 0 3-2 5-2s3 2 5 2 3-2 5-2"/></svg>',
    "tsb": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M12 3v18M5 10l7-7 7 7"/></svg>',
    "ready": '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
}


def _band_cn(band: str | None) -> str:
    return band_label(band, get_lang())


def highlight_cards(items: list[dict], *, show_glossary: bool = True) -> None:
    """Render a single HTML grid of complete cards with optional icons + advice."""
    parts = ['<div class="hl-grid">']
    explained: list = []
    for it in items:
        tone = it.get("tone", "info")
        hint = it.get("hint") or ""
        if hint in {"green", "yellow", "red", "unknown"}:
            hint = _band_cn(hint)
        advice = it.get("advice") or ""
        ico = _ICONS.get(it.get("icon") or "", "")
        info = info_for_label(it["label"])
        if info:
            explained.append(info)
        card = (
            f'<div class="hl-card hl-{tone}">'
            f'<div class="label">{ico}{html.escape(it["label"])}</div>'
            f'<div class="value">{html.escape(str(it["value"]))}</div>'
        )
        if hint:
            card += f'<div class="hint">{html.escape(hint)}</div>'
        if advice:
            card += f'<div class="advice">{html.escape(advice)}</div>'
        card += "</div>"
        parts.append(card)
    parts.append("</div>")
    st.markdown("".join(parts), unsafe_allow_html=True)

    if show_glossary and explained:
        seen = set()
        uniq = []
        for info in explained:
            if info.key in seen:
                continue
            seen.add(info.key)
            uniq.append(info)
        with st.expander(tr("metric_explain"), expanded=False):
            for info in uniq:
                loc = localized_metric(info, get_lang())
                st.markdown(f"**{loc.name}** — {loc.what}")
                st.caption(tr("ref_advice", text=loc.healthy))


def section_chip(text: str, color: str = "teal") -> None:
    st.markdown(f'<div class="section-chip chip-{color}">{html.escape(text)}</div>', unsafe_allow_html=True)


def status_banner(latest: pd.Series, advice_headline: str | None = None) -> None:
    overall = _num(latest.get("overall_score"))
    tsb = _num(latest.get("tsb"))
    day = latest["day"].date().isoformat() if hasattr(latest["day"], "date") else str(latest["day"])

    if tsb is not None and tsb < -10:
        bg, border = COLORS["bad_bg"], COLORS["coral"]
    elif overall is not None and overall >= 70:
        bg, border = COLORS["good_bg"], COLORS["teal"]
    elif overall is not None and overall < 45:
        bg, border = COLORS["warn_bg"], COLORS["amber"]
    else:
        bg, border = COLORS["info_bg"], COLORS["sky"]

    title = advice_headline or tr("today_observe")
    st.markdown(
        f'<div class="hero-banner" style="background:linear-gradient(120deg,{bg},#ffffff);'
        f'border-color:{border};">'
        f"<h2>{html.escape(title)}</h2>"
        f"<p>{html.escape(day)} · {html.escape(DISCLAIMER_SHORT)}</p></div>",
        unsafe_allow_html=True,
    )


def render_advice_panel(df: pd.DataFrame, latest: pd.Series, *, compact: bool = True) -> None:
    from src.insights.advice import build_advice

    recent = df.tail(14)
    rows = recent.to_dict(orient="records")
    for r in rows:
        if hasattr(r.get("day"), "date"):
            r["day"] = r["day"].date().isoformat()
    latest_row = dict(rows[-1]) if rows else latest.to_dict()
    if hasattr(latest_row.get("day"), "date"):
        latest_row["day"] = latest_row["day"].date().isoformat()

    bundle = build_advice(latest_row, rows)
    if compact:
        for p in bundle.main_problems[:2]:
            st.markdown(f"- {p}")
        st.markdown(f"**{tr('how_to_train')}**")
        for t in bundle.exercise[:2]:
            st.markdown(f"- {t}")
        return

    status_map = {
        "miss": tr("status_miss"),
        "warn": tr("status_warn"),
        "ok": tr("status_ok"),
        "unknown": tr("status_unknown"),
    }
    tone_map = {"miss": "bad", "warn": "warn", "ok": "good", "unknown": "info"}
    st.markdown(f"**{bundle.headline}**")
    for p in bundle.main_problems:
        st.markdown(f"- {p}")
    flag_items = [
        {
            "label": f.name,
            "value": f"{status_map.get(f.status, f.status)} · {f.value_text}",
            "tone": tone_map.get(f.status, "info"),
            "hint": f.target_text,
        }
        for f in bundle.flags
    ]
    highlight_cards(flag_items)
    c1, c2, c3 = st.columns(3)
    with c1:
        st.markdown(f"##### {tr('advice_exercise')}")
        for t in bundle.exercise[:3]:
            st.markdown(f"- {t}")
    with c2:
        st.markdown(f"##### {tr('advice_recovery')}")
        for t in bundle.recovery[:3]:
            st.markdown(f"- {t}")
    with c3:
        st.markdown(f"##### {tr('advice_lifestyle')}")
        for t in bundle.lifestyle[:3]:
            st.markdown(f"- {t}")

    with st.expander(tr("advice_tcm"), expanded=False):
        for t in bundle.tcm[:3]:
            st.markdown(f"- {t}")
        for t in bundle.bazi[:4]:
            st.markdown(f"- {t}")


def style_fig(fig: go.Figure, *, height: int = 300) -> go.Figure:
    fig.update_layout(
        margin=dict(l=10, r=10, t=48, b=10),
        height=height,
        paper_bgcolor="rgba(255,255,255,0.55)",
        plot_bgcolor="rgba(255,255,255,0.35)",
        font=dict(family="IBM Plex Sans, sans-serif", color=COLORS["ink"]),
        title_font=dict(family="DM Sans, sans-serif", size=16, color=COLORS["ink"]),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0),
    )
    fig.update_xaxes(showgrid=True, gridcolor="rgba(15,118,110,0.08)")
    fig.update_yaxes(showgrid=True, gridcolor="rgba(15,118,110,0.08)")
    return fig


def colored_line(df: pd.DataFrame, x: str, y: str, title: str, color: str | None = None) -> go.Figure:
    c = color or CHART_COLOR_MAP.get(y, COLORS["teal"])
    fig = px.line(df, x=x, y=y, markers=True, title=title)
    fig.update_traces(line=dict(color=c, width=3), marker=dict(size=7, color=c))
    return style_fig(fig)


def colored_bar(df: pd.DataFrame, x: str, y: str, title: str, color: str | None = None) -> go.Figure:
    c = color or COLORS["lime"]
    fig = px.bar(df, x=x, y=y, title=title)
    fig.update_traces(marker_color=c, marker_line_width=0)
    return style_fig(fig)


@st.cache_data(ttl=30)
def load_daily_metrics(db_path: str) -> pd.DataFrame:
    path = Path(db_path)
    if not path.exists():
        return pd.DataFrame()
    try:
        conn = sqlite3.connect(str(path))
        df = pd.read_sql_query(
            "SELECT * FROM daily_metrics WHERE day >= ? ORDER BY day",
            conn,
            params=(DATA_START_DATE,),
        )
        conn.close()
    except (sqlite3.Error, pd.errors.DatabaseError):
        return pd.DataFrame()
    if not df.empty:
        df["day"] = pd.to_datetime(df["day"])
        df["month"] = df["day"].dt.strftime("%Y-%m")
        for col in df.columns:
            if col in {"day", "month", "mood_source", "preferred_sources_json", "extras_json"}:
                continue
            if df[col].dtype == object:
                df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


@st.cache_data(ttl=30)
def load_workouts(db_path: str, limit: int = 500) -> pd.DataFrame:
    path = Path(db_path)
    if not path.exists():
        return pd.DataFrame()
    try:
        conn = sqlite3.connect(str(path))
        df = pd.read_sql_query(
            f"""
            SELECT start_date, workout_activity_type, duration, duration_unit,
                   total_distance, total_distance_unit, total_energy_burned,
                   total_energy_burned_unit, source_name
            FROM workouts
            WHERE substr(start_date, 1, 10) >= ?
            ORDER BY start_date DESC
            LIMIT {int(limit)}
            """,
            conn,
            params=(DATA_START_DATE,),
        )
        conn.close()
    except (sqlite3.Error, pd.errors.DatabaseError):
        return pd.DataFrame()
    if not df.empty:
        df["workout_activity_type"] = (
            df["workout_activity_type"].fillna("").str.replace("HKWorkoutActivityType", "", regex=False)
        )
        df["day"] = pd.to_datetime(df["start_date"].str.slice(0, 19), errors="coerce")
        df["month"] = df["day"].dt.strftime("%Y-%m")
    return df


@st.cache_data(ttl=30)
def load_latest_reports(db_path: str) -> pd.DataFrame:
    path = Path(db_path)
    if not path.exists():
        return pd.DataFrame()
    try:
        conn = sqlite3.connect(str(path))
        df = pd.read_sql_query(
            """
            SELECT report_type, period_start, period_end, title, body_md, file_path, created_at
            FROM reports
            ORDER BY
                CASE report_type
                    WHEN 'overview' THEN 0
                    WHEN 'monthly' THEN 1
                    WHEN 'weekly' THEN 2
                    WHEN 'daily' THEN 3
                    ELSE 4
                END,
                period_start DESC
            """,
            conn,
        )
        conn.close()
    except (sqlite3.Error, pd.errors.DatabaseError):
        return pd.DataFrame()
    return df


def metric_card(label: str, value, suffix: str = "", *, glossary_key: str | None = None) -> None:
    info = GLOSSARY.get(glossary_key) if glossary_key else info_for_label(label)
    display = "—"
    if value is not None and not (isinstance(value, float) and pd.isna(value)):
        if isinstance(value, float):
            display = f"{value:.1f}{suffix}" if abs(value) < 1000 else f"{value:.0f}{suffix}"
        else:
            display = f"{value}{suffix}"

    if info is None:
        st.metric(label, display)
        return

    loc = localized_metric(info, get_lang())
    head_l, head_r = st.columns([5, 1])
    with head_l:
        st.metric(label, display)
    with head_r:
        with st.popover("i", help=loc.name):
            st.markdown(f"**{loc.name}**" + (f" · `{loc.unit}`" if loc.unit else ""))
            st.markdown(f"**{tr('what')}**\n\n{loc.what}")
            st.markdown(f"**{tr('why')}**\n\n{loc.why}")
            st.markdown(f"**{tr('ref_range')}**\n\n{loc.healthy}")
            if loc.notes:
                st.markdown(f"**{tr('notes')}**\n\n{loc.notes}")
            st.caption(DISCLAIMER_SHORT)


def _safe_mean(series: pd.Series):
    s = pd.to_numeric(series, errors="coerce").dropna()
    return float(s.mean()) if not s.empty else None


def _month_table(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    work = df.copy()
    # Some exports leave sleep/score columns as object (all-NULL TEXT); coerce before agg.
    for col in [
        "steps",
        "sleep_hours",
        "resting_hr",
        "hrv_sdnn_ms",
        "active_energy_kcal",
        "exercise_minutes",
        "mood_score",
        "overall_score",
        "workout_count",
        "tsb",
    ]:
        if col in work.columns:
            work[col] = pd.to_numeric(work[col], errors="coerce")
    g = work.groupby("month", as_index=False).agg(
        days=("day", "count"),
        steps=("steps", "mean"),
        sleep_h=("sleep_hours", "mean"),
        resting_hr=("resting_hr", "mean"),
        hrv=("hrv_sdnn_ms", "mean"),
        active_kcal=("active_energy_kcal", "mean"),
        exercise_min=("exercise_minutes", "mean"),
        mood=("mood_score", "mean"),
        overall=("overall_score", "mean"),
        workouts=("workout_count", "sum"),
        tsb=("tsb", "mean"),
    )
    g = g.sort_values("month", ascending=False)
    for col in ["steps", "resting_hr", "hrv", "active_kcal", "exercise_min", "overall", "workouts", "tsb"]:
        if col in g.columns:
            g[col] = pd.to_numeric(g[col], errors="coerce").round(0)
    for col in ["sleep_h", "mood"]:
        if col in g.columns:
            g[col] = pd.to_numeric(g[col], errors="coerce").round(1)
    rename = {
        "days": tr("col_days"),
        "steps": tr("col_steps"),
        "sleep_h": tr("col_sleep"),
        "resting_hr": tr("col_rhr"),
        "hrv": tr("col_hrv"),
        "active_kcal": tr("col_active_kcal"),
        "exercise_min": tr("col_exercise_min"),
        "mood": tr("col_mood"),
        "overall": tr("col_overall"),
        "workouts": tr("col_workouts"),
        "tsb": tr("col_tsb"),
    }
    return g.rename(columns=rename)


def explain_metrics(*keys: str) -> None:
    """Compact expander for named glossary keys."""
    infos = [GLOSSARY[k] for k in keys if k in GLOSSARY]
    if not infos:
        return
    with st.expander(tr("metric_explain"), expanded=False):
        st.caption(DISCLAIMER_SHORT)
        for info in infos:
            loc = localized_metric(info, get_lang())
            st.markdown(
                f"**{loc.name}**"
                + (f" · `{loc.unit}`" if loc.unit else "")
                + f"\n\n- {tr('what')}：{loc.what}\n"
                f"- {tr('why')}：{loc.why}\n"
                f"- {tr('ref_range')}：{loc.healthy}"
                + (f"\n- {tr('notes')}：{loc.notes}" if loc.notes else "")
            )


def page_glossary() -> None:
    section_chip(tr("glossary_title"), "sky")
    st.caption(DISCLAIMER_SHORT)
    st.markdown(
        f'<div class="hero-banner" style="background:linear-gradient(120deg,{COLORS["info_bg"]},#fff);">'
        f"<h2>{html.escape(tr('glossary_hero'))}</h2>"
        f"<p>{html.escape(tr('glossary_sub'))}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )

    groups = {
        tr("group_scores"): ["overall_score", "recovery_score", "activity_score", "sleep_score", "mood_score"],
        tr("group_heart"): ["hrv_sdnn_ms", "resting_hr", "avg_hr", "walking_hr_avg", "spo2_avg"],
        tr("group_sleep"): ["sleep_hours", "sleep_deep_hours", "sleep_rem_hours", "sleep_core_hours", "sleep_consistency"],
        tr("group_activity"): ["steps", "distance_km", "flights_climbed", "active_energy_kcal", "basal_energy_kcal", "exercise_minutes", "stand_hours"],
        tr("group_load"): ["workout_count", "workout_minutes", "training_load", "ctl", "atl", "tsb"],
        tr("group_body"): ["weight_kg", "body_fat_pct", "mindful_minutes", "headphone_db_avg", "environmental_db_avg"],
    }

    browse = tr("glossary_browse")
    name_by_key = {k: localized_metric(GLOSSARY[k], get_lang()).name for k in GLOSSARY}
    options = [browse] + list(name_by_key.values())
    pick = st.selectbox(tr("glossary_search"), options=options)
    if pick != browse:
        key = next(k for k, n in name_by_key.items() if n == pick)
        info = localized_metric(GLOSSARY[key], get_lang())
        highlight_cards(
            [
                {
                    "label": info.name,
                    "value": info.unit or "—",
                    "tone": "info",
                    "hint": tr("glossary_see_below"),
                }
            ]
        )
        st.markdown(
            f"### {info.name}\n\n"
            f"- **{tr('what')}**：{info.what}\n"
            f"- **{tr('why')}**：{info.why}\n"
            f"- **{tr('ref_range')}**：{info.healthy}\n"
            + (f"- **{tr('notes')}**：{info.notes}\n" if info.notes else "")
        )
        return

    for title, keys in groups.items():
        st.markdown(f"#### {title}")
        st.markdown(render_glossary_markdown(keys, lang=get_lang()))


def page_today(df: pd.DataFrame, ws: Workspace) -> None:
    if df.empty:
        st.warning(tr("no_data_upload"))
        return

    latest = df.iloc[-1]
    from src.insights.advice import build_advice
    from src.metrics.readiness import compute_morning_brief
    from src.metrics.triad import load_triad, triad_advice_lines

    recent_rows = df.tail(28).to_dict(orient="records")
    for r in recent_rows:
        if hasattr(r.get("day"), "date"):
            r["day"] = r["day"].date().isoformat()
    latest_row = dict(recent_rows[-1])
    brief = compute_morning_brief(recent_rows, latest_row)
    advice = build_advice(latest_row, recent_rows[-14:])
    triad = load_triad(latest_row["day"], db_path=ws.db_path) or load_triad(db_path=ws.db_path)

    # One decision headline
    if triad and triad.get("recovery_pct") is not None:
        intent = intent_label(triad.get("target_intent"))
        headline = tr(
            "headline_recovery",
            pct=int(triad["recovery_pct"]),
            intent=intent,
            strain=_fmt_val(triad.get("strain"), 1),
            lo=_fmt_val(triad.get("target_low"), 0),
            hi=_fmt_val(triad.get("target_high"), 0),
        )
    else:
        headline = advice.headline
    status_banner(latest, headline)

    # Primary triad with icons + parameter advice
    if triad:
        band_tone = {"green": "good", "yellow": "warn", "red": "bad"}.get(triad.get("recovery_band"), "info")
        strain_v = _num(triad.get("strain"))
        lo, hi = _num(triad.get("target_low")), _num(triad.get("target_high"))
        in_zone = strain_v is not None and lo is not None and hi is not None and lo <= strain_v <= hi
        intent = triad.get("target_intent")
        intent_cn = intent_label(intent, full=True)

        rec_pct = _num(triad.get("recovery_pct"))
        if rec_pct is not None and rec_pct >= 67:
            rec_advice = tr("rec_green")
        elif rec_pct is not None and rec_pct >= 34:
            rec_advice = tr("rec_yellow")
        else:
            rec_advice = tr("rec_red")

        if in_zone:
            strain_advice = tr("strain_in_zone", intent=intent_cn)
        elif strain_v is not None and hi is not None and strain_v > hi:
            strain_advice = tr("strain_over")
        else:
            strain_advice = tr(
                "strain_under",
                lo=_fmt_val(lo, 0),
                hi=_fmt_val(hi, 0),
            )

        sleep_need = triad.get("sleep_need_h")
        sleep_debt = triad.get("sleep_debt_h")
        if triad.get("sleep_performance") is None:
            sleep_advice = tr("sleep_missing", need=_fmt_val(sleep_need, 1))
        else:
            sleep_advice = tr(
                "sleep_plan",
                need=_fmt_val(sleep_need, 1),
                debt=_fmt_val(sleep_debt, 1),
            )

        highlight_cards(
            [
                {
                    "icon": "recovery",
                    "label": tr("card_recovery"),
                    "value": f"{_fmt_val(triad.get('recovery_pct'), 0)}%",
                    "tone": band_tone,
                    "hint": tr(
                        "hint_recovery_ref",
                        band=band_label(triad.get("recovery_band")),
                    ),
                    "advice": rec_advice,
                },
                {
                    "icon": "strain",
                    "label": tr("card_strain"),
                    "value": _fmt_val(triad.get("strain"), 1),
                    "tone": "good" if in_zone else ("warn" if strain_v and hi and strain_v > hi else "info"),
                    "hint": tr(
                        "hint_strain_zone",
                        lo=_fmt_val(lo, 0),
                        hi=_fmt_val(hi, 0),
                        intent=intent_cn,
                    ),
                    "advice": strain_advice,
                },
                {
                    "icon": "sleep",
                    "label": tr("card_sleep"),
                    "value": (
                        f"{_fmt_val(triad.get('sleep_performance'), 0)}%"
                        if triad.get("sleep_performance") is not None
                        else tr("no_sleep_data")
                    ),
                    "tone": tone_for_score(triad.get("sleep_performance")),
                    "hint": tr(
                        "hint_sleep_need",
                        need=_fmt_val(sleep_need, 1),
                        debt=_fmt_val(sleep_debt, 1),
                    ),
                    "advice": sleep_advice,
                },
            ]
        )

        tips = [
            tr(
                "intensity_line",
                intent=intent_cn or brief.suggested_intensity,
                workout=brief.suggested_workout,
            ),
            rec_advice,
            strain_advice,
            sleep_advice,
        ]
        st.markdown(
            f'<div class="rec-box"><h3>{html.escape(tr("today_params"))}</h3><ul>'
            + "".join(f"<li>{html.escape(t)}</li>" for t in tips)
            + "</ul></div>",
            unsafe_allow_html=True,
        )
    else:
        st.info(tr("need_triad"))

    section_chip(tr("key_metrics"), "sky")
    highlight_cards(
        [
            {
                "icon": "ready",
                "label": tr("readiness"),
                "value": _fmt_val(brief.training_readiness, 0),
                "tone": tone_for_score(brief.training_readiness),
                "hint": brief.readiness_label,
                "advice": tr("advice_readiness"),
            },
            {
                "icon": "hrv",
                "label": "HRV",
                "value": _fmt_val(latest.get("hrv_sdnn_ms"), 0, " ms"),
                "tone": "info",
                "hint": tr(
                    "hint_hrv_ratio",
                    ratio=_fmt_val(triad.get("hrv_ratio") if triad else None, 2),
                ),
                "advice": tr("advice_hrv"),
            },
            {
                "icon": "rhr",
                "label": tr("rhr"),
                "value": _fmt_val(latest.get("resting_hr"), 0, " bpm"),
                "tone": tone_for_rhr(latest.get("resting_hr")),
                "hint": tr("hint_rhr"),
                "advice": tr("advice_rhr"),
            },
            {
                "icon": "steps",
                "label": tr("steps"),
                "value": _fmt_val(latest.get("steps"), 0),
                "tone": tone_for_steps(latest.get("steps")),
                "hint": tr("hint_steps"),
                "advice": tr("advice_steps"),
            },
            {
                "icon": "tsb",
                "label": tr("tsb"),
                "value": _fmt_val(latest.get("tsb"), 0),
                "tone": tone_for_tsb(latest.get("tsb")),
                "hint": tr("hint_tsb"),
                "advice": tr("advice_tsb"),
            },
            {
                "icon": "ready",
                "label": tr("overall"),
                "value": _fmt_val(latest.get("overall_score"), 0),
                "tone": tone_for_score(latest.get("overall_score")),
                "hint": tr("hint_overall"),
                "advice": tr("advice_overall"),
            },
        ],
        show_glossary=True,
    )

    with st.expander(tr("more_advice"), expanded=False):
        render_advice_panel(df, latest, compact=False)

    with st.expander(tr("journal"), expanded=False):
        from src.insights.journal import TAGS, add_journal_entry, list_journal

        with st.form("journal_form"):
            jday = st.date_input(tr("journal_day"), value=latest["day"].date(), key="jday")
            jtags = st.multiselect(tr("tags"), TAGS, default=[])
            jnote = st.text_input(tr("note"), value="")
            if st.form_submit_button(tr("save_journal")):
                add_journal_entry(jday.isoformat(), jtags, jnote, db_path=ws.db_path)
                st.success(tr("saved"))
        jrows = list_journal(5, db_path=ws.db_path)
        if jrows:
            st.dataframe(pd.DataFrame(jrows)[["day", "tags", "note"]], use_container_width=True, hide_index=True)

        with st.form("mood_form"):
            mood_day = st.date_input(tr("mood_day"), value=latest["day"].date())
            mood_score = st.slider(tr("mood_slider"), 1.0, 5.0, float(latest.get("mood_score") or 3.0), 0.5)
            note = st.text_input(tr("mood_note"), value="")
            if st.form_submit_button(tr("save_mood")):
                upsert_manual_mood(mood_day.isoformat(), float(mood_score), note or None, db_path=ws.db_path)
                st.cache_data.clear()
                st.success(tr("saved"))


def page_all_overview(df: pd.DataFrame, wdf: pd.DataFrame, ws: Workspace) -> None:
    section_chip(tr("overview_title"), "teal")
    if df.empty:
        st.warning(tr("no_data"))
        return

    start = df["day"].min().date().isoformat()
    end = df["day"].max().date().isoformat()
    st.markdown(
        f'<div class="hero-banner" style="background:linear-gradient(120deg,{COLORS["good_bg"]},#fff);">'
        f"<h2>{html.escape(tr('overview_hero'))}</h2>"
        f"<p>{html.escape(tr('overview_sub', start=start, end=end, days=len(df), workouts=len(wdf), disclaimer=DISCLAIMER))}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )

    highlight_cards(
        [
            {"label": tr("mean_overall"), "value": _fmt_val(_safe_mean(df["overall_score"]), 0), "tone": tone_for_score(_safe_mean(df["overall_score"]))},
            {"label": tr("mean_sleep"), "value": _fmt_val(_safe_mean(df["sleep_hours"]), 1, " h"), "tone": tone_for_sleep(_safe_mean(df["sleep_hours"]))},
            {"label": tr("mean_hrv"), "value": _fmt_val(_safe_mean(df["hrv_sdnn_ms"]), 0), "tone": "info"},
            {"label": tr("mean_mood"), "value": _fmt_val(_safe_mean(df["mood_score"]), 1), "tone": tone_for_mood(_safe_mean(df["mood_score"]))},
            {"label": tr("mean_steps"), "value": _fmt_val(_safe_mean(df["steps"]), 0), "tone": tone_for_steps(_safe_mean(df["steps"]))},
            {"label": tr("total_workouts"), "value": _fmt_val(float(df["workout_count"].fillna(0).sum()), 0), "tone": "info"},
        ]
    )

    section_chip(tr("all_trends"), "sky")
    chart_cols = [
        ("overall_score", tr("chart_overall")),
        ("steps", tr("chart_steps")),
        ("sleep_hours", tr("chart_sleep")),
        ("resting_hr", tr("chart_rhr")),
        ("hrv_sdnn_ms", tr("chart_hrv")),
        ("mood_score", tr("chart_mood")),
        ("tsb", tr("chart_tsb")),
    ]
    pick = st.multiselect(
        tr("show_metrics"),
        options=[c[0] for c in chart_cols],
        default=["overall_score", "steps", "mood_score", "hrv_sdnn_ms"],
        format_func=lambda x: dict(chart_cols)[x],
    )
    for col in pick:
        if col not in df.columns or df[col].dropna().empty:
            continue
        st.plotly_chart(
            colored_line(df, "day", col, dict(chart_cols)[col]),
            use_container_width=True,
        )

    section_chip(tr("month_summary"), "amber")
    month_df = _month_table(df)
    st.dataframe(month_df, use_container_width=True, hide_index=True)

    overview_path = ws.reports_dir / "overview_all.md"
    if overview_path.exists():
        with st.expander(tr("overview_report"), expanded=False):
            st.markdown(overview_path.read_text(encoding="utf-8"))


def page_monthly(df: pd.DataFrame, wdf: pd.DataFrame, rdf: pd.DataFrame, ws: Workspace) -> None:
    section_chip(tr("monthly_title"), "coral")
    explain_metrics("overall_score", "steps", "sleep_hours", "hrv_sdnn_ms", "mood_score", "tsb")
    if df.empty:
        st.warning(tr("no_data"))
        return

    months = sorted(df["month"].dropna().unique().tolist(), reverse=True)
    month = st.selectbox(tr("pick_month"), options=months, index=0)
    mdf = df[df["month"] == month].copy()
    mw = wdf[wdf["month"] == month] if not wdf.empty and "month" in wdf.columns else pd.DataFrame()

    prev_months = [m for m in months if m < month]
    prev = prev_months[0] if prev_months else None
    pdf = df[df["month"] == prev] if prev else pd.DataFrame()

    def delta(cur, base):
        if cur is None or base is None or base == 0:
            return None
        return (cur - base) / abs(base) * 100.0

    cur_overall = _safe_mean(mdf["overall_score"])
    prev_overall = _safe_mean(pdf["overall_score"]) if not pdf.empty else None
    cur_steps = _safe_mean(mdf["steps"])
    prev_steps = _safe_mean(pdf["steps"]) if not pdf.empty else None
    cur_sleep = _safe_mean(mdf["sleep_hours"])
    prev_sleep = _safe_mean(pdf["sleep_hours"]) if not pdf.empty else None
    cur_hrv = _safe_mean(mdf["hrv_sdnn_ms"])
    prev_hrv = _safe_mean(pdf["hrv_sdnn_ms"]) if not pdf.empty else None
    cur_mood = _safe_mean(mdf["mood_score"])
    prev_mood = _safe_mean(pdf["mood_score"]) if not pdf.empty else None
    cur_tsb = _safe_mean(mdf["tsb"]) if "tsb" in mdf.columns else None

    d_overall = delta(cur_overall, prev_overall)
    banner_tone = "good" if (d_overall or 0) > 3 else ("bad" if (d_overall or 0) < -3 else "info")
    bg = {"good": COLORS["good_bg"], "bad": COLORS["bad_bg"], "info": COLORS["info_bg"]}[banner_tone]
    sub_bits = [tr("month_days", n=len(mdf))]
    if prev:
        sub_bits.append(tr("vs_prev_month", prev=prev))
    sub_bits.append(tr("overall_val", _fmt=_fmt_val(cur_overall, 0)))
    if d_overall is not None:
        sub_bits.append(tr("mom_pct", pct=d_overall))
    st.markdown(
        f'<div class="hero-banner" style="background:linear-gradient(120deg,{bg},#fff);">'
        f"<h2>{html.escape(tr('month_hero', month=month))}</h2>"
        f"<p>{html.escape(' · '.join(sub_bits))}</p></div>",
        unsafe_allow_html=True,
    )

    def _mom(cur, base):
        d = delta(cur, base)
        return tr("mom_label", pct=d) if d is not None else ""

    highlight_cards(
        [
            {
                "label": tr("chart_overall"),
                "value": _fmt_val(cur_overall, 0),
                "tone": tone_for_score(cur_overall),
                "hint": tr("mom_label", pct=d_overall) if d_overall is not None else tr("no_prev_month"),
            },
            {
                "label": tr("mean_steps"),
                "value": _fmt_val(cur_steps, 0),
                "tone": tone_for_steps(cur_steps),
                "hint": _mom(cur_steps, prev_steps),
            },
            {
                "label": tr("month_sleep"),
                "value": _fmt_val(cur_sleep, 1, " h"),
                "tone": tone_for_sleep(cur_sleep),
                "hint": _mom(cur_sleep, prev_sleep),
            },
            {
                "label": tr("month_hrv"),
                "value": _fmt_val(cur_hrv, 0),
                "tone": "info",
                "hint": _mom(cur_hrv, prev_hrv),
            },
            {
                "label": tr("month_mood"),
                "value": _fmt_val(cur_mood, 1),
                "tone": tone_for_mood(cur_mood),
                "hint": _mom(cur_mood, prev_mood),
            },
            {
                "label": tr("tsb_mean"),
                "value": _fmt_val(cur_tsb, 0),
                "tone": tone_for_tsb(cur_tsb),
            },
        ]
    )

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        metric_card(tr("month_active_kcal"), _safe_mean(mdf["active_energy_kcal"]), " kcal")
    with c2:
        metric_card(tr("month_exercise_min_avg"), _safe_mean(mdf["exercise_minutes"]), " min")
    with c3:
        metric_card(tr("month_workouts_n"), float(mdf["workout_count"].fillna(0).sum()))
    with c4:
        metric_card(tr("month_workout_total_min"), float(mdf["workout_minutes"].fillna(0).sum()), " min")

    left, right = st.columns(2)
    with left:
        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=mdf["day"],
                y=mdf["overall_score"],
                name=tr("chart_overall"),
                mode="lines+markers",
                line=dict(color=COLORS["teal"], width=3),
            )
        )
        fig.add_trace(
            go.Scatter(
                x=mdf["day"],
                y=mdf["mood_score"],
                name=tr("chart_mood"),
                mode="lines+markers",
                yaxis="y2",
                line=dict(color=COLORS["amber"], width=3),
            )
        )
        fig.update_layout(
            title=tr("chart_month_overall_mood"),
            yaxis=dict(title=tr("chart_overall")),
            yaxis2=dict(title=tr("chart_mood"), overlaying="y", side="right", range=[1, 5]),
        )
        st.plotly_chart(style_fig(fig, height=320), use_container_width=True)
    with right:
        st.plotly_chart(
            colored_bar(mdf, "day", "steps", tr("chart_month_steps"), COLORS["lime"]),
            use_container_width=True,
        )

    c1, c2 = st.columns(2)
    with c1:
        fig3 = go.Figure()
        fig3.add_trace(
            go.Scatter(
                x=mdf["day"],
                y=mdf["resting_hr"],
                name=tr("chart_rhr"),
                mode="lines+markers",
                line=dict(color=COLORS["coral"], width=3),
            )
        )
        fig3.add_trace(
            go.Scatter(
                x=mdf["day"],
                y=mdf["hrv_sdnn_ms"],
                name=tr("chart_hrv"),
                mode="lines+markers",
                yaxis="y2",
                line=dict(color=COLORS["teal_deep"], width=3),
            )
        )
        fig3.update_layout(
            title=tr("chart_month_rhr_hrv"),
            yaxis=dict(title=tr("chart_rhr")),
            yaxis2=dict(title=tr("chart_hrv"), overlaying="y", side="right"),
        )
        st.plotly_chart(style_fig(fig3, height=320), use_container_width=True)
    with c2:
        if not mw.empty:
            counts = mw["workout_activity_type"].value_counts().reset_index()
            counts.columns = ["type", "count"]
            fig4 = px.bar(
                counts,
                x="type",
                y="count",
                title=tr("chart_month_types"),
                color="count",
                color_continuous_scale=["#99F6E4", COLORS["teal"], COLORS["coral"]],
            )
            st.plotly_chart(style_fig(fig4, height=320), use_container_width=True)
        else:
            st.info(tr("no_month_workouts"))

    section_chip(tr("month_daily"), "sky")
    show_cols = [
        "day",
        "steps",
        "sleep_hours",
        "resting_hr",
        "hrv_sdnn_ms",
        "active_energy_kcal",
        "exercise_minutes",
        "workout_count",
        "mood_score",
        "overall_score",
        "tsb",
    ]
    detail = mdf[[c for c in show_cols if c in mdf.columns]].copy()
    detail["day"] = detail["day"].dt.date.astype(str)
    st.dataframe(detail, use_container_width=True, hide_index=True)

    section_chip(tr("month_compare"), "amber")
    recent_months = months[:12]
    cmp = _month_table(df[df["month"].isin(recent_months)])
    st.dataframe(cmp, use_container_width=True, hide_index=True)

    overall_col = tr("col_overall")
    if not cmp.empty and overall_col in cmp.columns:
        fig5 = px.bar(
            cmp.sort_values("month"),
            x="month",
            y=overall_col,
            title=tr("chart_recent_overall"),
            color=overall_col,
            color_continuous_scale=["#FECACA", "#FDE68A", "#99F6E4", COLORS["teal"]],
        )
        st.plotly_chart(style_fig(fig5, height=300), use_container_width=True)

    monthly_reports = rdf[rdf["report_type"] == "monthly"] if not rdf.empty else pd.DataFrame()
    body = None
    if not monthly_reports.empty:
        hit = monthly_reports[monthly_reports["period_start"].astype(str).str.startswith(month)]
        if not hit.empty:
            body = hit.iloc[0]["body_md"]
    path = ws.reports_dir / f"month_{month}.md"
    if body is None and path.exists():
        body = path.read_text(encoding="utf-8")
    if body:
        with st.expander(tr("month_report"), expanded=True):
            st.markdown(body)


def page_trends(df: pd.DataFrame) -> None:
    section_chip(tr("trends_title"), "sky")
    explain_metrics(
        "overall_score",
        "hrv_sdnn_ms",
        "resting_hr",
        "sleep_hours",
        "steps",
        "training_load",
        "tsb",
        "mood_score",
    )
    if df.empty:
        st.warning(tr("no_data"))
        return

    all_label = tr("window_all")
    window = st.radio(tr("window"), options=[7, 30, 90, 365, all_label], index=1, horizontal=True)
    sub = df if window == all_label else df.tail(int(window))

    charts = [
        ("overall_score", tr("chart_overall")),
        ("mood_score", tr("chart_mood")),
        ("steps", tr("chart_steps")),
        ("sleep_hours", tr("chart_sleep_hours")),
        ("sleep_consistency", tr("chart_sleep_consistency")),
        ("resting_hr", tr("chart_rhr")),
        ("hrv_sdnn_ms", tr("chart_hrv") + " (ms)"),
        ("active_energy_kcal", tr("chart_active_kcal")),
        ("training_load", tr("chart_training_load")),
        ("ctl", tr("chart_ctl")),
        ("atl", tr("chart_atl")),
        ("tsb", tr("chart_tsb")),
    ]
    for col, title in charts:
        if col not in sub.columns or sub[col].dropna().empty:
            continue
        info = GLOSSARY.get(col)
        header = title
        if info:
            loc = localized_metric(info, get_lang())
            header = f"{title} — {loc.what[:28]}…"
        st.plotly_chart(colored_line(sub, "day", col, header), use_container_width=True)
        if info:
            loc = localized_metric(info, get_lang())
            st.caption(tr("ref_caption", text=loc.healthy))


@st.cache_data(ttl=30)
def load_workout_analytics(db_path: str, limit: int = 200):
    from src.metrics.workouts import load_workout_analytics as _load

    return _load(Path(db_path), limit=limit)


def _render_pt_sessions(ws: Workspace) -> None:
    """Morning private-training window (07:30–08:50 from Aug 3), with sport-day override."""
    from src.metrics.pt_sessions import hr_series_for_day, load_pt_sessions

    section_chip(tr("pt_title"), "coral")
    st.caption(
        tr(
            "pt_caption",
            since=PT_SESSION_START_DATE,
            start=PT_SESSION_TIME_START,
            end=PT_SESSION_TIME_END,
        )
    )

    sessions = load_pt_sessions(db_path=ws.db_path)
    if not sessions:
        st.info(tr("pt_empty"))
        return

    cards = []
    for s in sessions:
        if s.kind == "sport":
            tone = "info"
            label = f"{s.day[5:]} · {s.primary_activity or tr('pt_sport')}"
            advice = s.note
        else:
            tone = {
                "dense": "good",
                "partial": "warn",
                "sparse": "warn",
                "none": "bad",
            }.get(s.coverage, "info")
            label = f"{s.day[5:]} · {tr('pt_kind_pt')}"
            advice = s.note
        cards.append(
            {
                "icon": "ready",
                "label": label,
                "value": f"{_fmt_val(s.hr_avg, 0)} bpm" if s.hr_avg is not None else tr("pt_no_hr"),
                "tone": tone,
                "hint": f"{s.coverage} · {s.hr_zone or '—'} · {_fmt_val(s.active_kcal, 0)} kcal",
                "advice": advice,
            }
        )
    highlight_cards(cards, show_glossary=False)

    day_opts = [s.day for s in sessions]
    pick = st.selectbox(tr("pt_pick_day"), day_opts, index=len(day_opts) - 1, key="pt_day")
    chosen = next(s for s in sessions if s.day == pick)
    c1, c2 = st.columns([1.4, 1])
    with c1:
        series = hr_series_for_day(
            pick, db_path=ws.db_path, time_start=chosen.time_start, time_end=chosen.time_end
        )
        title_kind = (
            f"{chosen.primary_activity}" if chosen.kind == "sport" else tr("pt_window")
        )
        if series:
            sdf = pd.DataFrame(series)
            fig = go.Figure()
            fig.add_trace(
                go.Scatter(
                    x=sdf["bucket"],
                    y=sdf["hr_avg"],
                    mode="lines+markers",
                    name=tr("pt_hr_avg5"),
                    line=dict(color=COLORS["coral"], width=2.5),
                    marker=dict(size=8),
                )
            )
            fig.add_trace(
                go.Scatter(
                    x=sdf["bucket"],
                    y=sdf["hr_max"],
                    mode="markers",
                    name=tr("pt_hr_peak"),
                    marker=dict(color=COLORS["amber"], size=7, symbol="triangle-up"),
                )
            )
            fig.update_layout(
                title=tr(
                    "pt_chart_title",
                    day=pick,
                    kind=title_kind,
                    start=chosen.time_start,
                    end=chosen.time_end,
                ),
                yaxis_title="bpm",
                xaxis_title=tr("pt_time"),
            )
            st.plotly_chart(style_fig(fig, height=340), use_container_width=True)
        else:
            st.warning(tr("pt_no_samples", day=pick))
    with c2:
        highlight_cards(
            [
                {
                    "label": tr("pt_type"),
                    "value": chosen.primary_activity or tr("pt_window"),
                    "tone": "info" if chosen.kind == "sport" else "good",
                    "hint": f"{chosen.time_start}–{chosen.time_end}",
                    "advice": chosen.note,
                },
                {
                    "label": tr("pt_samples"),
                    "value": str(chosen.hr_n),
                    "tone": "good" if chosen.hr_n >= 200 else ("warn" if chosen.hr_n >= 40 else "bad"),
                    "hint": chosen.coverage,
                    "advice": tr("pt_hr_advice"),
                },
                {
                    "label": tr("pt_avg_peak"),
                    "value": (
                        f"{_fmt_val(chosen.hr_avg, 0)} / {_fmt_val(chosen.hr_max, 0)}"
                        if chosen.hr_avg is not None
                        else "—"
                    ),
                    "tone": "info",
                    "hint": chosen.hr_zone or tr("pt_no_zone"),
                    "advice": chosen.intensity or tr("pt_intensity_hint"),
                },
                {
                    "label": tr("pt_kcal"),
                    "value": _fmt_val(chosen.active_kcal, 0, " kcal"),
                    "tone": "info",
                    "hint": tr(
                        "pt_mets_hint",
                        avg=_fmt_val(chosen.mets_avg, 1),
                        peak=_fmt_val(chosen.mets_max, 1),
                    ),
                },
            ],
            show_glossary=False,
        )
        if chosen.apple_workouts:
            st.markdown(f"**{tr('pt_apple_workouts')}**")
            for w in chosen.apple_workouts:
                st.markdown(
                    f"- {w['start'][11:16]}–{str(w['end'])[11:16]} · {w['activity']} · "
                    f"{w['duration_min']:.0f} min"
                    + (f" · {w['energy']:.0f} kcal" if w.get("energy") else "")
                )
        else:
            st.caption(tr("pt_no_apple"))

    with st.expander(tr("pt_table"), expanded=False):
        table = pd.DataFrame(
            [
                {
                    tr("col_date"): s.day,
                    tr("col_type"): s.primary_activity or tr("pt_kind_pt"),
                    tr("col_window"): f"{s.time_start}–{s.time_end}",
                    tr("col_coverage"): s.coverage,
                    tr("col_hr_n"): s.hr_n,
                    tr("col_hr_avg"): s.hr_avg,
                    tr("col_hr_min"): s.hr_min,
                    tr("col_hr_max"): s.hr_max,
                    tr("col_zone"): s.hr_zone,
                    tr("col_intensity"): s.intensity,
                    tr("col_kcal"): s.active_kcal,
                    tr("col_mets"): s.mets_avg,
                    tr("col_note"): s.note,
                }
                for s in sessions
            ]
        )
        st.dataframe(table, use_container_width=True, hide_index=True)


def page_workouts(wdf: pd.DataFrame, ws: Workspace) -> None:
    _render_pt_sessions(ws)

    section_chip(tr("workouts_title"), "amber")
    explain_metrics("workout_count", "workout_minutes", "training_load", "tsb", "hr_avg_workout", "hr_zone")

    wa = load_workout_analytics(str(ws.db_path), 300)
    wadf = pd.DataFrame(wa) if wa else pd.DataFrame()

    if wadf.empty:
        st.info(tr("wo_no_analytics"))
        if not wdf.empty:
            st.dataframe(
                wdf.drop(columns=[c for c in ["day", "month"] if c in wdf.columns]),
                use_container_width=True,
                hide_index=True,
            )
        return

    # Summary cards
    recent = wadf.head(30)
    hr_vals = recent["hr_avg"].dropna() if "hr_avg" in recent else pd.Series(dtype=float)
    hard_n = int((recent.get("intensity") == "高强度").sum()) if "intensity" in recent else 0
    easy_n = int((recent.get("intensity") == "轻松").sum()) if "intensity" in recent else 0

    highlight_cards(
        [
            {
                "label": tr("wo_recent_n"),
                "value": str(len(recent)),
                "tone": "info",
                "hint": tr("wo_recent_hint"),
            },
            {
                "label": tr("wo_avg_hr"),
                "value": f"{hr_vals.mean():.0f} bpm" if not hr_vals.empty else "—",
                "tone": "warn" if (not hr_vals.empty and hr_vals.mean() >= 150) else "info",
                "hint": tr("wo_avg_hr_hint"),
            },
            {
                "label": tr("wo_peak_hr"),
                "value": f"{recent['hr_max'].max():.0f} bpm" if recent.get("hr_max") is not None and recent["hr_max"].notna().any() else "—",
                "tone": "info",
                "hint": tr("wo_peak_hr_hint"),
            },
            {
                "label": tr("wo_hard"),
                "value": str(hard_n),
                "tone": "bad" if hard_n >= 8 else ("warn" if hard_n >= 4 else "good"),
                "hint": tr("wo_hard_hint"),
            },
            {
                "label": tr("wo_easy"),
                "value": str(easy_n),
                "tone": "good" if easy_n >= 3 else "warn",
                "hint": tr("wo_easy_hint"),
            },
            {
                "label": tr("wo_duration"),
                "value": f"{recent['duration_min'].fillna(0).sum():.0f} min",
                "tone": "info",
                "hint": tr("wo_duration_hint"),
            },
        ]
    )

    from src.metrics.workouts import workout_advice_lines

    section_chip(tr("training_advice"), "coral")
    for line in workout_advice_lines(db_path=ws.db_path):
        st.markdown(f"- {line}")

    c1, c2 = st.columns(2)
    with c1:
        plot_df = recent.dropna(subset=["hr_avg"]).copy()
        if not plot_df.empty:
            plot_df["label"] = plot_df["day"].astype(str) + " " + plot_df["activity"].astype(str)
            fig = go.Figure()
            fig.add_trace(
                go.Scatter(
                    x=plot_df["start_date"].astype(str).str.slice(0, 16),
                    y=plot_df["hr_avg"],
                    mode="markers+lines",
                    name=tr("wo_avg_hr_series"),
                    line=dict(color=COLORS["coral"], width=2),
                    marker=dict(size=9),
                )
            )
            if plot_df["hr_max"].notna().any():
                fig.add_trace(
                    go.Scatter(
                        x=plot_df["start_date"].astype(str).str.slice(0, 16),
                        y=plot_df["hr_max"],
                        mode="markers",
                        name=tr("wo_max_hr_series"),
                        marker=dict(color=COLORS["amber"], size=8, symbol="triangle-up"),
                    )
                )
            fig.update_layout(title=tr("wo_hr_chart"), yaxis_title="bpm")
            st.plotly_chart(style_fig(fig, height=340), use_container_width=True)
        else:
            st.info(tr("wo_no_hr"))
    with c2:
        if "hr_zone" in recent.columns and recent["hr_zone"].notna().any():
            zc = recent["hr_zone"].fillna(tr("unknown")).value_counts().reset_index()
            zc.columns = ["zone", "count"]
            fig2 = px.bar(
                zc,
                x="zone",
                y="count",
                title=tr("wo_zone_dist"),
                color="count",
                color_continuous_scale=["#99F6E4", COLORS["amber"], COLORS["coral"]],
            )
            st.plotly_chart(style_fig(fig2, height=340), use_container_width=True)
        else:
            counts = recent["activity"].value_counts().reset_index()
            counts.columns = ["type", "count"]
            fig2 = px.bar(counts, x="type", y="count", title=tr("wo_activity_types"), color="count")
            st.plotly_chart(style_fig(fig2, height=340), use_container_width=True)

    section_chip(tr("wo_detail"), "sky")
    show_cols = [
        "day",
        "activity",
        "duration_min",
        "hr_avg",
        "hr_min",
        "hr_max",
        "hr_zone",
        "intensity",
        "active_kcal",
        "distance_km",
        "mets",
        "elevation_m",
        "temp_c",
        "note",
    ]
    detail = recent[[c for c in show_cols if c in recent.columns]].copy()
    for col in ["duration_min", "hr_avg", "hr_min", "hr_max", "active_kcal", "distance_km", "mets", "elevation_m", "temp_c"]:
        if col in detail.columns:
            detail[col] = detail[col].round(1)
    st.dataframe(detail, use_container_width=True, hide_index=True)

    with st.expander(tr("wo_zones_help"), expanded=False):
        st.markdown(tr("wo_zones_body"))


def page_agent(ws: Workspace) -> None:
    section_chip(tr("agent_title"), "lime")
    st.caption(tr("agent_caption", disclaimer=DISCLAIMER))
    from src.agent.chat import ask, build_context

    with st.expander(tr("agent_context"), expanded=False):
        st.code(build_context(ws.db_path))

    if "agent_messages" not in st.session_state:
        st.session_state.agent_messages = []

    for msg in st.session_state.agent_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    prompt = st.chat_input(tr("agent_placeholder"))
    if prompt:
        st.session_state.agent_messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        ans = ask(prompt, db_path=ws.db_path, use_llm=True)
        tag = "LLM" if ans.used_llm else ans.intent
        content = f"**[{tag}]**\n\n{ans.text}"
        st.session_state.agent_messages.append({"role": "assistant", "content": content})
        with st.chat_message("assistant"):
            st.markdown(content)

    st.markdown(tr("agent_shortcuts"))
    cols = st.columns(4)
    shortcuts = [
        tr("shortcut_recovery"),
        tr("shortcut_today"),
        tr("shortcut_hr"),
        tr("shortcut_sleep"),
    ]
    for col, q in zip(cols, shortcuts):
        if col.button(q, use_container_width=True):
            st.session_state.agent_messages.append({"role": "user", "content": q})
            ans = ask(q, db_path=ws.db_path, use_llm=True)
            tag = "LLM" if ans.used_llm else ans.intent
            st.session_state.agent_messages.append(
                {"role": "assistant", "content": f"**[{tag}]**\n\n{ans.text}"}
            )
            st.rerun()


def page_reports(rdf: pd.DataFrame, ws: Workspace) -> None:
    section_chip(tr("reports_title"), "teal")
    st.caption(DISCLAIMER)
    if rdf.empty:
        st.info(tr("reports_empty"))
        files = sorted(ws.reports_dir.glob("*.md"), reverse=True) if ws.reports_dir.exists() else []
        if files:
            choice = st.selectbox(tr("local_reports"), options=[p.name for p in files])
            st.markdown((ws.reports_dir / choice).read_text(encoding="utf-8"))
        return

    type_filter = st.multiselect(
        tr("reports_type"),
        options=["overview", "monthly", "weekly", "daily"],
        default=["overview", "monthly", "weekly", "daily"],
    )
    view = rdf[rdf["report_type"].isin(type_filter)] if type_filter else rdf
    if view.empty:
        st.info(tr("reports_none_filter"))
        return

    labels = [
        f"{r['report_type']} · {r['period_start']}"
        + (f"~{r['period_end']}" if r["period_end"] != r["period_start"] else "")
        for _, r in view.iterrows()
    ]
    idx = st.selectbox(tr("reports_pick"), options=range(len(labels)), format_func=lambda i: labels[i])
    st.markdown(view.iloc[idx]["body_md"])


def _render_lang_picker(*, key: str = "lang_picker") -> None:
    cur = get_lang()
    labels = {"zh": tr("lang_zh"), "en": tr("lang_en")}
    choice = st.radio(
        tr("lang"),
        options=["zh", "en"],
        format_func=lambda x: labels.get(x, x),
        index=0 if cur == "zh" else 1,
        horizontal=True,
        key=key,
    )
    if normalize_lang(choice) != cur:
        st.session_state["lang"] = normalize_lang(choice)
        st.rerun()


def _render_login() -> None:
    import src.auth as auth

    _render_lang_picker(key="lang_login")
    st.markdown(f"### {tr('login')}")
    if auth.user_count() == 0:
        st.info(tr("first_user_hint"))
    with st.form("login_form"):
        u = st.text_input(tr("username"))
        p = st.text_input(tr("password"), type="password")
        if st.form_submit_button(tr("login_btn"), type="primary"):
            if auth.verify(u, p):
                st.session_state.user = u.strip()
                st.session_state.agent_messages = []
                st.cache_data.clear()
                st.rerun()
            else:
                st.error(tr("login_fail"))

    with st.expander(tr("register"), expanded=auth.user_count() == 0):
        with st.form("register_form"):
            ru = st.text_input(tr("username"), key="reg_u")
            rp = st.text_input(tr("password_min"), type="password", key="reg_p")
            rp2 = st.text_input(tr("password_confirm"), type="password", key="reg_p2")
            if st.form_submit_button(tr("register_btn")):
                try:
                    if rp != rp2:
                        raise ValueError("两次密码不一致" if get_lang() == "zh" else "Passwords do not match")
                    info = auth.register(ru, rp)
                    if info["role"] == "admin":
                        migrated = migrate_legacy_if_needed(target_user=info["username"])
                        workspace_for(info["username"])
                        if migrated:
                            st.info(tr("migrated_legacy"))
                    else:
                        workspace_for(info["username"])
                    st.success(tr("registered", user=info["username"], role=info["role"]))
                except ValueError as e:
                    st.error(str(e))


def _render_sidebar(ws: Workspace, username: str) -> None:
    import src.auth as auth
    from src.ingest.upload_pipeline import run_user_pipeline
    from src.workspace import extract_health_zip

    with st.sidebar:
        _render_lang_picker(key="lang_sidebar")
        st.markdown(f"**{tr('current_user')}** · {username}")
        if auth.is_admin(username):
            st.caption(tr("admin"))
        if st.button(tr("logout"), use_container_width=True):
            for k in ("user", "agent_messages"):
                st.session_state.pop(k, None)
            st.cache_data.clear()
            st.rerun()

        st.divider()
        st.markdown(f"### {tr('upload_title')}")
        st.caption(tr("upload_hint"))
        up = st.file_uploader(tr("upload_pick"), type=["zip"], key="health_zip")
        if st.button(tr("upload_start"), type="primary", use_container_width=True, disabled=up is None):
            try:
                with st.status(tr("upload_status"), expanded=True) as status:
                    st.write(tr("upload_unzip"))
                    extract_health_zip(up.getvalue(), ws)
                    st.write(tr("upload_compute"))
                    result = run_user_pipeline(ws, reset=True)
                    status.update(
                        label=tr("upload_done", days=result["days"], workouts=result["workouts"]),
                        state="complete",
                    )
                st.cache_data.clear()
                st.success(tr("upload_success"))
                st.rerun()
            except Exception as e:
                st.error(tr("upload_fail", err=e))

        if not ws.db_path.exists():
            st.warning(tr("no_db"))

        if auth.is_admin(username):
            st.divider()
            st.markdown(f"### {tr('user_mgmt')}")
            for u in auth.list_users():
                flag = tr("disabled_flag") if u["disabled"] else u["role"]
                st.text(f"{u['username']} · {flag}")
            with st.form("admin_create_user"):
                nu = st.text_input(tr("create_username"))
                npw = st.text_input(tr("initial_password"), type="password")
                if st.form_submit_button(tr("create_user")):
                    try:
                        auth.register(nu, npw, role="user")
                        workspace_for(nu)
                        st.success(tr("created_user", user=nu))
                    except ValueError as e:
                        st.error(str(e))
            with st.form("admin_disable"):
                du = st.text_input(tr("disable_user"))
                disable = st.checkbox(tr("disable"), value=True)
                if st.form_submit_button(tr("update_status")):
                    try:
                        auth.set_disabled(du, disable)
                        st.success(tr("updated"))
                    except ValueError as e:
                        st.error(str(e))


def main() -> None:
    inject_css()
    if "lang" not in st.session_state:
        st.session_state["lang"] = "zh"

    st.markdown(
        f'<h1 class="dash-title">{html.escape(tr("app_title"))}</h1>'
        f'<p class="disclaimer">{html.escape(DISCLAIMER)}</p>',
        unsafe_allow_html=True,
    )

    username = st.session_state.get("user")
    if not username:
        _render_login()
        return

    ws = workspace_for(username)
    set_profile_path(ws.profile_path)
    _render_sidebar(ws, username)

    db = str(ws.db_path)
    df = load_daily_metrics(db)
    wdf = load_workouts(db)
    rdf = load_latest_reports(db)

    tab1, tab2, tab3, tab4, tab5, tab6, tab7, tab8 = st.tabs(
        [
            tr("tab_today"),
            tr("tab_overview"),
            tr("tab_monthly"),
            tr("tab_trends"),
            tr("tab_workouts"),
            tr("tab_agent"),
            tr("tab_glossary"),
            tr("tab_reports"),
        ]
    )
    with tab1:
        page_today(df, ws)
    with tab2:
        page_all_overview(df, wdf, ws)
    with tab3:
        page_monthly(df, wdf, rdf, ws)
    with tab4:
        page_trends(df)
    with tab5:
        page_workouts(wdf, ws)
    with tab6:
        page_agent(ws)
    with tab7:
        page_glossary()
    with tab8:
        page_reports(rdf, ws)


if __name__ == "__main__":
    main()
