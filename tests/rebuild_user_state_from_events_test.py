import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from rebuild_user_state_from_events import rebuild


def _answer_event(occurred_at: str) -> dict:
    return {
        "type": "answer",
        "session_id": "s1",
        "event_id": "e-answer",
        "occurred_at": occurred_at,
        "payload": {
            "question_id": "q1",
            "lesson_id": "lesson1",
            "user_answer": "60",
            "is_correct": True,
            "answered_at": occurred_at,
        },
    }


def _sketch_event(occurred_at: str) -> dict:
    return {
        "type": "sketch",
        "session_id": "s1",
        "event_id": "e-sketch",
        "occurred_at": occurred_at,
        "payload": {
            "question_id": "q1",
            "lesson_id": "lesson1",
            "stroke_count": 8,
            "duration_sec": 30,
            "ai_category": "ok",
            "ai_comment": "せんぶんずがかけてるね",
        },
    }


def test_sketch_event_does_not_touch_state_or_updated_at():
    # 回帰: 175行付近の `if occurred_at:` は全 type に updated_at を適用していたため、
    # sketch だけの日も updated_at が進んでいた（plan-reviewer 指摘）。
    answer_at = "2026-06-10T10:00:00.000Z"
    sketch_at = "2026-06-11T10:00:00.000Z"
    state = rebuild([_answer_event(answer_at), _sketch_event(sketch_at)], "s1")

    assert state["updated_at"] == answer_at
    assert len(state["answer_history"]) == 1


def test_sketch_only_events_leave_state_empty():
    state = rebuild([_sketch_event("2026-06-11T10:00:00.000Z")], "s1")

    assert state["updated_at"] == ""
    assert state["answer_history"] == []
