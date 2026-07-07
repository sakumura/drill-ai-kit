#!/usr/bin/env python3
from __future__ import annotations

import argparse
import glob
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CHOICE_TYPES = {"single_tier", "two_tier", "evidence_first"}


@dataclass
class Issue:
    source: str
    lesson_id: str
    question_id: str
    message: str

    def render(self) -> str:
        q = f" {self.question_id}" if self.question_id else ""
        return f"{self.source} {self.lesson_id}{q}: {self.message}"


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def normalize(value: Any) -> str:
    return str(value or "").strip()


def flat_hints(question: dict[str, Any]) -> list[str]:
    hints = question.get("hints")
    if not isinstance(hints, list):
        return []
    if hints and isinstance(hints[0], list):
        out: list[str] = []
        for step in hints:
            if isinstance(step, list):
                out.extend(normalize(item) for item in step)
        return out
    return [normalize(item) for item in hints]


def lesson_id_of(lesson: dict[str, Any]) -> str:
    return normalize(lesson.get("lesson_id") or lesson.get("id"))


def question_id_of(lesson_id: str, question: dict[str, Any]) -> str:
    return normalize(question.get("id")) or f"pos{question.get('position', '?')}"


def iter_lesson_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(Path(p) for p in sorted(glob.glob(str(path / "*.json"))))
        elif path.exists():
            files.append(path)
    return files


def iter_lessons(path: Path) -> list[dict[str, Any]]:
    data = load_json(path)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def collect_schedule(schedule_path: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    if not schedule_path.exists():
        return {}, []
    rows = load_json(schedule_path)
    if not isinstance(rows, list):
        return {}, []
    lesson_dates: dict[str, str] = {}
    schedule_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        lesson_id = normalize(row.get("lesson_id") or row.get("id"))
        date = normalize(row.get("date"))
        if lesson_id and date:
            lesson_dates[lesson_id] = date
            schedule_rows.append(row)
    return lesson_dates, schedule_rows


def matches_filter(lesson: dict[str, Any], lesson_dates: dict[str, str], date: str | None, lesson_ids: set[str]) -> bool:
    lesson_id = lesson_id_of(lesson)
    if lesson_ids and lesson_id not in lesson_ids:
        return False
    if date is None:
        return True
    return normalize(lesson.get("date")) == date or lesson_dates.get(lesson_id) == date


def collect_slot_correct_values(config: Any) -> list[str]:
    if not isinstance(config, dict):
        return []
    if config.get("type") == "two_tier_slot":
        return collect_slot_correct_values(config.get("tier1")) + collect_slot_correct_values(config.get("tier2"))
    value = normalize(config.get("correct_value"))
    return [value] if value else []


def validate_question(source: str, lesson_id: str, question: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    question_id = question_id_of(lesson_id, question)
    qtype = normalize(question.get("question_type")) or "single_tier"
    hints = question.get("hints")
    hint_values = flat_hints(question)
    answer = normalize(question.get("answer"))

    def add(message: str) -> None:
        issues.append(Issue(source, lesson_id, question_id, message))

    if qtype in CHOICE_TYPES:
        if not isinstance(hints, list) or (hints and isinstance(hints[0], list)):
            add(f"{qtype}: hints must be a flat string array")
        if len(hint_values) < 3:
            add(f"{qtype}: hints must contain at least 3 choices")
        if hint_values and not hint_values[0]:
            add(f"{qtype}: correct candidate hints[0] is empty")
        seen = set()
        duplicates = set()
        for value in hint_values:
            if value in seen:
                duplicates.add(value)
            seen.add(value)
        if duplicates:
            add(f"hints contain duplicates: {sorted(duplicates)}")
        if qtype == "single_tier" and answer != (hint_values[0] if hint_values else ""):
            add(f"single_tier: answer must match hints[0] (answer={answer!r}, hints[0]={hint_values[0] if hint_values else ''!r})")
        if qtype in {"two_tier", "evidence_first"}:
            if len(hint_values) < 6:
                add(f"{qtype}: hints must contain at least 6 choices")
            if len(hint_values) >= 4 and not hint_values[3]:
                add(f"{qtype}: second-tier correct candidate hints[3] is empty")
    elif qtype.startswith("slot_"):
        slot_config = question.get("slot_config")
        if not isinstance(slot_config, dict):
            add(f"{qtype}: slot_config is required")
        correct_values = collect_slot_correct_values(slot_config)
        if not correct_values and not answer:
            add(f"{qtype}: slot_config.correct_value or answer is required")
        for value in correct_values:
            if answer and answer != value and answer not in value and value not in answer:
                add(f"{qtype}: correct_value {value!r} is not aligned with answer {answer!r}")
    else:
        add(f"unknown question_type {qtype!r}")

    return issues


def validate_schedule(schedule_rows: list[dict[str, Any]], date: str | None, lesson_ids: set[str]) -> list[Issue]:
    issues: list[Issue] = []
    for row in schedule_rows:
        lesson_id = normalize(row.get("lesson_id") or row.get("id"))
        if lesson_ids and lesson_id not in lesson_ids:
            continue
        if date and normalize(row.get("date")) != date:
            continue
        if row.get("meta_reviewed_at") is None or row.get("parent_approved_at") is None:
            issues.append(Issue("frontend/public/data/schedule.json", lesson_id, "", "schedule approval fields are not set"))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate scoring-sensitive lesson JSON invariants.")
    parser.add_argument("paths", nargs="*", type=Path, default=[Path("data/lessons-handwritten"), Path("frontend/public/data/lessons.json")])
    parser.add_argument("--date", help="Limit validation by lesson date, e.g. 2026-05-17")
    parser.add_argument("--lesson-id", action="append", default=[], help="Limit validation to a lesson id. Can be repeated.")
    parser.add_argument("--schedule", type=Path, default=Path("frontend/public/data/schedule.json"))
    parser.add_argument("--skip-schedule", action="store_true", help="Skip schedule approval checks.")
    args = parser.parse_args()

    lesson_dates, schedule_rows = collect_schedule(args.schedule)
    lesson_ids = set(args.lesson_id)
    issues: list[Issue] = []
    checked = 0

    for path in iter_lesson_files(args.paths):
        for lesson in iter_lessons(path):
            if not matches_filter(lesson, lesson_dates, args.date, lesson_ids):
                continue
            lesson_id = lesson_id_of(lesson)
            questions = lesson.get("questions")
            if not isinstance(questions, list):
                continue
            checked += 1
            for question in questions:
                if isinstance(question, dict):
                    issues.extend(validate_question(str(path), lesson_id, question))

    if not args.skip_schedule:
        issues.extend(validate_schedule(schedule_rows, args.date, lesson_ids))

    if issues:
        print(f"validate_lesson_scoring: FAIL ({len(issues)} issues, {checked} lessons checked)")
        for issue in issues:
            print(f"- {issue.render()}")
        return 1

    print(f"validate_lesson_scoring: PASS ({checked} lessons checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
