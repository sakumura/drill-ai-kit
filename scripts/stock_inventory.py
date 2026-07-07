#!/usr/bin/env python3
"""
scripts/stock_inventory.py

志望校本番ストック (data/lessons-stock/) の在庫管理 CLI。
5/9 以降の generate-drill-lesson 実行時、エージェントが在庫から問題をピックする際に使う。

使い方:
  python3 scripts/stock_inventory.py --list
  python3 scripts/stock_inventory.py --list --subject math
  python3 scripts/stock_inventory.py --topic hi-keisan
  python3 scripts/stock_inventory.py --weakness-top 5
  python3 scripts/stock_inventory.py --stats
  python3 scripts/stock_inventory.py --record data/lessons-handwritten/2026-05-09-math.json

設計:
- 在庫マスタ: data/lessons-stock/*.json (トピック単位 30 問)
- インデックス: data/lessons-stock/_index.json (build_stock_index.py で生成)
- 使用履歴: data/lessons-stock/_usage.jsonl (1 行 = 1 問使用記録)

stock 由来の問題を新しい lesson に組み込む際、当該問題の meta フィールドに
  "from_stock": "{topic}-{subject}-1#{position}"
を付与すれば --record でその参照を _usage.jsonl に書き込める。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOCK_DIR = ROOT / "data" / "lessons-stock"
INDEX_PATH = STOCK_DIR / "_index.json"
USAGE_PATH = STOCK_DIR / "_usage.jsonl"
WEAKNESS_PATH = ROOT / "data" / "weakness_profile.json"
JST = timezone(timedelta(hours=9))

FROM_STOCK_RE = re.compile(r"^(?P<file_stem>[a-z0-9\-]+?-(?:math|japanese)-\d+)#(?P<pos>\d+)$")


def load_index() -> dict:
    if not INDEX_PATH.exists():
        sys.exit(f"_index.json が見つかりません。先に build_stock_index.py を実行してください: {INDEX_PATH}")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def load_usage() -> list[dict]:
    if not USAGE_PATH.exists():
        return []
    out = []
    for line in USAGE_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        out.append(json.loads(line))
    return out


def used_positions_by_topic(usage: list[dict]) -> dict[tuple[str, str], set[int]]:
    """{(topic, subject): {position, ...}} で使用済みポジションをまとめる。"""
    out: dict[tuple[str, str], set[int]] = defaultdict(set)
    for u in usage:
        out[(u["topic"], u["subject"])].add(int(u["stock_position"]))
    return out


def topic_stock_path(topic: dict) -> Path:
    return STOCK_DIR / topic["file"]


def load_topic_questions(topic: dict) -> list[dict]:
    return json.loads(topic_stock_path(topic).read_text(encoding="utf-8"))["questions"]


def cmd_list(args: argparse.Namespace, index: dict, usage: list[dict]) -> None:
    used_map = used_positions_by_topic(usage)
    rows = []
    for t in index["topics"]:
        if args.subject and t["subject"] != args.subject:
            continue
        used = used_map.get((t["topic"], t["subject"]), set())
        remaining = t["total"] - len(used)
        rows.append((t["subject"], t["topic"], t["total"], len(used), remaining, t["title"]))
    rows.sort(key=lambda r: (r[0], r[1]))
    print(f"{'subject':<9} {'topic':<22} {'total':>5} {'used':>5} {'remain':>6}  title")
    print("-" * 100)
    for subject, topic, total, used, remain, title in rows:
        print(f"{subject:<9} {topic:<22} {total:>5} {used:>5} {remain:>6}  {title}")


def cmd_topic(args: argparse.Namespace, index: dict, usage: list[dict]) -> None:
    target = next((t for t in index["topics"] if t["topic"] == args.topic), None)
    if not target:
        sys.exit(f"topic '{args.topic}' は _index.json にありません")
    used = used_positions_by_topic(usage).get((target["topic"], target["subject"]), set())
    questions = load_topic_questions(target)
    by_diff: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        if q["position"] in used:
            continue
        by_diff[q["difficulty"]].append(q)
    print(f"# {target['topic']} ({target['subject']}) — 未使用 {sum(len(v) for v in by_diff.values())} / {target['total']} 問")
    print(f"  {target['title']}")
    print()
    for diff in sorted(by_diff.keys()):
        print(f"## {diff} ({len(by_diff[diff])} 問)")
        for q in by_diff[diff]:
            preview = q["question_text"].replace("\n", " ")
            if len(preview) > 60:
                preview = preview[:60] + "..."
            print(f"  pos={q['position']:>2}  unit={q['unit_id']:<28} {preview}")
        print()


def cmd_weakness_top(args: argparse.Namespace, index: dict, usage: list[dict]) -> None:
    if not WEAKNESS_PATH.exists():
        sys.exit(f"weakness_profile.json が見つかりません: {WEAKNESS_PATH}")
    weakness = json.loads(WEAKNESS_PATH.read_text(encoding="utf-8"))
    queue = weakness.get("priority_queue", [])[: args.weakness_top]
    used_map = used_positions_by_topic(usage)
    print(f"# priority_queue 上位 {len(queue)} の在庫対応 (エージェント判断用、厳密マッチではない)")
    print()
    print(f"{'rank':<5} {'pattern_id':<28} {'subj':<9} {'score':>5} {'sev':<11} → 関連 stock トピック (残量)")
    print("-" * 110)
    for i, item in enumerate(queue, 1):
        related = []
        pid = item["pattern_id"]
        for t in index["topics"]:
            if t["subject"] != item["subject"]:
                continue
            unit_ids = t.get("unit_ids", [])
            tokens = [tok for tok in pid.split("-") if len(tok) >= 3]
            matched = (
                pid in t["topic"]
                or t["topic"] in pid
                or any(pid in u or u in pid for u in unit_ids)
                or any(tok in t["topic"] for tok in tokens)
                or any(any(tok in u for tok in tokens) for u in unit_ids)
            )
            if matched:
                used = used_map.get((t["topic"], t["subject"]), set())
                related.append(f"{t['topic']}({t['total'] - len(used)})")
        related_str = ", ".join(related) if related else "(該当 stock なし)"
        print(f"{i:<5} {pid:<28} {item['subject']:<9} {item['score']:>5} {item['severity']:<11} → {related_str}")


def cmd_stats(args: argparse.Namespace, index: dict, usage: list[dict]) -> None:
    used_map = used_positions_by_topic(usage)
    total_q = sum(t["total"] for t in index["topics"])
    total_used = sum(len(s) for s in used_map.values())
    by_subject: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "used": 0})
    for t in index["topics"]:
        by_subject[t["subject"]]["total"] += t["total"]
        by_subject[t["subject"]]["used"] += len(used_map.get((t["topic"], t["subject"]), set()))
    print("# stock 使用率レポート")
    print()
    print(f"全体: {total_used}/{total_q} 問使用 ({total_used / total_q * 100:.1f}%)")
    for subj, s in by_subject.items():
        rate = s["used"] / s["total"] * 100 if s["total"] else 0
        print(f"  {subj:<9}: {s['used']}/{s['total']} ({rate:.1f}%)")
    if usage:
        recent = sorted(usage, key=lambda u: u.get("used_at", ""))[-5:]
        print()
        print("## 直近の使用履歴 (最新 5 件)")
        for u in recent:
            print(f"  {u.get('used_at', '?')}  {u.get('lesson_id', '?'):<22}  {u['topic']}#{u['stock_position']} ({u['subject']})")


def parse_from_stock(value: str) -> tuple[str, str, int] | None:
    """meta.from_stock の値 '{topic}-{subject}-{ver}#{position}' を分解する。"""
    m = FROM_STOCK_RE.match(value.strip())
    if not m:
        return None
    file_stem = m.group("file_stem")
    parts = file_stem.split("-")
    subject = next((p for p in parts if p in ("math", "japanese")), None)
    if not subject:
        return None
    idx = parts.index(subject)
    topic = "-".join(parts[:idx])
    return topic, subject, int(m.group("pos"))


def cmd_record(args: argparse.Namespace, index: dict, usage: list[dict]) -> None:
    lesson_path = Path(args.record)
    if not lesson_path.exists():
        sys.exit(f"lesson JSON が見つかりません: {lesson_path}")
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    lesson_id = lesson.get("lesson_id", lesson_path.stem)
    used_at = lesson.get("date") or datetime.now(JST).strftime("%Y-%m-%d")
    existing = {(u["topic"], u["subject"], int(u["stock_position"]), u.get("lesson_id")) for u in usage}
    new_records: list[dict] = []
    skipped_dup: list[str] = []
    skipped_invalid: list[str] = []
    for q in lesson.get("questions", []):
        from_stock = (q.get("meta") or {}).get("from_stock")
        if not from_stock:
            continue
        parsed = parse_from_stock(from_stock)
        if not parsed:
            skipped_invalid.append(from_stock)
            continue
        topic, subject, pos = parsed
        key = (topic, subject, pos, lesson_id)
        if key in existing:
            skipped_dup.append(f"{topic}#{pos}")
            continue
        new_records.append(
            {
                "used_at": used_at,
                "lesson_id": lesson_id,
                "topic": topic,
                "subject": subject,
                "stock_position": pos,
            }
        )
    if new_records:
        with USAGE_PATH.open("a", encoding="utf-8") as f:
            for rec in new_records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"記録: {len(new_records)} 件追加 → {USAGE_PATH}")
    if skipped_dup:
        print(f"スキップ (この lesson_id で記録済み): {len(skipped_dup)} 件 — {', '.join(skipped_dup[:10])}{' ...' if len(skipped_dup) > 10 else ''}")
    if skipped_invalid:
        print(f"スキップ (from_stock 形式不正): {len(skipped_invalid)} 件 — {', '.join(skipped_invalid[:5])}")
    used_map = used_positions_by_topic(usage + new_records)
    repeats = []
    for rec in new_records:
        positions = used_map[(rec["topic"], rec["subject"])]
        prior_uses = [u for u in usage if u["topic"] == rec["topic"] and u["subject"] == rec["subject"] and int(u["stock_position"]) == rec["stock_position"]]
        if prior_uses:
            repeats.append(f"{rec['topic']}#{rec['stock_position']} (前回: {prior_uses[-1].get('lesson_id')})")
    if repeats:
        print(f"⚠️  再出題 {len(repeats)} 件 — {', '.join(repeats)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="全トピック残量を一覧表示")
    g.add_argument("--topic", metavar="TOPIC", help="指定トピックの未使用問題を difficulty 別に表示")
    g.add_argument("--weakness-top", metavar="N", type=int, help="priority_queue 上位 N の pattern_id と関連 stock を表示")
    g.add_argument("--stats", action="store_true", help="使用率レポート")
    g.add_argument("--record", metavar="LESSON_JSON", help="lesson JSON の meta.from_stock を _usage.jsonl に追記")
    parser.add_argument("--subject", choices=("math", "japanese"), help="--list 時の科目フィルタ")
    args = parser.parse_args()

    index = load_index()
    usage = load_usage()

    if args.list:
        cmd_list(args, index, usage)
    elif args.topic:
        cmd_topic(args, index, usage)
    elif args.weakness_top:
        cmd_weakness_top(args, index, usage)
    elif args.stats:
        cmd_stats(args, index, usage)
    elif args.record:
        cmd_record(args, index, usage)


if __name__ == "__main__":
    main()
