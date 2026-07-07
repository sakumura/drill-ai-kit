import json
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from apply_bank_selection_to_lesson import compose_lesson
from _lib.problem_bank import append_usage, load_usage
from record_problem_bank_usage import records_from_selection
from select_lesson_from_bank import build_blueprint, load_plan_context, merged_pattern_priority, select_from_bank


def reusable_entry(**overrides):
    entry = {
        "bank_id": "pb-bank-001",
        "subject": "math",
        "unit_id": "kakudo",
        "pattern_id": "kakudo",
        "difficulty": "d4",
        "question_type": "two_tier",
        "content_hash": "hash-1",
        "validation_status": "pass",
        "is_figure": True,
        "svg_status": "visual_pass",
        "reuse": {},
        "quality": {"review_status": "semantic_pass", "reuse_grade": 5},
    }
    entry.update(overrides)
    return entry


def test_selection_requires_quality_assured_candidates():
    blueprint = [{"position": 1, "subject": "math", "unit_id": "kakudo", "pattern_id": "kakudo", "difficulty": "d4", "question_type": None}]
    report = select_from_bank([reusable_entry(validation_status="not_evaluated")], blueprint, date(2026, 5, 25), [])
    assert report["summary"]["bank_selected"] == 0
    assert report["summary"]["new_required"] == 1
    assert report["rejection_reasons"]["not_quality_assured"] == 1


def test_selection_picks_visual_pass_reuse_grade_5_candidate():
    blueprint = [{"position": 1, "subject": "math", "unit_id": "kakudo", "pattern_id": "kakudo", "difficulty": "d4", "question_type": None}]
    report = select_from_bank([reusable_entry()], blueprint, date(2026, 5, 25), [])
    assert report["summary"]["bank_selected"] == 1
    assert report["selected"][0]["source"] == "bank:pb-bank-001"


def test_selection_respects_cooldown():
    blueprint = [{"position": 1, "subject": "math", "unit_id": "kakudo", "pattern_id": "kakudo", "difficulty": "d4", "question_type": None}]
    usage = [{"bank_id": "pb-bank-001", "used_at": "2026-05-20"}]
    report = select_from_bank([reusable_entry()], blueprint, date(2026, 5, 25), usage)
    assert report["summary"]["bank_selected"] == 0
    assert report["rejection_reasons"]["cooldown"] == 1


def test_selection_rejects_difficulty_mismatch():
    blueprint = [{"position": 1, "subject": "math", "unit_id": "kakudo", "pattern_id": "kakudo", "difficulty": "d5", "question_type": None}]
    report = select_from_bank([reusable_entry(difficulty="d3")], blueprint, date(2026, 5, 25), [])
    assert report["summary"]["bank_selected"] == 0
    assert report["summary"]["new_required"] == 1
    assert report["rejection_reasons"]["difficulty_mismatch"] == 1


def test_blueprint_uses_short_blocks_on_tuesday():
    blueprint = build_blueprint(date(2026, 5, 26), "math", ["kakudo"], {}, None)
    assert len(blueprint) == 10
    assert blueprint[0]["block_type"] == "warmup"


def test_blueprint_prefers_training_plan_units(tmp_path):
    plan = tmp_path / "training-plan.md"
    plan.write_text("- 最優先 unit_id: kakudo\n- 維持 unit_id: gyakuhi\n", encoding="utf-8")
    context = load_plan_context({"training_plan": plan}, {"kakudo", "gyakuhi", "baibun-ouyou"})
    patterns = merged_pattern_priority(context["unit_priority"], ["baibun-ouyou"])
    blueprint = build_blueprint(date(2026, 5, 25), "math", patterns, {}, 2, context)

    assert patterns[:2] == ["kakudo", "gyakuhi"]
    assert blueprint[0]["unit_id"] == "kakudo"
    assert blueprint[0]["plan_source_kind"] == "training_plan"
    assert "kakudo" in blueprint[0]["plan_theme"]


