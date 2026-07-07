#!/usr/bin/env python3
"""Dry-run bank-first lesson selection from quality-assured problem-bank entries."""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import (  # noqa: E402
    QUESTIONS_PATH,
    USAGE_PATH,
    append_usage,
    cooldown_blocked,
    is_figure_entry,
    is_selection_candidate,
    load_entries,
    load_json,
    load_usage,
    now_iso,
)


BLOCKS_NORMAL = [
    ("warmup", 4),
    ("core", 8),
    ("weakness_spiral", 4),
    ("exam_transfer", 2),
    ("confidence_recovery", 2),
]
BLOCKS_SHORT = [
    ("warmup", 2),
    ("core", 4),
    ("weakness_spiral", 2),
    ("exam_transfer", 1),
    ("confidence_recovery", 1),
]
DIFFICULTY_CYCLE = ["d2", "d3", "d3", "d4", "d4", "d4", "d5"]
PLAN_LINE_RE = re.compile(r"^[\s>*#\-\d.)・]*([^#\n]{3,160})")


def weakness_patterns(path: Path, subject: str, limit: int = 10) -> list[str]:
    if not path.exists():
        return []
    payload = load_json(path)
    queue = payload.get("priority_queue") if isinstance(payload, dict) else []
    patterns = [
        item.get("pattern_id")
        for item in queue
        if isinstance(item, dict) and item.get("subject") == subject and item.get("pattern_id")
    ]
    return patterns[:limit]


