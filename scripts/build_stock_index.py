#!/usr/bin/env python3
"""
scripts/build_stock_index.py

data/lessons-stock/*.json (アンダースコア接頭ファイル除く) を集計して
data/lessons-stock/_index.json を生成する。

5/9 以降の generate-drill-lesson 実行時、エージェントが在庫トピック/未使用問題を
即座に把握するためのインデックス。

使い方:
  python3 scripts/build_stock_index.py
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

STOCK_DIR = Path(__file__).resolve().parent.parent / "data" / "lessons-stock"
INDEX_PATH = STOCK_DIR / "_index.json"
JST = timezone(timedelta(hours=9))


def collect_topic(file: Path) -> dict:
    data = json.loads(file.read_text(encoding="utf-8"))
    questions = data.get("questions", [])
    diff_counter: Counter[str] = Counter(q.get("difficulty") for q in questions)
    unit_counter: Counter[str] = Counter(q.get("unit_id") for q in questions)
    anchors: list[str] = []
    seen_anchors: set[str] = set()
    for q in questions:
        anchor = (q.get("meta") or {}).get("target_anchor")
        if anchor and anchor not in seen_anchors:
            seen_anchors.add(anchor)
            anchors.append(anchor)
    return {
        "topic": data.get("topic"),
        "subject": data.get("subject"),
        "file": file.name,
        "lesson_id": data.get("lesson_id"),
        "title": data.get("title"),
        "stock_version": data.get("stock_version"),
        "total": len(questions),
        "difficulty_dist": dict(sorted(diff_counter.items())),
        "unit_ids": sorted(unit_counter.keys()),
        "unit_id_dist": dict(sorted(unit_counter.items())),
        "target_anchors": anchors,
    }


def main() -> None:
    files = sorted(p for p in STOCK_DIR.glob("*.json") if not p.name.startswith("_"))
    topics = [collect_topic(f) for f in files]
    payload = {
        "version": 1,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "total_topics": len(topics),
        "total_questions": sum(t["total"] for t in topics),
        "topics": topics,
    }
    INDEX_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {INDEX_PATH} ({len(topics)} topics, {payload['total_questions']} questions)")


if __name__ == "__main__":
    main()
