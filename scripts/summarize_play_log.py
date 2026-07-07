#!/usr/bin/env python3
"""Summarize play_log JSONL for briefing Phase 1a / 1g / 1h.

briefing SKILL.md のインライン集計を固定化したスクリプト。
信頼性ゲート（invalidation 適用 → dedup → datetime filter → lesson join）を
常に同じ順序・同じ実装で適用する。

Usage:
    python3 scripts/summarize_play_log.py                # all sections
    python3 scripts/summarize_play_log.py --mode summary
    python3 scripts/summarize_play_log.py --json /tmp/_play_summary.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
from datetime import datetime, timezone, timedelta
import zoneinfo

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.append(str(REPO_ROOT / "scripts"))

from play_log_invalidation import invalidation_reason, load_rules  # noqa: E402

UNKNOWN_SUBJECT = "unknown_needs_lesson_join"


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def load_lesson_subjects(built_lessons: pathlib.Path, handwritten_dir: pathlib.Path) -> dict:
    """lesson_id -> subject の join テーブルを作る。"""
    subjects: dict = {}
    if built_lessons.exists():
        data = json.loads(built_lessons.read_text())
        lessons = data["lessons"] if isinstance(data, dict) else data
        for lesson in lessons:
            if lesson.get("id") and lesson.get("subject"):
                subjects[lesson["id"]] = lesson["subject"]
    if handwritten_dir.exists():
        for path in handwritten_dir.glob("????-??-??-*.json"):
            subject = path.stem.split("-", 3)[-1]  # {YYYY-MM-DD}-{subject}
            try:
                lesson_id = json.loads(path.read_text()).get("lesson_id")
            except (json.JSONDecodeError, OSError):
                continue
            if lesson_id:
                subjects.setdefault(lesson_id, subject)
    return subjects


def iter_valid_answers(play_dir: pathlib.Path, rules, since: datetime | None):
    """invalidation → is_correct None 除外 → dedup → datetime filter 済み answer を yield。"""
    seen: set = set()
    for jl in sorted(play_dir.glob("????-??-??.jsonl")):
        for line in jl.read_text().splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if invalidation_reason(rec, rules):
                continue
            payload = rec.get("payload", {})
            if payload.get("is_correct") is None:
                continue  # debug skip mode の NULL を除外
            answered_at_raw = payload.get("answered_at") or rec.get("occurred_at")
            if not answered_at_raw:
                continue
            answered_at = parse_dt(answered_at_raw)
            if since is not None and answered_at <= since:
                continue
            dedup = (payload.get("question_id"), payload.get("step", 1), payload.get("answered_at"))
            if dedup in seen:
                continue
            seen.add(dedup)
            yield jl.stem, answered_at, payload


def build_report(args) -> dict:
    if args.since:
        since = parse_dt(args.since)
    elif getattr(args, 'window', None) is not None:
        tz_jst = zoneinfo.ZoneInfo("Asia/Tokyo")
        now_jst = datetime.now(tz_jst)
        target_date = now_jst - timedelta(days=args.window)
        since_jst = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=tz_jst)
        since = since_jst.astimezone(timezone.utc)
    else:
        profile = json.loads(pathlib.Path(args.profile).read_text())
        since = parse_dt(profile["last_updated"])
    rules = load_rules()
    subjects = load_lesson_subjects(pathlib.Path(args.built_lessons), pathlib.Path(args.handwritten_dir))

    subject_stats = collections.defaultdict(lambda: {
        "total": 0, "correct": 0, "time_sum": 0, "rescued": 0,
        "first_attempt": {"total": 0, "correct": 0, "time_sum": 0},
        "retry": {"total": 0, "correct": 0, "time_sum": 0}
    })
    lesson_unit = collections.defaultdict(lambda: {
        "cnt": 0, "correct": 0, "steps": collections.Counter(),
        "first_attempt_cnt": 0, "first_attempt_correct": 0
    })
    wrong: list = []
    unanalyzed_days: set = set()

    for day, answered_at, p in iter_valid_answers(pathlib.Path(args.play_log_dir), rules, since):
        subject = p.get("subject") or subjects.get(p.get("lesson_id"), UNKNOWN_SUBJECT)
        unanalyzed_days.add(answered_at.astimezone(timezone.utc).date().isoformat())

        stats = subject_stats[subject]
        is_correct = int(bool(p.get("is_correct")))
        time_spent = p.get("time_spent_sec", 0) or 0
        is_retry = bool(p.get("is_retry"))

        stats["total"] += 1
        stats["correct"] += is_correct
        stats["time_sum"] += time_spent
        
        if is_retry:
            stats["retry"]["total"] += 1
            stats["retry"]["correct"] += is_correct
            stats["retry"]["time_sum"] += time_spent
            if is_correct:
                stats["rescued"] += 1
        else:
            stats["first_attempt"]["total"] += 1
            stats["first_attempt"]["correct"] += is_correct
            stats["first_attempt"]["time_sum"] += time_spent

        key = (p.get("lesson_id", "?"), p.get("unit_id", "?"))
        lesson_unit[key]["cnt"] += 1
        lesson_unit[key]["correct"] += is_correct
        lesson_unit[key]["steps"][p.get("step_label", "single")] += 1
        if not is_retry:
            lesson_unit[key]["first_attempt_cnt"] += 1
            lesson_unit[key]["first_attempt_correct"] += is_correct

        if not p.get("is_correct"):
            wrong.append({
                "day": day,
                "lesson_id": p.get("lesson_id", ""),
                "question_id": p.get("question_id", ""),
                "step": p.get("step", 1),
                "unit_id": p.get("unit_id", ""),
                "difficulty": p.get("difficulty", ""),
                "user_answer": p.get("user_answer", ""),
            })

    return {
        "since": since.isoformat(),
        "unanalyzed_days": sorted(unanalyzed_days),
        "subjects": {
            subj: {
                "total": s["total"],
                "correct": s["correct"],
                "accuracy_pct": round(100 * s["correct"] / s["total"], 1) if s["total"] else 0,
                "avg_time_sec": round(s["time_sum"] / s["total"], 1) if s["total"] else 0,
                "rescued": s["rescued"],
                "first_attempt": {
                    "total": s["first_attempt"]["total"],
                    "correct": s["first_attempt"]["correct"],
                    "accuracy_pct": round(100 * s["first_attempt"]["correct"] / s["first_attempt"]["total"], 1) if s["first_attempt"]["total"] else 0,
                },
                "retry": {
                    "total": s["retry"]["total"],
                    "correct": s["retry"]["correct"],
                    "accuracy_pct": round(100 * s["retry"]["correct"] / s["retry"]["total"], 1) if s["retry"]["total"] else 0,
                }
            }
            for subj, s in sorted(subject_stats.items())
        },
        "lesson_unit_breakdown": [
            {
                "lesson_id": lid,
                "unit_id": uid,
                "steps_answered": s["cnt"],
                "correct": s["correct"],
                "accuracy_pct": round(100 * s["correct"] / s["cnt"], 1) if s["cnt"] else 0,
                "first_attempt_cnt": s["first_attempt_cnt"],
                "first_attempt_accuracy_pct": round(100 * s["first_attempt_correct"] / s["first_attempt_cnt"], 1) if s["first_attempt_cnt"] else 0,
                "step_labels": dict(s["steps"]),
            }
            for (lid, uid), s in sorted(lesson_unit.items())
        ],
        "wrong_answers": wrong,
        "has_unknown_subject": UNKNOWN_SUBJECT in subject_stats,
    }


def print_report(report: dict, mode: str) -> None:
    if mode in ("all", "unanalyzed"):
        days = report["unanalyzed_days"]
        print("未分析プレイ日:", days if days else "なし")
    if mode in ("all", "summary"):
        total_rescued = 0
        for subj, s in report["subjects"].items():
            print(f"{subj}: {s['total']}問, 正答率 {s['accuracy_pct']}%, 平均 {s['avg_time_sec']}秒")
            fa = s['first_attempt']
            re = s['retry']
            print(f"  初回試行: {fa['total']}step, 正答率 {fa['accuracy_pct']}%")
            print(f"  再出題: {re['total']}step, 正答率 {re['accuracy_pct']}%")
            total_rescued += s.get("rescued", 0)
        print(f"rescued 合計 {total_rescued}")
    if mode in ("all", "breakdown"):
        for row in report["lesson_unit_breakdown"]:
            print(
                f"lesson={row['lesson_id']} unit={row['unit_id']}: {row['steps_answered']}step, "
                f"正答率 {row['accuracy_pct']}% (初回 {row['first_attempt_accuracy_pct']}%), steps={row['step_labels']}"
            )
    if mode in ("all", "wrong"):
        for w in report["wrong_answers"]:
            print(
                f"[{w['day']}] {w['lesson_id']} {w['question_id']} step={w['step']} "
                f"unit={w['unit_id']} {w['difficulty']} | 回答:{w['user_answer']}"
            )
    if report["has_unknown_subject"]:
        print(f"⚠️ {UNKNOWN_SUBJECT} が残っています。lesson join を確認するまで Phase 3 に進まないこと。")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="data/weakness_profile.json")
    parser.add_argument("--since", default=None, help="ISO datetime 上書き（既定は profile.last_updated）")
    parser.add_argument("--window", type=int, default=None, help="今日からN日前 00:00 JST 以降")
    parser.add_argument("--play-log-dir", default="data/play_log")
    parser.add_argument("--built-lessons", default="frontend/public/data/lessons.json")
    parser.add_argument("--handwritten-dir", default="data/lessons-handwritten")
    parser.add_argument("--mode", default="all", choices=["all", "summary", "wrong", "unanalyzed", "breakdown"])
    parser.add_argument("--json", dest="json_out", default=None, help="機械可読レポートの出力先")
    args = parser.parse_args()

    report = build_report(args)
    print_report(report, args.mode)
    if args.json_out:
        pathlib.Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"json: {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
