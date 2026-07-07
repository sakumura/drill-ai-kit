import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from finalize_problem_bank_quality import finalize_entries, grade_entry


def base_entry(**overrides):
    entry = {
        "validation_status": "pass",
        "is_figure": False,
        "svg_status": "not_required",
        "quality": {
            "review_status": "semantic_pass",
            "review_items": {
                "question_text_ok": "OK",
                "choices_are_meaningful": "OK",
                "correct_answer_matches_solution": "OK",
                "student_age_fit": "OK",
                "difficulty_label_ok": "OK",
                "training_plan_fit": "OK",
                "weakness_pattern_fit": "OK",
                "step1_step2_are_distinct": "N/A",
                "figure_matches_question": "N/A",
            },
            "pedagogy_score": 5,
            "solvability_score": 5,
            "distractor_score": 4,
            "reuse_grade": None,
        },
    }
    entry.update(overrides)
    return entry


def test_grade_5_requires_validation_and_semantic_pass():
    grade, reason = grade_entry(base_entry())
    assert grade == 5
    assert "direct reuse" in reason


def test_unreviewed_entry_remains_unfinalized():
    grade, reason = grade_entry(base_entry(quality={"review_status": "unreviewed", "reuse_grade": None}))
    assert grade is None
    assert "semantic review" in reason


def test_validation_failure_is_grade_1():
    grade, reason = grade_entry(base_entry(validation_status="fail"))
    assert grade == 1
    assert "validation" in reason


def test_figure_without_visual_pass_is_repair_candidate_not_selection_candidate():
    entry = base_entry(is_figure=True, svg_status="svg_present_unreviewed")
    finalized = finalize_entries([entry])[0]
    assert finalized["quality"]["reuse_grade"] == 3
    assert finalized["selection_candidate"] is False


def test_grade_4_candidate_allowed_for_minor_distractor_gap():
    entry = base_entry()
    entry["quality"]["distractor_score"] = 3
    finalized = finalize_entries([entry])[0]
    assert finalized["quality"]["reuse_grade"] == 4
    assert finalized["selection_candidate"] is True
