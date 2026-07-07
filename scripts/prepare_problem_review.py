#!/usr/bin/env python3
"""Prepare, verify, and optionally apply problem-bank semantic reviews."""
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
    TWO_STEP_TYPES,
    ensure_quality,
    load_entries,
    load_index,
    now_iso,
    update_all_summaries,
    write_entries,
    write_json,
)


REVIEW_ITEM_KEYS = [
    "question_text_ok",
    "choices_are_meaningful",
    "correct_answer_matches_solution",
    "student_age_fit",
    "difficulty_label_ok",
    "training_plan_fit",
    "weakness_pattern_fit",
    "step1_step2_are_distinct",
    "figure_matches_question",
]
PASS_VALUES = {"OK", "N/A"}
FINAL_VALUES = {"OK", "NG", "N/A"}


def default_review_items(entry: dict[str, Any]) -> dict[str, str]:
    q_type = str(entry.get("question_type") or (entry.get("question") or {}).get("question_type") or "single_tier")
    is_figure = bool(entry.get("is_figure") or (entry.get("question") or {}).get("figure_svg"))
    return {
        "question_text_ok": "PENDING",
        "choices_are_meaningful": "PENDING",
        "correct_answer_matches_solution": "PENDING",
        "student_age_fit": "PENDING",
        "difficulty_label_ok": "PENDING",
        "training_plan_fit": "PENDING",
        "weakness_pattern_fit": "PENDING",
        "step1_step2_are_distinct": "PENDING" if q_type in TWO_STEP_TYPES else "N/A",
        "figure_matches_question": "PENDING" if is_figure else "N/A",
    }


def review_record(entry: dict[str, Any]) -> dict[str, Any]:
    question = entry.get("question") or {}
    return {
        "bank_id": entry.get("bank_id"),
        "content_hash": entry.get("content_hash"),
        "figure_svg_hash": entry.get("figure_svg_hash"),
        "subject": entry.get("subject"),
        "unit_id": entry.get("unit_id"),
        "pattern_id": entry.get("pattern_id"),
        "difficulty": entry.get("difficulty"),
        "question_type": entry.get("question_type"),
        "validation_status": entry.get("validation_status"),
        "question_text": question.get("question_text"),
        "answer": question.get("answer"),
        "hints": question.get("hints") if isinstance(question.get("hints"), list) else [],
        "solution_steps": question.get("solution_steps") if isinstance(question.get("solution_steps"), list) else [],
        "is_figure": bool(entry.get("is_figure")),
        "review_items": default_review_items(entry),
        "scores": {
            "pedagogy_score": None,
            "solvability_score": None,
            "distractor_score": None,
        },
        "semantic_verdict": "PENDING",
        "review_note": "",
    }


def build_review_sheet(entries: list[dict[str, Any]], bank_ids: set[str] | None, include_failed: bool, limit: int | None) -> dict[str, Any]:
    reviews = []
    skipped_auto_rejected = 0
    for entry in entries:
        if bank_ids and entry.get("bank_id") not in bank_ids:
            continue
        if entry.get("validation_status") == "fail" and not include_failed:
            skipped_auto_rejected += 1
            continue
        reviews.append(review_record(entry))
        if limit and len(reviews) >= limit:
            break
    return {
        "review_type": "problem_bank_semantic_review",
        "created_at": now_iso(),
        "instructions": [
            "Fill every review_items value with OK, NG, or N/A.",
            "PENDING is not accepted by verify.",
            "Set semantic_verdict=OK only after self-solving the problem and checking answer/solution consistency.",
            "validation_status=fail entries should remain auto_rejected and are skipped by default.",
        ],
        "review_items_required": REVIEW_ITEM_KEYS,
        "summary": {
            "review_count": len(reviews),
            "skipped_auto_rejected": skipped_auto_rejected,
        },
        "reviews": reviews,
    }


def _norm(value: Any) -> str:
    return str(value or "").strip().upper()


