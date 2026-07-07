#!/usr/bin/env python3
"""scripts/_lib/json_env.py

D1廃止後のJSON入出力共通ヘルパー。
全スクリプトはこのモジュール経由でlessons.json / schedule.jsonを読み書きする。
"""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"
HANDWRITTEN_DIR = PROJECT_ROOT / "data" / "lessons-handwritten"


def load_lessons() -> list:
    """frontend/public/data/lessons.json を読み込む。"""
    path = DATA_DIR / "lessons.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_schedule() -> list:
    """frontend/public/data/schedule.json を読み込む。"""
    path = DATA_DIR / "schedule.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_lessons(data: list) -> None:
    """frontend/public/data/lessons.json に書き戻す。"""
    path = DATA_DIR / "lessons.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def write_schedule(data: list) -> None:
    """frontend/public/data/schedule.json に書き戻す。"""
    path = DATA_DIR / "schedule.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
