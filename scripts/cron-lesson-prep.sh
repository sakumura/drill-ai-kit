#!/bin/bash
# cron-lesson-prep.sh - 毎日の弱点分析→翌日レッスン準備を自動実行
# Usage: cron-lesson-prep.sh
# 前提: このリポジトリを clone した場所で node / claude が PATH に通っていること
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/data/logs"
LOG_FILE="${LOG_DIR}/cron_lesson_prep.log"

mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') lesson-prep start ==="

# 排他制御
LOCK_FILE="/tmp/cron-lesson-prep.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "Already running"; exit 0; }

cd "$PROJECT_ROOT"

# Claude Code をヘッドレスで実行
# /generate-drill-lesson スキルが弱点分析→翌日レッスンに追加問題投入を行う
exec claude -p "/generate-drill-lesson を実行してください。当日までの弱点分析に基づいて翌日のレッスンに手作り問題を2-3問追加してください。完了後は追加作業せず即座に終了すること。" \
    --dangerously-skip-permissions \
    --max-turns 10
