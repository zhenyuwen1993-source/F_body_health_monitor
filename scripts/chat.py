#!/usr/bin/env python3
"""CLI entry for the local health agent."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.agent.chat import ask, build_context, chat_loop
from src.config import DB_PATH


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="本地健康问答 Agent")
    p.add_argument("question", nargs="?", help="一次性提问；省略则进入交互")
    p.add_argument("--db", type=Path, default=DB_PATH)
    p.add_argument("--no-llm", action="store_true", help="禁用 Ollama，仅规则引擎")
    p.add_argument("--context", action="store_true", help="只打印上下文")
    args = p.parse_args(argv)

    if args.context:
        print(build_context(args.db))
        return 0
    if args.question:
        ans = ask(args.question, args.db, use_llm=not args.no_llm)
        print(ans.text)
        return 0
    chat_loop(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
