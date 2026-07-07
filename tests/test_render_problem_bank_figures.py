import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from render_problem_bank_figures import apply_visual_review, render_cache


def figure_entry() -> dict:
    return {
        "bank_id": "pb-fig-001",
        "figure_svg_hash": "abc123",
        "is_figure": True,
        "svg_status": "svg_present_unreviewed",
        "unit_id": "kakudo",
        "difficulty": "d4",
        "quality": {"review_status": "semantic_pass", "reuse_grade": None},
        "question": {
            "question_text": "図の角アは何度ですか。",
            "answer": "40",
            "hints": ["40", "60", "80"],
            "solution_steps": ["一直線は180度。"],
            "figure_svg": "<svg viewBox='0 0 10 10'><line x1='0' y1='0' x2='10' y2='10'/></svg>",
        },
    }


def write_entries(path: Path, entries: list[dict]) -> None:
    path.write_text("".join(json.dumps(e, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for e in entries), encoding="utf-8")


def test_render_cache_writes_html_and_manifest(tmp_path):
    manifest = render_cache([figure_entry()], tmp_path)
    assert len(manifest["figures"]) == 1
    html_path = Path(manifest["figures"][0]["html_path"])
    assert html_path.exists()
    assert "図の角ア" in html_path.read_text(encoding="utf-8")


def test_apply_visual_review_updates_status_and_render_score(tmp_path):
    questions = tmp_path / "questions.jsonl"
    index = tmp_path / "_index.json"
    write_entries(questions, [figure_entry()])
    index.write_text("{}", encoding="utf-8")
    review = tmp_path / "review.json"
    review.write_text(
        json.dumps(
            {
                "figures": [
                    {
                        "bank_id": "pb-fig-001",
                        "figure_svg_hash": "abc123",
                        "svg_status": "visual_pass",
                        "render_score": 5,
                        "review_note": "labels and dimensions are readable",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    apply_visual_review(review, questions, index)

    updated = json.loads(questions.read_text(encoding="utf-8").splitlines()[0])
    assert updated["svg_status"] == "visual_pass"
    assert updated["quality"]["render_score"] == 5


def test_apply_visual_review_invalidates_stale_hash(tmp_path):
    questions = tmp_path / "questions.jsonl"
    index = tmp_path / "_index.json"
    write_entries(questions, [figure_entry()])
    index.write_text("{}", encoding="utf-8")
    review = tmp_path / "review.json"
    review.write_text(
        json.dumps(
            {
                "figures": [
                    {
                        "bank_id": "pb-fig-001",
                        "figure_svg_hash": "old-hash",
                        "svg_status": "visual_pass",
                        "render_score": 5,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    apply_visual_review(review, questions, index)

    updated = json.loads(questions.read_text(encoding="utf-8").splitlines()[0])
    assert updated["svg_status"] == "svg_present_unreviewed"
    assert updated["quality"]["render_score"] is None
