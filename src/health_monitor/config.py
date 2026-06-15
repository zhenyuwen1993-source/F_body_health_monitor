"""Runtime configuration.

All settings are optional and read from environment variables (a local ``.env``
file is loaded automatically if present). Sensible defaults are used otherwise,
so the project runs with zero configuration.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Repo root is two levels up from this file: src/health_monitor/config.py
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"


@dataclass(frozen=True)
class Settings:
    """Resolved application settings."""

    db_path: Path
    api_host: str
    api_port: int
    api_key: str | None

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"


def _resolve() -> Settings:
    db_path = Path(os.environ.get("HM_DB_PATH", DEFAULT_DATA_DIR / "health.db")).expanduser()
    return Settings(
        db_path=db_path,
        api_host=os.environ.get("HM_API_HOST", "0.0.0.0"),
        api_port=int(os.environ.get("HM_API_PORT", "8000")),
        api_key=(os.environ.get("HM_API_KEY") or "").strip() or None,
    )


settings = _resolve()
