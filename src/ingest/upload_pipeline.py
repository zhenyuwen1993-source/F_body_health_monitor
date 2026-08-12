"""Run full ingest→metrics→reports pipeline for one user workspace."""

from __future__ import annotations

from src.ingest.parse_export import ingest_export
from src.metrics.compute import compute_daily_metrics
from src.metrics.triad import rebuild_daily_triad
from src.metrics.workouts import rebuild_workout_analytics
from src.reports.generate import generate_reports
from src.workspace import Workspace


def run_user_pipeline(ws: Workspace, *, reset: bool = True) -> dict:
    """Import workspace.export_path into the user DB and recompute everything."""
    ws.ensure()
    if not ws.export_path.exists():
        raise FileNotFoundError(f"缺少 export.xml: {ws.export_path}")

    ingest_export(ws.export_path, ws.db_path, reset=reset)
    n_days = compute_daily_metrics(ws.db_path)
    n_wo = rebuild_workout_analytics(ws.db_path)
    n_triad = rebuild_daily_triad(ws.db_path)
    paths = generate_reports(ws.db_path, reports_dir=ws.reports_dir)
    return {
        "days": n_days,
        "workouts": n_wo,
        "triad_days": n_triad,
        "reports": [str(p) for p in paths],
    }
