#!/usr/bin/env python3
"""Apply existing lesson validation rules to problem-bank entries."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import (  # noqa: E402
    INDEX_PATH,
    QUESTIONS_PATH,
    ensure_quality,
    load_entries,
    load_index,
    normalize_rule,
    update_all_summaries,
    write_entries,
    write_json,
)
from validate_lesson_format import (  # noqa: E402
    VALIDATION_MD_PATH,
    check_question_extended,
    load_allowed_units,
    load_r10r16_config,
    validate_questions,
    validate_remediation_and_blocks,
)


AUTO_REJECT_RULES = {"R0", "R12", "R17", "R18", "R19", "R22"}


def bank_question_for_validation(entry: dict[str, Any]) -> dict[str, Any]:
    question = dict(entry.get("question") or {})
    for key in ("hints", "solution_steps", "common_mistakes"):
        if isinstance(question.get(key), list):
            question[key] = [
                item if isinstance(item, str) else json.dumps(item, ensure_ascii=False, sort_keys=True)
                for item in question[key]
            ]
    bank_id = entry.get("bank_id")
    question["id"] = question.get("id") or f"q-{bank_id}"
    prefix = "lesson-m" if entry.get("subject") == "math" else "lesson-j" if entry.get("subject") == "japanese" else "problem-bank"
    question["lesson_id"] = f"{prefix}-{bank_id}"
    question["position"] = 1
    return question


def temp_lesson_for_entry(entry: dict[str, Any]) -> dict[str, Any]:
    prefix = "lesson-m" if entry.get("subject") == "math" else "lesson-j" if entry.get("subject") == "japanese" else "problem-bank"
    lesson_id = f"{prefix}-{entry.get('bank_id')}"
    return {
        "id": lesson_id,
        "lesson_id": lesson_id,
        "title": f"Problem Bank Validation {entry.get('bank_id')}",
        "subject": entry.get("subject"),
        "questions": [bank_question_for_validation(entry)],
    }


def flatten_validation_records(records: list[dict[str, Any]], level: str = "reject") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for record in records:
        for violation in record.get("violated_rules") or []:
            out.append(
                {
                    "rule": normalize_rule(violation.get("rule")),
                    "level": str(violation.get("level") or level),
                    "detail": str(violation.get("detail") or ""),
                }
            )
    return out


def flatten_extended_rules(rules: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "rule": normalize_rule(rule.get("rule")),
            "level": str(rule.get("level") or "reject"),
            "detail": str(rule.get("detail") or ""),
        }
        for rule in rules
        if rule.get("level") in {"reject", "warn", "error"}
    ]


def validate_entry(entry: dict[str, Any], allowed_units: dict[str, Any], r10r16_config: dict[str, Any]) -> tuple[str, list[dict[str, str]]]:
    lesson = temp_lesson_for_entry(entry)
    question = lesson["questions"][0]
    rules: list[dict[str, str]] = []
    rules.extend(flatten_validation_records(validate_questions([question], allowed_units)))
    rules.extend(flatten_extended_rules(check_question_extended(question, r10r16_config)))
    rules.extend(flatten_validation_records([{"violated_rules": validate_remediation_and_blocks(lesson)}]))
    deduped: list[dict[str, str]] = []
    seen = set()
    for rule in rules:
        key = (rule["rule"], rule["level"], rule["detail"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(rule)
    return ("fail" if deduped else "pass"), deduped


def evaluate_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed_units = load_allowed_units(VALIDATION_MD_PATH)
    r10r16_config = load_r10r16_config(VALIDATION_MD_PATH)
    for entry in entries:
        quality = ensure_quality(entry)
        try:
            status, rules = validate_entry(entry, allowed_units, r10r16_config)
        except Exception as exc:  # noqa: BLE001 - capture validator exceptions as data.
            entry["validation_status"] = "error"
            entry["validation_rules"] = [{"rule": "ERROR", "level": "error", "detail": str(exc)}]
            quality["review_status"] = "auto_rejected"
            continue
        entry["validation_status"] = status
        entry["validation_rules"] = rules
        if any(rule.get("level") == "reject" and rule.get("rule") in AUTO_REJECT_RULES for rule in rules):
            quality["review_status"] = "auto_rejected"
            entry["quality_status"] = "validation_failed_auto_rejected"
        elif status == "pass" and quality.get("review_status") == "unreviewed":
            entry["quality_status"] = "validation_pass_unreviewed"
        elif status == "fail":
            entry["quality_status"] = "validation_failed_unreviewed"
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate problem-bank questions with validate_lesson_format rules")
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--output", type=Path, help="Optional output JSONL path. Defaults to overwriting --questions.")
    args = parser.parse_args()

    entries = evaluate_entries(load_entries(args.questions))
    output = args.output or args.questions
    write_entries(entries, output)
    index = load_index(args.index)
    update_all_summaries(index, entries)
    write_json(args.index, index)
    summary = index.get("validation_summary") or {}
    print(
        "[problem-bank] validation "
        f"pass={summary.get('validation_pass', 0)} "
        f"fail={summary.get('validation_fail', 0)} "
        f"error={summary.get('validation_error', 0)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
