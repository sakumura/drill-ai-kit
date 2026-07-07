import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from problem_bank_metrics import metrics


def test_metrics_reports_required_operational_fields(tmp_path):
    weakness = tmp_path / "weakness.json"
    weakness.write_text(
        '{"priority_queue":[{"pattern_id":"kakudo","subject":"math","score":100,"severity":"critical"}]}',
        encoding="utf-8",
    )
    entries = [
        {
            "bank_id": "pb-1",
            "unit_id": "kakudo",
            "pattern_id": "kakudo",
            "validation_status": "pass",
            "is_figure": True,
            "svg_status": "visual_pass",
            "quality": {"review_status": "semantic_pass", "reuse_grade": 5},
            "validation_rules": [],
        },
        {
            "bank_id": "pb-2",
            "unit_id": "kakudo",
            "pattern_id": "kakudo",
            "validation_status": "fail",
            "is_figure": False,
            "svg_status": "not_required",
            "quality": {"review_status": "auto_rejected", "reuse_grade": 1, "reuse_grade_reason": "validation failed or errored"},
            "validation_rules": [{"rule": "R22", "detail": "bad", "level": "reject"}],
        },
    ]
    report = metrics(entries, [{"bank_id": "pb-1", "used_at": "2026-05-25", "lesson_id": "lesson-m-0525"}], weakness, lesson_question_count=2)

    assert report["bank_total"] == 2
    assert report["reviewed_total"] == 2
    assert report["reusable_total"] == 1
    assert report["visual_pass_figure_count"] == 1
    assert report["weakness_profile_reusable_coverage"][0]["reusable_count"] == 1
    assert report["latest_lesson_bank_reuse_ratio"]["bank_reuse_count"] == 1
    assert report["latest_lesson_bank_reuse_ratio"]["total_questions"] == 2
    assert report["latest_lesson_bank_reuse_ratio"]["bank_reuse_ratio"] == 0.5
    assert report["rejected_reason_distribution"]["R22"] == 1


def test_metrics_uses_selection_report_ratio_when_available(tmp_path):
    weakness = tmp_path / "weakness.json"
    weakness.write_text('{"priority_queue":[]}', encoding="utf-8")
    report = metrics(
        [],
        [],
        weakness,
        selection_report={"date": "2026-05-25", "summary": {"total_slots": 4, "bank_selected": 3, "new_required": 1, "svg_new_required": 0}},
    )

    ratio = report["latest_lesson_bank_reuse_ratio"]
    assert ratio["source"] == "selection_report"
    assert ratio["bank_reuse_count"] == 3
    assert ratio["total_questions"] == 4
    assert ratio["bank_reuse_ratio"] == 0.75
