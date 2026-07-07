#!/usr/bin/env python3
"""
Rebuild user_state/latest.json from pulled R2 event logs.

Usage:
    python3 scripts/rebuild_user_state_from_events.py --session-id <session>
    python3 scripts/rebuild_user_state_from_events.py --session-id <session> --output /tmp/latest.json

Input defaults to data/play_log/*.jsonl produced by pull_r2_play_log.py.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from play_log_invalidation import invalidation_reason, load_rules
except ModuleNotFoundError:
    from scripts.play_log_invalidation import invalidation_reason, load_rules

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "play_log"


def empty_state(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "answer_history": [],
        "lesson_completions": [],
        "updated_at": "",
    }


def iter_events(input_dir: Path, session_id: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in sorted(input_dir.glob("*.jsonl")):
        if path.name.endswith(".tmp"):
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("session_id") == session_id:
                events.append(event)
    return sorted(events, key=lambda e: str(e.get("occurred_at", "")))


def merge_answer(state: dict[str, Any], payload: dict[str, Any], occurred_at: str) -> None:
    question_id = payload.get("question_id")
    if not isinstance(question_id, str) or not question_id:
        return
    answered_at = payload.get("answered_at") if isinstance(payload.get("answered_at"), str) else occurred_at
    step = payload.get("step") if isinstance(payload.get("step"), int) else None
    key = (question_id, step or 1, answered_at)
    for existing in state["answer_history"]:
        if (existing.get("question_id"), existing.get("step", 1), existing.get("answered_at")) == key:
            return
    entry = {
        "question_id": question_id,
        "lesson_id": payload.get("lesson_id") if isinstance(payload.get("lesson_id"), str) else "",
        "user_answer": payload.get("user_answer") if isinstance(payload.get("user_answer"), str) else "",
        "is_correct": payload.get("is_correct") is True,
        "time_spent_sec": payload.get("time_spent_sec") if isinstance(payload.get("time_spent_sec"), (int, float)) else 0,
        "hints_used": payload.get("hints_used") if isinstance(payload.get("hints_used"), int) else 0,
        "answered_at": answered_at,
    }
    if step is not None:
        entry["step"] = step
    if isinstance(payload.get("step_label"), str):
        entry["step_label"] = payload["step_label"]
    state["answer_history"].append(entry)


def merge_lesson_complete(state: dict[str, Any], payload: dict[str, Any], occurred_at: str) -> None:
    lesson_id = payload.get("lesson_id")
    if not isinstance(lesson_id, str) or not lesson_id:
        return
    completed_at = payload.get("completed_at") if isinstance(payload.get("completed_at"), str) else occurred_at
    entry = {
        "lesson_id": lesson_id,
        "completed_at": completed_at,
    }
    for field in ["lesson_title", "subject"]:
        if isinstance(payload.get(field), str):
            entry[field] = payload[field]
    for field in [
        "question_count",
        "correct_count",
        "first_correct_count",
        "final_correct_count",
        "rescued_count",
        "needs_review_count",
        "attempts",
    ]:
        if isinstance(payload.get(field), (int, float)):
            entry[field] = payload[field]
    completions = {item["lesson_id"]: item for item in state["lesson_completions"] if item.get("lesson_id")}
    existing = completions.get(lesson_id)
    if not existing or str(existing.get("completed_at", "")) < completed_at:
        completions[lesson_id] = entry
    state["lesson_completions"] = sorted(completions.values(), key=lambda item: item.get("completed_at", ""))


def rebuild(events: list[dict[str, Any]], session_id: str) -> dict[str, Any]:
    state = empty_state(session_id)
    invalidation_rules = load_rules()
    invalidated = 0
    invalidated_by_reason: dict[str, int] = {}
    for event in events:
        reason = invalidation_reason(event, invalidation_rules)
        if reason:
            invalidated += 1
            invalidated_by_reason[reason] = invalidated_by_reason.get(reason, 0) + 1
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        occurred_at = str(event.get("occurred_at", ""))
        event_type = event.get("type")
        if event_type == "sketch":
            # sketch は advisory ログ専用。Worker 側 updateLatestState と同じく
            # state に一切反映しない（updated_at も進めない）
            continue
        if event_type == "answer":
            merge_answer(state, payload, occurred_at)
        elif event_type == "lesson_complete":
            merge_lesson_complete(state, payload, occurred_at)
        if occurred_at:
            state["updated_at"] = occurred_at
    state["answer_history"] = sorted(state["answer_history"], key=lambda item: item.get("answered_at", ""))
    if invalidated:
        state["invalidated_event_count"] = invalidated
        state["invalidated_event_reasons"] = invalidated_by_reason
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild latest user state from pulled event logs")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--input-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    events = iter_events(args.input_dir, args.session_id)
    state = rebuild(events, args.session_id)
    output = args.output or args.input_dir / f"user_state-{args.session_id}-latest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rebuilt {len(events)} events -> {output}")


if __name__ == "__main__":
    main()
