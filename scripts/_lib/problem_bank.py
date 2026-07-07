#!/usr/bin/env python3
"""Shared helpers for problem-bank scripts."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PROBLEM_BANK_DIR = PROJECT_ROOT / "data" / "problem-bank"
QUESTIONS_PATH = PROBLEM_BANK_DIR / "questions.jsonl"
INDEX_PATH = PROBLEM_BANK_DIR / "_index.json"
USAGE_PATH = PROBLEM_BANK_DIR / "usage.jsonl"
JST = timezone(timedelta(hours=9))

VISUAL_REVIEW_STATUSES = {"visual_pass", "visual_warn", "visual_fail"}
REUSABLE_REVIEW_STATUSES = {"semantic_pass", "reviewed_pass"}
NON_REUSABLE_REVIEW_STATUSES = {"unreviewed", "auto_rejected", "semantic_fail", "reviewed_fail"}
TWO_STEP_TYPES = {"two_tier", "evidence_first", "slot_two_tier"}


def now_iso() -> str:
    return datetime.now(JST).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_entries(path: Path = QUESTIONS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSONL at {path}:{line_no}: {exc}") from exc
    return entries


def write_entries(entries: list[dict[str, Any]], path: Path = QUESTIONS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(canonical_json(entry) + "\n" for entry in entries), encoding="utf-8")


def load_index(path: Path = INDEX_PATH) -> dict[str, Any]:
    return load_json(path) if path.exists() else {}


def load_usage(path: Path = USAGE_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def usage_identity(record: dict[str, Any]) -> tuple[str, str, str, str]:
    position = record.get("position")
    position_key = "" if position is None else str(position)
    return (
        str(record.get("lesson_id") or ""),
        str(record.get("bank_id") or ""),
        position_key,
        str(record.get("content_hash") or ""),
    )


def append_usage(records: list[dict[str, Any]], path: Path = USAGE_PATH) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {usage_identity(record) for record in load_usage(path)}
    written = 0
    with path.open("a", encoding="utf-8") as f:
        for record in records:
            key = usage_identity(record)
            if key in existing:
                continue
            f.write(canonical_json(record) + "\n")
            existing.add(key)
            written += 1
    return written


def ensure_quality(entry: dict[str, Any]) -> dict[str, Any]:
    quality = entry.setdefault("quality", {})
    quality.setdefault("pedagogy_score", None)
    quality.setdefault("solvability_score", None)
    quality.setdefault("distractor_score", None)
    quality.setdefault("render_score", None)
    quality.setdefault("reuse_grade", None)
    quality.setdefault("review_status", "unreviewed")
    quality.setdefault("reviewed_at", None)
    quality.setdefault("review_note", None)
    return quality


def review_status(entry: dict[str, Any]) -> str:
    return str((entry.get("quality") or {}).get("review_status") or "unreviewed")


def is_figure_entry(entry: dict[str, Any]) -> bool:
    return bool(entry.get("is_figure") or (entry.get("question") or {}).get("figure_svg"))


def is_selection_candidate(entry: dict[str, Any]) -> bool:
    quality = ensure_quality(entry)
    if entry.get("validation_status") != "pass":
        return False
    if quality.get("reuse_grade") not in {4, 5}:
        return False
    if review_status(entry) not in REUSABLE_REVIEW_STATUSES:
        return False
    if is_figure_entry(entry) and entry.get("svg_status") != "visual_pass":
        return False
    return True


def update_inventory_summary(index: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    index["total_questions"] = len(entries)
    index["subject_counts"] = dict(sorted(Counter(str(e.get("subject")) for e in entries).items()))
    index["difficulty_counts"] = dict(sorted(Counter(str(e.get("difficulty")) for e in entries if e.get("difficulty")).items()))
    index["svg_status_counts"] = dict(sorted(Counter(str(e.get("svg_status")) for e in entries).items()))
    unit_counts = Counter(str(e.get("unit_id")) for e in entries if e.get("unit_id"))
    index["total_units"] = len(unit_counts)
    index["top_units"] = [{"unit_id": unit, "count": count} for unit, count in unit_counts.most_common(25)]
    return index


def update_validation_summary(index: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = Counter(str(e.get("validation_status") or "not_evaluated") for e in entries)
    index["validation_summary"] = {
        "validation_pass": status_counts.get("pass", 0),
        "validation_fail": status_counts.get("fail", 0),
        "validation_error": status_counts.get("error", 0),
        "validation_not_evaluated": status_counts.get("not_evaluated", 0),
        "r12_fail_count": rule_fail_count(entries, "R12"),
        "r18_fail_count": rule_fail_count(entries, "R18"),
        "r22_fail_count": rule_fail_count(entries, "R22"),
    }
    return index


def update_quality_summary(index: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    review_counts = Counter(review_status(e) for e in entries)
    grade_counts = Counter(str((e.get("quality") or {}).get("reuse_grade")) for e in entries)
    index["quality_summary"] = {
        "review_status_counts": dict(sorted(review_counts.items())),
        "reuse_grade_distribution": dict(sorted(grade_counts.items())),
        "reviewed_total": sum(count for status, count in review_counts.items() if status not in {"unreviewed"}),
        "reusable_total": sum(1 for e in entries if is_selection_candidate(e)),
        "visual_pass_figure_count": sum(1 for e in entries if is_figure_entry(e) and e.get("svg_status") == "visual_pass"),
    }
    return index


def update_all_summaries(index: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    update_inventory_summary(index, entries)
    update_validation_summary(index, entries)
    update_quality_summary(index, entries)
    index["updated_at"] = now_iso()
    return index


def rule_fail_count(entries: list[dict[str, Any]], rule: str) -> int:
    return sum(
        1
        for entry in entries
        if any(str(v.get("rule")) == rule for v in entry.get("validation_rules") or [])
    )


def normalize_rule(rule: Any) -> str:
    text = str(rule)
    return text if text.startswith("R") else f"R{text}"


def usage_by_bank_id(usage: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in usage:
        bank_id = record.get("bank_id")
        if isinstance(bank_id, str) and bank_id:
            out[bank_id].append(record)
    return out


def parse_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def cooldown_blocked(entry: dict[str, Any], target_date: date, usage: list[dict[str, Any]], default_days: int = 14) -> bool:
    reuse = entry.get("reuse") or {}
    cooldown_until = parse_date(reuse.get("cooldown_until"))
    if cooldown_until and cooldown_until >= target_date:
        return True
    dates = [parse_date(record.get("used_at")) for record in usage if record.get("bank_id") == entry.get("bank_id")]
    dates = [d for d in dates if d is not None]
    if not dates:
        return False
    return (target_date - max(dates)).days < default_days