def learning_signal_map(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    payload = load_json(path)
    rows = payload.get("rows") if isinstance(payload, dict) else []
    return {row["pattern_id"]: row for row in rows if isinstance(row, dict) and row.get("pattern_id")}


def known_patterns(entries: list[dict[str, Any]], weakness: list[str]) -> set[str]:
    patterns = {pattern for pattern in weakness if pattern}
    for entry in entries:
        for key in ("unit_id", "pattern_id"):
            value = entry.get(key)
            if isinstance(value, str) and value:
                patterns.add(value)
    return patterns


def extract_plan_units(text: str, known: set[str]) -> list[str]:
    positions: list[tuple[int, str]] = []
    for unit in sorted(known, key=len, reverse=True):
        match = re.search(rf"(?<![A-Za-z0-9_-]){re.escape(unit)}(?![A-Za-z0-9_-])", text) if unit else None
        if match:
            positions.append((match.start(), unit))
    return [unit for _, unit in sorted(positions)]


def extract_plan_themes(text: str, limit: int = 12) -> list[str]:
    themes: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if not any(marker in line for marker in ("単元", "重点", "優先", "弱点", "theme", "unit", "pattern", "training", "plan")) and not line.startswith(("#", "-", "*", "・")):
            continue
        match = PLAN_LINE_RE.match(line)
        if not match:
            continue
        theme = match.group(1).strip()
        if theme and theme not in themes:
            themes.append(theme[:160])
        if len(themes) >= limit:
            break
    return themes


def load_plan_context(plan_paths: dict[str, Path | None], known: set[str]) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    unit_priority: list[str] = []
    theme_by_unit: dict[str, dict[str, str]] = {}
    all_themes: list[str] = []

    for kind, path in plan_paths.items():
        source = {
            "kind": kind,
            "path": str(path) if path else None,
            "exists": bool(path and path.exists()),
            "extracted_units": [],
            "extracted_themes": [],
        }
        if path and path.exists():
            text = path.read_text(encoding="utf-8")
            source["extracted_units"] = extract_plan_units(text, known)
            source["extracted_themes"] = extract_plan_themes(text)
            for unit in source["extracted_units"]:
                if unit not in unit_priority:
                    unit_priority.append(unit)
                theme_by_unit.setdefault(
                    unit,
                    {
                        "source_kind": kind,
                        "source_path": str(path),
                        "theme": (source["extracted_themes"] or [None])[0],
                    },
                )
            for theme in source["extracted_themes"]:
                if theme not in all_themes:
                    all_themes.append(theme)
        sources.append(source)

    return {
        "sources": sources,
        "unit_priority": unit_priority,
        "theme_by_unit": theme_by_unit,
        "themes": all_themes[:20],
    }


def block_plan_for(target_date: date) -> list[tuple[str, int]]:
    return BLOCKS_SHORT if target_date.weekday() in {1, 4} else BLOCKS_NORMAL


def merged_pattern_priority(plan_units: list[str], weakness: list[str]) -> list[str]:
    merged: list[str] = []
    for pattern in [*plan_units, *weakness]:
        if pattern and pattern not in merged:
            merged.append(pattern)
    return merged


def build_blueprint(
    target_date: date,
    subject: str,
    patterns: list[str],
    signal_map: dict[str, dict[str, Any]],
    total_slots: int | None = None,
    plan_context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    blocks = block_plan_for(target_date)
    if total_slots:
        blocks = [("core", total_slots)]
    if not patterns:
        patterns = ["mixed"]
    plan_context = plan_context or {}
    theme_by_unit = plan_context.get("theme_by_unit") or {}
    blueprint: list[dict[str, Any]] = []
    position = 1
    for block_type, count in blocks:
        for block_position in range(1, count + 1):
            pattern = patterns[(position - 1) % len(patterns)]
            signal = signal_map.get(pattern) or {}
            unit_plan = theme_by_unit.get(pattern) or {}
            blueprint.append(
                {
                    "position": position,
                    "block_type": block_type,
                    "block_position": block_position,
                    "subject": subject,
                    "unit_id": pattern,
                    "pattern_id": pattern,
                    "difficulty": DIFFICULTY_CYCLE[(position - 1) % len(DIFFICULTY_CYCLE)],
                    "question_type": None,
                    "learning_signal": signal.get("learning_signal"),
                    "recommended_intervention": signal.get("recommended_intervention"),
                    "plan_source_kind": unit_plan.get("source_kind"),
                    "plan_source_path": unit_plan.get("source_path"),
                    "plan_theme": unit_plan.get("theme"),
                }
            )
            position += 1
    return blueprint


def match_score(entry: dict[str, Any], slot: dict[str, Any]) -> int:
    score = 0
    if entry.get("pattern_id") == slot.get("pattern_id") or entry.get("unit_id") == slot.get("unit_id"):
        score += 100
    if entry.get("difficulty") == slot.get("difficulty"):
        score += 40
    if entry.get("question_type") == slot.get("question_type") and slot.get("question_type"):
        score += 20
    grade = (entry.get("quality") or {}).get("reuse_grade")
    if grade:
        score += 10 * int(grade)
    return score


def rejection_reason(entry: dict[str, Any], slot: dict[str, Any], target_date: date, usage: list[dict[str, Any]]) -> str | None:
    if entry.get("subject") != slot.get("subject"):
        return "subject_mismatch"
    if not is_selection_candidate(entry):
        return "not_quality_assured"
    if is_figure_entry(entry) and entry.get("svg_status") != "visual_pass":
        return "figure_not_visual_pass"
    if cooldown_blocked(entry, target_date, usage):
        return "cooldown"
    if slot.get("difficulty") and entry.get("difficulty") != slot.get("difficulty"):
        return "difficulty_mismatch"
    if entry.get("pattern_id") != slot.get("pattern_id") and entry.get("unit_id") != slot.get("unit_id"):
        return "pattern_mismatch"
    return None


def select_from_bank(entries: list[dict[str, Any]], blueprint: list[dict[str, Any]], target_date: date, usage: list[dict[str, Any]]) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    used_hashes: set[str] = set()
    rejection_counts: Counter[str] = Counter()
    candidate_counts: dict[int, int] = {}

    for slot in blueprint:
        candidates = []
        for entry in entries:
            reason = rejection_reason(entry, slot, target_date, usage)
            if reason:
                rejection_counts[reason] += 1
                continue
            if entry.get("content_hash") in used_hashes:
                rejection_counts["duplicate_content_in_lesson"] += 1
                continue
            candidates.append(entry)
        candidate_counts[slot["position"]] = len(candidates)
        if not candidates:
            missing.append({**slot, "source": "new", "reason": "no reusable bank candidate"})
            continue
        best = max(candidates, key=lambda entry: match_score(entry, slot))
        used_hashes.add(str(best.get("content_hash")))
        selected.append(
            {
                **slot,
                "source": f"bank:{best['bank_id']}",
                "bank_id": best["bank_id"],
                "content_hash": best.get("content_hash"),
                "reason": "reuse_grade>=4 + validation pass + review pass + SVG gate pass",
            }
        )

    return {
        "selected": selected,
        "missing_slots": missing,
        "candidate_counts": candidate_counts,
        "rejection_reasons": dict(sorted(rejection_counts.items())),
        "summary": {
            "total_slots": len(blueprint),
            "bank_selected": len(selected),
            "new_required": len(missing),
            "svg_new_required": sum(1 for slot in missing if "kakudo" in str(slot.get("unit_id")) or "zukei" in str(slot.get("unit_id")) or "tamen" in str(slot.get("unit_id"))),
        },
    }


def usage_records(report: dict[str, Any], lesson_id: str, target_date: date) -> list[dict[str, Any]]:
    records = []
    for item in report.get("selected") or []:
        records.append(
            {
                "used_at": target_date.isoformat(),
                "recorded_at": now_iso(),
                "lesson_id": lesson_id,
                "bank_id": item["bank_id"],
                "position": item["position"],
                "source": item["source"],
                "content_hash": item.get("content_hash"),
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run bank-first lesson selection")
    parser.add_argument("--date", required=True)
    parser.add_argument("--subject", choices=["math", "japanese"], required=True)
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--usage", type=Path, default=USAGE_PATH)
    parser.add_argument("--weakness-profile", type=Path, default=Path("data/weakness_profile.json"))
    parser.add_argument("--learning-signal-profile", type=Path, default=Path("data/learning_signal_profile.json"))
    parser.add_argument("--training-plan", type=Path)
    parser.add_argument("--analysis", type=Path)
    parser.add_argument("--grade5-training-plan", type=Path, default=Path("data/textbooks/curriculum/grade5-training-plan.md"))
    parser.add_argument("--grade5-analysis", type=Path, default=Path("data/textbooks/curriculum/grade5-analysis.md"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--slots", type=int)
    parser.add_argument("--record-usage", action="store_true")
    args = parser.parse_args()

    target_date = date.fromisoformat(args.date)
    entries = load_entries(args.questions)
    usage = load_usage(args.usage)
    weakness = weakness_patterns(args.weakness_profile, args.subject)
    signal_map = learning_signal_map(args.learning_signal_profile)
    plan_context = load_plan_context(
        {
            "training_plan": args.training_plan,
            "analysis": args.analysis,
            "grade5_training_plan": args.grade5_training_plan,
            "grade5_analysis": args.grade5_analysis,
        },
        known_patterns(entries, weakness),
    )
    patterns = merged_pattern_priority(plan_context["unit_priority"], weakness)
    blueprint = build_blueprint(target_date, args.subject, patterns, signal_map, args.slots, plan_context)
    result = select_from_bank(entries, blueprint, target_date, usage)
    report = {
        "date": args.date,
        "subject": args.subject,
        "generated_at": now_iso(),
        "dry_run": not args.record_usage,
        "plan_context": plan_context,
        "blueprint": blueprint,
        **result,
    }
    if args.record_usage:
        append_usage(usage_records(report, f"lesson-{'m' if args.subject == 'math' else 'j'}-{target_date.strftime('%m%d')}", target_date), args.usage)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        "[problem-bank] selection dry-run "
        f"bank={report['summary']['bank_selected']} "
        f"new={report['summary']['new_required']} "
        f"svg_new={report['summary']['svg_new_required']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
