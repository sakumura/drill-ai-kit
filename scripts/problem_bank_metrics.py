#!/usr/bin/env python3
"""Report operational metrics for problem-bank readiness and reuse."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import (  # noqa: E402
    QUESTIONS_PATH,
    USAGE_PATH,
    is_figure_entry,
    is_selection_candidate,
    load_entries,
    load_json,
    load_usage,
    review_status,
)


def weakness_patterns(path: Path, limit: int = 10) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = load_json(path)
    queue = payload.get("priority_queue") if isinstance(payload, dict) else []
    return [item for item in queue[:limit] if isinstance(item, dict)]


def unit_coverage(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total: dict[str, int] = defaultdict(int)
    reusable: dict[str, int] = defaultdict(int)
    for entry in entries:
        unit = entry.get("unit_id")
        if not unit:
            continue
        total[str(unit)] += 1
        if is_selection_candidate(entry):
            reusable[str(unit)] += 1
    return [
        {"unit_id": unit, "total": count, "reusable": reusable.get(unit, 0)}
        for unit, count in sorted(total.items())
    ]


def weakness_reusable_coverage(entries: list[dict[str, Any]], weakness_path: Path) -> list[dict[str, Any]]:
    reusable_by_unit = Counter(
        str(entry.get("unit_id") or entry.get("pattern_id"))
        for entry in entries
        if is_selection_candidate(entry)
    )
    rows = []
    for item in weakness_patterns(weakness_path):
        pattern = item.get("pattern_id")
        rows.append(
            {
                "pattern_id": pattern,
                "subject": item.get("subject"),
                "score": item.get("score"),
                "severity": item.get("severity"),
                "reusable_count": reusable_by_unit.get(str(pattern), 0),
            }
        )
    return rows


def ratio_from_selection(selection_report: dict[str, Any]) -> dict[str, Any]:
    summary = selection_report.get("summary") or {}
    total = int(summary.get("total_slots") or len(selection_report.get("blueprint") or []) or 0)
    bank_count = int(summary.get("bank_selected") or len(selection_report.get("selected") or []) or 0)
    return {
        "source": "selection_report",
        "lesson_id": selection_report.get("lesson_id"),
        "used_at": selection_report.get("date"),
        "bank_reuse_count": bank_count,
        "total_questions": total,
        "bank_reuse_ratio": bank_count / total if total else 0.0,
    }


def latest_usage_ratio(usage: list[dict[str, Any]], lesson_question_count: int | None = None) -> dict[str, Any]:
    if not usage:
        return {"source": "usage", "lesson_id": None, "bank_reuse_count": 0, "total_questions": lesson_question_count, "bank_reuse_ratio": 0.0}
    latest = max(str(record.get("used_at") or "") for record in usage)
    latest_records = [record for record in usage if str(record.get("used_at") or "") == latest]
    lesson_counts = Counter(str(record.get("lesson_id") or "unknown") for record in latest_records)
    lesson_id, count = lesson_counts.most_common(1)[0]
    return {
        "source": "usage",
        "lesson_id": lesson_id,
        "used_at": latest,
        "bank_reuse_count": count,
        "total_questions": lesson_question_count,
        "bank_reuse_ratio": count / lesson_question_count if lesson_question_count else None,
    }


def rejected_reason_distribution(entries: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for entry in entries:
        for rule in entry.get("validation_rules") or []:
            counts[str(rule.get("rule"))] += 1
        reason = (entry.get("quality") or {}).get("reuse_grade_reason")
        if reason:
            counts[str(reason)] += 1
    return dict(sorted(counts.items()))


def metrics(
    entries: list[dict[str, Any]],
    usage: list[dict[str, Any]],
    weakness_path: Path,
    selection_report: dict[str, Any] | None = None,
    lesson_question_count: int | None = None,
) -> dict[str, Any]:
    reviewed_total = sum(1 for entry in entries if review_status(entry) != "unreviewed")
    reusable_total = sum(1 for entry in entries if is_selection_candidate(entry))
    visual_pass_figure_count = sum(1 for entry in entries if is_figure_entry(entry) and entry.get("svg_status") == "visual_pass")
    selection_summary = (selection_report or {}).get("summary") or {}
    report = {
        "bank_total": len(entries),
        "reviewed_total": reviewed_total,
        "reusable_total": reusable_total,
        "visual_pass_figure_count": visual_pass_figure_count,
        "unit_id_coverage": unit_coverage(entries),
        "weakness_profile_reusable_coverage": weakness_reusable_coverage(entries, weakness_path),
        "latest_lesson_bank_reuse_ratio": ratio_from_selection(selection_report) if selection_report else latest_usage_ratio(usage, lesson_question_count),
        "new_generation_count": selection_summary.get("new_required"),
        "svg_new_generation_count": selection_summary.get("svg_new_required"),
        "rejected_reason_distribution": rejected_reason_distribution(entries),
    }
    if selection_report:
        report["selection_dry_run_summary"] = selection_summary
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Report problem-bank operational metrics")
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--usage", type=Path, default=USAGE_PATH)
    parser.add_argument("--weakness-profile", type=Path, default=Path("data/weakness_profile.json"))
    parser.add_argument("--selection-report", type=Path)
    parser.add_argument("--lesson-question-count", type=int)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    selection_report = load_json(args.selection_report) if args.selection_report and args.selection_report.exists() else None
    report = metrics(load_entries(args.questions), load_usage(args.usage), args.weakness_profile, selection_report, args.lesson_question_count)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
