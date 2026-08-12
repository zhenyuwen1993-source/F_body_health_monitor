"""Source priority helpers for Apple Health multi-device dedup."""

from __future__ import annotations

import re


# Higher wins. Manual Health entries often named without Watch/iPhone — keep middling.
_WATCH = re.compile(r"watch", re.I)
_PHONE = re.compile(r"iphone|ipad", re.I)
_MANUAL = re.compile(r"health|手动|manual", re.I)


def source_priority(source_name: str | None) -> int:
    name = source_name or ""
    if _WATCH.search(name):
        return 100
    if _MANUAL.search(name) and not _PHONE.search(name):
        return 80
    if _PHONE.search(name):
        return 50
    return 20


def pick_preferred_total(by_source: dict[str, float]) -> tuple[float | None, str | None]:
    """Pick the highest-priority source's daily total (do not sum across devices)."""
    if not by_source:
        return None, None
    best_src = None
    best_pri = -1
    best_val = 0.0
    for src, val in by_source.items():
        pri = source_priority(src)
        if pri > best_pri or (pri == best_pri and val > best_val):
            best_src = src
            best_pri = pri
            best_val = val
    return (best_val if best_val else None), best_src


# Cumulative metrics that must not be double-counted across Watch + iPhone
CUMULATIVE_KEYS = {
    "steps",
    "distance",
    "flights",
    "active_energy",
    "basal_energy",
    "exercise",
    "stand_time",
}
