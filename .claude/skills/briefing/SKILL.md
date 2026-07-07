---
name: briefing
description: 起動時の日次ブリーフィング。プレイログ分析→弱点更新→スケジュール確認→レッスン生成→テスト分析を対話形式で実行するオーケストレータ。generate-drill-lesson / analyze-test を呼び出す。
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Briefing - 日次ブリーフィング

起動時に保護者に現状を報告し、方針を議論してからアクションに入る統合スキル。このスキルは**オーケストレータ**で、個別の重い処理は atomic スキルに委譲する。

## 使い方

```
/briefing              # 通常ブリーフィング
/briefing "テスト分析"  # テスト結果がある場合
```

## フロー

```
[Phase 1] 状況把握（自動）
  ├─ 1a プレイログ取得
  ├─ 1b 弱点プロファイル確認
  ├─ 1c スケジュール確認
  ├─ 1d テスト結果フォルダ確認
  ├─ 1e test_schedule.json 経由で次テストの artifacts を読む
  ├─ 1f staleness check
  ├─ 1g 未分析プレイログの検出
  └─ 1h プレイ済みレッスン内訳取得
       ↓
[Phase 2] ブリーフィング報告（保護者に提示）
       ↓
[Phase 3] 再設計方針の自動提案（エージェントが提案 → 保護者は承認だけ）
       ↓
[Phase 4] アクション実行（承認後）
  ├─ 4a 弱点プロファイル更新（briefing 内部）
  ├─ 4a-2 学習信号プロファイル再生成（build_learning_signal_profile.py）
  ├─ 4b Skill: generate-drill-lesson を呼び出す
  ├─ 4c Skill: analyze-test を呼び出す（テスト未分析時のみ）
  ├─ 4d モチベーターメッセージ
  └─ 4e 統合報告
```

**Phase 1-2 は自動、Phase 3 で再設計方針を提示して保護者の承認だけ得る。Phase 4 は承認後に実行。**

**自発性の原則**: 未分析プレイログが1日でもあれば、エージェントは自発的に Phase 3 の再設計方針を組み立てて提示する。「ユーザーに言われるまで再設計を始めない」は禁止。

---

## 信頼性ゲート（抜け穴防止・必須）

このスキルは日次運用の司令塔なので、以下を満たすまで「ブリーフィング完了」と言わない。

1. **時刻は ISO datetime として比較する。** `weakness_profile.last_updated` は `YYYY-MM-DD` ではなく `2026-05-07T18:05:00+09:00` のような日時を取り得る。`data/play_log/*.jsonl` のファイル名だけで判定せず、各レコードの `payload.answered_at` または `occurred_at` を timezone-aware datetime に parse して `answered_at > last_updated` を判定する。
2. **R2 pull は last_updated の「翌日」から始めない。** 同日内の更新漏れを防ぐため、`--since {last_updated の日付 YYYY-MM-DD}` で pull し、ローカル側で datetime filter する。
3. **重複 answer を除外する。** 送信リトライで同じ回答が複数行入るため、dedup key は `question_id + step + answered_at`。`event_id` は送信ごとに変わるので dedup key に使わない。
4. **既知 UI バグ期間の無効化ルールを最初に適用する。** `data/play_log/invalidations.json` と `scripts/play_log_invalidation.py` を読み、該当 event は dedup・正答率・弱点スコア・lesson difficulty 判断・user_state rebuild の全入力から除外する。invalidations.json の rules に該当する期間・条件の answer は全て破棄する。生ログは監査用に残すが、分析根拠にしない。
5. **ログ単体で subject/unit/pattern/difficulty を推測しない。** `data/play_log/*.jsonl` の payload は `question_id` と `lesson_id` が主で、`subject` / `unit_id` / `pattern_id` / `difficulty` / `correct_answer` を持たないことがある。必ず `data/lessons-handwritten/{date}-{subject}.json` または `frontend/public/data/lessons.json` と join してから集計する。
6. **多段階問題は step 単位で集計する。** `two_tier` / `evidence_first` / `slot_two_tier` は step ごとに別 answer として扱う。問題全体の成否が必要な場合は、同一 `question_id` の全 step が正解のときだけ「問題正解」として別列に出す。
7. **新テスト分析はレッスン生成より先に処理する。** 未分析テストがある場合、Phase 4 は `analyze-test` → Phase 1 再確認 → weakness/training-plan 更新 → `generate-drill-lesson` の順にする。古い弱点で当日レッスンを生成しない。
8. **artifact 欠落の扱いを日付で分ける。** 次の定例テスト（`type: "regular"`）の artifacts は常に必須。次の公開模試（`type: "mock"`）の training_plan は試験日まで14日以内なら必須、15日以上先なら警告のみ。`analysis=null` は未受験の公開模試では正常。
9. **skill 内パスはカレント実体から解決する。** 本文の参照はこの skill ディレクトリ相対パスを優先し、グローバル側だけを読んで repo 内の更新を見落とさない。
10. **staleness alert は blocker / warning を分ける。** blocker がある場合は Phase 4 を止める。warning だけなら Phase 4 は進めてよいが、完了報告に残す。
11. **最後に自己監査を行う。** Phase 2/3/4e の直前に「invalidation適用・未分析ログ検出・dedup・lesson join・artifact check・test analysis ordering・pending 2日維持」の7項目を確認し、未確認項目があれば完了扱いにしない。

