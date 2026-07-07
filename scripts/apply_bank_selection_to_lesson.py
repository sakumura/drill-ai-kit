#!/usr/bin/env python3
"""Compose a lesson draft from a bank selection report.

This intentionally creates a draft composition, not a deployable lesson. Missing
slots remain explicit placeholders so `/generate-drill-lesson` can write only the
new or repair questions before the final gates run.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import QUESTIONS_PATH, load_entries, load_json, now_iso  # noqa: E402


def entry_by_bank_id(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(entry["bank_id"]): entry for entry in entries if entry.get("bank_id")}


def source_by_position(report: dict[str, Any]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for item in report.get("selected") or []:
        out[int(item["position"])] = item
    for item in report.get("missing_slots") or []:
        out[int(item["position"])] = item
    return out


def compose_bank_question(slot: dict[str, Any], selected: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    question = copy.deepcopy(entry.get("question") or {})
    question["position"] = slot["position"]
    question["block_type"] = slot.get("block_type")
    question["block_position"] = slot.get("block_position")
    question["subject"] = slot.get("subject")
    question["unit_id"] = slot.get("unit_id")
    question["pattern_id"] = slot.get("pattern_id")
    question["difficulty"] = question.get("difficulty") or entry.get("difficulty")
    if slot.get("question_type") and not question.get("question_type"):
        question["question_type"] = slot.get("question_type")
    meta = question.setdefault("meta", {})
    meta.update(
        {
            "source": selected["source"],
            "bank_id": selected["bank_id"],
            "content_hash": selected.get("content_hash"),
            "bank_source_path": entry.get("source_path"),
            "bank_source_lesson_id": entry.get("source_lesson_id"),
            "bank_source_position": entry.get("source_position"),
            "target_difficulty": slot.get("difficulty"),
        }
    )
    return question


def compose_missing_placeholder(slot: dict[str, Any]) -> dict[str, Any]:
    return {
        "position": slot["position"],
        "block_type": slot.get("block_type"),
        "block_position": slot.get("block_position"),
        "subject": slot.get("subject"),
        "unit_id": slot.get("unit_id"),
        "pattern_id": slot.get("pattern_id"),
        "difficulty": slot.get("difficulty"),
        "question_type": slot.get("question_type"),
        "source": slot.get("source", "new"),
        "reason": slot.get("reason", "no reusable bank candidate"),
        "requires_generation": True,
        "meta": {
            "source": slot.get("source", "new"),
            "requires_new_generation": slot.get("source", "new") == "new",
            "requires_repair": str(slot.get("source", "")).startswith("repair:"),
            "selection_reason": slot.get("reason"),
        },
    }


def compose_lesson(report: dict[str, Any], entries: list[dict[str, Any]], lesson_id: str | None = None) -> dict[str, Any]:
    by_bank_id = entry_by_bank_id(entries)
    by_position = source_by_position(report)
    questions: list[dict[str, Any]] = []

    for slot in sorted(report.get("blueprint") or [], key=lambda item: int(item["position"])):
        position = int(slot["position"])
        selected_or_missing = by_position.get(position)
        if not selected_or_missing:
            questions.append(compose_missing_placeholder({**slot, "reason": "slot not present in selection report"}))
            continue
        bank_id = selected_or_missing.get("bank_id")
        if bank_id:
            entry = by_bank_id.get(str(bank_id))
            if not entry:
                raise ValueError(f"selection references missing bank_id: {bank_id}")
            questions.append(compose_bank_question(slot, selected_or_missing, entry))
        else:
            questions.append(compose_missing_placeholder({**slot, **selected_or_missing}))

    selected_count = len(report.get("selected") or [])
    total = len(questions)
    return {
        "lesson_id": lesson_id or report.get("lesson_id") or f"lesson-bank-draft-{report.get('date')}-{report.get('subject')}",
        "date": report.get("date"),
        "subject": report.get("subject"),
        "generated_at": now_iso(),
        "draft_status": "bank_selection_applied_requires_final_generation_and_gates",
        "source_selection_report": {
            "date": report.get("date"),
            "subject": report.get("subject"),
            "summary": report.get("summary"),
        },
        "composition_summary": {
            "total_questions": total,
            "bank_selected": selected_count,
            "new_required": len(report.get("missing_slots") or []),
            "bank_reuse_ratio": selected_count / total if total else 0.0,
        },
        "questions": questions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply a problem-bank selection report to a lesson draft")
    parser.add_argument("--selection-report", type=Path, required=True)
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--lesson-id")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lesson = compose_lesson(load_json(args.selection_report), load_entries(args.questions), args.lesson_id)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(lesson, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        "[problem-bank] composed lesson draft "
        f"bank={lesson['composition_summary']['bank_selected']} "
        f"new={lesson['composition_summary']['new_required']} "
        f"output={args.output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
