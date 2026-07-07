import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from prepare_problem_review import apply_review, build_review_sheet, review_failures


def entry(validation_status: str = "pass") -> dict:
    return {
        "bank_id": "pb-review-001",
        "content_hash": "content",
        "figure_svg_hash": None,
        "subject": "math",
        "unit_id": "keisan-junjo",
        "pattern_id": "keisan-junjo",
        "difficulty": "d2",
        "question_type": "single_tier",
        "is_figure": False,
        "validation_status": validation_status,
        "quality": {"review_status": "unreviewed", "reuse_grade": None},
        "question": {
            "question_text": "3+4はいくつですか。",
            "answer": "7",
            "hints": ["7", "8", "1"],
            "solution_steps": ["3+4=7"],
        },
    }


def write_entries(path: Path, entries: list[dict]) -> None:
    path.write_text("".join(json.dumps(e, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for e in entries), encoding="utf-8")


def test_prepare_skips_validation_failed_by_default():
    sheet = build_review_sheet([entry("fail")], bank_ids=None, include_failed=False, limit=None)
    assert sheet["reviews"] == []
    assert sheet["summary"]["skipped_auto_rejected"] == 1


def test_verify_fails_on_pending_items():
    sheet = build_review_sheet([entry()], bank_ids=None, include_failed=False, limit=None)
    failures = review_failures(sheet)
    assert any("question_text_ok" in failure for failure in failures)
    assert any("semantic_verdict" in failure for failure in failures)


def test_apply_completed_review_updates_quality(tmp_path):
    questions = tmp_path / "questions.jsonl"
    index = tmp_path / "_index.json"
    write_entries(questions, [entry()])
    index.write_text("{}", encoding="utf-8")
    sheet = build_review_sheet([entry()], bank_ids=None, include_failed=False, limit=None)
    review = sheet["reviews"][0]
    review["review_items"] = {key: "OK" for key in review["review_items"]}
    review["scores"] = {
        "pedagogy_score": 5,
        "solvability_score": 5,
        "distractor_score": 4,
    }
    review["semantic_verdict"] = "OK"
    review["review_note"] = "self-solved and choices are meaningful"

    assert review_failures(sheet) == []
    apply_review(sheet, questions, index)

    updated = json.loads(questions.read_text(encoding="utf-8").splitlines()[0])
    assert updated["quality"]["review_status"] == "semantic_pass"
    assert updated["quality"]["pedagogy_score"] == 5
    assert updated["quality"]["reuse_grade"] is None