---

## 設定責任コントラクト

「同じ設定を2箇所に書かない」ため、各設定項目の所有ファイルを固定する。

| 設定項目 | 所有ファイル | 参照する側 |
|---|---|---|
| **レッスン生成単一入口**（構成設計・執筆・4層ゲート） | **generate-drill-lesson/SKILL.md** | briefing Phase 4b |
| **ブロック別レッスンサイズ**（通常日本編18〜22問 + optional_extra / 火・金本編10問目安 + optional_extra。stock 上限の正本） | **generate-drill-lesson/reference/ownership-contract.md** | SKILL.md, briefing |
| 動的難易度ロジック式（正答率×実難易度→difficulty） | **generate-drill-lesson/reference/ownership-contract.md** + **data/target-school/difficulty-anchor.md** | — |
| 本編 N 問の §4d 必達ミックス（通常日本編18〜22問 / 火・金本編10問目安。optional_extra は本編正解率から分離。強化日は weakness_profile.difficulty_policy を優先） | **generate-drill-lesson/reference/ownership-contract.md** | — |
| 配分検証の判定基準（機械検証 + 視覚検証 + エージェント自己解答 + 保護者目視） | **generate-drill-lesson/reference/gates.md** | — |
| 弱点スコア降格/昇格テーブル | **briefing/reference/score-logic.md** | Phase 3/4a |
| 次テストの日付・主教材X回・パス | **data/test_schedule.json** | 両スキル必読 |
| 主教材カリキュラム全体（19-38回 単元×ページ×授業日×定例テスト日のマスタ／**学習力定例テスト限定**、公開模試は test_schedule.json 側） | **data/textbooks/curriculum/curriculum.json** | 定例テスト範囲・教材学習日の正規化情報源 |
| 5年ステージIII全体分析（単元連鎖・横断ボトルネック・志望校合格から逆算した重点） | **data/textbooks/curriculum/grade5-analysis.md** | briefing / analyze-textbook / generate-drill-lesson 必読 |
| 5年ステージIII全体トレーニング計画（フェーズ計画・既習弱点スパイラル・科目別固定ルール・調整ルール） | **data/textbooks/curriculum/grade5-training-plan.md** | briefing / analyze-textbook / generate-drill-lesson 必読 |
| 志望校ターゲット校方針（入試形式・合格者平均・国算140〜150点ロードマップ） | **data/target-school/long-term-plan.md** | briefing / analyze-textbook / generate-drill-lesson 必読 |
| 各テスト範囲の重点対策ポイント | **training-plan.md** (per test) | 両スキル必読 |
| Day別配分 + 必達難易度ミックス | **training-plan.md** (per test) | 両スキル必読 |
| テスト範囲の核心概念・漢字一覧 | **analysis.md** (定例テストのみ) | 両スキル必読 |
| 大問位置と実難易度の対応表 | **data/test_difficulty_reference.md** | 両スキル必読 |
| テスト別失点大問マーキング | **data/test_difficulty_reference.md** | 両スキル必読 |
| 弱点の evidence_tier（実難易度） | **data/weakness_profile.json** | 両スキル参照 |
| 問題文・選択肢の禁則（英略禁止・数式記号の全角統一） | **_shared/question-rules.md** | Phase 4b / 手書きJSON修正時も必読 |
| **難易度の定義（d1-d5 志望校アンカー基準）** | **_shared/question-rules.md §4d** + **data/target-school/difficulty-anchor.md** | Phase 3/4 必読・analyze-textbook 必読 |
| **タイマー秒数（subject 別固定：算60秒 / 国30秒）** | **frontend/src/hooks/useGameTimer.ts** | 参照のみ（固定値） |

---

## Phase 1: 状況把握

### 1a. 直近のプレイログ取得

`data/weakness_profile.json` の `last_updated` フィールドを確認し、同じ日付から今日までを pull する。pull 後にローカルで `answered_at > last_updated` を datetime filter する。

