#!/usr/bin/env python3
"""Render problem-bank SVG figures and apply manual visual review results."""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _lib.problem_bank import (  # noqa: E402
    INDEX_PATH,
    PROBLEM_BANK_DIR,
    QUESTIONS_PATH,
    VISUAL_REVIEW_STATUSES,
    ensure_quality,
    is_figure_entry,
    load_entries,
    load_index,
    now_iso,
    update_all_summaries,
    write_entries,
    write_json,
)


RENDER_CACHE_DIR = PROBLEM_BANK_DIR / "render-cache"
ALLOWED_SVG_STATUS = {"not_required", "svg_present_unreviewed", "visual_pass", "visual_warn", "visual_fail"}


def figure_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [entry for entry in entries if is_figure_entry(entry)]


def render_html(entry: dict[str, Any]) -> str:
    question = entry.get("question") or {}
    svg = question.get("figure_svg") or ""
    choices = question.get("hints") if isinstance(question.get("hints"), list) else []
    steps = question.get("solution_steps") if isinstance(question.get("solution_steps"), list) else []
    choice_html = "".join(f"<li>{html.escape(str(choice))}</li>" for choice in choices)
    step_html = "".join(f"<li>{html.escape(str(step))}</li>" for step in steps)
    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>{html.escape(str(entry.get("bank_id")))}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; color: #202124; }}
    .meta {{ color: #5f6368; font-size: 13px; }}
    .figure {{ border: 1px solid #dadce0; padding: 16px; margin: 16px 0; width: max-content; max-width: 100%; }}
    svg {{ max-width: 720px; max-height: 520px; }}
  </style>
</head>
<body>
  <h1>{html.escape(str(entry.get("bank_id")))}</h1>
  <p class="meta">unit={html.escape(str(entry.get("unit_id")))} difficulty={html.escape(str(entry.get("difficulty")))} hash={html.escape(str(entry.get("figure_svg_hash")))}</p>
  <h2>Question</h2>
  <p>{html.escape(str(question.get("question_text") or ""))}</p>
  <h2>Figure</h2>
  <div class="figure">{svg}</div>
  <h2>Choices</h2>
  <ol>{choice_html}</ol>
  <h2>Solution Steps</h2>
  <ol>{step_html}</ol>
</body>
</html>
"""


def render_cache(entries: list[dict[str, Any]], cache_dir: Path, limit: int | None = None) -> dict[str, Any]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "rendered_at": now_iso(),
        "review_instructions": [
            "Check that the figure is non-empty.",
            "Check line/label/angle/shading overlap.",
            "Check dimensions against question_text.",
            "Check values used by solution_steps are visible.",
            "Check choices and correct answer do not contradict the figure.",
        ],
        "figures": [],
    }
    selected = figure_entries(entries)
    if limit:
        selected = selected[:limit]
    for entry in selected:
        figure_hash = entry.get("figure_svg_hash")
        if not figure_hash:
            continue
        html_path = cache_dir / f"{figure_hash}.html"
        html_path.write_text(render_html(entry), encoding="utf-8")
        manifest["figures"].append(
            {
                "bank_id": entry.get("bank_id"),
                "figure_svg_hash": figure_hash,
                "html_path": str(html_path),
                "svg_status": entry.get("svg_status"),
                "render_score": (entry.get("quality") or {}).get("render_score"),
            }
        )
    write_json(cache_dir / "manifest.json", manifest)
    return manifest


def screenshot_manifest(manifest: dict[str, Any], cache_dir: Path) -> None:
    for figure in manifest.get("figures") or []:
        html_path = Path(figure["html_path"]).resolve()
        output_path = cache_dir / f"{figure['figure_svg_hash']}.png"
        subprocess.run(
            ["npx", "playwright", "screenshot", f"file://{html_path}", str(output_path)],
            check=True,
        )
        figure["screenshot_path"] = str(output_path)
    write_json(cache_dir / "manifest.json", manifest)


def apply_visual_review(review_path: Path, questions_path: Path, index_path: Path) -> None:
    review = json.loads(review_path.read_text(encoding="utf-8"))
    review_items = review.get("figures") if isinstance(review.get("figures"), list) else review.get("reviews")
    if not isinstance(review_items, list):
        raise ValueError("visual review file must contain figures or reviews list")
    entries = load_entries(questions_path)
    by_id = {entry.get("bank_id"): entry for entry in entries}
    for item in review_items:
        bank_id = item.get("bank_id")
        entry = by_id.get(bank_id)
        if not entry:
            continue
        expected_hash = entry.get("figure_svg_hash")
        if item.get("figure_svg_hash") != expected_hash:
            entry["svg_status"] = "svg_present_unreviewed" if expected_hash else "visual_fail"
            ensure_quality(entry)["render_score"] = None
            continue
        status = item.get("svg_status")
        if status not in ALLOWED_SVG_STATUS:
            raise ValueError(f"{bank_id}: invalid svg_status={status!r}")
        if status == "visual_pass" and not isinstance(item.get("render_score"), int):
            raise ValueError(f"{bank_id}: visual_pass requires integer render_score")
        entry["svg_status"] = status
        quality = ensure_quality(entry)
        quality["render_score"] = item.get("render_score")
        quality["svg_reviewed_at"] = now_iso()
        quality["svg_review_note"] = item.get("review_note")
    write_entries(entries, questions_path)
    index = load_index(index_path)
    update_all_summaries(index, entries)
    write_json(index_path, index)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render/apply problem-bank SVG visual review cache")
    sub = parser.add_subparsers(dest="cmd", required=True)

    render = sub.add_parser("render")
    render.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    render.add_argument("--cache-dir", type=Path, default=RENDER_CACHE_DIR)
    render.add_argument("--limit", type=int)
    render.add_argument("--screenshot", action="store_true", help="Run npx playwright screenshot for each rendered HTML file")

    apply = sub.add_parser("apply-review")
    apply.add_argument("--review", type=Path, required=True)
    apply.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    apply.add_argument("--index", type=Path, default=INDEX_PATH)

    args = parser.parse_args()
    if args.cmd == "render":
        manifest = render_cache(load_entries(args.questions), args.cache_dir, args.limit)
        if args.screenshot:
            screenshot_manifest(manifest, args.cache_dir)
        print(f"[problem-bank] rendered {len(manifest['figures'])} figure HTML file(s) to {args.cache_dir}")
        return 0

    apply_visual_review(args.review, args.questions, args.index)
    print(f"[problem-bank] applied SVG visual review: {args.review}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
