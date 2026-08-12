"""Personal profile for TCM / BaZi lifestyle references."""

from __future__ import annotations

import json
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from pathlib import Path

from src.config import DATA_DIR

PROFILE_PATH = DATA_DIR / "profile.json"
_PROFILE_PATH_OVERRIDE: ContextVar[Path | None] = ContextVar("profile_path", default=None)


@dataclass
class UserProfile:
    # 公历出生：年-月-日 时:分（本地时间）
    birth_datetime: str | None = None  # e.g. "1992-05-18 08:30"
    sex: str | None = None  # "男" / "女"
    birth_place: str | None = None
    display_name: str | None = None
    # 若不想自动排盘，可手填四柱，如 "壬申 乙巳 丙寅 壬辰"
    bazi_manual: str | None = None
    # 养生偏好备注
    notes: str | None = None


DEFAULT_PROFILE = UserProfile(
    birth_datetime=None,
    sex=None,
    birth_place=None,
    display_name=None,
    bazi_manual=None,
    notes="填写 birth_datetime 与 sex 后启用八字参考（仅作传统文化/作息参考，非命运或医疗判断）。",
)


def set_profile_path(path: Path | None) -> None:
    """Bind profile.json to the current user workspace for this request/session."""
    _PROFILE_PATH_OVERRIDE.set(path)


def active_profile_path() -> Path:
    return _PROFILE_PATH_OVERRIDE.get() or PROFILE_PATH


def load_profile(path: Path | None = None) -> UserProfile:
    path = path or active_profile_path()
    if not path.exists():
        save_profile(DEFAULT_PROFILE, path)
        return DEFAULT_PROFILE
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return DEFAULT_PROFILE
    return UserProfile(
        birth_datetime=raw.get("birth_datetime"),
        sex=raw.get("sex"),
        birth_place=raw.get("birth_place"),
        display_name=raw.get("display_name"),
        bazi_manual=raw.get("bazi_manual"),
        notes=raw.get("notes"),
    )


def save_profile(profile: UserProfile, path: Path | None = None) -> None:
    path = path or active_profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(profile), ensure_ascii=False, indent=2), encoding="utf-8")