```bash
# .env の CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を有効にした上で実行（SETUP.md 参照）
python3 scripts/pull_r2_play_log.py --since {last_updated の日付 YYYY-MM-DD}
```

pull 完了後、`data/play_log/YYYY-MM-DD.jsonl`（answer）が生成される。
各行は 1 レコードの JSON（fields: type, session_id, event_id, occurred_at, payload）。

**必須:** 集計前に invalidation summary を確認する。

```bash
python3 scripts/play_log_invalidation.py
```

出力に `invalidated>0` がある場合、その event は以後の snippets / 手元集計 / weakness 更新 / lesson 生成の入力から除外する。Python 集計では必ず次を入れる:

```python
import sys
sys.path.append("scripts")
from play_log_invalidation import invalidation_reason, load_rules
rules = load_rules()
# rec を処理する前に:
if invalidation_reason(rec, rules):
    continue
```

**サマリ集計（固定スクリプト必須）:**

集計は必ず `scripts/summarize_play_log.py` を使う。**インライン Python を書き直すことを禁止する**（invalidation → dedup → datetime filter → lesson join の信頼性ゲートを毎回同一実装で適用するため）。

```bash
python3 scripts/summarize_play_log.py --mode summary   # 科目別正答率
python3 scripts/summarize_play_log.py --mode wrong     # 不正解詳細
python3 scripts/summarize_play_log.py --json /tmp/_play_summary_{date}.json  # 全部 + 機械可読出力
```

スクリプトは subject を lessons.json / lessons-handwritten と自動 join する。出力に `unknown_needs_lesson_join` の警告が残る場合は Phase 3 に進まない。


**is_retry 分離:** answer payload に `is_retry` フィールドが存在するログでは、初回試行（`is_retry` でない record）と再出題（`is_retry === true`）を必ず分離集計する。weakness 更新・難易度判断・正答率の主指標は初回試行ベースで行い、再出題正解は「解説後に救済できた」ことを示す `rescued` 系の補助指標として扱う。

### 1b. 弱点プロファイル確認

```bash
cat data/weakness_profile.json
```

各パターンの `evidence_tier.required_mastery_tier` も確認する（Phase 4b の難易度選定で使う）。

### 1c. スケジュール確認

`data/plan/` または `data/lessons-handwritten/` ディレクトリを確認し、生成済みレッスンの一覧と pending 状況を把握する。

```bash
ls data/plan/ 2>/dev/null
ls data/lessons-handwritten/ 2>/dev/null | tail -10
```

生成済みレッスン JSON が今日以降に存在するかを確認する（2日分維持ルール: 鉄則2）。

### 1d. テスト結果フォルダ確認

```bash
ls data/practice_test/ 2>/dev/null
```

新しいテストフォルダがあり `analysis.json` がなければ Phase 4c（`Skill: analyze-test`）の対象。

### 1e. test_schedule.json 経由で次テストの artifacts を読む

**wildcard find は廃止。すべてのパス解決は `data/test_schedule.json` を経由する。**

```bash
cat data/test_schedule.json
```

`tests[]` 配列から今日以降の次の定例テスト（regular）/公開模試（mock）を選び、各 artifacts (`training_plan`, `analysis`) を読む。`status` 欠落は `upcoming` と同義に扱う。`tbd: true` のエントリは artifacts が null なので 1f の staleness check で検出される。

**必読ファイル:**
1. `data/test_schedule.json`
2. `data/textbooks/curriculum/grade5-analysis.md`
3. `data/textbooks/curriculum/grade5-training-plan.md`
4. `data/target-school/long-term-plan.md`
5. 次の定例テストの artifacts（training_plan + analysis × 国算）
6. 次の公開模試の artifacts（training_plan × 国算、analysis は基本 null）
7. `data/test_difficulty_reference.md`

### training-plan.md の必須スキーマ

以下のセクションが揃っているか確認する（欠落があれば Phase 4 に進む前に保護者に補完を要求）:

```markdown
# training-plan: {テスト名} ({YYYY-MM-DD})

## テスト情報
- 試験日 / 残り日数 / 科目 / 出題範囲

## 重点対策ポイント (優先順)

## Day別配分
| Day | 日付 | 主テーマ | 本編量 | 必達難易度ミックス（§4d: d1-2/d3/d4/d5） |

## 必達難易度ミックス方針（§4d テキスト基準、30問固定禁止）

## Day4 以降の方針
```

### 1f. Staleness Check（必須）

