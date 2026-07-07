# Phase 1 集計クエリ集

2026-04-27 の D1 全廃後、ブリーフィングの一次データは `data/play_log/*.jsonl`、`data/weakness_profile.json`、`data/lessons-handwritten/*.json`、`frontend/public/data/*.json`。このファイルに残る SQL は旧 D1 時代の参考であり、現行 briefing では JSONL/JSON 集計を優先する。

現行の必須ルール:
- `weakness_profile.last_updated` は timezone-aware ISO datetime として parse する。
- 未分析判定は `payload.answered_at` または `occurred_at` が `last_updated` より後かで判定する。
- dedup key は `question_id + step + answered_at`。
- `data/play_log/invalidations.json` と `scripts/play_log_invalidation.py` を最初に適用し、該当 event は正答率・弱点・難易度判断に使わない。
- `lesson_id` / `question_id` を `data/lessons-handwritten/{date}-{subject}.json` または `frontend/public/data/lessons.json` と join して、subject / unit_id / pattern_id / difficulty / correct_answer を確定する。
- `subject="unknown"` や `unit_id="?"` が残る集計を Phase 3 の根拠にしない。

## 1a. 直近プレイログ取得

`{last_updated}` = `data/weakness_profile.json` の `last_updated` フィールド。

### 科目別サマリー（前回更新以降・現行 JSONL）

```python
import collections, json, pathlib, sys
from datetime import datetime, timezone

sys.path.append("scripts")
from play_log_invalidation import invalidation_reason, load_rules

def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

last_updated = parse_dt(json.loads(pathlib.Path("data/weakness_profile.json").read_text())["last_updated"])
rules = load_rules()
stats = collections.defaultdict(lambda: {"total": 0, "correct": 0, "time": 0})
seen = set()

for path in sorted(pathlib.Path("data/play_log").glob("????-??-??.jsonl")):
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if invalidation_reason(rec, rules):
            continue
        p = rec.get("payload", {})
        if p.get("is_correct") is None:
            continue
        answered_at_raw = p.get("answered_at") or rec.get("occurred_at")
        if not answered_at_raw or parse_dt(answered_at_raw) <= last_updated:
            continue
        key = (p.get("question_id"), p.get("step", 1), p.get("answered_at"))
        if key in seen:
            continue
        seen.add(key)
        subject = p.get("subject") or "unknown_needs_lesson_join"
        stats[subject]["total"] += 1
        stats[subject]["correct"] += int(bool(p.get("is_correct")))
        stats[subject]["time"] += p.get("time_spent_sec", 0) or 0

print(dict(stats))
```

### 不正解の詳細

不正解詳細も同じ invalidation filter + datetime filter + dedup を通し、表示前に lesson metadata と join する。question_text / correct_answer が取得できない場合は、Phase 2 では「join 未完了」と明記し、Phase 3 のスコア更新根拠に使わない。

## 1c. スケジュール確認

```bash
python3 - <<'PY'
import json, pathlib
schedule = json.loads(pathlib.Path("frontend/public/data/schedule.json").read_text())
for item in schedule:
    print(item)
PY
```

## 1g. 未分析プレイ日の検出

invalidation filter を通したうえで、`answered_at > last_updated` を datetime で判定する。`answered_at > '{last_updated}T23:59:59'` のような文字列合成は禁止。`last_updated` がすでに日時を含むため、同日内のログを取りこぼす。

**未分析プレイ日が1日でもあれば、Phase 3 の再設計提案と Phase 4 のアクション実行を必ず動かす。**

## 1h. プレイ済みレッスン内訳（問題単位＋集計）

未分析 answer の `lesson_id` / `question_id` を lesson metadata に join して、少なくとも以下を出す:

| lesson_id | question_id | step | subject | unit_id | pattern_id | difficulty | is_correct | user_answer | correct_answer |
|---|---|---:|---|---|---|---|---:|---|---|

同じ `question_id` で複数 step がある場合は step 単位で1行ずつ出す。

取得した内訳から、パターン別に以下を推定する:

| 項目 | 推定方法 |
|------|---------|
| サンプル数 | パターンごとの問題数 |
| 正答率 | correct / total |
| 含まれた難易度 | 問題テキスト・unit_id・lesson.difficulty から **§4d（志望校アンカー基準）** で判定（d1-d5）。参照: `_shared/question-rules.md §4d` + `data/target-school/difficulty-anchor.md`。d5 は過去問大問 3(3)(4) 相当・偏差値 50 で 10-20% 正答の発展問題 |
| 4/12-style 再出題の成否 | 直近ミスと同一パターンが含まれていて正解なら「克服マーク」 |

これが Phase 3 の降格ロジック・難易度昇格ロジックの入力になる。1h をスキップすると Phase 3 は独自解釈で動くことになり信頼性を失う。

## 2 の pending 配分チェック Step1（unit_idレベル）

`frontend/public/data/schedule.json` と `frontend/public/data/lessons.json` を join して、今日以降かつ `pending` 相当のレッスンについて unit_id 分布を集計する。D1 SQL は使用しない。

※ パターンレベルの検証（Step 2）は `scripts/validate_lesson_format.py` と `generate-drill-lesson/reference/gates.md` に委譲。スコア60以上のパターンに0問がないかはそちら参照。
