#!/usr/bin/env python3
"""公開前セーフティチェック（必要条件のみ。十分条件ではない）。

PUBLICATION_SAFETY.md を参照。git 管理下に置いてはいけないファイルが
tracked になっていないかを機械的に検査する。

Usage:
    python3 scripts/check_publication_safety.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# public template に同梱してよい root data は合成データだけに固定する。
# 実運用データを追加する場合は private clone で行う。public template 側で
# data/ を増やす場合は、この allowlist 更新をレビュー対象にする。
ALLOWED_DATA_FILES = {
    "data/learning_signal_profile.json",
    "data/lessons-handwritten/2026-07-01-math.json",
    "data/lessons-handwritten/2026-07-02-japanese.json",
    "data/maintenance_ledger.json",
    "data/plan/regular-05/japanese/analysis.md",
    "data/plan/regular-05/japanese/training-plan.md",
    "data/plan/regular-05/math/analysis.md",
    "data/plan/regular-05/math/training-plan.md",
    "data/play_log/2026-07-01.jsonl",
    "data/play_log/2026-07-02.jsonl",
    "data/play_log/invalidations.json",
    "data/play_log/user_state-11111111-2222-3333-4444-555555555555-latest.json",
    "data/problem-bank/_index.json",
    "data/problem-bank/questions.jsonl",
    "data/problem-bank/usage.jsonl",
    "data/target-school/difficulty-anchor.md",
    "data/target-school/kokugo-analysis.md",
    "data/target-school/long-term-plan.md",
    "data/target-school/math-analysis.md",
    "data/test_difficulty_reference.md",
    "data/test_schedule.json",
    "data/textbooks/curriculum/curriculum.json",
    "data/textbooks/curriculum/grade5-analysis.md",
    "data/textbooks/curriculum/grade5-training-plan.md",
    "data/vocabulary/bunpou.md",
    "data/vocabulary/kanyouku.md",
    "data/vocabulary/keigo.md",
    "data/vocabulary/kotowaza.md",
    "data/weakness_profile.json",
}

ALLOWED_FRONTEND_DATA_FILES = {
    "frontend/public/data/learning_profile.json",
    "frontend/public/data/lessons.json",
    "frontend/public/data/motivator.json",
    "frontend/public/data/schedule.json",
    "frontend/public/data/units.json",
}

FORBIDDEN_TRACKED_PATHS = [
    "frontend/.env.production",
    ".env",
    ".dev.vars",
    "PRIVATE_CONTEXT.md",
]

SENSITIVE_PATH_MARKERS = (
    "student",
    "students",
    "real",
    "private",
    "practice_test",
    "answer_sheet",
    "score",
    "scores",
    "grade_report",
    "handwriting",
    "scan",
    "scans",
    "image",
    "images",
    "kakomon-raw",
    "logs",
    "analysis",
    "answers",
    "name",
    "names",
    "成績",
    "答案",
    "氏名",
    "実名",
    "志望校",
    "学校名",
    "手書き",
    "画像",
)

SENSITIVE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".heic",
    ".pdf",
    ".xlsx",
    ".xls",
    ".csv",
    ".zip",
}


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return out.stdout.splitlines()


def check_files(files: list[str]) -> list[str]:
    warnings: list[str] = []

    for path in FORBIDDEN_TRACKED_PATHS:
        if path in files:
            warnings.append(
                f"[NG] '{path}' が git 管理下にあります。"
                f" .gitignore に追加し `git rm --cached {path}` してください。"
            )

    for f in files:
        path = Path(f)
        lower = f.lower()
        if f.startswith("data/") and f not in ALLOWED_DATA_FILES:
            warnings.append(
                f"[NG] public template の許可リスト外 data ファイル '{f}' が git 管理下にあります。"
                " 実データ・教材・成績・答案の混入でないか確認し、必要なら private clone 側だけに置いてください。"
            )
        if f.startswith("frontend/public/data/") and f not in ALLOWED_FRONTEND_DATA_FILES:
            warnings.append(
                f"[NG] public 配信対象の許可リスト外データ '{f}' が git 管理下にあります。"
                " ブラウザ配信されるため、合成データ以外は置かないでください。"
            )
        if f.startswith("data/") and path.suffix.lower() in SENSITIVE_SUFFIXES:
            warnings.append(
                f"[NG] 画像/PDF/表計算等の実資料になり得る '{f}' が git 管理下にあります。"
                " 答案・成績・教材本体は public template に含めないでください。"
            )
        if f.startswith("data/") and any(marker in lower for marker in SENSITIVE_PATH_MARKERS):
            if f not in ALLOWED_DATA_FILES:
                warnings.append(
                    f"[NG] 実運用データを示す名前の '{f}' が git 管理下にあります。"
                    " public template では合成データ allowlist 以外を拒否します。"
                )

    # 重複メッセージを安定順でまとめる。
    return list(dict.fromkeys(warnings))


def main() -> int:
    warnings = check_files(tracked_files())

    if warnings:
        print("\n".join(warnings))
        print(f"\n{len(warnings)} 件の警告。PUBLICATION_SAFETY.md を確認してください。")
        return 1

    print("[OK] 既知の危険パターンは検出されませんでした。")
    print("注意: このチェックは必要条件のみです。十分条件ではありません。PUBLICATION_SAFETY.md を必ず読んでください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
