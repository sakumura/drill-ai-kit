#!/usr/bin/env python3
"""scripts/meta_review_gate.py

generate-drill-lesson のゲートで必ず実行する「エージェント目視レビューゲート」。
spec 通り 30問×レッスン数 を 1問ずつエージェントが判定し、結果を保存することを強制する。

使い方:
  # ステップ1: ゲート起動 → 質問リスト出力 + エージェントが書く JSON テンプレを生成
  python3 scripts/meta_review_gate.py prepare --lesson-id lesson-m-0424

  # ステップ2: エージェントが /tmp/_review_lesson-m-0424.json を編集して保存

  # ステップ3: 検証 → 全 OK なら meta_reviewed_at + parent_approved_at を自動更新
  python3 scripts/meta_review_gate.py verify --lesson-id lesson-m-0424

終了コード:
  0 = 全 OK、meta_reviewed_at + parent_approved_at 更新済（--no-auto-approve 時は meta_reviewed_at のみ）
  1 = NG あり or レビュー未完了
  2 = 入出力エラー
"""

import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

TMP_DIR = Path("/tmp")


def fetch_questions(lesson_id: str) -> list[dict]:
    """lessons.json から lesson_id に対応するquestions を返す。"""
    from _lib.json_env import load_lessons
    lessons = load_lessons()
    for lesson in lessons:
        if lesson.get("id") == lesson_id:
            qs = lesson.get("questions", [])
            return [
                {
                    "position": q.get("position"),
                    "unit_id": q.get("unit_id", ""),
                    "difficulty": q.get("difficulty", ""),
                    "question_text": q.get("question_text", ""),
                    "answer": q.get("answer", ""),
                    "hints": q.get("hints", ""),
                    "question_type": q.get("question_type", ""),
                    "tier1_label": q.get("tier1_label", ""),
                    "tier1_purpose": q.get("tier1_purpose", ""),
                    "tier2_label": q.get("tier2_label", ""),
                    "tier2_purpose": q.get("tier2_purpose", ""),
                    "solution_steps": q.get("solution_steps", []),
                    "figure_svg": q.get("figure_svg", ""),
                }
                for q in qs
            ]
    return []


