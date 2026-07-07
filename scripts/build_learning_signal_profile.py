#!/usr/bin/env python3
"""Build derived learning-signal profile from pulled answer logs."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from audit_learning_signals import (
    AttemptGroup,
    audit_groups,
    build_attempt,
    group_attempts,
    is_late,
    iter_events,
    load_question_meta,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9))
SIGNAL_TO_INTERVENTION = {
    "concept_gap": "concept_contrast",
    "procedure_gap": "process_scaffold",
    "reading_load": "short_reading_evidence",
    "careless_or_tap_noise": "slow_confirm",
    "fatigue_throwaway": "rest_or_short_block",
    "question_quality_bug": "fix_question",
}
INVALID_ACCURACY_SIGNALS = {"fatigue_throwaway", "question_quality_bug"}


@dataclass
class PatternBucket:
    pattern_id: str
    subject: str
    total_groups: int = 0
    valid_groups: int = 0
    valid_final_correct: int = 0
    first_wrong: int = 0
    fast_wrong: int = 0
    late_groups: int = 0
    late_wrong: int = 0
    signal_counts: Counter[str] = field(default_factory=Counter)
    lesson_ids: set[str] = field(default_factory=set)
    latest_answered_at: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build data/learning_signal_profile.json")
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
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "data" / "learning_signal_profile.json",
    )
    return parser.parse_args()


def pct(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round((numerator / denominator) * 100, 1)


def signal_confidence(top_count: int, wrong_count: int) -> float:
    if wrong_count == 0:
        return 0.0
    sample_factor = min(1.0, wrong_count / 5)
    return round((top_count / wrong_count) * sample_factor, 2)


def top_signal(signal_counts: Counter[str]) -> str | None:
    if not signal_counts:
        return None
    return signal_counts.most_common(1)[0][0]


def intervention_for(signal: str | None) -> str:
    if signal is None:
        return "maintain"
    return SIGNAL_TO_INTERVENTION.get(signal, "concept_contrast")


def build_signal_profile(
    groups: list[AttemptGroup],
    start_date: str,
    end_date: str,
    generated_at: str,
) -> dict[str, Any]:
    row_by_group_key = {row.group_key: row for row in audit_groups(groups)}

    buckets: dict[tuple[str, str], PatternBucket] = {}
    for group in groups:
        pattern_id = group.first.unit_id or "unknown"
        subject = group.first.subject
        key = (subject, pattern_id)
        bucket = buckets.setdefault(key, PatternBucket(pattern_id=pattern_id, subject=subject))
        bucket.total_groups += 1
        bucket.lesson_ids.add(group.first.lesson_id)
        bucket.latest_answered_at = max(bucket.latest_answered_at, group.last.answered_at)
        if is_late(group):
            bucket.late_groups += 1

        signal = None
        if not group.first.is_correct:
            bucket.first_wrong += 1
            if group.first.time_spent_sec <= 3:
                bucket.fast_wrong += 1
            if is_late(group):
                bucket.late_wrong += 1
            row = row_by_group_key.get(group.key)
            signal = row.signal if row else None
            if signal:
                bucket.signal_counts[signal] += 1

        if signal not in INVALID_ACCURACY_SIGNALS:
            bucket.valid_groups += 1
            if group.last.is_correct:
                bucket.valid_final_correct += 1

    rows = []
    for bucket in buckets.values():
        signal = top_signal(bucket.signal_counts)
        top_count = bucket.signal_counts[signal] if signal else 0
        rows.append(
            {
                "pattern_id": bucket.pattern_id,
                "subject": bucket.subject,
                "learning_signal": signal,
                "signal_confidence": signal_confidence(top_count, bucket.first_wrong),
                "recommended_intervention": intervention_for(signal),
                "recent_valid_accuracy": pct(bucket.valid_final_correct, bucket.valid_groups),
                "recent_fast_wrong_rate": pct(bucket.fast_wrong, bucket.total_groups),
                "recent_late_drop_rate": pct(bucket.late_wrong, bucket.late_groups),
                "recent_attempts": bucket.total_groups,
                "recent_valid_attempts": bucket.valid_groups,
                "recent_first_wrong_count": bucket.first_wrong,
                "signal_counts": dict(sorted(bucket.signal_counts.items())),
                "lesson_ids": sorted(bucket.lesson_ids),
                "latest_answered_at": bucket.latest_answered_at,
            }
        )

    return {
        "version": 1,
        "generated_at": generated_at,
        "date_range": {"start": start_date, "end": end_date, "timezone": "Asia/Tokyo"},
        "metric_notes": {
            "recent_valid_accuracy": "final accuracy excluding fatigue_throwaway and question_quality_bug first-wrong groups",
            "recent_fast_wrong_rate": "first-wrong attempts at <=3 seconds divided by recent attempts",
            "recent_late_drop_rate": "late first-wrong groups divided by late groups",
        },
        "rows": sorted(rows, key=lambda row: (row["subject"], row["pattern_id"])),
    }


def build_from_files(
    start_date: str,
    end_date: str,
    play_log_dir: Path,
    handwritten_dir: Path,
    built_lessons: Path,
    generated_at: str | None = None,
) -> dict[str, Any]:
    meta = load_question_meta(handwritten_dir, built_lessons)
    events, _ = iter_events(play_log_dir, start_date, end_date, include_invalidated=False)
    attempts = [attempt for event in events if (attempt := build_attempt(event, meta))]
    groups = group_attempts(attempts)
    return build_signal_profile(
        groups,
        start_date=start_date,
        end_date=end_date,
        generated_at=generated_at or datetime.now(JST).isoformat(timespec="seconds"),
    )


def main() -> int:
    args = parse_args()
    payload = build_from_files(
        args.start_date,
        args.end_date,
        args.play_log_dir,
        args.handwritten_dir,
        args.built_lessons,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output} ({len(payload['rows'])} signal rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
