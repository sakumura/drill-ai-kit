import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import scripts.prepare_semantic_review as semantic_review


def write_lessons(path, lesson):
    path.write_text(json.dumps([lesson], ensure_ascii=False), encoding="utf-8")


def test_prepare_template_records_two_tier_step_contract(tmp_path):
    lessons_path = tmp_path / "lessons.json"
    output_path = tmp_path / "review.json"
    write_lessons(
        lessons_path,
        {
            "id": "lesson-test",
            "questions": [
                {
                    "id": "q1",
                    "position": 1,
                    "question_type": "two_tier",
                    "tier1_purpose": "diagram",
                    "tier2_purpose": "answer",
                    "question_text": "図の見方を選び、答えを選ぶ。",
                    "answer": "28.5",
                    "hints": ["円から正方形を引く", "足す", "円だけ", "28.5", "78.5", "50"],
                    "solution_steps": ["円の面積を出す。", "正方形を引く。"],
                    "figure_svg": "<svg><circle cx='1' cy='1' r='1'/></svg>",
                }
            ],
        },
    )

    result = semantic_review.cmd_prepare(
        argparse.Namespace(
            lesson_id="lesson-test",
            lessons_json=str(lessons_path),
            output=str(output_path),
        )
    )

    assert result == 0
    review = json.loads(output_path.read_text(encoding="utf-8"))
    item = review["reviews"][0]
    assert item["answer_contract"]["step1_expected"] == "円から正方形を引く"
    assert item["answer_contract"]["step2_expected"] == "28.5"
    assert item["review_items"]["figure_matches_question"] == "PENDING"
    assert item["review_items"]["step1_step2_are_distinct"] == "PENDING"
    assert review["external_reviewers"]["required"] == ["codex", "claude", "gemini"]
    assert sorted(item["external_reviews"]) == ["claude", "codex", "gemini"]
    assert review["summary"]["question_count"] == 1
    assert review["summary"]["figure_question_count"] == 1
    assert review["summary"]["two_step_question_count"] == 1


def test_prepare_template_records_slot_correct_value(tmp_path):
    lessons_path = tmp_path / "lessons.json"
    output_path = tmp_path / "review.json"
    write_lessons(
        lessons_path,
        {
            "id": "lesson-test",
            "questions": [
                {
                    "id": "q1",
                    "position": 1,
                    "question_type": "slot_number",
                    "question_text": "半径を入力する。",
                    "answer": "5",
                    "hints": [],
                    "slot_config": {"type": "number", "digits": 1, "correct_value": "5"},
                    "solution_steps": ["10 ÷ 2 = 5。"],
                }
            ],
        },
    )

    result = semantic_review.cmd_prepare(
        argparse.Namespace(
            lesson_id="lesson-test",
            lessons_json=str(lessons_path),
            output=str(output_path),
        )
    )

    assert result == 0
    review = json.loads(output_path.read_text(encoding="utf-8"))
    item = review["reviews"][0]
    assert item["answer_contract"]["slot_expected"] == "5"
    assert item["review_items"]["figure_matches_question"] == "N/A"
    assert item["review_items"]["step1_step2_are_distinct"] == "N/A"


def test_verify_rejects_pending_or_empty_review_items(tmp_path):
    output_path = tmp_path / "review.json"
    output_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "reviews": [
                    {
                        "position": 1,
                        "review_items": {
                            "question_text_ok": "OK",
                            "figure_matches_question": "N/A",
                            "choices_are_meaningful": "PENDING",
                            "correct_answer_matches_solution": "OK",
                            "step1_step2_are_distinct": "N/A",
                            "student_age_fit": "OK",
                        },
                        "review_note": "",
                        "semantic_verdict": "PENDING",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = semantic_review.cmd_verify(
        argparse.Namespace(lesson_id="lesson-test", output=str(output_path))
    )

    assert result == 1


def test_verify_accepts_filled_review(tmp_path):
    output_path = tmp_path / "review.json"
    output_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "reviews": [
                    {
                        "position": 1,
                        "review_items": {
                            "question_text_ok": "OK",
                            "figure_matches_question": "N/A",
                            "choices_are_meaningful": "OK",
                            "correct_answer_matches_solution": "OK",
                            "step1_step2_are_distinct": "N/A",
                            "student_age_fit": "OK",
                        },
                        "review_note": "自分で解いて答えと解説が一致することを確認。",
                        "semantic_verdict": "OK",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = semantic_review.cmd_verify(
        argparse.Namespace(lesson_id="lesson-test", output=str(output_path))
    )

    assert result == 0


def test_verify_rejects_pending_external_reviewer(tmp_path):
    output_path = tmp_path / "review.json"
    output_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "external_reviewers": {"required": ["codex"]},
                "reviews": [
                    {
                        "position": 1,
                        "review_items": {
                            "question_text_ok": "OK",
                            "figure_matches_question": "N/A",
                            "choices_are_meaningful": "OK",
                            "correct_answer_matches_solution": "OK",
                            "step1_step2_are_distinct": "N/A",
                            "student_age_fit": "OK",
                        },
                        "external_reviews": {
                            "codex": {
                                "verdict": "PENDING",
                                "meaning_clear": "PENDING",
                                "conditions_sufficient": "PENDING",
                                "answer_unique": "PENDING",
                                "answer_contract_consistent": "PENDING",
                                "step_logic_consistent": "N/A",
                                "refusal_reason": "",
                                "review_note": "",
                            }
                        },
                        "review_note": "自分で確認済み。",
                        "semantic_verdict": "OK",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = semantic_review.cmd_verify(
        argparse.Namespace(lesson_id="lesson-test", output=str(output_path))
    )

    assert result == 1


def test_verify_accepts_filled_external_review(tmp_path):
    output_path = tmp_path / "review.json"
    output_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "external_reviewers": {"required": ["codex"]},
                "reviews": [
                    {
                        "position": 1,
                        "review_items": {
                            "question_text_ok": "OK",
                            "figure_matches_question": "N/A",
                            "choices_are_meaningful": "OK",
                            "correct_answer_matches_solution": "OK",
                            "step1_step2_are_distinct": "N/A",
                            "student_age_fit": "OK",
                        },
                        "external_reviews": {
                            "codex": {
                                "verdict": "OK",
                                "meaning_clear": "OK",
                                "conditions_sufficient": "OK",
                                "answer_unique": "OK",
                                "answer_contract_consistent": "OK",
                                "step_logic_consistent": "N/A",
                                "refusal_reason": "",
                                "review_note": "曖昧な条件はなく、問題として成立。",
                            }
                        },
                        "review_note": "自分で確認済み。",
                        "semantic_verdict": "OK",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = semantic_review.cmd_verify(
        argparse.Namespace(lesson_id="lesson-test", output=str(output_path))
    )

    assert result == 0
