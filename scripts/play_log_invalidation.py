#!/usr/bin/env python3
"""Utilities for excluding known-bad play-log records from analysis."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RULES_PATH = REPO_ROOT / "data" / "play_log" / "invalidations.json"
DEFAULT_LOG_DIR = REPO_ROOT / "data" / "play_log"


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


@dataclass(frozen=True)
class InvalidationRule:
    id: str
    reason: str
    invalid_from: datetime
    invalid_until: datetime
    event_type: str | None
    payload_is_correct: bool | None
    affected_lesson_ids: frozenset[str]


def load_rules(path: Path = DEFAULT_RULES_PATH) -> list[InvalidationRule]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    rules: list[InvalidationRule] = []
    for item in raw.get("rules", []):
        lesson_ids = item.get("affected_lesson_ids")
        rules.append(
            InvalidationRule(
                id=str(item["id"]),
                reason=str(item.get("reason", "")),
                invalid_from=parse_datetime(str(item["invalid_from"])),
                invalid_until=parse_datetime(str(item["invalid_until"])),
                event_type=item.get("event_type") if isinstance(item.get("event_type"), str) else None,
                payload_is_correct=item.get("payload_is_correct")
                if isinstance(item.get("payload_is_correct"), bool)
                else None,
                affected_lesson_ids=frozenset(str(lesson_id) for lesson_id in lesson_ids)
                if isinstance(lesson_ids, list)
                else frozenset(),
            )
        )
    return rules


def event_time(event: dict[str, Any]) -> datetime | None:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    raw = payload.get("answered_at") or event.get("occurred_at")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return parse_datetime(raw)
    except ValueError:
        return None


def invalidation_reason(event: dict[str, Any], rules: list[InvalidationRule] | None = None) -> str | None:
    active_rules = rules if rules is not None else load_rules()
    if not active_rules:
        return None
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    occurred = event_time(event)
    if occurred is None:
        return None

    for rule in active_rules:
        if rule.event_type is not None and event.get("type") != rule.event_type:
            continue
        if not (rule.invalid_from <= occurred <= rule.invalid_until):
            continue
        if rule.payload_is_correct is not None:
            actual = payload.get("is_correct")
            if isinstance(actual, bool):
                actual_bool = actual
            elif isinstance(actual, (int, float)):
                actual_bool = bool(actual)
            else:
                continue
            if actual_bool != rule.payload_is_correct:
                continue
        lesson_id = payload.get("lesson_id")
        if rule.affected_lesson_ids and lesson_id not in rule.affected_lesson_ids:
            continue
        return rule.id
    return None


def is_invalid_event(event: dict[str, Any], rules: list[InvalidationRule] | None = None) -> bool:
    return invalidation_reason(event, rules) is not None


def iter_jsonl_events(log_dir: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in sorted(log_dir.glob("????-??-??*.jsonl")):
        if path.name.endswith(".tmp"):
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            event["_source_file"] = path.name
            events.append(event)
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description="Report play-log records excluded by invalidation rules")
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES_PATH)
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    args = parser.parse_args()

    rules = load_rules(args.rules)
    events = iter_jsonl_events(args.log_dir)
    invalid: dict[str, int] = {}
    by_lesson: dict[str, int] = {}
    for event in events:
        reason = invalidation_reason(event, rules)
        if reason is None:
            continue
        invalid[reason] = invalid.get(reason, 0) + 1
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        lesson_id = str(payload.get("lesson_id") or "unknown")
        by_lesson[lesson_id] = by_lesson.get(lesson_id, 0) + 1

    print(f"rules={len(rules)} events={len(events)} invalidated={sum(invalid.values())}")
    for rule_id, count in sorted(invalid.items()):
        print(f"{rule_id}: {count}")
    for lesson_id, count in sorted(by_lesson.items()):
        print(f"  {lesson_id}: {count}")


if __name__ == "__main__":
    main()