| チェック | 判定方法 | 失敗時のアクション |
|---|---|---|
| `test_schedule.json` に今日以降の定例テスト（regular）と公開模試（mock）が両方あるか | `tests[]` の future entries を探す（`status` 欠落は upcoming 扱い） | 「次テスト日程を test_schedule.json に追加して」 |
| 5年全体資料が存在するか | `data/textbooks/curriculum/grade5-analysis.md` と `grade5-training-plan.md` を `ls` | 「5年ステージIII全体分析・全体training-planを作成/復旧して」 |
| 志望校長期計画が存在するか | `data/target-school/long-term-plan.md` を `ls` | blocker: 「志望校長期計画を復旧して」 |
| `test_difficulty_reference.md` の `covered_tests` に `weakness_profile.timeline` の最新テストが含まれているか | front matter と timeline を突合 | 「{最新テスト名} 分の難易度マーキングを追加して」（Phase 4c 未実施のサイン） |
| 次の定例テストの artifacts パスが実在するか（`tbd: true` は除外） | 各パスを `ls` | blocker: 「教科書画像から analysis.md/training-plan.md を作成」 |
| 次の公開模試の training_plan が実在するか | 試験日まで14日以内なら `ls`、15日以上先なら warning | blocker または warning: 「公開模試テンプレから作成」 |
| `learning_signal_profile.json` が新鮮か（**鮮度ゲート**） | `generated_at` と play_log の最新有効 `answered_at` を datetime 比較 | 7日超: warning / 14日超: blocker。Phase 4a-2 で再生成する |

**鮮度の原則**: 必読入力は「存在するか」だけでなく「最新プレイ・最新テストに追従しているか」を見る。欠落と同様に、停滞した必読入力も staleness alert の対象とする（凍結したまま古い信号でレッスン形式が決まり続けることを防ぐため）。

blocker が1つでもあれば **Phase 2 報告の冒頭に ⚠️ アラートを出し、Phase 4 に入る前に保護者へ更新確認を要求する。** warning のみなら Phase 4 は進めてよいが、完了報告に残す。

### 1g. 未分析プレイログの検出（必須）

`data/play_log/` 内の jsonl レコードの `answered_at` と `weakness_profile.json` の `last_updated` を datetime 比較する。ファイル名だけで比較しない。

```bash
python3 scripts/summarize_play_log.py --mode unanalyzed
```

**未分析プレイ日が1日でもあれば:**
1. 弱点スコア再計算（Phase 4a、降格含む）
2. 既存 pending レッスンの上書き再生成（Phase 4b で `generate-drill-lesson` 呼び出し）
3. 不足日の新規生成

未分析 0日なら Phase 3/4 の再設計はスキップしてよい（ただし鉄則2の2日分維持チェックは残る）。

### 1h. プレイ済みレッスン内訳取得（必須）

1g で検出した未分析 answer を読み込み、lesson metadata と join して lesson_id / unit_id / pattern_id / difficulty / step / 正誤 の内訳を集計する。

```bash
python3 scripts/summarize_play_log.py --mode breakdown
```

取得した内訳を Phase 3 の降格/昇格ロジックの入力にする。**1h をスキップすると Phase 3 は独自解釈で動くことになり信頼性を失う。** `unit_id="?"` または `unknown_needs_lesson_join` が残っている場合も Phase 3 に進まない。

---

## Phase 2: ブリーフィング報告

`reference/report-template.md` の「Phase 2: ブリーフィング報告」テンプレートに従って保護者に提示。

Staleness alert があれば冒頭に表示。

pending 配分チェックは 2段階（unit_idレベル + パターンレベル）:
- **unit_id レベル**: `data/plan/` 配下の pending レッスン JSON の unit_id 分布を集計して確認
- **パターンレベル**: `generate-drill-lesson/reference/gates.md` 参照

---

## Phase 3: 再設計方針の自動提案

**実行前に `reference/score-logic.md` を Read。** 降格テーブルと難易度昇格ロジックを確認する。

`reference/report-template.md` の「Phase 3: 再設計方針の自動提案」テンプレートに従って、1h のデータから機械的に以下を計算して提示する:

- **A. 弱点スコア調整**（降格テーブル適用）
- **B. 難易度昇格/降格**（昇格ロジック適用）
- **C. パターン配分の重み変更**
- **D. 実行アクション**（Phase 4 で実行する具体内容）

未分析 0日なら Phase 3 をスキップして Phase 4 の鉄則2（2日分維持）チェックだけ走らせる。

**保護者への確認は「この方針で Phase 4 を回していい？」だけ。** 個別数値は聞かない（修正要求があった場合のみ議論）。

---

## Phase 4: アクション実行

