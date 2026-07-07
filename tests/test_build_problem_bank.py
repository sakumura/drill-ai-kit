import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_problem_bank import build_problem_bank, write_problem_bank


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def sample_question(position: int = 1) -> dict:
    return {
        "position": position,
        "unit_id": "kakudo",
        "difficulty": "d4",
        "question_type": "two_tier",
        "question_text": "図の角アは何度ですか。",
        "answer": "40",
        "answer_unit": "度",
        "hints": ["180-140", "40", "60", "40"],
        "solution_steps": ["一直線は180度。", "180-140=40。"],
        "common_mistakes": ["140度をそのまま答える"],
        "is_figure": True,
        "figure_svg": "<svg viewBox='0 0 10 10'><line x1='0' y1='0' x2='10' y2='10'/></svg>",
        "tier1_purpose": "diagram",
        "tier2_purpose": "answer",
        "tier2_correct_index": 3,
        "tier2_label": "答え",
        "meta": {
            "target_anchor": "2026-1 大問3",
            "match_type": "adjacent",
            "difficulty_from_anchor": "d4",
        },
    }


def test_build_problem_bank_dedupes_bundle_copy_and_keeps_alias(tmp_path):
    question = sample_question()
    handwritten = {
        "lesson_id": "lesson-m-0501",
        "subject": "math",
        "date": "2026-05-01",
        "title": "手書き算数",
        "questions": [question],
    }
    bundle_lesson = {
        "id": "lesson-m-0501",
        "subject": "math",
        "title": "配信用算数",
        "created_at": "2026-05-01T00:00:00+09:00",
        "questions": [dict(question, id="q-lesson-m-0501-01", lesson_id="lesson-m-0501")],
    }
    stock_question = dict(sample_question(position=2), question_text="時速60kmで3時間進む道のりは何kmですか。", answer="180", is_figure=False, figure_svg=None)
    stock = {
        "lesson_id": "stock-hayasa-math-1",
        "subject": "math",
        "topic": "hayasa",
        "title": "速さ stock",
        "questions": [stock_question],
    }

    write_json(tmp_path / "data/lessons-handwritten/2026-05-01-math.json", handwritten)
    write_json(tmp_path / "frontend/public/data/lessons.json", [bundle_lesson])
    write_json(tmp_path / "data/lessons-stock/hayasa-math-1.json", stock)

    entries, index = build_problem_bank(tmp_path)

    assert index["source_question_count"] == 3
    assert index["total_questions"] == 2
    assert index["duplicates_collapsed"] == 1

    handwritten_entry = next(e for e in entries if e["source_lesson_id"] == "lesson-m-0501")
    assert handwritten_entry["source_kind"] == "lesson-handwritten"
    assert handwritten_entry["duplicate_sources"][0]["source_kind"] == "lesson-bundle"
    assert handwritten_entry["svg_status"] == "svg_present_unreviewed"
    assert handwritten_entry["quality_status"] == "inventory_only_unreviewed"
    assert handwritten_entry["validation_status"] == "not_evaluated"
    assert handwritten_entry["quality"]["review_status"] == "unreviewed"
    assert handwritten_entry["quality"]["reuse_grade"] is None
    assert handwritten_entry["reuse"]["times_used"] == 0
    assert handwritten_entry["target_anchor"] == "2026-1 大問3"

    stock_entry = next(e for e in entries if e["source_kind"] == "lesson-stock")
    assert stock_entry["stock_topic"] == "hayasa"
    assert stock_entry["svg_status"] == "not_required"


def test_write_problem_bank_creates_expected_files(tmp_path):
    question = sample_question()
    handwritten = {
        "lesson_id": "lesson-m-0501",
        "subject": "math",
        "date": "2026-05-01",
        "questions": [question],
    }
    write_json(tmp_path / "data/lessons-handwritten/2026-05-01-math.json", handwritten)
    write_json(tmp_path / "frontend/public/data/lessons.json", [])

    entries, index = build_problem_bank(tmp_path)
    output_dir = tmp_path / "data/problem-bank"
    write_problem_bank(entries, index, output_dir)

    assert (output_dir / "questions.jsonl").exists()
    assert (output_dir / "_index.json").exists()
    assert (output_dir / "usage.jsonl").exists()
    assert (output_dir / "reviews").is_dir()
    assert (output_dir / "render-cache").is_dir()
    lines = (output_dir / "questions.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["bank_id"] == "pb-m-20260501-lesson-m-0501-q01"


def test_bank_ids_remain_unique_when_source_positions_collide(tmp_path):
    first = sample_question(position=1)
    second = dict(sample_question(position=1), question_text="同じ位置にある別問題です。", answer="50")
    handwritten = {
        "lesson_id": "lesson-m-0501",
        "subject": "math",
        "date": "2026-05-01",
        "questions": [first, second],
    }
    write_json(tmp_path / "data/lessons-handwritten/2026-05-01-math.json", handwritten)
    write_json(tmp_path / "frontend/public/data/lessons.json", [])

    entries, _index = build_problem_bank(tmp_path)
    bank_ids = [entry["bank_id"] for entry in entries]

    assert len(bank_ids) == 2
    assert len(set(bank_ids)) == 2
    assert all(bank_id.startswith("pb-m-20260501-lesson-m-0501-q01") for bank_id in bank_ids)


def test_build_problem_bank_initial_output_is_inventory_only_unreviewed(tmp_path):
    question = sample_question()
    handwritten = {
        "lesson_id": "lesson-m-0501",
        "subject": "math",
        "date": "2026-05-01",
        "questions": [question],
    }
    write_json(tmp_path / "data/lessons-handwritten/2026-05-01-math.json", handwritten)
    write_json(tmp_path / "frontend/public/data/lessons.json", [])

    entries, index = build_problem_bank(tmp_path)

    assert index["quality_status"] == "inventory_only_unreviewed"
    assert "machine_pass" not in index["svg_status_counts"]
    for entry in entries:
        assert entry["quality_status"] == "inventory_only_unreviewed"
        assert entry["validation_status"] == "not_evaluated"
        assert entry["quality"]["review_status"] == "unreviewed"
        assert entry["quality"]["reuse_grade"] is None
        assert entry["svg_status"] != "machine_pass"
