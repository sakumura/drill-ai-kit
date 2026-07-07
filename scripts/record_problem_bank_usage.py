#!/usr/bin/env python3
"""Record bank question usage from a lesson JSON or selection report."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import USAGE_PATH, append_usage, now_iso  # noqa: E402


def records_from_selection(report: dict[str, Any]) -> list[dict[str, Any]]:
    target_date = report.get("date") or date.today().isoformat()
    lesson_id = report.get("lesson_id") or f"lesson-bank-{target_date}"
    records = []
    for item in report.get("selected") or []:
        if not item.get("bank_id"):
            continue
        records.append(
            {
                "used_at": target_date,
                "recorded_at": now_iso(),
                "lesson_id": lesson_id,
                "bank_id": item["bank_id"],
                "position": item.get("position"),
                "source": item.get("source"),
                "content_hash": item.get("content_hash"),
            }
        )
    return records


def records_from_lesson(lesson: dict[str, Any]) -> list[dict[str, Any]]:
    target_date = lesson.get("date") or date.today().isoformat()
    lesson_id = lesson.get("lesson_id") or lesson.get("id") or f"lesson-bank-{target_date}"
    records = []
    for question in lesson.get("questions") or []:
        meta = question.get("meta") if isinstance(question.get("meta"), dict) else {}
        bank_id = meta.get("bank_id") or meta.get("from_bank")
        source = meta.get("source") or (f"bank:{bank_id}" if bank_id else None)
        if not bank_id and isinstance(source, str) and source.startswith("bank:"):
            bank_id = source.removeprefix("bank:")
        if not bank_id:
            continue
        records.append(
            {
                "used_at": target_date,
                "recorded_at": now_iso(),
                "lesson_id": lesson_id,
                "bank_id": bank_id,
                "position": question.get("position"),
                "source": source,
                "content_hash": meta.get("content_hash"),
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Record problem-bank usage")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--kind", choices=["selection", "lesson"], required=True)
    parser.add_argument("--usage", type=Path, default=USAGE_PATH)
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records = records_from_selection(payload) if args.kind == "selection" else records_from_lesson(payload)
    written = append_usage(records, args.usage)
    skipped = len(records) - written
    print(f"[problem-bank] recorded {written} usage record(s) to {args.usage} (skipped_duplicates={skipped})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
