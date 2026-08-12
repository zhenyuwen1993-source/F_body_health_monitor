"""Simple habit journal + impact hints (WHOOP/Athlytic-style)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from statistics import mean
from typing import Any

from src.config import DB_PATH
from src.ingest.parse_export import init_db

TAGS = ["酒精", "旅行", "生病", "加班", "比赛", "聚餐", "咖啡过量", "午睡"]


def ensure_journal_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS habit_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT NOT NULL,
            tags TEXT,
            note TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_journal_day ON habit_journal(day);
        """
    )


def add_journal_entry(day: str, tags: list[str], note: str = "", db_path: Path = DB_PATH) -> None:
    conn = init_db(db_path)
    ensure_journal_table(conn)
    conn.execute(
        "INSERT INTO habit_journal(day, tags, note) VALUES (?, ?, ?)",
        (day, ",".join(tags), note or None),
    )
    conn.commit()
    conn.close()


def list_journal(limit: int = 30, db_path: Path = DB_PATH) -> list[dict]:
    conn = init_db(db_path)
    ensure_journal_table(conn)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM habit_journal ORDER BY day DESC, id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def impact_hints(db_path: Path = DB_PATH) -> list[str]:
    """Compare HRV on tagged alcohol days vs other days (simple observational)."""
    conn = init_db(db_path)
    ensure_journal_table(conn)
    conn.row_factory = sqlite3.Row
    journals = conn.execute("SELECT day, tags FROM habit_journal").fetchall()
    if not journals:
        conn.close()
        return ["习惯日记还是空的：记下酒精/旅行/生病等，几周后可看对 HRV 的影响。"]

    alcohol_days = {r["day"] for r in journals if r["tags"] and "酒精" in r["tags"]}
    metrics = {
        r["day"]: r["hrv_sdnn_ms"]
        for r in conn.execute("SELECT day, hrv_sdnn_ms FROM daily_metrics WHERE hrv_sdnn_ms IS NOT NULL")
    }
    conn.close()

    tips: list[str] = []
    if alcohol_days:
        a_vals = [metrics[d] for d in alcohol_days if d in metrics]
        o_vals = [v for d, v in metrics.items() if d not in alcohol_days]
        if a_vals and o_vals and len(a_vals) >= 2:
            tips.append(
                f"观察：标记「酒精」的日子 HRV 均值约 {mean(a_vals):.0f} ms，"
                f"其他日约 {mean(o_vals):.0f} ms（样本小，仅供参考）。"
            )
        else:
            tips.append(f"已记录 {len(alcohol_days)} 个酒精相关日，再积累几天可做对比。")
    tips.append(f"日记共 {len(journals)} 条。持续记录习惯，Impact 才会越来越准。")
    return tips
