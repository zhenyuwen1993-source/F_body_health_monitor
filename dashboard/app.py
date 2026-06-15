"""Streamlit health dashboard.

Run with::

    streamlit run dashboard/app.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

# Allow running without `pip install -e .` by adding ./src to the path.
_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from health_monitor import queries as q

st.set_page_config(page_title="Body Health Monitor", page_icon="❤️", layout="wide")


# --------------------------------------------------------------------------- #
# Cached data access (cleared by the sidebar "Refresh" button).
# --------------------------------------------------------------------------- #
@st.cache_data(ttl=300, show_spinner=False)
def _metrics() -> list[str]:
    return q.available_metrics()


@st.cache_data(ttl=300, show_spinner=False)
def _bounds() -> tuple[str | None, str | None]:
    return q.date_bounds()


@st.cache_data(ttl=300, show_spinner=False)
def _daily(metric: str, agg: str, start: str, end: str) -> pd.DataFrame:
    return q.daily_metric(metric, agg=agg, start=start, end=end)


@st.cache_data(ttl=300, show_spinner=False)
def _hr_band(start: str, end: str) -> pd.DataFrame:
    return q.daily_hr_band(start, end)


@st.cache_data(ttl=300, show_spinner=False)
def _sleep(start: str, end: str) -> pd.DataFrame:
    return q.sleep_stages(start, end)


@st.cache_data(ttl=300, show_spinner=False)
def _workouts(start: str, end: str) -> pd.DataFrame:
    return q.workouts(start, end)


def _rolling(df: pd.DataFrame, value_col: str, window: int = 7) -> pd.DataFrame:
    df = df.copy()
    df["rolling"] = df[value_col].rolling(window, min_periods=1).mean()
    return df


def _trend_chart(df: pd.DataFrame, value_col: str, title: str, unit: str = "") -> go.Figure:
    df = _rolling(df, value_col)
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=df["date"], y=df[value_col], mode="markers+lines", name="daily",
            line=dict(color="#9ecae1", width=1), marker=dict(size=4),
        )
    )
    fig.add_trace(
        go.Scatter(
            x=df["date"], y=df["rolling"], mode="lines", name="7-day avg",
            line=dict(color="#08519c", width=3),
        )
    )
    fig.update_layout(
        title=title, height=320, margin=dict(l=10, r=10, t=40, b=10),
        yaxis_title=unit, legend=dict(orientation="h", y=1.12, x=0),
    )
    return fig


def _chart(target, fig: go.Figure, key: str) -> None:
    """Render a Plotly figure with a stable, unique element key."""
    target.plotly_chart(fig, width="stretch", key=key)


# --------------------------------------------------------------------------- #
# Sidebar
# --------------------------------------------------------------------------- #
st.sidebar.title("❤️ Health Monitor")

if st.sidebar.button("🔄 Refresh data", width="stretch"):
    st.cache_data.clear()
    st.rerun()

metrics = _metrics()
lo, hi = _bounds()

if not metrics or lo is None:
    st.title("Body Health Monitor")
    st.info(
        "No data yet. Load demo data to explore the dashboard:\n\n"
        "```\npython scripts/load_sample_data.py\n```\n\n"
        "…or start the ingest API and point the **Health Auto Export** iOS app at it "
        "(see the README)."
    )
    st.stop()

hi_d = datetime.strptime(hi, "%Y-%m-%d").date()
lo_d = datetime.strptime(lo, "%Y-%m-%d").date()
default_start = max(lo_d, hi_d - timedelta(days=29))

picked = st.sidebar.date_input(
    "Date range", value=(default_start, hi_d), min_value=lo_d, max_value=hi_d
)
if isinstance(picked, tuple) and len(picked) == 2:
    start_d, end_d = picked
else:
    start_d, end_d = default_start, hi_d
start, end = start_d.isoformat(), end_d.isoformat()

st.sidebar.caption(f"Data available\n\n{lo} → {hi}")
st.sidebar.caption(f"{len(metrics)} metrics tracked")


# --------------------------------------------------------------------------- #
# Header + KPIs
# --------------------------------------------------------------------------- #
st.title("Body Health Monitor")
st.caption(f"Apple Watch → iPhone → this dashboard · showing {start} to {end}")


def _kpi(col, label: str, concept: str, fmt: str, unit: str, days: int = 7) -> None:
    metric = q.resolve_metric(concept, metrics)
    if metric is None:
        col.metric(f"{label} ({unit})", "—")
        return
    val, _ = q.latest(metric)
    recent = q.daily_metric(
        metric, agg="mean", start=(end_d - timedelta(days=days)).isoformat(), end=end
    )
    avg = recent["value"].mean() if not recent.empty else None
    value_str = fmt.format(val) if val is not None else "—"
    delta = None
    if val is not None and avg is not None and not pd.isna(avg):
        delta = f"{val - avg:+.0f} vs {days}d avg"
    col.metric(f"{label} ({unit})", value_str, delta=delta, delta_color="off")


c1, c2, c3, c4, c5, c6 = st.columns(6)
_kpi(c1, "Resting HR", "resting_heart_rate", "{:.0f}", "bpm")
_kpi(c2, "HRV", "hrv", "{:.0f}", "ms")
_kpi(c3, "SpO₂", "spo2", "{:.0f}", "%")
_kpi(c4, "Resp. rate", "respiratory_rate", "{:.0f}", "/min")
_kpi(c5, "VO₂ max", "vo2_max", "{:.1f}", "ml/kg/min")
_kpi(c6, "Weight", "weight", "{:.1f}", "kg")


# --------------------------------------------------------------------------- #
# Tabs
# --------------------------------------------------------------------------- #
tab_overview, tab_heart, tab_sleep, tab_activity, tab_workouts, tab_explore = st.tabs(
    ["Overview", "Heart", "Sleep", "Activity", "Workouts", "Explore"]
)

with tab_overview:
    left, right = st.columns(2)
    steps_m = q.resolve_metric("steps", metrics)
    if steps_m:
        df = _daily(steps_m, "sum", start, end)
        if not df.empty:
            _chart(left, _trend_chart(df, "value", "Steps / day", "steps"), "ov_steps")
    sleep_df = _sleep(start, end)
    if not sleep_df.empty and sleep_df["total"].notna().any():
        fig = _trend_chart(sleep_df.rename(columns={"total": "value"}), "value", "Sleep / night", "hours")
        _chart(right, fig, "ov_sleep")
    band = _hr_band(start, end)
    if not band.empty:
        _chart(st, _trend_chart(band.rename(columns={"avg": "value"}), "value", "Average heart rate", "bpm"),
               "ov_hr")

with tab_heart:
    band = _hr_band(start, end)
    if band.empty:
        st.info("No heart-rate data in this range.")
    else:
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=band["date"], y=band["hi"], mode="lines",
                                 line=dict(width=0), showlegend=False, hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=band["date"], y=band["lo"], mode="lines", fill="tonexty",
                                 fillcolor="rgba(8,81,156,0.15)", line=dict(width=0), name="min–max"))
        fig.add_trace(go.Scatter(x=band["date"], y=band["avg"], mode="lines",
                                 line=dict(color="#08519c", width=2.5), name="avg"))
        fig.update_layout(title="Heart rate range (min / avg / max per day)", height=380,
                          yaxis_title="bpm", margin=dict(l=10, r=10, t=40, b=10))
        _chart(st, fig, "heart_band")
    col1, col2 = st.columns(2)
    rhr = q.resolve_metric("resting_heart_rate", metrics)
    if rhr:
        df = _daily(rhr, "mean", start, end)
        if not df.empty:
            _chart(col1, _trend_chart(df, "value", "Resting heart rate", "bpm"), "heart_rhr")
    hrv = q.resolve_metric("hrv", metrics)
    if hrv:
        df = _daily(hrv, "mean", start, end)
        if not df.empty:
            _chart(col2, _trend_chart(df, "value", "Heart-rate variability", "ms"), "heart_hrv")

with tab_sleep:
    sleep_df = _sleep(start, end)
    if sleep_df.empty:
        st.info("No sleep data in this range.")
    else:
        stage_cols = [c for c in ["deep", "core", "rem", "awake"] if sleep_df[c].notna().any()]
        if stage_cols:
            melted = sleep_df.melt(id_vars="date", value_vars=stage_cols,
                                   var_name="stage", value_name="hours").dropna()
            fig = px.bar(melted, x="date", y="hours", color="stage", title="Sleep stages per night",
                         color_discrete_map={"deep": "#08306b", "core": "#2171b5",
                                             "rem": "#6baed6", "awake": "#c6dbef"})
            fig.update_layout(height=380, margin=dict(l=10, r=10, t=40, b=10), barmode="stack")
            _chart(st, fig, "sleep_stages")
        else:
            _chart(st, _trend_chart(sleep_df.rename(columns={"total": "value"}), "value", "Total sleep", "hours"),
                   "sleep_total")
        avg_total = sleep_df["total"].mean()
        if pd.notna(avg_total):
            st.metric("Average sleep / night", f"{avg_total:.1f} h")

with tab_activity:
    cols = st.columns(2)
    plan = [
        ("steps", "sum", "Steps / day", "steps", 0),
        ("active_energy", "sum", "Active energy / day", "kcal", 1),
        ("exercise_time", "sum", "Exercise minutes / day", "min", 0),
        ("distance", "sum", "Distance / day", "km", 1),
    ]
    any_activity = False
    for concept, agg, title, unit, idx in plan:
        m = q.resolve_metric(concept, metrics)
        if not m:
            continue
        df = _daily(m, agg, start, end)
        if df.empty:
            continue
        any_activity = True
        _chart(cols[idx % 2], _trend_chart(df, "value", title, unit), f"act_{concept}")
    if not any_activity:
        st.info("No activity data in this range.")

with tab_workouts:
    wdf = _workouts(start, end)
    if wdf.empty:
        st.info("No workouts in this range.")
    else:
        k1, k2, k3 = st.columns(3)
        k1.metric("Workouts", f"{len(wdf)}")
        k2.metric("Total distance", f"{wdf['distance_km'].sum():.1f} km")
        k3.metric("Total active energy", f"{wdf['active_energy_kcal'].sum():.0f} kcal")
        by_type = wdf.groupby("name").agg(
            sessions=("name", "size"),
            distance_km=("distance_km", "sum"),
            energy_kcal=("active_energy_kcal", "sum"),
        ).reset_index()
        _chart(st, px.bar(by_type, x="name", y="sessions", title="Sessions by workout type"), "wo_bar")
        show = wdf.copy()
        show["start"] = show["start"].dt.strftime("%Y-%m-%d %H:%M")
        show["duration_min"] = (show["duration_s"] / 60).round(0)
        st.dataframe(
            show[["start", "name", "duration_min", "distance_km", "active_energy_kcal", "avg_hr"]],
            width="stretch", hide_index=True, key="wo_table",
        )

with tab_explore:
    st.caption("Inspect any metric in your data.")
    metric = st.selectbox("Metric", metrics)
    agg = st.radio("Daily aggregation", ["mean", "sum", "min", "max", "last"], horizontal=True)
    df = _daily(metric, agg, start, end)
    if df.empty:
        st.info("No samples for this metric in the selected range.")
    else:
        _chart(st, _trend_chart(df, "value", f"{metric} ({agg}/day)"), "explore_chart")
        with st.expander("Raw daily values"):
            st.dataframe(df, width="stretch", hide_index=True, key="explore_table")
