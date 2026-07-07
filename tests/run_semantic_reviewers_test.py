import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import scripts.run_semantic_reviewers as runner


def test_extract_json_accepts_markdown_fence():
    parsed = runner.extract_json(
        "Here is the result:\n```json\n{\"reviewer\":\"codex\",\"reviews\":[]}\n```"
    )

    assert parsed == {"reviewer": "codex", "reviews": []}


def test_apply_reviewer_result_updates_matching_positions():
    review = {
        "reviews": [
            {
                "position": 1,
                "external_reviews": {
                    "codex": {
                        "verdict": "PENDING",
                    }
                },
            }
        ]
    }
    result = {
        "reviewer": "codex",
        "reviews": [
            {
                "position": 1,
                "verdict": "OK",
                "meaning_clear": "OK",
                "conditions_sufficient": "OK",
                "answer_unique": "OK",
                "answer_contract_consistent": "OK",
                "step_logic_consistent": "N/A",
                "review_note": "問題文と解答契約は矛盾しない。",
            }
        ],
    }

    warnings = runner.apply_reviewer_result(review, "codex", result)

    assert warnings == []
    codex = review["reviews"][0]["external_reviews"]["codex"]
    assert codex["verdict"] == "OK"
    assert codex["step_logic_consistent"] == "N/A"


def test_apply_reviewer_result_marks_missing_position_ng():
    review = {"reviews": [{"position": 1, "external_reviews": {}}]}

    warnings = runner.apply_reviewer_result(review, "gemini", {"reviews": []})

    assert warnings
    gemini = review["reviews"][0]["external_reviews"]["gemini"]
    assert gemini["verdict"] == "NG"
    assert "did not return" in gemini["refusal_reason"]


def test_gemini_reviewer_uses_antigravity_flash_medium():
    command = runner.command_for(
        "gemini",
        repo_root=".",
        timeout_sec=123,
    )

    assert command == [
        "agy",
        "--model",
        "Gemini 3.5 Flash (Medium)",
        "--print-timeout",
        "123s",
        "--print",
        "",
    ]


def test_dry_run_writes_prompts(tmp_path):
    review_path = tmp_path / "review.json"
    review_path.write_text(
        json.dumps(
            {
                "lesson_id": "lesson-test",
                "external_reviewers": {"required": ["codex"]},
                "reviews": [
                    {
                        "position": 1,
                        "question_text": "3個のりんごを2人で分ける。",
                        "answer_contract": {"answer": "1.5個"},
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    prompt_dir = tmp_path / "prompts"

    result = runner.cmd_run(
        type(
            "Args",
            (),
            {
                "review": str(review_path),
                "reviewer": None,
                "repo_root": ".",
                "timeout_sec": 1,
                "dry_run": True,
                "write_prompts_dir": str(prompt_dir),
            },
        )()
    )

    assert result == 0
    prompt = (prompt_dir / "codex.prompt.txt").read_text(encoding="utf-8")
    assert "strict refusal semantics" in prompt
    assert "3個のりんご" in prompt
