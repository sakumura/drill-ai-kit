#!/usr/bin/env python3
"""Run strict external semantic reviewers for a prepared lesson review sheet."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REVIEWERS = ["codex", "claude", "gemini"]
ANTIGRAVITY_GEMINI_MODEL = "Gemini 3.5 Flash (Medium)"
REVIEW_ITEM_KEYS = [
    "meaning_clear",
    "conditions_sufficient",
    "answer_unique",
    "answer_contract_consistent",
    "step_logic_consistent",
]


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _norm(value: Any) -> str:
    return str(value or "").strip().upper()


def _question_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "position": item.get("position"),
        "question_id": item.get("question_id"),
        "unit_id": item.get("unit_id"),
        "difficulty": item.get("difficulty"),
        "question_type": item.get("question_type"),
        "tier1_purpose": item.get("tier1_purpose"),
        "tier2_purpose": item.get("tier2_purpose"),
        "question_text": item.get("question_text"),
        "answer_contract": item.get("answer_contract"),
        "hints": item.get("hints"),
        "solution_steps": item.get("solution_steps"),
        "is_figure": item.get("is_figure"),
    }


def build_prompt(review: dict[str, Any], reviewer: str) -> str:
    payload = {
        "reviewer": reviewer,
        "lesson_id": review.get("lesson_id"),
        "policy": {
            "role": "semantic_quality_reviewer_not_solver",
            "strict_refusal": (
                "Do not try to be helpful by solving around unclear wording. "
                "If any condition, subject, quantity, unit, step relation, answer contract, "
                "or solution premise is unclear, contradictory, missing, or not uniquely "
                "determined, mark the question NG."
            ),
            "do_not_output_solutions": True,
            "ok_standard": (
                "OK means a careful Japanese fifth-grade learner can understand exactly "
                "what is being asked and the answer contract/solution steps are internally "
                "consistent. Uncertain means NG."
            ),
        },
        "output_schema": {
            "reviewer": reviewer,
            "reviews": [
                {
                    "position": "number",
                    "verdict": "OK or NG",
                    "meaning_clear": "OK or NG",
                    "conditions_sufficient": "OK or NG",
                    "answer_unique": "OK or NG",
                    "answer_contract_consistent": "OK or NG",
                    "step_logic_consistent": "OK, NG, or N/A",
                    "refusal_reason": "required when verdict is NG",
                    "review_note": "brief reason, no worked solution",
                }
            ],
        },
        "questions": [_question_payload(item) for item in _as_list(review.get("reviews"))],
    }
    return (
        "Return JSON only. Do not wrap it in markdown. "
        "Review the lesson questions with strict refusal semantics.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )


def command_for(
    reviewer: str,
    repo_root: Path,
    timeout_sec: int | None = None,
) -> list[str]:
    if reviewer == "claude":
        return [
            "claude",
            "--print",
            "--output-format",
            "text",
            "--tools",
            "",
            "--permission-mode",
            "dontAsk",
        ]
    if reviewer == "gemini":
        return [
            "agy",
            "--model",
            ANTIGRAVITY_GEMINI_MODEL,
            "--print-timeout",
            f"{timeout_sec or 240}s",
            "--print",
            "",
        ]
    if reviewer == "codex":
        return [
            "codex",
            "exec",
            "--cd",
            str(repo_root),
            "--sandbox",
            "workspace-write",
            "--ignore-rules",
            "--ephemeral",
            "--color",
            "never",
        ]
    raise ValueError(f"unsupported reviewer: {reviewer}")


def extract_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    if fenced:
        stripped = fenced.group(1)
    else:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            stripped = stripped[start : end + 1]
    parsed = json.loads(stripped)
    if not isinstance(parsed, dict):
        raise ValueError("reviewer output JSON root must be an object")
    return parsed


def run_reviewer(
    reviewer: str,
    review: dict[str, Any],
    repo_root: Path,
    timeout_sec: int,
) -> dict[str, Any]:
    prompt = build_prompt(review, reviewer)
    command = command_for(reviewer, repo_root, timeout_sec=timeout_sec)
    proc = subprocess.run(
        command,
        input=prompt,
        text=True,
        capture_output=True,
        cwd=repo_root,
        timeout=timeout_sec,
        check=False,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        raise RuntimeError(f"{reviewer} exited {proc.returncode}: {stderr[:500]}")
    return extract_json(proc.stdout)


def _ng_result(reason: str) -> dict[str, str]:
    return {
        "verdict": "NG",
        "meaning_clear": "NG",
        "conditions_sufficient": "NG",
        "answer_unique": "NG",
        "answer_contract_consistent": "NG",
        "step_logic_consistent": "NG",
        "refusal_reason": reason,
        "review_note": reason,
    }


def normalize_reviewer_item(raw: dict[str, Any]) -> dict[str, str]:
    verdict = _norm(raw.get("verdict"))
    normalized = {
        "verdict": "OK" if verdict == "OK" else "NG",
        "refusal_reason": str(raw.get("refusal_reason") or "").strip(),
        "review_note": str(raw.get("review_note") or "").strip(),
    }
    for key in REVIEW_ITEM_KEYS:
        value = _norm(raw.get(key))
        normalized[key] = value if value in {"OK", "NG", "N/A"} else "NG"
    if normalized["verdict"] != "OK" and not normalized["refusal_reason"]:
        normalized["refusal_reason"] = "Reviewer marked the question NG."
    if not normalized["review_note"]:
        normalized["review_note"] = normalized["refusal_reason"] or "Reviewer returned OK."
    return normalized


def apply_reviewer_result(
    review: dict[str, Any],
    reviewer: str,
    result: dict[str, Any],
) -> list[str]:
    warnings: list[str] = []
    by_position = {
        int(item.get("position")): item
        for item in _as_list(review.get("reviews"))
        if item.get("position") is not None
    }
    result_by_position: dict[int, dict[str, Any]] = {}
    for raw in _as_list(result.get("reviews")):
        try:
            position = int(raw.get("position"))
        except (TypeError, ValueError):
            warnings.append(f"{reviewer}: ignored review with invalid position={raw.get('position')!r}")
            continue
        if position in result_by_position:
            warnings.append(f"{reviewer}: duplicate result for position {position}; later item used")
        result_by_position[position] = raw

    for position, item in by_position.items():
        external_reviews = item.setdefault("external_reviews", {})
        if position not in result_by_position:
            reason = f"{reviewer} did not return a review for position {position}."
            external_reviews[reviewer] = _ng_result(reason)
            warnings.append(reason)
            continue
        external_reviews[reviewer] = normalize_reviewer_item(result_by_position[position])
    return warnings


def reviewer_names(args: argparse.Namespace, review: dict[str, Any]) -> list[str]:
    if args.reviewer:
        return args.reviewer
    configured = (review.get("external_reviewers") or {}).get("required")
    if isinstance(configured, list) and configured:
        return [str(item) for item in configured]
    return DEFAULT_REVIEWERS


def cmd_run(args: argparse.Namespace) -> int:
    review_path = Path(args.review)
    review = json.loads(review_path.read_text(encoding="utf-8"))
    reviewers = reviewer_names(args, review)
    prompts_dir = Path(args.write_prompts_dir) if args.write_prompts_dir else None
    if prompts_dir:
        prompts_dir.mkdir(parents=True, exist_ok=True)

    run_log = []
    had_error = False
    for reviewer in reviewers:
        prompt = build_prompt(review, reviewer)
        if prompts_dir:
            (prompts_dir / f"{reviewer}.prompt.txt").write_text(prompt, encoding="utf-8")
        if args.dry_run:
            continue
        try:
            result = run_reviewer(reviewer, review, Path(args.repo_root), args.timeout_sec)
            warnings = apply_reviewer_result(review, reviewer, result)
            ng_positions = [
                int(item.get("position"))
                for item in _as_list(review.get("reviews"))
                if _norm((item.get("external_reviews") or {}).get(reviewer, {}).get("verdict")) != "OK"
            ]
            if ng_positions:
                had_error = True
                run_log.append(
                    {
                        "reviewer": reviewer,
                        "status": "ng",
                        "ng_positions": ng_positions,
                        "warnings": warnings,
                    }
                )
            else:
                run_log.append({"reviewer": reviewer, "status": "ok", "warnings": warnings})
        except Exception as exc:  # noqa: BLE001 - a reviewer failure must become an NG gate result.
            had_error = True
            reason = str(exc)
            for item in _as_list(review.get("reviews")):
                item.setdefault("external_reviews", {})[reviewer] = _ng_result(reason)
            run_log.append({"reviewer": reviewer, "status": "error", "error": reason})

    if not args.dry_run:
        external_config = review.setdefault("external_reviewers", {})
        external_config.setdefault("required", reviewers)
        external_config["last_run_at"] = datetime.now(timezone.utc).isoformat()
        external_config["runs"] = run_log
        review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.dry_run:
        print(f"[OK] prompts prepared for {', '.join(reviewers)}")
        if prompts_dir:
            print(f"  prompt dir: {prompts_dir}")
        return 0
    if had_error:
        print("[NG] one or more reviewers failed or returned NG; review file was updated", file=sys.stderr)
        return 1
    print(f"[OK] external semantic reviewers completed: {', '.join(reviewers)}")
    print(f"  review file: {review_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run codex/claude/Antigravity Gemini semantic review gate"
    )
    parser.add_argument("--review", required=True, help="Path to _semantic_review_<lesson-id>.json")
    parser.add_argument("--reviewer", action="append", help="Reviewer to run. Defaults to required reviewers in the sheet.")
    parser.add_argument("--repo-root", default=str(PROJECT_ROOT))
    parser.add_argument("--timeout-sec", type=int, default=240)
    parser.add_argument("--dry-run", action="store_true", help="Only write prompts; do not call external CLIs.")
    parser.add_argument("--write-prompts-dir", help="Optional directory for reviewer prompt files.")
    args = parser.parse_args()
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
