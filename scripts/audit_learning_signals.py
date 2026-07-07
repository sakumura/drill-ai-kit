#!/usr/bin/env python3
"""Audit answer logs into learning-signal buckets.

The script is intentionally heuristic: it produces an auditable first pass for
human review before the signals are wired into production scoring.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable

try:
    from play_log_invalidation import invalidation_reason, load_rules
except ModuleNotFoundError:
    from scripts.play_log_invalidation import invalidation_reason, load_rules


REPO_ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9))
SIGNALS = (
    "concept_gap",
    "procedure_gap",
    "reading_load",
    "careless_or_tap_noise",
    "fatigue_throwaway",
    "question_quality_bug",
)
PROCESS_PURPOSES = {
    "strategy",
    "formula",
    "diagram",
    "basis",
    "calculation",
    "unit",
    "error_diagnosis",
}
READING_PURPOSES = {"evidence", "elimination_reason", "expression_effect"}
QUICK_WRONG_SEC = 3
THROWAWAY_SEC = 5
FATIGUE_POSITION = 21
FATIGUE_PROGRESS = 0.70
PLAY_RUN_GAP_SECONDS = 30 * 60


@dataclass(frozen=True)
class QuestionMeta:
    question_id: str
    lesson_id: str
    lesson_title: str
    subject: str
    position: int | None
    total_questions: int | None
    unit_id: str
    difficulty: str
    question_type: str
    tier1_purpose: str
    tier2_purpose: str
    step_purpose: str
    question_text: str
    answer: str
    common_mistakes: tuple[str, ...]


@dataclass(frozen=True)
class Attempt:
    session_id: str
    question_id: str
    lesson_id: str
    play_run: int
    user_answer: str
    is_correct: bool
    time_spent_sec: float
    answered_at: str
    day: str
    step: int
    unit_id: str
    difficulty: str
    question_type: str
    step_purpose: str
    subject: str
    meta: QuestionMeta | None


@dataclass(frozen=True)
class AttemptGroup:
    key: tuple[str, str, int, str, int]
    attempts: tuple[Attempt, ...]
    first: Attempt
    last: Attempt
    position: int | None
    total_questions: int | None


@dataclass(frozen=True)
class AuditRow:
    group_key: tuple[str, str, int, str, int]
    signal: str
    reason: str
    day: str
    subject: str
    lesson_id: str
    lesson_title: str
    position: int | None
    total_questions: int | None
    question_id: str
    unit_id: str
    difficulty: str
    step_purpose: str
    time_spent_sec: float
    attempts: int
    rescued: bool
    user_answer: str
    correct_answer: str
    question_text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit answer logs into learning_signal buckets")
    parser.add_argument("--start-date", required=True, help="JST date, YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="JST date, YYYY-MM-DD")
    parser.add_argument(
        "--play-log-dir",
        type=Path,
        default=REPO_ROOT / "data" / "play_log",
        help="Directory containing pulled R2 JSONL logs",
    )
    parser.add_argument(
        "--handwritten-dir",
        type=Path,
        default=REPO_ROOT / "data" / "lessons-handwritten",
        help="Directory containing handwritten lesson JSON",
    )
    parser.add_argument(
        "--built-lessons",
        type=Path,
        default=REPO_ROOT / "frontend" / "public" / "data" / "lessons.json",
        help="Built lessons JSON used as metadata fallback",
    )
    parser.add_argument("--output", type=Path, default=None, help="Write markdown report to this path")
    parser.add_argument(
        "--include-invalidated",
        action="store_true",
        help="Include events matched by data/play_log/invalidations.json",
    )
    return parser.parse_args()


def parse_iso(iso: str) -> datetime:
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def jst_day(iso: str) -> str:
    parsed = parse_iso(iso)
    return parsed.astimezone(JST).date().isoformat()


def in_range(day: str, start: str, end: str) -> bool:
    return start <= day <= end


def normalize_answer(value: str) -> str:
    text = value.lower()
    for token in ("cm", "㎝", "平方", "°", "℃"):
        text = text.replace(token, "")
    return re.sub(r"[\s　、。，．・]+", "", text)


def coerce_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def difficulty_value(value: str) -> int:
    match = re.search(r"(\d+)", value)
    return int(match.group(1)) if match else 0


def subject_from_lesson_id(lesson_id: str) -> str:
    if lesson_id.startswith("lesson-m-"):
        return "math"
    if lesson_id.startswith("lesson-j-"):
        return "japanese"
    return "unknown"


def question_id_for(lesson_id: str, question: dict[str, Any]) -> str:
    existing = question.get("id")
    if isinstance(existing, str) and existing:
        return existing
    position = question.get("position")
    if isinstance(position, int):
        return f"q-{lesson_id}-{position:02d}"
    return f"q-{lesson_id}-unknown"


def mistake_texts(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    rows: list[str] = []
    for item in value:
        if isinstance(item, str):
            rows.append(item)
        elif isinstance(item, dict):
            rows.append(" ".join(coerce_str(v) for v in item.values() if v is not None))
    return tuple(rows)


def lesson_questions(lesson: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield from lesson.get("questions") or []
    yield from lesson.get("reading_questions") or []


def build_question_meta_from_lesson(lesson: dict[str, Any]) -> dict[str, QuestionMeta]:
    lesson_id = coerce_str(lesson.get("lesson_id") or lesson.get("id"))
    if not lesson_id:
        return {}
    subject = coerce_str(lesson.get("subject") or subject_from_lesson_id(lesson_id))
    title = coerce_str(lesson.get("title"))
    questions = list(lesson_questions(lesson))
    total = len(questions) or None
    out: dict[str, QuestionMeta] = {}
    for index, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            continue
        position = question.get("position")
        if not isinstance(position, int):
            position = index
        question_id = question_id_for(lesson_id, question)
        correct = question.get("answer")
        if correct is None and isinstance(question.get("choices"), list):
            for choice in question["choices"]:
                if isinstance(choice, dict) and choice.get("isCorrect") is True:
                    correct = choice.get("text")
                    break
        out[question_id] = QuestionMeta(
            question_id=question_id,
            lesson_id=lesson_id,
            lesson_title=title,
            subject=subject,
            position=position,
            total_questions=total,
            unit_id=coerce_str(question.get("unit_id") or lesson.get("unit_id")),
            difficulty=coerce_str(question.get("difficulty") or question.get("difficulty_tier")),
            question_type=coerce_str(question.get("question_type")),
            tier1_purpose=coerce_str(question.get("tier1_purpose")),
            tier2_purpose=coerce_str(question.get("tier2_purpose")),
            step_purpose=coerce_str(question.get("step_purpose")),
            question_text=coerce_str(question.get("question_text") or question.get("prompt")),
            answer=coerce_str(correct),
            common_mistakes=mistake_texts(question.get("common_mistakes")),
        )
    return out


def load_question_meta(handwritten_dir: Path, built_lessons: Path) -> dict[str, QuestionMeta]:
    meta: dict[str, QuestionMeta] = {}
    for path in sorted(handwritten_dir.glob("*.json")):
        try:
            lesson = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        meta.update(build_question_meta_from_lesson(lesson))

    if built_lessons.exists():
        try:
            payload = json.loads(built_lessons.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = []
        lessons = payload if isinstance(payload, list) else payload.get("lessons", [])
        for lesson in lessons:
            if isinstance(lesson, dict):
                for question_id, row in build_question_meta_from_lesson(lesson).items():
                    meta.setdefault(question_id, row)
    return meta


def event_date(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    raw = payload.get("answered_at") or payload.get("completed_at") or event.get("occurred_at")
    return jst_day(coerce_str(raw))


def iter_events(
    play_log_dir: Path,
    start: str,
    end: str,
    include_invalidated: bool,
) -> tuple[list[dict[str, Any]], int]:
    rules = [] if include_invalidated else load_rules()
    events: list[dict[str, Any]] = []
    invalidated = 0
    for path in sorted(play_log_dir.glob("*.jsonl")):
        if path.name.endswith(".tmp"):
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            try:
                day = event_date(event)
            except ValueError:
                continue
            if not in_range(day, start, end):
                continue
            if not include_invalidated and invalidation_reason(event, rules):
                invalidated += 1
                continue
            events.append(event)
    return sorted(events, key=lambda event: coerce_str(event.get("occurred_at"))), invalidated


def resolve_step_purpose(payload: dict[str, Any], meta: QuestionMeta | None, step: int) -> str:
    logged = payload.get("step_purpose")
    if isinstance(logged, str) and logged:
        return logged
    if meta is None:
        return "answer"

    if step == 1:
        candidates = (meta.tier1_purpose, meta.step_purpose, meta.tier2_purpose)
    elif step == 2:
        candidates = (meta.tier2_purpose, meta.step_purpose, meta.tier1_purpose)
    else:
        candidates = (meta.step_purpose, meta.tier1_purpose, meta.tier2_purpose)

    return next((value for value in candidates if value), "answer")


def build_attempt(event: dict[str, Any], meta_by_question: dict[str, QuestionMeta]) -> Attempt | None:
    if event.get("type") != "answer":
        return None
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    question_id = payload.get("question_id")
    lesson_id = payload.get("lesson_id")
    if not isinstance(question_id, str) or not isinstance(lesson_id, str):
        return None
    meta = meta_by_question.get(question_id)
    answered_at = coerce_str(payload.get("answered_at") or event.get("occurred_at"))
    step = payload.get("step") if isinstance(payload.get("step"), int) else 1
    return Attempt(
        session_id=coerce_str(event.get("session_id")),
        question_id=question_id,
        lesson_id=lesson_id,
        play_run=0,
        user_answer=coerce_str(payload.get("user_answer")),
        is_correct=payload.get("is_correct") is True,
        time_spent_sec=float(payload.get("time_spent_sec") or 0),
        answered_at=answered_at,
        day=jst_day(answered_at),
        step=step,
        unit_id=coerce_str(payload.get("unit_id") or (meta.unit_id if meta else "")),
        difficulty=coerce_str(payload.get("difficulty") or (meta.difficulty if meta else "")),
        question_type=coerce_str(
            payload.get("question_type") or (meta.question_type if meta else "")
        ),
        step_purpose=resolve_step_purpose(payload, meta, step),
        subject=meta.subject if meta else subject_from_lesson_id(lesson_id),
        meta=meta,
    )


def attempt_position(attempt: Attempt) -> int | None:
    if attempt.meta:
        return attempt.meta.position
    return parse_position(attempt.question_id)


def assign_play_runs(attempts: Iterable[Attempt]) -> list[Attempt]:
    by_lesson: dict[tuple[str, str], list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        by_lesson[(attempt.session_id, attempt.lesson_id)].append(attempt)

    with_runs: list[Attempt] = []
    for lesson_attempts in by_lesson.values():
        run = 0
        last_position: int | None = None
        last_at: datetime | None = None
        ordered = sorted(lesson_attempts, key=lambda item: item.answered_at)
        for attempt in ordered:
            current_at = parse_iso(attempt.answered_at)
            position = attempt_position(attempt)
            if last_at is not None:
                gap = (current_at - last_at).total_seconds()
                rewound = (
                    position is not None
                    and last_position is not None
                    and position < last_position
                )
                if gap > PLAY_RUN_GAP_SECONDS or rewound:
                    run += 1
            with_runs.append(replace(attempt, play_run=run))
            last_at = current_at
            if position is not None:
                last_position = position
    return sorted(with_runs, key=lambda item: (item.answered_at, item.session_id, item.lesson_id))


def group_attempts(attempts: Iterable[Attempt]) -> list[AttemptGroup]:
    buckets: dict[tuple[str, str, int, str, int], list[Attempt]] = defaultdict(list)
    for attempt in assign_play_runs(attempts):
        buckets[
            (
                attempt.session_id,
                attempt.lesson_id,
                attempt.play_run,
                attempt.question_id,
                attempt.step,
            )
        ].append(attempt)

    groups: list[AttemptGroup] = []
    for key, rows in buckets.items():
        ordered = tuple(sorted(rows, key=lambda item: item.answered_at))
        meta = ordered[0].meta
        position = meta.position if meta else parse_position(ordered[0].question_id)
        groups.append(
            AttemptGroup(
                key=key,
                attempts=ordered,
                first=ordered[0],
                last=ordered[-1],
                position=position,
                total_questions=meta.total_questions if meta else None,
            )
        )
    return sorted(groups, key=lambda group: (group.first.answered_at, group.key))


def parse_position(question_id: str) -> int | None:
    match = re.search(r"-(\d+)$", question_id)
    return int(match.group(1)) if match else None


def is_late(group: AttemptGroup) -> bool:
    position = group.position
    if position is None:
        return False
    total = group.total_questions
    if total and total > 0 and (position / total) >= FATIGUE_PROGRESS:
        return True
    return position >= FATIGUE_POSITION


def fatigue_run_lengths(groups: list[AttemptGroup]) -> dict[tuple[str, str, int, str, int], int]:
    by_run: dict[tuple[str, str, int], list[AttemptGroup]] = defaultdict(list)
    for group in groups:
        by_run[(group.first.session_id, group.first.lesson_id, group.first.play_run)].append(group)

    runs: dict[tuple[str, str, int, str, int], int] = {}
    for run_groups in by_run.values():
        run = 0
        ordered = sorted(
            run_groups,
            key=lambda group: (group.position or 9999, group.first.answered_at),
        )
        for group in ordered:
            first = group.first
            if not first.is_correct and first.time_spent_sec <= THROWAWAY_SEC:
                run += 1
            else:
                run = 0
            runs[group.key] = run
    return runs


def likely_question_quality_bug(attempt: Attempt) -> bool:
    meta = attempt.meta
    if not meta or not meta.answer:
        return False
    return normalize_answer(attempt.user_answer) == normalize_answer(meta.answer)


def classify_signal(group: AttemptGroup, fatigue_run: int = 0) -> tuple[str, str]:
    first = group.first
    purpose = first.step_purpose
    text_len = len(first.meta.question_text) if first.meta else 0
    diff = difficulty_value(first.difficulty)

    if likely_question_quality_bug(first):
        return "question_quality_bug", "ログ上は不正解だが、回答文字列がlesson上の正答と一致"

    if first.time_spent_sec <= THROWAWAY_SEC and (is_late(group) or fatigue_run >= 3):
        return (
            "fatigue_throwaway",
            "後半または連続短秒誤答で、実力判定より疲労/投げ出しの可能性が高い",
        )

    if first.time_spent_sec <= QUICK_WRONG_SEC:
        return "careless_or_tap_noise", "3秒以下の初回誤答"

    if first.subject == "japanese" and (purpose in READING_PURPOSES or diff >= 4):
        return "reading_load", "国語の根拠/消去/表現効果またはd4以上で読解負荷が高い"

    if text_len >= 80 and first.time_spent_sec >= 10:
        return "reading_load", "問題文が長く、読解負荷の影響を疑う"

    if purpose in PROCESS_PURPOSES:
        return "procedure_gap", "式・図・基準量・方針などのprocess目的で誤答"

    return "concept_gap", "短秒/疲労/読解/手順に寄せる根拠が弱い通常の理解不足"


def audit_groups(groups: list[AttemptGroup]) -> list[AuditRow]:
    runs = fatigue_run_lengths(groups)
    rows: list[AuditRow] = []
    for group in groups:
        if group.first.is_correct:
            continue
        signal, reason = classify_signal(group, runs.get(group.key, 0))
        meta = group.first.meta
        rows.append(
            AuditRow(
                group_key=group.key,
                signal=signal,
                reason=reason,
                day=group.first.day,
                subject=group.first.subject,
                lesson_id=group.first.lesson_id,
                lesson_title=meta.lesson_title if meta else "",
                position=group.position,
                total_questions=group.total_questions,
                question_id=group.first.question_id,
                unit_id=group.first.unit_id,
                difficulty=group.first.difficulty,
                step_purpose=group.first.step_purpose,
                time_spent_sec=group.first.time_spent_sec,
                attempts=len(group.attempts),
                rescued=not group.first.is_correct and group.last.is_correct,
                user_answer=group.first.user_answer,
                correct_answer=meta.answer if meta else "",
                question_text=meta.question_text if meta else "",
            )
        )
    return rows


def pct(numerator: int | float, denominator: int | float) -> str:
    if denominator == 0:
        return "0.0%"
    return f"{(numerator / denominator) * 100:.1f}%"


def short(value: str, limit: int = 38) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    return compact if len(compact) <= limit else compact[: limit - 1] + "..."


def md_escape(value: Any) -> str:
    text = coerce_str(value).replace("\n", " ")
    return text.replace("|", "\\|")


def lesson_signal_summary(rows: list[AuditRow]) -> str:
    by_lesson: dict[str, list[AuditRow]] = defaultdict(list)
    for row in rows:
        by_lesson[row.lesson_id].append(row)
    lines = [
        "| lesson | subject | first misses | rescued | quick<=3s | late misses | top signals |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for lesson_id, lesson_rows in sorted(by_lesson.items()):
        counts = Counter(row.signal for row in lesson_rows)
        top = ", ".join(f"{signal}:{count}" for signal, count in counts.most_common(3))
        quick = sum(1 for row in lesson_rows if row.time_spent_sec <= QUICK_WRONG_SEC)
        late = sum(
            1
            for row in lesson_rows
            if row.position is not None
            and (
                row.position >= FATIGUE_POSITION
                or (row.total_questions and row.position / row.total_questions >= FATIGUE_PROGRESS)
            )
        )
        subject = lesson_rows[0].subject
        rescued = sum(1 for row in lesson_rows if row.rescued)
        lines.append(
            f"| `{lesson_id}` | {subject} | {len(lesson_rows)} | {rescued} | {quick} | {late} | {top} |"
        )
    return "\n".join(lines)


def signal_count_table(rows: list[AuditRow]) -> str:
    counts = Counter(row.signal for row in rows)
    lines = ["| learning_signal | count | share |", "|---|---:|---:|"]
    for signal in SIGNALS:
        count = counts.get(signal, 0)
        lines.append(f"| `{signal}` | {count} | {pct(count, len(rows))} |")
    return "\n".join(lines)


def unit_hotspot_table(rows: list[AuditRow]) -> str:
    grouped: dict[tuple[str, str], list[AuditRow]] = defaultdict(list)
    for row in rows:
        grouped[(row.subject, row.unit_id or "unknown")].append(row)
    ranked = sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0]))
    lines = [
        "| subject | unit | misses | top_signal | quick<=3s | fatigue |",
        "|---|---|---:|---|---:|---:|",
    ]
    for (subject, unit_id), unit_rows in ranked[:12]:
        counts = Counter(row.signal for row in unit_rows)
        top_signal, top_count = counts.most_common(1)[0]
        quick = sum(1 for row in unit_rows if row.time_spent_sec <= QUICK_WRONG_SEC)
        fatigue = counts.get("fatigue_throwaway", 0)
        lines.append(
            f"| {subject} | `{unit_id}` | {len(unit_rows)} | `{top_signal}` ({top_count}) | {quick} | {fatigue} |"
        )
    return "\n".join(lines)


def detail_table(rows: list[AuditRow]) -> str:
    lines = [
        "| day | lesson | pos | signal | unit | diff | sec | rescued | answer -> correct | question |",
        "|---|---|---:|---|---|---|---:|---|---|---|",
    ]
    for row in rows:
        pos = "" if row.position is None else str(row.position)
        total = "" if row.total_questions is None else f"/{row.total_questions}"
        retry = "yes" if row.rescued else ""
        answer = f"{short(row.user_answer, 18)} -> {short(row.correct_answer, 18)}"
        lines.append(
            "| "
            + " | ".join(
                [
                    row.day,
                    f"`{row.lesson_id}`",
                    f"{pos}{total}",
                    f"`{row.signal}`",
                    f"`{md_escape(row.unit_id)}`",
                    md_escape(row.difficulty),
                    f"{row.time_spent_sec:g}",
                    retry,
                    md_escape(answer),
                    md_escape(short(row.question_text, 46)),
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def lesson_accuracy_table(groups: list[AttemptGroup]) -> str:
    by_lesson: dict[str, list[AttemptGroup]] = defaultdict(list)
    for group in groups:
        by_lesson[group.first.lesson_id].append(group)
    lines = [
        "| lesson | subject | questions/steps | first_correct | final_correct | first_acc | final_acc | quick_wrong |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for lesson_id, lesson_groups in sorted(by_lesson.items()):
        total = len(lesson_groups)
        first_correct = sum(1 for group in lesson_groups if group.first.is_correct)
        final_correct = sum(1 for group in lesson_groups if group.last.is_correct)
        quick_wrong = sum(
            1
            for group in lesson_groups
            if not group.first.is_correct and group.first.time_spent_sec <= QUICK_WRONG_SEC
        )
        subject = lesson_groups[0].first.subject
        lines.append(
            f"| `{lesson_id}` | {subject} | {total} | {first_correct} | {final_correct} | "
            f"{pct(first_correct, total)} | {pct(final_correct, total)} | {quick_wrong} |"
        )
    return "\n".join(lines)


def render_report(
    start: str,
    end: str,
    events: list[dict[str, Any]],
    invalidated: int,
    groups: list[AttemptGroup],
    rows: list[AuditRow],
) -> str:
    attempts = sum(len(group.attempts) for group in groups)
    lessons = {group.first.lesson_id for group in groups}
    first_misses = len(rows)
    signal_counts = Counter(row.signal for row in rows)
    fatigue_rows = [row for row in rows if row.signal == "fatigue_throwaway"]
    quick_rows = [row for row in rows if row.time_spent_sec <= QUICK_WRONG_SEC]
    generated = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S JST")

    findings = [
        f"{start}〜{end} JST の answer first-attempt {len(groups)}件"
        f"（raw attempts {attempts}件、raw events {len(events)}件、lesson {len(lessons)}本）を監査。",
        f"初回誤答は {first_misses}件。最多 signal は {signal_counts.most_common(1)[0][0] if rows else 'none'}。",
        f"3秒以下の初回誤答は {len(quick_rows)}件、"
        f"後半/連続短秒の fatigue_throwaway は {len(fatigue_rows)}件。",
    ]
    if invalidated:
        findings.append(f"既存 invalidation rule により {invalidated} event を除外。")

    lines = [
        f"# Learning Signal Audit: {start} to {end}",
        "",
        f"Generated: {generated}",
        "",
        "## Executive Summary",
        "",
    ]
    lines.extend(f"- {item}" for item in findings)
    lines.extend(
        [
            "",
            "## Classification Rules",
            "",
            "- `question_quality_bug`: ログ上は不正解だが、正規化した回答文字列が lesson の正答と一致する。",
            "- `fatigue_throwaway`: 初回誤答が5秒以下で、問題位置が後半70%以上または21問目以降、"
            "もしくは短秒誤答が3連続以上。",
            "- `careless_or_tap_noise`: 初回誤答が3秒以下で、疲労扱いする文脈がない。",
            "- `reading_load`: 国語の根拠・消去理由・表現効果、d4以上、または長文問題で読解負荷が強い。",
            "- `procedure_gap`: 式・図・基準量・方針など process 目的の設問で誤答している。",
            "- `concept_gap`: 上記に寄せる根拠が弱い通常の理解不足。",
            "- Attempts are grouped by `session_id + lesson_id + inferred play_run + question_id + step`; "
            "a new play run starts after a 30-minute gap or when question position rewinds.",
            "",
            "## Lesson Accuracy",
            "",
            lesson_accuracy_table(groups),
            "",
            "## Signal Counts",
            "",
            signal_count_table(rows),
            "",
            "## Lesson Signal Summary",
            "",
            lesson_signal_summary(rows),
            "",
            "## Unit Hotspots",
            "",
            unit_hotspot_table(rows),
            "",
            "## Detailed First Wrong Attempts",
            "",
            detail_table(rows),
            "",
            "## Project Implications",
            "",
            "- #6 should land before dashboard work: the audit separates late short-second mistakes "
            "from normal weakness scoring, which supports block-level completion and optional extras.",
            "- #26 should treat process-purpose misses as first-class data: `procedure_gap` is already "
            "visible through `step_purpose=formula/basis/...`, but current single-step UI still mixes "
            "process and final-answer choices.",
            "- #5 retry branching should not retry `fatigue_throwaway` in place. Use `learning_signal` "
            "to choose between concept contrast, process scaffold, reading-load reduction, or no immediate retry.",
            "- #7 dashboard should display signal counts, quick-wrong rate, and late-collapse rate alongside score.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    meta = load_question_meta(args.handwritten_dir, args.built_lessons)
    events, invalidated = iter_events(args.play_log_dir, args.start_date, args.end_date, args.include_invalidated)
    attempts = [attempt for event in events if (attempt := build_attempt(event, meta))]
    groups = group_attempts(attempts)
    rows = audit_groups(groups)
    report = render_report(args.start_date, args.end_date, events, invalidated, groups, rows)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report.rstrip() + "\n", encoding="utf-8")
        print(f"wrote {args.output} ({len(rows)} first-miss rows from {len(groups)} first attempts)")
    else:
        print(report.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