def review_failures(sheet: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    reviews = sheet.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        return ["reviews is empty"]
    seen = set()
    for item in reviews:
        bank_id = item.get("bank_id") or "?"
        if bank_id in seen:
            failures.append(f"{bank_id}: duplicate review")
        seen.add(bank_id)
        review_items = item.get("review_items")
        if not isinstance(review_items, dict):
            failures.append(f"{bank_id}: review_items missing")
            continue
        for key in REVIEW_ITEM_KEYS:
            value = _norm(review_items.get(key))
            if value not in FINAL_VALUES:
                failures.append(f"{bank_id}: {key}={review_items.get(key)!r}")
        verdict = _norm(item.get("semantic_verdict"))
        if verdict not in {"OK", "NG", "AUTO_REJECTED"}:
            failures.append(f"{bank_id}: semantic_verdict={item.get('semantic_verdict')!r}")
        if not str(item.get("review_note") or "").strip():
            failures.append(f"{bank_id}: review_note is empty")
        scores = item.get("scores")
        if verdict == "OK":
            for score_key in ("pedagogy_score", "solvability_score", "distractor_score"):
                score = (scores or {}).get(score_key)
                if not isinstance(score, int) or not 1 <= score <= 5:
                    failures.append(f"{bank_id}: {score_key} must be 1..5 for OK reviews")
    return failures


def apply_review(sheet: dict[str, Any], questions_path: Path, index_path: Path) -> None:
    entries = load_entries(questions_path)
    by_id = {entry.get("bank_id"): entry for entry in entries}
    for review in sheet.get("reviews") or []:
        entry = by_id.get(review.get("bank_id"))
        if not entry:
            continue
        if review.get("content_hash") != entry.get("content_hash"):
            raise ValueError(f"{review.get('bank_id')}: content_hash changed; regenerate review sheet")
        quality = ensure_quality(entry)
        if entry.get("validation_status") == "fail":
            quality["review_status"] = "auto_rejected"
            continue
        scores = review.get("scores") or {}
        quality["pedagogy_score"] = scores.get("pedagogy_score")
        quality["solvability_score"] = scores.get("solvability_score")
        quality["distractor_score"] = scores.get("distractor_score")
        quality["review_note"] = review.get("review_note")
        quality["reviewed_at"] = now_iso()
        quality["review_items"] = review.get("review_items")
        quality["semantic_verdict"] = _norm(review.get("semantic_verdict"))
        all_pass = all(_norm((review.get("review_items") or {}).get(key)) in PASS_VALUES for key in REVIEW_ITEM_KEYS)
        quality["review_status"] = "semantic_pass" if _norm(review.get("semantic_verdict")) == "OK" and all_pass else "semantic_fail"
        entry["quality_status"] = quality["review_status"]
    write_entries(entries, questions_path)
    index = load_index(index_path)
    update_all_summaries(index, entries)
    write_json(index_path, index)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare/verify problem-bank semantic review sheets")
    sub = parser.add_subparsers(dest="cmd", required=True)

    prepare = sub.add_parser("prepare")
    prepare.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--bank-id", action="append", dest="bank_ids")
    prepare.add_argument("--include-failed", action="store_true")
    prepare.add_argument("--limit", type=int)

    verify = sub.add_parser("verify")
    verify.add_argument("--review", type=Path, required=True)
    verify.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    verify.add_argument("--index", type=Path, default=INDEX_PATH)
    verify.add_argument("--apply", action="store_true")

    args = parser.parse_args()
    if args.cmd == "prepare":
        entries = load_entries(args.questions)
        sheet = build_review_sheet(entries, set(args.bank_ids) if args.bank_ids else None, args.include_failed, args.limit)
        write_json(args.output, sheet)
        print(f"[problem-bank] review sheet written: {args.output} ({sheet['summary']['review_count']} entries)")
        return 0

    sheet = json.loads(args.review.read_text(encoding="utf-8"))
    failures = review_failures(sheet)
    if failures:
        print(f"[NG] problem review incomplete: {len(failures)} item(s)", file=sys.stderr)
        for failure in failures[:30]:
            print(f"  {failure}", file=sys.stderr)
        if len(failures) > 30:
            print(f"  ... and {len(failures) - 30} more", file=sys.stderr)
        return 1
    if args.apply:
        apply_review(sheet, args.questions, args.index)
    print(f"[OK] problem review complete: {args.review}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
