import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import scripts.meta_review_gate as meta_review_gate


def test_prepare_template_includes_process_review_context(monkeypatch, tmp_path):
    monkeypatch.setattr(meta_review_gate, "TMP_DIR", tmp_path)
    monkeypatch.setattr(
        meta_review_gate,
        "fetch_questions",
        lambda lesson_id: [
            {
                "position": 1,
                "unit_id": "math-unit",
                "difficulty": "d4",
                "question_text": "外半径6cm、内半径4cmのドーナツ型おうぎ形を考える。",
                "answer": "15.7",
                "hints": ["外側から内側を引く", "外側だけ求める", "足す"],
                "question_type": "two_tier",
                "tier1_label": "解き方を選ぼう",
                "tier1_purpose": "strategy",
                "tier2_label": "式を選ぼう",
                "tier2_purpose": "formula",
                "solution_steps": ["外側の1/4円を求める", "内側の1/4円を引く"],
                "figure_svg": "",
            }
        ],
    )

    result = meta_review_gate.cmd_prepare(argparse.Namespace(lesson_id="lesson-test"))

    assert result == 0
    review = json.loads((tmp_path / "_review_lesson-test.json").read_text(encoding="utf-8"))
    item = review["reviews"][0]
    assert item["question_type"] == "two_tier"
    assert item["tier1_label"] == "解き方を選ぼう"
    assert item["tier1_purpose"] == "strategy"
    assert item["tier2_label"] == "式を選ぼう"
    assert item["tier2_purpose"] == "formula"
    assert item["solution_steps"] == ["外側の1/4円を求める", "内側の1/4円を引く"]


def test_verify_strict_process_gate_rejects_missing_process_review(monkeypatch, tmp_path):
    monkeypatch.setattr(meta_review_gate, "TMP_DIR", tmp_path)
    review_path = tmp_path / "_review_lesson-test.json"
    review_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "reviews": [
                    {
                        "position": 1,
                        "unit_id": "math-unit",
                        "verdict": "OK",
                        "reason": "",
                        "thinking_steps": "外側を求める → 内側を引く = 2ステップ",
                        "process_understanding": "PENDING",
                        "process_reason": "",
                        "answer_only_risk": "PENDING",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = meta_review_gate.cmd_verify(
        argparse.Namespace(
            lesson_id="lesson-test",
            no_auto_approve=False,
            strict_process_gate=True,
        )
    )

    assert result == 1
