#!/usr/bin/env python3
"""Validate static JSON files served by the frontend."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "frontend" / "public" / "data"
REQUIRED_FILES = [
    "lessons.json",
    "units.json",
    "schedule.json",
    "motivator.json",
    "learning_profile.json",
]


def main() -> None:
    missing: list[str] = []
    invalid: list[str] = []
    for name in REQUIRED_FILES:
        path = DATA_DIR / name
        if not path.exists():
            missing.append(name)
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            invalid.append(f"{name}: {exc}")

    if missing or invalid:
        for name in missing:
            print(f"[missing] {name}")
        for message in invalid:
            print(f"[invalid] {message}")
        raise SystemExit(1)

    print(f"validated {len(REQUIRED_FILES)} static JSON files")


if __name__ == "__main__":
    main()