def cmd_prepare(args: argparse.Namespace) -> int:
    lesson_id = args.lesson_id
    questions = fetch_questions(lesson_id)
    if not questions:
        print(f"[error] lesson_id={lesson_id} に問題が見つからない", file=sys.stderr)
        return 2

    template = {
        "lesson_id": lesson_id,
        "instructions": (
            "エージェントは 1問ずつ §4d 難易度判定 + R12-R16 自己チェックを行い、verdict を 'OK'/'NG' のいずれかで記入する。"
            "NG の場合は reason に修正方針を書き、別途 D1 を UPDATE してから verify を再実行する。"
        ),
        "reviews": [
            {
                "position": q["position"],
                "unit_id": q.get("unit_id", ""),
                "difficulty": q.get("difficulty", ""),
                    "question_text_preview": (q.get("question_text") or "")[:80],
                    "answer": q.get("answer", ""),
                    "hints": q.get("hints", ""),
                    "question_type": q.get("question_type", ""),
                    "tier1_label": q.get("tier1_label", ""),
                    "tier1_purpose": q.get("tier1_purpose", ""),
                    "tier2_label": q.get("tier2_label", ""),
                    "tier2_purpose": q.get("tier2_purpose", ""),
                    "solution_steps": q.get("solution_steps", []),
                    "is_figure": bool(q.get("figure_svg")),
                    "verdict": "PENDING",
                "reason": "",
                "thinking_steps": "",
                "d4_judgment": "",
                "process_understanding": "PENDING",
                "process_reason": "",
                "answer_only_risk": "PENDING",
            }
            for q in questions
        ],
    }

    review_path = TMP_DIR / f"_review_{lesson_id}.json"
    review_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] {len(questions)} 問のレビューテンプレを書き出し")
    print(f"  review file: {review_path}")
    print()
    print("=== エージェントへの指示 ===")
    print(f"上記 {review_path} を開いて、各問題の verdict を 'OK' or 'NG' に書き換える。")
    print("'OK' にする条件:")
    print("  1. §4d 難易度判定: 思考ステップ数を数えて difficulty ラベルと整合する")
    print("  2. R12 figure_svg: 図前提語を含むなら figure_svg 必須")
    print("  3. R14 問題文崩壊なし、R15 ダミー選択肢なし")
    print("  4. distractor が教育的 (÷2/×2 機械テンプレでない)")
    print("  5. 小5語彙範囲、自然な日本語")
    print("  6. R22 process_understanding: 解説の中核が出題本体で問われている")
    print()
    print("各問題で thinking_steps / d4_judgment / process_understanding / process_reason / answer_only_risk を記入する。")
    print("例: process_understanding='OK', process_reason='割合の基準量を先に選ばせている', answer_only_risk='OK'")
    print("最終答え暗算だけなら process_understanding='NG' または answer_only_risk='NG' にして reason に修正方針を書く。")
    print()
    print("全 verdict が OK になったら次を実行:")
    print(f"  python3 scripts/meta_review_gate.py verify --lesson-id {lesson_id}")
    print("新規手書き生成では必要に応じて:")
    print(f"  python3 scripts/meta_review_gate.py verify --lesson-id {lesson_id} --strict-process-gate")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    lesson_id = args.lesson_id
    no_auto_approve = getattr(args, "no_auto_approve", False)
    review_path = TMP_DIR / f"_review_{lesson_id}.json"
    if not review_path.exists():
        print(f"[error] レビューファイルなし: {review_path}", file=sys.stderr)
        print(f"先に prepare を実行してテンプレを生成すること。", file=sys.stderr)
        return 2

    try:
        review = json.loads(review_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[error] JSON parse 失敗: {e}", file=sys.stderr)
        return 2

    reviews = review.get("reviews", [])
    if not reviews:
        print("[error] reviews 配列が空", file=sys.stderr)
        return 2

    pending = [r for r in reviews if r.get("verdict") == "PENDING"]
    ng = [r for r in reviews if r.get("verdict") == "NG"]

    if pending:
        print(f"[NG] 未判定が {len(pending)} 問残っている:", file=sys.stderr)
        for r in pending[:5]:
            print(f"  #{r['position']}: verdict=PENDING", file=sys.stderr)
        return 1

    if ng:
        print(f"[NG] {len(ng)} 問が NG 判定:", file=sys.stderr)
        for r in ng:
            print(f"  #{r['position']} ({r.get('unit_id','?')}) {r.get('reason','')}", file=sys.stderr)
        print(file=sys.stderr)
        print("→ 該当問題を lessons.json で修正してから verdict を OK に書き換え、再 verify。", file=sys.stderr)
        return 1

    # 思考ステップ未記入チェック
    no_thinking = [r for r in reviews if not r.get("thinking_steps", "").strip()]
    if no_thinking:
        print(f"[NG] thinking_steps 未記入が {len(no_thinking)} 問", file=sys.stderr)
        print("各問題で「Q{N}: ステップ手順 → §4d 判定」を thinking_steps に記入すること。", file=sys.stderr)
        return 1

    process_ng = [
        r for r in reviews
        if r.get("process_understanding") == "NG" or r.get("answer_only_risk") == "NG"
    ]
    if process_ng:
        print(f"[NG] R22 process_understanding NG が {len(process_ng)} 問:", file=sys.stderr)
        for r in process_ng:
            detail = r.get("process_reason") or r.get("reason") or "解き方理解を問えていない"
            print(f"  #{r.get('position')} ({r.get('unit_id','?')}) {detail}", file=sys.stderr)
        return 1

    strict_process_gate = getattr(args, "strict_process_gate", False)
    if strict_process_gate:
        missing_process = [
            r for r in reviews
            if r.get("process_understanding") != "OK"
            or r.get("answer_only_risk") != "OK"
            or not str(r.get("process_reason", "")).strip()
        ]
        if missing_process:
            print(f"[NG] R22 strict-process-gate 未完了が {len(missing_process)} 問", file=sys.stderr)
            print(
                "各問題で process_understanding='OK', answer_only_risk='OK', process_reason を記入すること。",
                file=sys.stderr,
            )
            for r in missing_process[:5]:
                print(f"  #{r.get('position')}: process_understanding={r.get('process_understanding')!r}, answer_only_risk={r.get('answer_only_risk')!r}", file=sys.stderr)
            return 1

    # 全 OK → schedule.json の meta_reviewed_at / parent_approved_at を更新
    from _lib.json_env import load_schedule, write_schedule
    schedule = load_schedule()
    now_str = datetime.now(timezone(timedelta(hours=9))).isoformat()
    updated = False
    for entry in schedule:
        if entry.get("lesson_id") == lesson_id:
            entry["meta_reviewed_at"] = now_str
            if not no_auto_approve:
                entry["parent_approved_at"] = now_str
            updated = True
            break
    if not updated:
        # エントリが存在しない場合は追加
        new_entry = {
            "id": lesson_id,
            "date": "",
            "lesson_id": lesson_id,
            "status": "reviewed",
            "meta_reviewed_at": now_str,
            "parent_approved_at": now_str if not no_auto_approve else None,
        }
        schedule.append(new_entry)
    write_schedule(schedule)

    print(f"[OK] {len(reviews)} 問すべて OK")
    print(f"  schedule.json の meta_reviewed_at を更新しました (lesson_id={lesson_id})")
    if not no_auto_approve:
        print(f"[OK] parent_approved_at も自動承認（運用ルール C、2026-04-25 以降）")
    else:
        print(f"  --no-auto-approve: parent_approved_at は NULL のまま（手動承認が必要）")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="エージェント目視レビューゲート (冪等性確保)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_prepare = sub.add_parser("prepare", help="レビューテンプレを生成")
    p_prepare.add_argument("--lesson-id", required=True)
    p_verify = sub.add_parser("verify", help="レビュー結果を検証して meta_reviewed_at + parent_approved_at 更新")
    p_verify.add_argument("--lesson-id", required=True)
    p_verify.add_argument(
        "--no-auto-approve",
        action="store_true",
        default=False,
        help="自動承認を無効化し meta_reviewed_at のみ更新する（従来動作）",
    )
    p_verify.add_argument(
        "--strict-process-gate",
        action="store_true",
        default=False,
        help="R22 process_understanding 欄の OK と process_reason 記入を必須にする",
    )

    args = parser.parse_args()
    if args.cmd == "prepare":
        return cmd_prepare(args)
    if args.cmd == "verify":
        return cmd_verify(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
