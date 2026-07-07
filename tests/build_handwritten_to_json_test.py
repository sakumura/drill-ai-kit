import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_handwritten_to_json import build_lesson_entry, merge_existing_lesson


def test_build_lesson_entry_preserves_blocks_and_remediation():
    lesson = build_lesson_entry(
        {
            "lesson_id": "lesson-m-test",
            "subject": "math",
            "title": "test",
            "questions": [
                {
                    "position": 1,
                    "unit_id": "kakudo",
                    "question_text": "角度",
                    "answer": "60",
                    "hints": ["60", "120", "30"],
                    "solution_steps": ["一直線は180度"],
                    "common_mistakes": [],
                    "remediation": {
                        "same_skill_question_id": "q-lesson-m-test-02",
                        "transfer_question_id": "q-lesson-m-test-03",
                        "micro_explanation": "外角と内角を分ける",
                        "pattern_id": "kakudo",
                    },
                }
            ],
            "blocks": [
                {
                    "id": "block-1",
                    "title": "角度チェック",
                    "kind": "review",
                    "question_ids": ["q-lesson-m-test-01"],
                }
            ],
        },
        "2026-05-09T00:00:00+09:00",
    )

    assert lesson["blocks"][0]["id"] == "block-1"
    assert lesson["questions"][0]["remediation"]["pattern_id"] == "kakudo"


def test_merge_existing_lesson_keeps_existing_blocks_when_source_omits_them():
    existing = {
        "id": "lesson-m-test",
        "questions": [{"id": "q-lesson-m-test-01", "position": 1, "answer": "old"}],
        "blocks": [{"id": "existing-block", "title": "既存", "kind": "main", "question_ids": ["q-lesson-m-test-01"]}],
    }
    generated = build_lesson_entry(
        {
            "lesson_id": "lesson-m-test",
            "subject": "math",
            "questions": [{"position": 2, "question_text": "new", "answer": "2"}],
        },
        "2026-05-09T00:00:00+09:00",
    )

    merged = merge_existing_lesson(existing, generated, source_has_blocks=False)

    assert [q["id"] for q in merged["questions"]] == ["q-lesson-m-test-01", "q-lesson-m-test-02"]
    assert merged["blocks"] == existing["blocks"]


def test_merge_existing_lesson_replaces_blocks_when_source_has_them():
    existing = {
        "id": "lesson-m-test",
        "questions": [],
        "blocks": [{"id": "existing-block", "title": "既存", "kind": "main", "question_ids": []}],
    }
    generated = build_lesson_entry(
        {
            "lesson_id": "lesson-m-test",
            "subject": "math",
            "questions": [],
            "blocks": [{"id": "new-block", "title": "新規", "kind": "review", "question_ids": []}],
        },
        "2026-05-09T00:00:00+09:00",
    )

    merged = merge_existing_lesson(existing, generated, source_has_blocks=True)

    assert merged["blocks"] == generated["blocks"]


def test_build_lesson_entry_copies_sketch_gate_fields_conditionally():
    base_q = {
        "position": 1,
        "unit_id": "sk-zukei",
        "question_text": "図",
        "answer": "180",
        "hints": ["180", "360", "90"],
        "solution_steps": ["内角の和"],
        "common_mistakes": [],
    }
    with_gate = build_lesson_entry(
        {
            "lesson_id": "lesson-m-test",
            "subject": "math",
            "questions": [{**base_q, "sketch_gate": True, "sketch_hint": "線分図"}],
        },
        "2026-06-11T00:00:00+09:00",
    )
    assert with_gate["questions"][0]["sketch_gate"] is True
    assert with_gate["questions"][0]["sketch_hint"] == "線分図"

    without_gate = build_lesson_entry(
        {
            "lesson_id": "lesson-m-test",
            "subject": "math",
            "questions": [dict(base_q)],
        },
        "2026-06-11T00:00:00+09:00",
    )
    assert "sketch_gate" not in without_gate["questions"][0]
    assert "sketch_hint" not in without_gate["questions"][0]
