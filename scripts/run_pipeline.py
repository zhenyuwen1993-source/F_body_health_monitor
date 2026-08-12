#!/usr/bin/env python3
"""One-shot pipeline: ingest → metrics → reports."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import DB_PATH, DEFAULT_EXPORT
from src.ingest.parse_export import ingest_export
from src.metrics.compute import compute_daily_metrics
from src.metrics.workouts import rebuild_workout_analytics
from src.metrics.triad import rebuild_daily_triad
from src.reports.generate import generate_reports


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Apple 健康本地监控流水线")
    p.add_argument(
        "--export",
        type=Path,
        default=None,
        help=f"export.xml 路径（默认随 --user 或 {DEFAULT_EXPORT}）",
    )
    p.add_argument("--db", type=Path, default=None, help="SQLite 路径（可被 --user 覆盖）")
    p.add_argument("--user", type=str, default=None, help="用户目录 data/users/<user>/")
    p.add_argument("--skip-ingest", action="store_true", help="跳过 XML 解析")
    p.add_argument("--ingest-only", action="store_true", help="只做入库")
    p.add_argument("--skip-metrics", action="store_true", help="跳过指标计算")
    p.add_argument("--skip-reports", action="store_true", help="跳过报告生成")
    p.add_argument("--as-of", type=str, default=None, help="报告截止日期 YYYY-MM-DD")
    p.add_argument("--no-reset", action="store_true", help="入库时不清空旧表（一般不推荐）")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    reports_dir = None
    if args.user:
        from src.workspace import workspace_for

        ws = workspace_for(args.user)
        db_path = args.db or ws.db_path
        export_path = args.export or ws.export_path
        reports_dir = ws.reports_dir
    else:
        db_path = args.db or DB_PATH
        export_path = args.export or DEFAULT_EXPORT

    if not args.skip_ingest:
        print("==> Ingest", flush=True)
        ingest_export(export_path, db_path, reset=not args.no_reset)
        if args.ingest_only:
            return 0
    elif args.ingest_only:
        print("--ingest-only 需要执行 ingest；请去掉 --skip-ingest", flush=True)
        return 2

    if not args.skip_metrics:
        print("==> Metrics", flush=True)
        compute_daily_metrics(db_path)
        print("==> Workout analytics", flush=True)
        rebuild_workout_analytics(db_path)
        print("==> Recovery / Strain / Sleep triad", flush=True)
        rebuild_daily_triad(db_path)

    if not args.skip_reports:
        print("==> Reports", flush=True)
        generate_reports(db_path, as_of=args.as_of, reports_dir=reports_dir)

    print("完成。打开仪表盘：streamlit run src/web/app.py", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
