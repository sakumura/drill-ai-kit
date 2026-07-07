#!/usr/bin/env python3
"""Finalize problem-bank reuse grades from validation, review, and SVG status."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import (  # noqa: E402
    INDEX_PATH,
    QUESTIONS_PATH,
    ensure_quality,
    is_figure_entry,
    load_entries,
    load_index,
    update_all_summaries,
    write_entries,
    write_json,
)


PASS_REVIEW_STATUS = {"semantic_pass", "reviewed_pass"}


def _score(quality: dict[str, Any], key: str) -> int | None:
    value = quality.get(key)
    return value if isinstance(value, int) else None


def _all_review_items_ok(quality: dict[str, Any]) -> bool:
    items = quality.get("review_items")
    if not isinstance(items, dict) or not items:
        return False
    return all(str(value).upper() in {"OK", "N/A"} for value in items.values())


def grade_entry(entry: dict[str, Any]) -> tuple[int | None, str]:
    quality = ensure_quality(entry)
    if entry.get("validation_status") in {"fail", "error"}:
        return 1, "validation failed or errored"
    if quality.get("review_status") == "auto_rejected":
        return 1, "auto rejected by validation"
    if is_figure_entry(entry) and entry.get("svg_status") == "visual_fail":
        return 1, "SVG visual review failed"
    if entry.get("validation_status") != "pass":
        return None, "validation not passed"
    if quality.get("review_status") not in PASS_REVIEW_STATUS:
        return None, "semantic review not passed"
    if not _all_review_items_ok(quality):
        return None, "semantic review items not all OK/N/A"
    if is_figure_entry(entry) and entry.get("svg_status") != "visual_pass":
        return 3, "figure requires SVG visual_pass before reuse"

    pedagogy = _score(quality, "pedagogy_score")
    solvability = _score(quality, "solvability_score")
    distractor = _score(quality, "distractor_score")
    if pedagogy is None or solvability is None or distractor is None:
        return None, "quality scores incomplete"
    if pedagogy >= 4 and solvability >= 4 and distractor >= 4:
        return 5, "ready for direct reuse"
    if pedagogy >= 4 and solvability >= 4 and distractor >= 3:
        return 4, "minor distractor or metadata adjustment acceptable"
    if pedagogy >= 4 or solvability >= 4:
        return 3, "repair candidate"
    if pedagogy >= 2 or solvability >= 2:
        return 2, "idea only"
    return 1, "not reusable"


def finalize_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for entry in entries:
        quality = ensure_quality(entry)
        grade, reason = grade_entry(entry)
        quality["reuse_grade"] = grade
        quality["reuse_grade_reason"] = reason
        entry["selection_candidate"] = grade in {4, 5}
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize problem-bank reuse grades")
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    args = parser.parse_args()

    entries = finalize_entries(load_entries(args.questions))
    write_entries(entries, args.questions)
    index = load_index(args.index)
    update_all_summaries(index, entries)
    write_json(args.index, index)
    dist = (index.get("quality_summary") or {}).get("reuse_grade_distribution", {})
    print(f"[problem-bank] finalized reuse grades: {dist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