def test_usage_records_from_selection_report():
    report = {
        "date": "2026-05-25",
        "lesson_id": "lesson-m-0525",
        "selected": [{"bank_id": "pb-bank-001", "position": 1, "source": "bank:pb-bank-001", "content_hash": "hash-1"}],
    }
    records = records_from_selection(report)
    assert records[0]["bank_id"] == "pb-bank-001"
    assert records[0]["lesson_id"] == "lesson-m-0525"


def test_usage_append_is_idempotent(tmp_path):
    usage_path = tmp_path / "usage.jsonl"
    report = {
        "date": "2026-05-25",
        "lesson_id": "lesson-m-0525",
        "selected": [{"bank_id": "pb-bank-001", "position": 1, "source": "bank:pb-bank-001", "content_hash": "hash-1"}],
    }
    records = records_from_selection(report)

    assert append_usage(records, usage_path) == 1
    assert append_usage(records, usage_path) == 0
    assert len(load_usage(usage_path)) == 1


def test_reviewed_sample_bank_selection_cli_selects_bank_entry(tmp_path):
    root = Path(__file__).resolve().parents[1]
    sample = root / "tests" / "data" / "problem_bank_reviewed_sample"
    output = tmp_path / "selection.json"
    result = subprocess.run(
        [
            sys.executable,
            str(root / "scripts" / "select_lesson_from_bank.py"),
            "--date",
            "2026-05-25",
            "--subject",
            "math",
            "--questions",
            str(sample / "questions.jsonl"),
            "--usage",
            str(tmp_path / "usage.jsonl"),
            "--training-plan",
            str(sample / "training-plan.md"),
            "--analysis",
            str(sample / "analysis.md"),
            "--grade5-training-plan",
            str(sample / "grade5-training-plan.md"),
            "--grade5-analysis",
            str(sample / "grade5-analysis.md"),
            "--slots",
            "1",
            "--output",
            str(output),
        ],
        cwd=root,
        text=True,
        capture_output=True,
        check=True,
    )
    report = json.loads(output.read_text(encoding="utf-8"))

    assert "bank=1" in result.stdout
    assert report["summary"]["bank_selected"] == 1
    assert report["selected"][0]["bank_id"] == "pb-test-kakudo-001"
    assert report["plan_context"]["sources"][0]["extracted_units"] == ["kakudo"]
    assert report["blueprint"][0]["plan_source_kind"] == "training_plan"


def test_compose_lesson_applies_selection_report_to_draft():
    report = {
        "date": "2026-05-25",
        "subject": "math",
        "summary": {"total_slots": 2, "bank_selected": 1, "new_required": 1},
        "blueprint": [
            {"position": 1, "block_type": "core", "block_position": 1, "subject": "math", "unit_id": "kakudo", "pattern_id": "kakudo", "difficulty": "d4"},
            {"position": 2, "block_type": "core", "block_position": 2, "subject": "math", "unit_id": "gyakuhi", "pattern_id": "gyakuhi", "difficulty": "d4"},
        ],
        "selected": [{"position": 1, "bank_id": "pb-bank-001", "source": "bank:pb-bank-001", "content_hash": "hash-1"}],
        "missing_slots": [{"position": 2, "source": "new", "reason": "no reusable bank candidate"}],
    }
    lesson = compose_lesson(
        report,
        [
            {
                "bank_id": "pb-bank-001",
                "difficulty": "d3",
                "source_path": "data/lessons-handwritten/example.json",
                "source_lesson_id": "lesson-m-example",
                "source_position": 1,
                "question": {"question_text": "角度を求める", "choices": ["50度"], "answer": "50度"},
            }
        ],
        "lesson-m-0525",
    )

    assert lesson["composition_summary"]["bank_selected"] == 1
    assert lesson["composition_summary"]["bank_reuse_ratio"] == 0.5
    assert lesson["questions"][0]["meta"]["bank_id"] == "pb-bank-001"
    assert lesson["questions"][0]["difficulty"] == "d3"
    assert lesson["questions"][0]["meta"]["target_difficulty"] == "d4"
    assert lesson["questions"][1]["requires_generation"] is True
    assert lesson["questions"][1]["unit_id"] == "gyakuhi"
