#!/usr/bin/env python3
"""Prepare and verify a per-question semantic review checklist.

This gate is intentionally not an automatic quality judge. It makes the
human review surface explicit, then refuses "reviewed" status while any
semantic item is still pending.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LESSONS_JSON = PROJECT_ROOT / "frontend" / "public" / "data" / "lessons.json"
DEFAULT_OUTPUT_DIR = Path("/tmp")

TWO_STEP_TYPES = {"two_tier", "evidence_first", "slot_two_tier"}
REVIEW_ITEM_KEYS = [
    "question_text_ok",
    "figure_matches_question",
    "choices_are_meaningful",
    "correct_answer_matches_solution",
    "step1_step2_are_distinct",
    "student_age_fit",
]
PASS_VALUES = {"OK", "N/A"}
DEFAULT_EXTERNAL_REVIEWERS = ["codex", "claude", "gemini"]
EXTERNAL_REVIEW_ITEM_KEYS = [
    "meaning_clear",
    "conditions_sufficient",
    "answer_unique",
    "answer_contract_consistent",
    "step_logic_consistent",
]


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def load_lesson(lessons_json: Path, lesson_id: str) -> dict[str, Any]:
    with lessons_json.open(encoding="utf-8") as f:
        lessons = json.load(f)
    for lesson in lessons:
        if lesson.get("id") == lesson_id:
            return lesson
    raise ValueError(f"lesson_id={lesson_id} not found in {lessons_json}")


def flattened_hints(question: dict[str, Any]) -> list[str]:
    hints = question.get("hints")
    if not isinstance(hints, list):
        return []
    if hints and isinstance(hints[0], list):
        return [str(item) for item in hints[0]]
    return [str(item) for item in hints]


def slot_correct_values(slot_config: Any, fallback: str) -> dict[str, str]:
    if not isinstance(slot_config, dict):
        return {}
    if slot_config.get("type") == "two_tier_slot":
        values: dict[str, str] = {}
        for key, label in (("tier1", "step1_expected"), ("tier2", "step2_expected")):
            nested = slot_config.get(key)
            if isinstance(nested, dict):
                values[label] = str(nested.get("correct_value") or fallback)
        return values
    return {"slot_expected": str(slot_config.get("correct_value") or fallback)}


def answer_contract(question: dict[str, Any]) -> dict[str, Any]:
    q_type = str(question.get("question_type") or "single_tier")
    hints = flattened_hints(question)
    answer = str(question.get("answer") or "")

    if q_type in {"two_tier", "evidence_first"}:
        return {
            "mode": q_type,
            "step1_expected": hints[0] if len(hints) > 0 else "",
            "step2_expected": hints[3] if len(hints) > 3 else "",
            "answer": answer,
            "rule": "Step1=hints[0] is process/evidence; Step2=hints[3] is final answer.",
        }

    if q_type == "slot_two_tier" or q_type.startswith("slot_"):
        return {
            "mode": q_type,
            **slot_correct_values(question.get("slot_config"), answer),
            "answer": answer,
            "rule": (
                "Use slot_config.correct_value; for slot_two_tier verify tier1 "
                "and tier2 separately."
            ),
        }

    return {
        "mode": q_type,
        "single_expected": hints[0] if hints else answer,
        "answer": answer,
        "rule": "single_tier: hints[0] is the displayed correct answer.",
    }


def default_review_items(question: dict[str, Any]) -> dict[str, str]:
    q_type = str(question.get("question_type") or "single_tier")
    has_figure = bool(question.get("figure_svg"))
    return {
        "question_text_ok": "PENDING",
        "figure_matches_question": "PENDING" if has_figure else "N/A",
        "choices_are_meaningful": "PENDING",
        "correct_answer_matches_solution": "PENDING",
        "step1_step2_are_distinct": "PENDING" if q_type in TWO_STEP_TYPES else "N/A",
        "student_age_fit": "PENDING",
    }


def default_external_reviews(reviewers: list[str]) -> dict[str, dict[str, str]]:
    return {
        reviewer: {
            "verdict": "PENDING",
            "meaning_clear": "PENDING",
            "conditions_sufficient": "PENDING",
            "answer_unique": "PENDING",
            "answer_contract_consistent": "PENDING",
            "step_logic_consistent": "PENDING",
            "refusal_reason": "",
            "review_note": "",
        }
        for reviewer in reviewers
    }


def build_review_template(
    lesson: dict[str, Any],
    lessons_json: Path,
    external_reviewers: list[str] | None = None,
) -> dict[str, Any]:
    reviewers = list(external_reviewers or DEFAULT_EXTERNAL_REVIEWERS)
    questions = sorted(_as_list(lesson.get("questions")), key=lambda q: int(q.get("position") or 0))
    reviews = []
    for question in questions:
        reviews.append(
            {
                "position": question.get("position"),
                "question_id": question.get("id"),
                "unit_id": question.get("unit_id", ""),
                "difficulty": question.get("difficulty", ""),
                "question_type": question.get("question_type", "single_tier"),
                "tier1_purpose": question.get("tier1_purpose"),
                "tier2_purpose": question.get("tier2_purpose"),
                "question_text": question.get("question_text", ""),
                "answer_contract": answer_contract(question),
                "hints": flattened_hints(question),
                "solution_steps": question.get("solution_steps", []),
                "is_figure": bool(question.get("figure_svg")),
                "review_items": default_review_items(question),
                "external_reviews": default_external_reviews(reviewers),
                "review_note": "",
                "semantic_verdict": "PENDING",
            }
        )
    return {
        "lesson_id": lesson.get("id"),
        "source_lessons_json": str(lessons_json),
        "external_reviewers": {
            "required": reviewers,
            "policy": (
                "All required reviewers must return OK. Reviewers must refuse/NG "
                "any question with unclear meaning, insufficient conditions, "
                "non-unique answer, answer-contract mismatch, or step logic mismatch."
            ),
        },
        "instructions": [
            "Automatic validation and UI dogfood do not replace semantic review.",
            "Fill every review_items value with OK, NG, or N/A.",
            (
                "Set semantic_verdict to OK only after self-solving the question "
                "without looking at distractors."
            ),
            (
                "Run scripts/run_semantic_reviewers.py so codex, claude, and "
                "Antigravity Gemini 3.5 Flash (Medium) perform strict refusal-based "
                "semantic checks. Any reviewer NG blocks release."
            ),
            "For two_tier/evidence_first, verify Step1 and Step2 mean different things.",
            (
                "For figure questions, compare SVG labels/shading/dimensions with "
                "question_text, choices, and solution_steps."
            ),
        ],
        "review_items_required": REVIEW_ITEM_KEYS + ["review_note", "semantic_verdict"],
        "summary": {
            "question_count": len(reviews),
            "figure_question_count": sum(1 for r in reviews if r["is_figure"]),
            "two_step_question_count": sum(
                1 for r in reviews if r["question_type"] in TWO_STEP_TYPES
            ),
        },
        "reviews": reviews,
    }


def output_path_for(args: argparse.Namespace) -> Path:
    if getattr(args, "output", None):
        return Path(args.output)
    return DEFAULT_OUTPUT_DIR / f"_semantic_review_{args.lesson_id}.json"


def cmd_prepare(args: argparse.Namespace) -> int:
    lessons_json = Path(args.lessons_json)
    try:
        lesson = load_lesson(lessons_json, args.lesson_id)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2

    review = build_review_template(lesson, lessons_json, getattr(args, "external_reviewers", None))
    out = output_path_for(args)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] semantic review template written: {out}")
    print(f"  questions: {review['summary']['question_count']}")
    print(f"  figures: {review['summary']['figure_question_count']}")
    print(f"  two-step: {review['summary']['two_step_question_count']}")
    return 0


def _normalized(value: Any) -> str:
    return str(value or "").strip().upper()


def required_external_reviewers(review: dict[str, Any]) -> list[str]:
    config = review.get("external_reviewers")
    if not isinstance(config, dict):
        return []
    required = config.get("required")
    if not isinstance(required, list):
        return []
    return [str(item).strip() for item in required if str(item).strip()]


def review_failures(review: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    reviews = _as_list(review.get("reviews"))
    if not reviews:
        return ["reviews is empty"]
    reviewers = required_external_reviewers(review)

    for item in reviews:
        label = f"#{item.get('position', '?')}"
        review_items = item.get("review_items")
        if not isinstance(review_items, dict):
            failures.append(f"{label}: review_items missing")
            continue
        for key in REVIEW_ITEM_KEYS:
            value = _normalized(review_items.get(key))
            if value not in PASS_VALUES:
                failures.append(f"{label}: {key}={review_items.get(key)!r}")
        if not str(item.get("review_note") or "").strip():
            failures.append(f"{label}: review_note is empty")
        if _normalized(item.get("semantic_verdict")) != "OK":
            failures.append(f"{label}: semantic_verdict={item.get('semantic_verdict')!r}")
        external_reviews = item.get("external_reviews")
        if reviewers and not isinstance(external_reviews, dict):
            failures.append(f"{label}: external_reviews missing")
            continue
        for reviewer in reviewers:
            reviewer_result = (external_reviews or {}).get(reviewer)
            if not isinstance(reviewer_result, dict):
                failures.append(f"{label}: external_reviews.{reviewer} missing")
                continue
            if _normalized(reviewer_result.get("verdict")) != "OK":
                failures.append(
                    f"{label}: external_reviews.{reviewer}.verdict="
                    f"{reviewer_result.get('verdict')!r}"
                )
            for key in EXTERNAL_REVIEW_ITEM_KEYS:
                value = _normalized(reviewer_result.get(key))
                if value not in PASS_VALUES:
                    failures.append(
                        f"{label}: external_reviews.{reviewer}.{key}="
                        f"{reviewer_result.get(key)!r}"
                    )
            if not str(reviewer_result.get("review_note") or "").strip():
                failures.append(f"{label}: external_reviews.{reviewer}.review_note is empty")
    return failures


def cmd_verify(args: argparse.Namespace) -> int:
    path = output_path_for(args)
    try:
        review = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"[error] invalid JSON in {path}: {exc}", file=sys.stderr)
        return 2

    failures = review_failures(review)
    if failures:
        print(f"[NG] semantic review incomplete: {len(failures)} item(s)", file=sys.stderr)
        for failure in failures[:20]:
            print(f"  {failure}", file=sys.stderr)
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more", file=sys.stderr)
        return 1

    print(f"[OK] semantic review complete: {path}")
    print(f"  questions: {len(review.get('reviews', []))}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare/verify semantic review checklist")
    sub = parser.add_subparsers(dest="cmd", required=True)

    prepare = sub.add_parser("prepare", help="write a semantic review template")
    prepare.add_argument("--lesson-id", required=True)
    prepare.add_argument("--lessons-json", default=str(DEFAULT_LESSONS_JSON))
    prepare.add_argument("--output")
    prepare.add_argument(
        "--external-reviewer",
        action="append",
        dest="external_reviewers",
        help=(
            "Required external reviewer name. Defaults to codex, claude, gemini "
            "(gemini runs through agy Gemini 3.5 Flash (Medium))."
        ),
    )

    verify = sub.add_parser("verify", help="verify a filled semantic review template")
    verify.add_argument("--lesson-id", required=True)
    verify.add_argument("--output")

    args = parser.parse_args()
    if args.cmd == "prepare":
        return cmd_prepare(args)
    if args.cmd == "verify":
        return cmd_verify(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
