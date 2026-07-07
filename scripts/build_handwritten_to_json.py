#!/usr/bin/env python3
"""
scripts/build_handwritten_to_json.py

旧 build_handwritten_to_sql.py の置換。
エージェント手書き JSON を frontend/public/data/lessons.json にマージし、
schedule.json にも upsert する。

使い方:
  python3 scripts/build_handwritten_to_json.py --date 2026-04-29 --subject math
  python3 scripts/build_handwritten_to_json.py --date 2026-04-29 --subject japanese

入力 JSON フォーマット (data/lessons-handwritten/{date}-{subject}.json):
{
  "lesson_id": "lesson-m-0429",
  "subject": "math",
  "title": "4/29 育成対策",
  "difficulty": 3,
  "questions": [
    {
      "position": 16,
      "unit_id": "tamen-tayoukei",
      "difficulty": "d3",
      "question_text": "...",
      "answer": "96",
      "hints": ["96", "48", "192"],
      "solution_steps": ["..."],
      "common_mistakes": ["..."],
      "is_figure": false,
      "figure_svg": null
    }
  ]
}
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
from _lib.json_env import (
    HANDWRITTEN_DIR,
    load_lessons,
    load_schedule,
    write_lessons,
    write_schedule,
)


def build_lesson_entry(data: dict, now_iso: str) -> dict:
    """手書き JSON をlessons.json スキーマに変換する。"""
    lesson_id = data["lesson_id"]
    subject = data.get("subject", "math")
    questions = []
    for q in data.get("questions", []):
        pos = q["position"]
        q_id = f"q-{lesson_id}-{pos:02d}"
        hints = q.get("hints", [])
        solution_steps = q.get("solution_steps", [])
        common_mistakes = q.get("common_mistakes", [])
        # ---- step / step_label 解決 (2026-04-30 追加) ----
        # step は answer ログ用メタデータ。単一 step 問題は後方互換のため
        # question JSON にも single を持たせるが、multi-step 問題では runtime が
        # tier1/tier2 または slot1/slot2 を送るので null フィールドを出力しない。
        q_type = q.get("question_type", "single_tier")
        _SINGLE_STEP_TYPES = {
            "single_tier", "slot_number", "slot_kanji",
            "slot_decimal", "slot_okurigana",
        }
        if q_type in _SINGLE_STEP_TYPES:
            step_val = q.get("step", 1)
            step_label_val = q.get("step_label", "single")
        else:
            step_val = None
            step_label_val = None
        question_entry = {
            "id": q_id,
            "lesson_id": lesson_id,
            "position": pos,
            "question_text": q.get("question_text", ""),
            "question_image_url": None,
            "answer": q.get("answer", ""),
            "answer_unit": q.get("answer_unit", None),
            "hints": hints if isinstance(hints, list) else [],
            "solution_steps": solution_steps if isinstance(solution_steps, list) else [],
            "common_mistakes": common_mistakes if isinstance(common_mistakes, list) else [],
            "diag_step1": None,
            "diag_step2": None,
            "unit_id": q.get("unit_id", None),
            "figure_svg": q.get("figure_svg", None),
            "difficulty": q.get("difficulty", None),
            "reference_problem_id": q.get("reference_problem_id", None),
            "src_lesson_id": q.get("src_lesson_id", None),
            # ---- 新問題形式フィールド (2026-04-28 追加) ----
            "question_type": q.get("question_type", "single_tier"),
            "tier2_correct_index": q.get("tier2_correct_index", None),
            "tier1_label": q.get("tier1_label", None),
            "tier1_purpose": q.get("tier1_purpose", None),
            "tier2_label": q.get("tier2_label", None),
            "tier2_purpose": q.get("tier2_purpose", None),
            "slot_config": q.get("slot_config", None),
        }
        if "choice_meta" in q:
            question_entry["choice_meta"] = q.get("choice_meta")
        if "remediation" in q:
            question_entry["remediation"] = q.get("remediation")
        # スケッチゲート (2026-06-11): 採点に影響しない advisory 作図ステップ
        if "sketch_gate" in q:
            question_entry["sketch_gate"] = q.get("sketch_gate")
        if "sketch_hint" in q:
            question_entry["sketch_hint"] = q.get("sketch_hint")
        if "sketch_kind" in q:
            question_entry["sketch_kind"] = q.get("sketch_kind")
        if step_val is not None:
            question_entry["step"] = step_val
        if step_label_val is not None:
            question_entry["step_label"] = step_label_val
        questions.append(question_entry)

    lesson_entry = {
        "id": lesson_id,
        "unit_id": subject,
        "subject": subject,
        "title": data.get("title", lesson_id),
        "concept_cards": [],
        "tips": [],
        "difficulty": data.get("difficulty", 3),
        "grade": 5,
        "sort_order": 0,
        "created_at": now_iso,
        "lesson_type": "handwritten",
        "archived": False,
        "questions": questions,
        "passages": [],
        "reading_questions": [],
    }
    if "blocks" in data:
        lesson_entry["blocks"] = data.get("blocks")
    return lesson_entry


def upsert_by_id(lst: list, new_item: dict, id_key: str = "id") -> list:
    """id_key ベースで upsert（同じ id があれば置換、なければ append）。"""
    target_id = new_item[id_key]
    for i, item in enumerate(lst):
        if item.get(id_key) == target_id:
            lst[i] = new_item
            return lst
    lst.append(new_item)
    return lst


def merge_existing_lesson(existing_lesson: dict, lesson_entry: dict, source_has_blocks: bool) -> dict:
    """既存 lesson に handwritten entry を merge する。

    questions は既存 pool を保持して id upsert する。blocks は source が明示した時だけ
    置換し、未指定なら既存 blocks を維持する。
    """
    existing_qs = existing_lesson.get("questions", [])
    new_qs = lesson_entry["questions"]
    merged_qs = list(existing_qs)
    for nq in new_qs:
        merged_qs = upsert_by_id(merged_qs, nq, id_key="id")
    merged_qs.sort(key=lambda q: q.get("position", 0))
    lesson_entry["questions"] = merged_qs
    lesson_entry["lesson_type"] = "mixed"  # pool + handwritten 混在
    if not source_has_blocks and "blocks" in existing_lesson:
        lesson_entry["blocks"] = existing_lesson["blocks"]
    return lesson_entry


def main():
    parser = argparse.ArgumentParser(
        description="エージェント手書き JSON を lessons.json / schedule.json にマージ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--date", required=True, help="日付 YYYY-MM-DD (例: 2026-04-29)")
    parser.add_argument(
        "--subject",
        choices=["math", "japanese"],
        required=True,
        help="科目 (math / japanese)",
    )
    args = parser.parse_args()

    input_filename = f"{args.date}-{args.subject}.json"
    input_path = HANDWRITTEN_DIR / input_filename
    if not input_path.exists():
        print(f"[error] 手書き JSON が見つかりません: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(input_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[error] JSON パース失敗: {input_path}: {e}", file=sys.stderr)
        sys.exit(1)

    lesson_id = data.get("lesson_id")
    if not lesson_id:
        print("[error] lesson_id が手書き JSON に存在しません", file=sys.stderr)
        sys.exit(1)

    jst = timezone(timedelta(hours=9))
    now_iso = datetime.now(jst).isoformat()

    # lessons.json にマージ（questions は id ベースで upsert し、過去pool を保持する）
    lessons = load_lessons()
    lesson_entry = build_lesson_entry(data, now_iso)
    source_has_blocks = "blocks" in data

    # 既存 lesson があれば questions を id ベースで merge する（上書き禁止）
    existing_idx = None
    for i, les in enumerate(lessons):
        if les.get("id") == lesson_id:
            existing_idx = i
            break

    if existing_idx is not None:
        lessons[existing_idx] = merge_existing_lesson(lessons[existing_idx], lesson_entry, source_has_blocks)
    else:
        lessons.append(lesson_entry)

    write_lessons(lessons)
    print(f"[OK] lessons.json 更新 (lesson_id={lesson_id}, questions={len(lesson_entry['questions'])}問)")

    # schedule.json にマージ
    schedule = load_schedule()
    schedule_entry = {
        "id": lesson_id,
        "date": args.date,
        "lesson_id": lesson_id,
        "status": "pending",
        "meta_reviewed_at": None,
        "parent_approved_at": None,
    }
    schedule = upsert_by_id(schedule, schedule_entry, id_key="lesson_id")
    write_schedule(schedule)
    print(f"[OK] schedule.json 更新 (lesson_id={lesson_id}, date={args.date})")

    # git add（commit はしない）
    project_root = _SCRIPT_DIR.parent
    subprocess.run(
        [
            "git", "add",
            "frontend/public/data/lessons.json",
            "frontend/public/data/schedule.json",
        ],
        cwd=str(project_root),
        check=True,
    )
    print("[OK] git add 完了（commit はしていません）")


if __name__ == "__main__":
    main()
