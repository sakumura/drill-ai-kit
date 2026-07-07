#!/usr/bin/env python3
"""Build the initial reusable problem bank from existing lesson sources.

This script intentionally only inventories and normalizes questions. It does
not grade quality, run the lesson validator, or connect the bank to daily lesson
generation. Later scripts can consume the stable hashes emitted here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent.parent
PROBLEM_BANK_DIR = ROOT / "data" / "problem-bank"
JST = timezone(timedelta(hours=9))

SUBJECT_PREFIX = {"math": "m", "japanese": "j"}
SOURCE_PRIORITY = {
    "lesson-stock": 0,
    "lesson-handwritten": 1,
    "lesson-bundle": 2,
}

CORE_QUESTION_FIELDS = [
    "question_text",
    "answer",
    "answer_unit",
    "hints",
    "solution_steps",
    "common_mistakes",
    "question_type",
    "tier1_label",
    "tier1_purpose",
    "tier2_correct_index",
    "tier2_label",
    "tier2_purpose",
    "slot_config",
    "choice_meta",
    "remediation",
]

PRESERVED_QUESTION_FIELDS = [
    "position",
    "unit_id",
    "difficulty",
    *CORE_QUESTION_FIELDS,
    "is_figure",
    "figure_svg",
    "meta",
]


@dataclass(frozen=True)
class SourceQuestion:
    source_kind: str
    source_path: str
    source_lesson_id: str
    source_position: int | None
    source_date: str | None
    subject: str
    lesson_title: str | None
    question: dict[str, Any]
    block_type: str | None = None
    stock_topic: str | None = None


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"[error] JSON parse failed: {path}: {exc}") from exc


def rel_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def compact_question(question: dict[str, Any]) -> dict[str, Any]:
    return {key: question.get(key) for key in PRESERVED_QUESTION_FIELDS if key in question}


def content_payload(question: dict[str, Any]) -> dict[str, Any]:
    return {key: question.get(key) for key in CORE_QUESTION_FIELDS if key in question}


def dedupe_payload(question: dict[str, Any]) -> dict[str, Any]:
    payload = content_payload(question)
    payload["is_figure"] = is_figure_question(question)
    payload["figure_svg"] = question.get("figure_svg") or None
    return payload


def infer_subject(*values: Any) -> str:
    for value in values:
        if value in {"math", "japanese"}:
            return str(value)
        if isinstance(value, str):
            if value.startswith("lesson-m-") or "-math-" in value or value.endswith("-math"):
                return "math"
            if value.startswith("lesson-j-") or "-japanese-" in value or value.endswith("-japanese"):
                return "japanese"
    return "unknown"


def date_from_lesson_id(lesson_id: str | None) -> str | None:
    if not lesson_id:
        return None
    match = re.search(r"lesson-[mj]-(\d{2})(\d{2})$", lesson_id)
    if not match:
        return None
    month, day = match.groups()
    return f"2026-{month}-{day}"


def date_from_source_path(path: Path) -> str | None:
    match = re.match(r"(\d{4}-\d{2}-\d{2})-(math|japanese)\.json$", path.name)
    return match.group(1) if match else None


def date_from_created_at(value: Any) -> str | None:
    if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def block_type_by_position(lesson: dict[str, Any]) -> dict[int, str]:
    blocks = lesson.get("blocks")
    lesson_id = lesson.get("lesson_id") or lesson.get("id")
    if not isinstance(blocks, list) or not lesson_id:
        return {}
    out: dict[int, str] = {}
    for block in blocks:
        block_type = block.get("block_type")
        if not isinstance(block_type, str):
            continue
        for qid in block.get("question_ids") or []:
            if not isinstance(qid, str):
                continue
            prefix = f"q-{lesson_id}-"
            if not qid.startswith(prefix):
                continue
            try:
                out[int(qid.removeprefix(prefix))] = block_type
            except ValueError:
                continue
    return out


def iter_handwritten(root: Path) -> Iterable[SourceQuestion]:
    for path in sorted((root / "data" / "lessons-handwritten").glob("*.json")):
        lesson = read_json(path)
        lesson_id = lesson.get("lesson_id") or path.stem
        subject = infer_subject(lesson.get("subject"), lesson_id, path.name)
        source_date = lesson.get("date") or date_from_source_path(path) or date_from_lesson_id(lesson_id)
        blocks = block_type_by_position(lesson)
        for question in lesson.get("questions") or []:
            position = question.get("position")
            yield SourceQuestion(
                source_kind="lesson-handwritten",
                source_path=rel_path(path, root),
                source_lesson_id=lesson_id,
                source_position=position if isinstance(position, int) else None,
                source_date=source_date,
                subject=subject,
                lesson_title=lesson.get("title"),
                question=question,
                block_type=blocks.get(position) if isinstance(position, int) else None,
            )


def iter_stock(root: Path) -> Iterable[SourceQuestion]:
    for path in sorted((root / "data" / "lessons-stock").glob("*.json")):
        if path.name.startswith("_"):
            continue
        lesson = read_json(path)
        lesson_id = lesson.get("lesson_id") or f"stock-{path.stem}"
        subject = infer_subject(lesson.get("subject"), lesson_id, path.name)
        topic = lesson.get("topic") or path.stem
        for question in lesson.get("questions") or []:
            position = question.get("position")
            yield SourceQuestion(
                source_kind="lesson-stock",
                source_path=rel_path(path, root),
                source_lesson_id=lesson_id,
                source_position=position if isinstance(position, int) else None,
                source_date=lesson.get("date") or date_from_lesson_id(lesson_id),
                subject=subject,
                lesson_title=lesson.get("title"),
                question=question,
                stock_topic=topic,
            )


def infer_subject_from_unit(unit_id: Any) -> str | None:
    if not isinstance(unit_id, str) or not unit_id:
        return None
    math_prefixes = (
        "baibun",
        "bunsu",
        "ensui",
        "gyakuzan",
        "hayasa",
        "heikin",
        "hi-keisan",
        "kakudo",
        "keisan",
        "menseki",
        "nodosan",
        "shigoto",
        "shousu",
        "shuugou",
        "sk-bunsuu",
        "sk-gcd-lcm",
        "sk-gyakuzan",
        "sk-keisan",
        "sk-syousuu",
        "sk-tsubun",
        "sk-uekizan",
        "sk-yakubun",
        "sk-zukei",
        "tamen",
        "tsurukame",
        "wari",
        "yakusu",
        "yakubun",
    )
    japanese_prefixes = (
        "bunpou",
        "dokkai",
        "goku",
        "hitei",
        "hyougen",
        "jouhou",
        "kanji",
        "kanyouku",
        "keigo",
        "monogatari",
        "naiyou",
        "setsumei",
        "setsuzoku",
        "shi-haiku",
        "shinjyou",
        "sk-hitei",
        "sk-inga",
        "sk-kanji",
        "sk-kanyouku",
        "sk-setsuzoku",
        "sk-youshi",
        "zuihitsu",
    )
    if unit_id.startswith(math_prefixes):
        return "math"
    if unit_id.startswith(japanese_prefixes):
        return "japanese"
    return None


def build_unit_subject_map(items: list[SourceQuestion]) -> dict[str, str]:
    subjects_by_unit: dict[str, set[str]] = defaultdict(set)
    for item in items:
        unit_id = item.question.get("unit_id")
        if isinstance(unit_id, str) and item.subject in {"math", "japanese"}:
            subjects_by_unit[unit_id].add(item.subject)
    out = {unit: next(iter(subjects)) for unit, subjects in subjects_by_unit.items() if len(subjects) == 1}
    for unit in list(subjects_by_unit):
        out.setdefault(unit, infer_subject_from_unit(unit) or "unknown")
    return {unit: subject for unit, subject in out.items() if subject in {"math", "japanese"}}


def iter_lesson_bundle(root: Path, unit_subject_map: dict[str, str]) -> Iterable[SourceQuestion]:
    path = root / "frontend" / "public" / "data" / "lessons.json"
    if not path.exists():
        return
    lessons = read_json(path)
    if not isinstance(lessons, list):
        raise SystemExit(f"[error] lessons.json must be a list: {path}")
    for lesson in lessons:
        lesson_id = lesson.get("id") or lesson.get("lesson_id")
        if not lesson_id:
            continue
        lesson_subject = infer_subject(lesson.get("subject"), lesson.get("unit_id"), lesson_id)
        source_date = lesson.get("date") or date_from_lesson_id(lesson_id) or date_from_created_at(lesson.get("created_at"))
        blocks = block_type_by_position(lesson)
        for question in lesson.get("questions") or []:
            position = question.get("position")
            unit_id = question.get("unit_id")
            question_subject = lesson_subject
            if question_subject == "unknown":
                question_subject = unit_subject_map.get(unit_id) or infer_subject_from_unit(unit_id) or "unknown"
            yield SourceQuestion(
                source_kind="lesson-bundle",
                source_path=rel_path(path, root),
                source_lesson_id=lesson_id,
                source_position=position if isinstance(position, int) else None,
                source_date=source_date,
                subject=question_subject,
                lesson_title=lesson.get("title"),
                question=question,
                block_type=blocks.get(position) if isinstance(position, int) else None,
            )


def source_ref(item: SourceQuestion) -> dict[str, Any]:
    ref = {
        "source_kind": item.source_kind,
        "source_path": item.source_path,
        "source_lesson_id": item.source_lesson_id,
        "source_position": item.source_position,
        "source_date": item.source_date,
        "subject": item.subject,
    }
    if item.stock_topic:
        ref["stock_topic"] = item.stock_topic
    if item.block_type:
        ref["block_type"] = item.block_type
    return ref


def source_sort_key(item: SourceQuestion) -> tuple[Any, ...]:
    return (
        SOURCE_PRIORITY.get(item.source_kind, 99),
        item.source_date or "9999-99-99",
        item.source_path,
        item.source_lesson_id,
        item.source_position if item.source_position is not None else 99999,
    )


def bank_id_for(item: SourceQuestion) -> str:
    subject_prefix = SUBJECT_PREFIX.get(item.subject, "x")
    date_part = (item.source_date or "nodate").replace("-", "")
    lesson_part = re.sub(r"[^a-zA-Z0-9]+", "-", item.source_lesson_id).strip("-").lower()
    position = item.source_position if item.source_position is not None else 0
    return f"pb-{subject_prefix}-{date_part}-{lesson_part}-q{position:02d}"


def is_figure_question(question: dict[str, Any]) -> bool:
    if question.get("is_figure") is True:
        return True
    if question.get("figure_svg"):
        return True
    return False


def svg_status(question: dict[str, Any]) -> str:
    if not is_figure_question(question):
        return "not_required"
    svg = question.get("figure_svg")
    return "svg_present_unreviewed" if isinstance(svg, str) and len(svg.strip()) >= 10 else "visual_fail"


def quality_seed() -> dict[str, Any]:
    return {
        "pedagogy_score": None,
        "solvability_score": None,
        "distractor_score": None,
        "render_score": None,
        "reuse_grade": None,
        "review_status": "unreviewed",
        "reviewed_at": None,
        "review_note": None,
    }


def reuse_seed() -> dict[str, Any]:
    return {
        "times_used": 0,
        "last_used_date": None,
        "cooldown_until": None,
    }


def tags_for(item: SourceQuestion, question: dict[str, Any]) -> list[str]:
    tags = {item.source_kind, item.subject}
    unit_id = question.get("unit_id")
    if isinstance(unit_id, str) and unit_id:
        tags.add(unit_id)
    if is_figure_question(question):
        tags.add("figure")
        if question.get("figure_svg"):
            tags.add("svg")
    if item.stock_topic:
        tags.add(item.stock_topic)
    if item.block_type:
        tags.add(item.block_type)
    return sorted(tags)


def build_entry(primary: SourceQuestion, duplicates: list[SourceQuestion]) -> dict[str, Any]:
    question = compact_question(primary.question)
    text = str(primary.question.get("question_text") or "")
    figure_svg = primary.question.get("figure_svg")
    figure_svg_hash = sha256_text(figure_svg) if isinstance(figure_svg, str) and figure_svg else None
    meta = primary.question.get("meta") if isinstance(primary.question.get("meta"), dict) else {}
    entry = {
        "bank_id": bank_id_for(primary),
        "source_kind": primary.source_kind,
        "source_path": primary.source_path,
        "source_lesson_id": primary.source_lesson_id,
        "source_position": primary.source_position,
        "source_date": primary.source_date,
        "subject": primary.subject,
        "unit_id": primary.question.get("unit_id"),
        "pattern_id": primary.question.get("pattern_id") or primary.question.get("unit_id"),
        "difficulty": primary.question.get("difficulty"),
        "question_type": primary.question.get("question_type", "single_tier"),
        "tier1_purpose": primary.question.get("tier1_purpose"),
        "tier2_purpose": primary.question.get("tier2_purpose"),
        "question_text_hash": sha256_text(text),
        "content_hash": sha256_json(content_payload(primary.question)),
        "figure_svg_hash": figure_svg_hash,
        "is_figure": is_figure_question(primary.question),
        "svg_status": svg_status(primary.question),
        "quality_status": "inventory_only_unreviewed",
        "validation_status": "not_evaluated",
        "validation_rules": [],
        "quality": quality_seed(),
        "reuse": reuse_seed(),
        "tags": tags_for(primary, primary.question),
        "question": question,
        "source_aliases": [source_ref(primary)],
        "duplicate_sources": [source_ref(item) for item in duplicates],
    }
    if primary.lesson_title:
        entry["source_lesson_title"] = primary.lesson_title
    if primary.stock_topic:
        entry["stock_topic"] = primary.stock_topic
    if primary.block_type:
        entry["block_type"] = primary.block_type
    for key in ("target_anchor", "match_type", "difficulty_from_anchor", "learning_signal", "recommended_intervention"):
        if key in meta:
            entry[key] = meta[key]
    return entry


def collect_questions(root: Path) -> list[SourceQuestion]:
    canonical_sources = [
        *iter_stock(root),
        *iter_handwritten(root),
    ]
    unit_subject_map = build_unit_subject_map(canonical_sources)
    return [
        *canonical_sources,
        *iter_lesson_bundle(root, unit_subject_map),
    ]


def build_problem_bank(root: Path = ROOT) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_hash: dict[str, list[SourceQuestion]] = defaultdict(list)
    source_items = collect_questions(root)
    for item in source_items:
        by_hash[sha256_json(dedupe_payload(item.question))].append(item)

    entries: list[dict[str, Any]] = []
    duplicate_count = 0
    for items in by_hash.values():
        ordered = sorted(items, key=source_sort_key)
        primary, duplicates = ordered[0], ordered[1:]
        duplicate_count += len(duplicates)
        entries.append(build_entry(primary, duplicates))

    ensure_unique_bank_ids(entries)
    entries.sort(key=lambda e: (e["subject"], e["source_date"] or "9999-99-99", e["source_kind"], e["source_lesson_id"], e["source_position"] or 0, e["bank_id"]))
    index = build_index(entries, source_items, duplicate_count)
    return entries, index


def ensure_unique_bank_ids(entries: list[dict[str, Any]]) -> None:
    counts = Counter(str(entry["bank_id"]) for entry in entries)
    for entry in entries:
        if counts[str(entry["bank_id"])] <= 1:
            continue
        entry["bank_id"] = f"{entry['bank_id']}-{sha256_json(entry['question'])[:8]}"


def build_index(entries: list[dict[str, Any]], source_items: list[SourceQuestion], duplicate_count: int) -> dict[str, Any]:
    subject_counts = Counter(str(e.get("subject")) for e in entries)
    source_counts = Counter(item.source_kind for item in source_items)
    primary_source_counts = Counter(str(e.get("source_kind")) for e in entries)
    unit_counts = Counter(str(e.get("unit_id")) for e in entries if e.get("unit_id"))
    difficulty_counts = Counter(str(e.get("difficulty")) for e in entries if e.get("difficulty"))
    svg_counts = Counter(str(e.get("svg_status")) for e in entries)
    return {
        "version": 1,
        "quality_status": "inventory_only_unreviewed",
        "generated_at": datetime.now(JST).isoformat(),
        "total_questions": len(entries),
        "source_question_count": len(source_items),
        "duplicates_collapsed": duplicate_count,
        "source_counts": dict(sorted(source_counts.items())),
        "primary_source_counts": dict(sorted(primary_source_counts.items())),
        "subject_counts": dict(sorted(subject_counts.items())),
        "difficulty_counts": dict(sorted(difficulty_counts.items())),
        "svg_status_counts": dict(sorted(svg_counts.items())),
        "total_units": len(unit_counts),
        "top_units": [{"unit_id": unit, "count": count} for unit, count in unit_counts.most_common(25)],
    }


def write_problem_bank(entries: list[dict[str, Any]], index: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "reviews").mkdir(exist_ok=True)
    (output_dir / "render-cache").mkdir(exist_ok=True)
    (output_dir / "usage.jsonl").touch(exist_ok=True)
    (output_dir / "questions.jsonl").write_text(
        "".join(canonical_json(entry) + "\n" for entry in entries),
        encoding="utf-8",
    )
    (output_dir / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build data/problem-bank/questions.jsonl from existing lesson sources")
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--output-dir", type=Path, default=PROBLEM_BANK_DIR)
    args = parser.parse_args()

    root = args.repo_root.resolve()
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    entries, index = build_problem_bank(root)
    write_problem_bank(entries, index, output_dir)
    print(
        "[problem-bank] wrote "
        f"{index['total_questions']} questions "
        f"({index['duplicates_collapsed']} duplicates collapsed) to {output_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