保護者の承認後、以下を順に実行。未分析テストがある場合は 4c を最優先し、分析後に Phase 1 を再実行してから 4a/4b に入る。

### 4-pre. 実行順序ゲート

| 条件 | 実行順 |
|---|---|
| 未分析テストあり | 4c analyze-test → Phase 1 再確認 → 4a weakness 更新 → 4b generate-drill-lesson |
| 未分析テストなし・未分析プレイあり | 4a weakness 更新 → 4b generate-drill-lesson |
| 未分析テストなし・未分析プレイなし | 鉄則2の2日分 pending 不足があれば 4b、足りていれば報告のみ |

この順序を崩すと、新しいテスト失点を反映しないレッスンを生成するため禁止。

### 4a. 弱点プロファイル更新

**編集前の突合（必須）**: `patterns` 配列と `priority_queue` の score が一致しているか全 pattern_id を突合する。乖離があれば `patterns` 側を正として `priority_queue` を再構築してから更新に入る（二重管理の同期漏れ前科あり）。

`data/weakness_profile.json` を直接編集:

- 新パターン追加（必ず `evidence_tier` を付ける）
- 既存パターンのスコア再計算（**降格含む**、`reference/score-logic.md` のテーブル適用）
- priority_queue 更新
- **`last_updated` を最新の分析済み answer datetime まで進める**（日付だけに丸めない。忘れると次回 1g で未分析扱いになり再計算が暴発する）
- テストで新たな失点があった場合は `evidence_tier.max_failed` と `last_failed_test` を更新

### 4a-2. 学習信号プロファイル再生成（必須）

4a の直後に必ず実行する。`generate-drill-lesson` が出題形式の決定に使う `learning_signal` / `recommended_intervention` を最新プレイに追従させる。**これをスキップすると学習信号が凍結し、古い信号でレッスン形式が決まり続ける。**

```bash
python3 scripts/build_learning_signal_profile.py \
  --start-date {今日の14日前 YYYY-MM-DD} \
  --end-date {今日 YYYY-MM-DD}
```

実行後、`data/learning_signal_profile.json` の `generated_at` が当日になっていることを確認してから 4b に進む。

### 4b. レッスン動的生成

**`Skill: generate-drill-lesson` を呼び出す。**

Phase 3 で決定した方針（降格済み weakness_profile + 改訂済み training-plan.md）を前提に、generate-drill-lesson スキルが以下を実行する:

- 既存 pending の上書き再生成（未分析プレイがあった場合）
- 不足日の新規生成（鉄則2の2日分維持）
- **本編ブロックの構成設計と執筆**（通常日本編18〜22問 / 火金本編10問目安。optional_extra は分離。両科目ともエージェント直接）
- 機械検証 + 視覚検証 + エージェント自己解答 + 保護者目視の4層ゲートのクリア

詳細手順は `generate-drill-lesson/SKILL.md` を参照。

### 4c. テスト分析

`data/practice_test/` に analysis.json 未作成のテストフォルダがある場合、または `weakness_profile.timeline` 最新テストが `test_difficulty_reference.md.covered_tests` に無い場合、**`Skill: analyze-test` を呼び出す。**

詳細手順は `analyze-test/SKILL.md` を参照。

**連動する staleness check:**
- `test_difficulty_reference.md.covered_tests` の最新 < `weakness_profile.timeline` の最新 → Phase 4c がスキップされた痕跡として次回 /briefing で ⚠️ アラートを出す

### 4d. モチベーターメッセージ

モチベーターメッセージは localStorage ベースの JSON アーキテクチャに移行済み（D1 不要）。

メッセージは `data/plan/` 配下のレッスン JSON に `motivator_message` フィールドとして直接埋め込む。
フロントエンドが localStorage から読み込む際に表示する。

埋め込み例（generate-drill-lesson が自動設定する想定。手動追記する場合はレッスン JSON を直接編集）:

```json
{
  "motivator_message": "{YYYY-MM-DD}の応援メッセージ"
}
```

### 4e. 統合報告

`reference/report-template.md` の「Phase 4e: アクション完了報告」テンプレートに従って報告。

---

## プロファイル構造リファレンス

```json
{
  "version": 2,
  "last_updated": "YYYY-MM-DD",
  "patterns": {
    "math": [
      {
        "id": "...",
        "severity": "critical",
        "typical_errors": [...],
        "status": "active",
        "evidence_tier": {
          "max_failed": 3,
          "last_failed_test": "公開模試第3回 大問4(1)(2)",
          "required_mastery_tier": 3
        }
      }
    ]
  },
  "priority_queue": [{ "pattern_id": "...", "subject": "math", "score": 98 }]
}
```
