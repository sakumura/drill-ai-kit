import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from evaluate_problem_bank import evaluate_entries


def entry_for(question: dict) -> dict:
    return {
        "bank_id": "pb-test-001",
        "subject": "math",
        "question": question,
        "validation_status": "not_evaluated",
        "validation_rules": [],
        "quality": {"review_status": "unreviewed", "reuse_grade": None},
    }


def valid_meta(difficulty: str = "d4") -> dict:
    return {
        "target_anchor": "2026-1 大問3",
        "match_type": "adjacent",
        "difficulty_from_anchor": difficulty,
    }


def test_r12_missing_svg_fails():
    entry = entry_for(
        {
            "position": 1,
            "unit_id": "kakudo",
            "difficulty": "d4",
            "question_type": "two_tier",
            "question_text": "図の角アは何度ですか。",
            "answer": "40",
            "hints": ["一直線", "三角形", "平行線", "40", "60", "80"],
            "solution_steps": ["一直線は180度。", "180-140=40。"],
            "common_mistakes": [],
            "is_figure": True,
            "figure_svg": None,
            "tier1_label": "考え方",
            "tier1_purpose": "diagram",
            "tier2_label": "答え",
            "tier2_purpose": "answer",
            "tier2_correct_index": 3,
            "meta": valid_meta("d4"),
        }
    )
    evaluated = evaluate_entries([entry])[0]
    assert evaluated["validation_status"] == "fail"
    assert any(rule["rule"] == "R12" for rule in evaluated["validation_rules"])
    assert evaluated["quality"]["review_status"] == "auto_rejected"


def test_r18_broken_two_tier_fails():
    entry = entry_for(
        {
            "position": 1,
            "unit_id": "kakudo",
            "difficulty": "d4",
            "question_type": "two_tier",
            "question_text": "角度の求め方を選びなさい。",
            "answer": "40",
            "hints": ["一直線", "40"],
            "solution_steps": ["一直線は180度。", "180-140=40。"],
            "common_mistakes": [],
            "is_figure": False,
            "figure_svg": None,
            "tier1_label": "",
            "tier1_purpose": None,
            "tier2_label": None,
            "tier2_purpose": None,
            "tier2_correct_index": 1,
            "meta": valid_meta("d4"),
        }
    )
    evaluated = evaluate_entries([entry])[0]
    assert evaluated["validation_status"] == "fail"
    assert any(rule["rule"] == "R18" for rule in evaluated["validation_rules"])
    assert evaluated["quality"]["review_status"] == "auto_rejected"


def test_r22_d4_answer_only_single_tier_fails():
    entry = entry_for(
        {
            "position": 1,
            "unit_id": "baibun-ouyou",
            "difficulty": "d4",
            "question_type": "single_tier",
            "question_text": "48人は全体の3/8です。全体は何人ですか。",
            "answer": "128",
            "hints": ["128", "18", "96"],
            "solution_steps": ["3/8が48人。", "1/8は16人。", "全体は128人。"],
            "common_mistakes": [],
            "is_figure": False,
            "figure_svg": None,
            "meta": valid_meta("d4"),
        }
    )
    evaluated = evaluate_entries([entry])[0]
    assert evaluated["validation_status"] == "fail"
    assert any(rule["rule"] == "R22" for rule in evaluated["validation_rules"])
    assert evaluated["quality"]["review_status"] == "auto_rejected"


def test_validation_pass_keeps_reuse_grade_unset():
    entry = entry_for(
        {
            "position": 1,
            "unit_id": "keisan-junjo",
            "difficulty": "d2",
            "question_type": "single_tier",
            "question_text": "3.14 × 7 + 3.14 × 3 は 3.14 × いくつ？",
            "answer": "10",
            "hints": ["10", "21", "4"],
            "solution_steps": ["3.14が共通。", "7+3=10。"],
            "common_mistakes": [],
            "is_figure": False,
            "figure_svg": None,
            "tier1_purpose": "formula",
            "meta": valid_meta("d2"),
        }
    )
    evaluated = evaluate_entries([entry])[0]
    assert evaluated["validation_status"] == "pass"
    assert evaluated["validation_rules"] == []
    assert evaluated["quality"]["review_status"] == "unreviewed"
    assert evaluated["quality"]["reuse_grade"] is None
