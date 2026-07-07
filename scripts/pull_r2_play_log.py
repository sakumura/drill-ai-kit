#!/usr/bin/env python3
"""
pull_r2_play_log.py - R2 から play_log / sketch_log を取得して data/play_log/ に保存する

Usage:
    python3 scripts/pull_r2_play_log.py --date 2026-04-28
    python3 scripts/pull_r2_play_log.py --date 2026-04-28 --type answer
    python3 scripts/pull_r2_play_log.py --since 2026-04-26

出力:
    data/play_log/YYYY-MM-DD.jsonl        (type=answer)
    data/play_log/YYYY-MM-DD-lesson-complete.jsonl  (type=lesson_complete)
    data/play_log/YYYY-MM-DD-sketch.jsonl  (type=sketch)
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
WORKERS_DIR = REPO_ROOT / "workers"
DATA_DIR = REPO_ROOT / "data" / "play_log"
BUCKET = os.environ.get("R2_BUCKET", "juken-ai-kit-play-log")
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds

PREFIX_MAP = {
    "answer": "play_log",
    "lesson_complete": "lesson_complete",
    "sketch": "sketch_log",
}

# ---------------------------------------------------------------------------
# wrangler wrapper
# ---------------------------------------------------------------------------

def _find_wrangler() -> str:
    """wrangler の実行パスを解決する。node_modules 優先"""
    candidates = [
        REPO_ROOT / "node_modules" / ".bin" / "wrangler",
        WORKERS_DIR / "node_modules" / ".bin" / "wrangler",
        Path("wrangler"),
    ]
    for c in candidates:
        if c.exists() or (c.name == "wrangler" and c == Path("wrangler")):
            # Path("wrangler") は which で確認
            if c.name == "wrangler" and c == Path("wrangler"):
                import shutil
                if shutil.which("wrangler"):
                    return "wrangler"
            else:
                return str(c)
    raise FileNotFoundError("wrangler が見つかりません。npm install 済みか確認してください。")


def _run(cmd: list[str], *, capture: bool = True, retry: int = MAX_RETRIES) -> subprocess.CompletedProcess:
    """subprocess wrapper with retry"""
    for attempt in range(1, retry + 1):
        result = subprocess.run(
            cmd,
            capture_output=capture,
            text=True,
            cwd=str(WORKERS_DIR),
        )
        if result.returncode == 0:
            return result
        if attempt < retry:
            print(f"  [warn] コマンド失敗 (attempt {attempt}/{retry}): {' '.join(cmd)}", file=sys.stderr)
            print(f"         stderr: {result.stderr[:200]}", file=sys.stderr)
            time.sleep(RETRY_DELAY)
        else:
            print(f"  [warn] 最大リトライ到達。スキップ: {' '.join(cmd)}", file=sys.stderr)
    return result  # last result (failed)


# ---------------------------------------------------------------------------
# R2 list
# ---------------------------------------------------------------------------

def list_keys(wrangler: str, prefix: str) -> list[str]:
    """指定 prefix の R2 object key を列挙する。

    wrangler r2 object list は存在しないため Cloudflare REST API を使用。
    CLOUDFLARE_API_TOKEN と wrangler.jsonc の account_id を参照する。
    """
    import re

    # account_id は環境変数を優先し、wrangler.jsonc に書かれていればフォールバック
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not account_id:
        wrangler_cfg = WORKERS_DIR / "wrangler.jsonc"
        if wrangler_cfg.exists():
            text = wrangler_cfg.read_text()
            m = re.search(r'"account_id"\s*:\s*"([^"]+)"', text)
            if m:
                account_id = m.group(1)

    if not account_id:
        print("[warn] CLOUDFLARE_ACCOUNT_ID が未設定です（.env.example 参照）。", file=sys.stderr)
        return []

    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("[warn] CLOUDFLARE_API_TOKEN が未設定です（.env.example 参照）。", file=sys.stderr)
        return []

    import urllib.request
    import urllib.parse

    keys: list[str] = []
    cursor = None

    while True:
        params: dict = {"prefix": prefix, "limit": "1000"}
        if cursor:
            params["cursor"] = cursor
        qs = urllib.parse.urlencode(params)
        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{BUCKET}/objects?{qs}"

        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
        except Exception as e:
            print(f"[warn] R2 list API エラー: {e}", file=sys.stderr)
            break

        if not body.get("success"):
            errs = body.get("errors", [])
            print(f"[warn] R2 list 失敗: {errs}", file=sys.stderr)
            break

        result = body.get("result", {})
        if isinstance(result, list):
            objects = result
            result_info = body.get("result_info", {}) or {}
            cursor = result_info.get("cursor")
        elif isinstance(result, dict):
            objects = result.get("objects", [])
            cursor = result.get("cursor")
        else:
            print(f"[warn] 予期外の result 型: {type(result)}", file=sys.stderr)
            break
        keys.extend(obj["key"] for obj in objects)

        if not cursor:
            break

    return keys


# ---------------------------------------------------------------------------
# R2 get
# ---------------------------------------------------------------------------

def fetch_object(wrangler: str, key: str, out_path: Path) -> bool:
    """1 object を wrangler r2 object get --remote で取得する"""
    result = _run(
        [wrangler, "r2", "object", "get", f"{BUCKET}/{key}", "--file", str(out_path), "--remote"],
        retry=MAX_RETRIES,
    )
    return result.returncode == 0


# ---------------------------------------------------------------------------
# 日付範囲ユーティリティ
# ---------------------------------------------------------------------------

def date_range(start: date, end: date) -> list[date]:
    """start .. end (inclusive) の date リスト"""
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def build_prefix(log_type: str, d: date) -> str:
    return f"{PREFIX_MAP[log_type]}/{d.year}/{d.month:02d}/{d.day:02d}/"


def out_path_for(d: date, log_type: str) -> Path:
    if log_type == "answer":
        return DATA_DIR / f"{d.isoformat()}.jsonl"
    if log_type == "lesson_complete":
        return DATA_DIR / f"{d.isoformat()}-lesson-complete.jsonl"
    return DATA_DIR / f"{d.isoformat()}-sketch.jsonl"


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------

def pull_day(wrangler: str, d: date, log_types: list[str]) -> dict[str, int]:
    """1日分の play_log を pull する。取得レコード数を返す"""
    counts: dict[str, int] = {}

    for lt in log_types:
        prefix = build_prefix(lt, d)
        print(f"  list {prefix} ...", end=" ", flush=True)
        keys = list_keys(wrangler, prefix)
        print(f"{len(keys)} objects")

        if not keys:
            counts[lt] = 0
            continue

        records: list[str] = []
        failed = 0

        with tempfile.TemporaryDirectory() as tmpdir:
            for i, key in enumerate(keys):
                fname = Path(tmpdir) / f"obj_{i}.jsonl"
                ok = fetch_object(wrangler, key, fname)
                if ok and fname.exists():
                    content = fname.read_text(encoding="utf-8").strip()
                    if content:
                        records.append(content)
                else:
                    failed += 1

        out = out_path_for(d, lt)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(records) + ("\n" if records else ""), encoding="utf-8")
        counts[lt] = len(records)

        if failed:
            print(f"  [warn] {lt} {d}: {failed}/{len(keys)} objects の取得に失敗しました（部分結果を保存済み）")

    return counts


def main():
    parser = argparse.ArgumentParser(description="R2 から play_log を pull して data/play_log/ に保存")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--date", metavar="YYYY-MM-DD", help="特定日を取得")
    group.add_argument("--since", metavar="YYYY-MM-DD", help="指定日から今日までを取得")
    parser.add_argument(
        "--type",
        choices=["answer", "lesson_complete", "sketch"],
        default=None,
        help="種別フィルタ（省略時は answer + lesson_complete 両方）",
    )
    args = parser.parse_args()

    # 対象日リスト
    today = date.today()
    if args.date:
        days = [date.fromisoformat(args.date)]
    else:
        start = date.fromisoformat(args.since)
        days = date_range(start, today)

    # 対象 log_type
    log_types = [args.type] if args.type else ["answer", "lesson_complete"]

    # wrangler 解決
    try:
        wrangler = _find_wrangler()
    except FileNotFoundError as e:
        print(f"[error] {e}", file=sys.stderr)
        sys.exit(1)

    print(f"=== pull_r2_play_log: {len(days)} 日分, types={log_types} ===")
    total: dict[str, int] = {"answer": 0, "lesson_complete": 0, "sketch": 0}

    for d in days:
        print(f"[{d}]")
        counts = pull_day(wrangler, d, log_types)
        for lt, n in counts.items():
            total[lt] += n

    print()
    print("=== 完了 ===")
    for lt in log_types:
        print(f"  {lt}: 合計 {total[lt]} records")
    print(f"  出力先: {DATA_DIR}/")


if __name__ == "__main__":
    main()
