# 未学習単元ガード

## 概要

本ファイルは `_shared/question-rules.md` **§4e 未学習単元ガード** の実装ガイドです。
ガードテーブル（禁止キーワード・教材学習日・例外）の定義は §4e を正本とします。本ファイルはパイプライン内での適用手順を補足します。

「教材学習日」の正規化情報源は **`data/textbooks/curriculum/curriculum.json`**（19-38回 × 算数/国語の `lecture_period.start`）。下の `GUARD_TABLE` の `unlock_date` は curriculum.json から派生したスナップショット。定例テスト限定で、公開模試は curriculum.json に含まれない。

---

## パイプライン内チェックポイント

```
Step 4: 科目別単独責任 LLM が全問執筆
   ↓
Step 5: 難易度割当
   ↓
Step 6: インターリーブ
   ↓
【★ここでガードチェック】Step 6.5: 未学習単元フィルタ  ← 本ファイルの対象
   （generate-drill-lesson Step 4〜5 の執筆時にエージェントが既にガード適用する場合、ここは確認的役割）
   ↓
Step 7: JSON ファイル出力（D1 は廃止済み: D1 投入は行わない）
```

**Step 6 後・Step 7 前** に、生成した全問題テキスト（`question_text`, `solution_steps`, `hints`, `figure_svg`）に対して禁止キーワードチェックを実行する。違反があれば当該問題を除外し、Step 4〜6 の対象プールから代替問題を再生成して補充する。

---

## チェックの実装（Python snippet）

```python
from datetime import date

# ガードテーブル（§4e ガードテーブルと同期して管理）
GUARD_TABLE = [
    {
        "label": "円の面積系",
        "unlock_date": date(2026, 9, 1),  # 教材学習日の例。実際は curriculum.json の lecture_period.start を使う
        "forbidden": [
            "円の面積",
            "おうぎ形",
            "弧の長さ",
            "中心角が何度",
            "半径 × 半径",
            "半径×半径",
            "かげの部分",   # 円を含む複合図形のかげ部分が対象
        ],
        # 例外キーワードを含む場合はガードをスキップ（公式直接適用1問のみ許可）
        "exceptions": [
            "面積 = 半径 × 半径 × 3.14",
        ],
    },
]

def validate_question(q_text: str, today: date = None) -> bool:
    """
    問題文・選択肢・解説の連結テキストを受け取り、
    未学習単元ガードに違反していなければ True を返す。
    today が None の場合は date.today() を使用。
    """
    if today is None:
        today = date.today()

    for guard in GUARD_TABLE:
        if today >= guard["unlock_date"]:
            # 解禁済み — チェック不要
            continue

        # 例外キーワードが含まれれば許可
        if any(exc in q_text for exc in guard["exceptions"]):
            continue

        # 禁止キーワードが含まれれば NG
        if any(f in q_text for f in guard["forbidden"]):
            return False  # この問題は除外

    return True  # 問題なし


def filter_questions(questions: list[dict], today: date = None) -> tuple[list[dict], list[dict]]:
    """
    questions: [{"id": ..., "full_text": "<question_text>+<solution_steps>+<hints>+<figure_svg>"}, ...]
    戻り値: (OK 問題リスト, 除外問題リスト)
    """
    ok, ng = [], []
    for q in questions:
        if validate_question(q["full_text"], today):
            ok.append(q)
        else:
            ng.append(q)
    return ok, ng
```

### 使用例

```python
questions = [
    {"id": "q001", "full_text": "長方形の面積を求めよ。縦3cm、横4cm。"},
    {"id": "q002", "full_text": "円の面積を求めよ。半径5cm。"},
    {"id": "q003", "full_text": "面積 = 半径 × 半径 × 3.14 を使って求めよ。半径3cm。"},
]

ok, ng = filter_questions(questions, today=date(2026, 8, 15))
# ok: [q001, q003]  ← q003 は例外（公式直接適用）で許可
# ng: [q002]        ← 除外対象
```

---

## ガード解除の手順

1. 教材学習日（`unlock_date`）当日朝に以下を実施:
   - 本ファイル `GUARD_TABLE` から該当エントリを削除（コメントアウトでも可）
   - `_shared/question-rules.md` §4e のガードテーブルから該当行を削除
   - 該当回の `data/textbooks/curriculum/算数/{回}回/training-plan.md` に「〇〇 解禁済（YYYY-MM-DD）」を記録する。単発回ディレクトリ（例: `27回`）を使う

2. 解禁後の初回 generate-drill-lesson では d2→d4 の段階問題を優先して出題（いきなり d5 は出さない）

---

## 現在のガード対象

**なし**。新しい未学習単元が発生したら §4e（question-rules.md）のガードテーブルと本ファイルの `GUARD_TABLE` に対で追加する。

### 解禁済み履歴（記入例）

| 単元 | 禁止期間 | 解禁日 |
|------|---------|-------|
| （例）円の面積系（おうぎ形・弧・中心角逆算・複合かげ部分） | 〜 YYYY-MM-DD | YYYY-MM-DD 解禁済み |

上の Python snippet の `GUARD_TABLE` エントリは記述例として残置している（`unlock_date` 経過後はコードが自動スキップするため実害なし）。

**運用方針**: 教材学習日当日は出題ガードを継続し、翌日から段階解禁する。理由: 学習当日は教材定着に充てるため、アプリ側出題は翌日からスタートする。
