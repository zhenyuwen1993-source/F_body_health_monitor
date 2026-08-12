"""Simple username/password auth for multi-user Streamlit (PBKDF2, no extra deps)."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.config import DATA_DIR

AUTH_PATH = DATA_DIR / "auth.json"
_ITERATIONS = 200_000
_USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fff-]{2,32}$")


def validate_username(username: str) -> str:
    name = (username or "").strip()
    if not name or ".." in name or "/" in name or "\\" in name:
        raise ValueError("用户名不合法")
    if not _USERNAME_RE.match(name):
        raise ValueError("用户名需 2–32 位（字母/数字/下划线/中文/连字符）")
    return name


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not AUTH_PATH.exists():
        return {"users": {}}
    try:
        raw = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"users": {}}
    if "users" not in raw or not isinstance(raw["users"], dict):
        return {"users": {}}
    return raw


def _save(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = AUTH_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(AUTH_PATH)


def _hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    if not password or len(password) < 6:
        raise ValueError("密码至少 6 位")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return salt.hex(), digest.hex()


def user_count() -> int:
    return len(_load()["users"])


def list_users() -> list[dict[str, Any]]:
    users = _load()["users"]
    out = []
    for name, meta in sorted(users.items()):
        out.append(
            {
                "username": name,
                "role": meta.get("role", "user"),
                "disabled": bool(meta.get("disabled")),
                "created_at": meta.get("created_at"),
            }
        )
    return out


def get_user(username: str) -> dict[str, Any] | None:
    return _load()["users"].get(username)


def register(username: str, password: str, *, role: str | None = None) -> dict[str, Any]:
    name = validate_username(username)
    data = _load()
    if name in data["users"]:
        raise ValueError("用户名已存在")
    if role is None:
        role = "admin" if not data["users"] else "user"
    if role not in {"admin", "user"}:
        raise ValueError("role 无效")
    salt_hex, hash_hex = _hash_password(password)
    data["users"][name] = {
        "salt": salt_hex,
        "hash": hash_hex,
        "role": role,
        "disabled": False,
        "created_at": _now(),
    }
    _save(data)
    return {"username": name, "role": role}


def verify(username: str, password: str) -> bool:
    name = (username or "").strip()
    meta = get_user(name)
    if not meta or meta.get("disabled"):
        return False
    try:
        salt = bytes.fromhex(meta["salt"])
        _, digest = _hash_password(password, salt=salt)
    except (ValueError, KeyError):
        return False
    return secrets.compare_digest(digest, meta.get("hash", ""))


def set_disabled(username: str, disabled: bool) -> None:
    name = validate_username(username)
    data = _load()
    if name not in data["users"]:
        raise ValueError("用户不存在")
    data["users"][name]["disabled"] = bool(disabled)
    _save(data)


def change_password(username: str, new_password: str) -> None:
    name = validate_username(username)
    data = _load()
    if name not in data["users"]:
        raise ValueError("用户不存在")
    salt_hex, hash_hex = _hash_password(new_password)
    data["users"][name]["salt"] = salt_hex
    data["users"][name]["hash"] = hash_hex
    _save(data)


def is_admin(username: str) -> bool:
    meta = get_user(username)
    return bool(meta and meta.get("role") == "admin" and not meta.get("disabled"))
