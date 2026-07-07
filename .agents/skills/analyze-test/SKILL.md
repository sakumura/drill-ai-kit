---
name: analyze-test
description: テスト結果（答案PDF + 問題画像）を分析し、Codex/Claude/Geminiの2系統以上で画像解析を照合してから、tier付け→test_difficulty_reference.md更新→weakness_profile.json更新→次テストtraining-plan.md更新までを一括実行する。定例テスト・公開模試の両方に対応。
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Analyze Test - テスト結果分析

`data/practice_test/` に新しいテストフォルダがあり `analysis.json` が未作成の時に実行する。briefing Phase 4c からも呼ばれる。

このスキルは「読めた気がする」で完了しない。結果画像・答案・問題・模範解答・解説をページ単位で棚卸しし、少なくとも Codex + Claude または Codex + Gemini の2系統で視覚解析を照合する。不一致や低信頼箇所は crop/再レンダリング/別モデル追加で潰し、`unresolved_questions` が空になるまで分析完了扱いにしない。

## 使い方

```
/analyze-test                            # 未分析テストを全部処理
/analyze-test "2026-04-05_mock_3"     # 特定フォルダのみ
```

## 前提

- `data/practice_test/<テスト名>/` に答案PDFと問題画像が格納されている
- `data/test_difficulty_reference.md` の換算表が読める状態にある
- 画像解析は Codex, Claude, Gemini のうち2つ以上を使う。片方が使えない場合は残る2つを使い、2系統を確保できない場合は完了にしない
- Claude/Gemini/Codex CLI など外部モデルCLIへ学習者答案・成績画像を送る場合は、送信先、送信資料、学習利用拒否・データ保持・人間レビュー設定の確認状況を説明して保護者の明示承認を取る。承認なしに回避実行しない
- このスキルは高性能な外部AI利用を前提にする。性能の低いローカルLLMだけで実戦品質の画像読解を代替する方針にはしない

## 必須チェックリスト（全項目クリアで完了）

```
[ ] 0. 全アーティファクトを棚卸しし、PDFは全ページを画像化してページ対応表を作る
[ ] 1. Codex + Claude/Gemini の2系統以上で画像解析し、差分を照合
[ ] 2. 不一致・低信頼・欠落を crop/再解析で潰し、unresolved_questions を空にする
[ ] 3. 答案 PDF + 問題画像を読み取り
[ ] 4. 各大問に tier (1-5) をタグ付け（test_difficulty_reference.md の換算表に従う）
[ ] 5. test_difficulty_reference.md を更新
       - front matter の last_updated を今日に
       - front matter の covered_tests に今回のテストを追加
       - 「直近失点マーキング」セクションに今回の失点大問を追記
       - 標準難易度表（大問位置 → tier）に乖離があれば追記
[ ] 6. test_schedule.json の該当テストを "完了" にするか、新しい次テストを追加
[ ] 7. 失点パターンに evidence_tier.{max_failed, last_failed_test, required_mastery_tier} を設定
[ ] 8. weakness_profile.json の timeline に結果追加
[ ] 9. weakness_profile.json の priority_queue を再計算
[ ] 10. 次テストの training-plan.md を更新（残り日数・必達難易度ミックス）
[ ] 11. analysis.json に model_reviews と unresolved_questions: [] を保存
```

**全項目クリアしないと "完了" にしない。** チェック漏れは次回 briefing の staleness check で検出される。

---

## Step 0: アーティファクト棚卸しとページ化

テストフォルダ内のファイルを `inventory` として記録する。PDFは全ページを 250-300dpi のPNGにレンダリングし、ページ順・科目・種別（問題/答案/解答/解説/成績）を対応付ける。画像が傾き・低解像・小さい場合は該当領域をcropして再解析する。

モデル照合の詳細手順は `reference/multi-model-vision.md` を読む。

## Step 1: 2系統以上の画像解析照合

Codexが一次読解し、ClaudeまたはGeminiが独立に同じページを読む。低信頼箇所、点数、正誤、選択肢番号、記述採点、問題番号対応は必ず field 単位で比較する。

照合結果は `analysis.json` に以下を残す:

```json
{
  "model_reviews": [
    {"model": "codex", "artifact": "算数/...", "findings": "...", "confidence": "high"},
    {"model": "gemini", "artifact": "算数/...", "findings": "...", "confidence": "high"}
  ],
  "cross_check": {
    "models_used": ["codex", "gemini"],
    "disagreements": [],
    "resolution_notes": []
  },
  "unresolved_questions": []
}
```

`unresolved_questions` に1件でも残る場合は、成果物更新に進まず Step 0/1 に戻る。

## Step 2: 答案読み取り

答案PDFを pages 指定で Read、問題画像を Read で視覚確認。大問ごとに:

- 問題文の要点
- 学習者の回答
- 正解
- 正誤
- 誤答パターン（計算ミス / 概念不理解 / 情報整理ミス 等）

## Step 3: tier 付け

`data/test_difficulty_reference.md` の換算表（大問位置 → 標準 tier）を参照し、各大問に tier 1〜5 を付与。換算表から乖離がある場合は Step 3 で追記する。

## Step 4: test_difficulty_reference.md 更新

**実行前に `reference/tier-mapping.md` を Read**。tier 判定の根拠を確認する。

更新箇所:

```markdown
---
last_updated: YYYY-MM-DD   ← 今日に更新
covered_tests:              ← 今回のテストを追加
  - 2026-03-21 定例テスト第12回
  - 2026-03-30 春期講習特別
  - 2026-04-05 公開模試第3回
  - 2026-MM-DD {今回}        ← 追記
---

## 直近失点マーキング

### 2026-MM-DD {今回}
- 算数 大問4 (1)(2): tier 4 — 角度
- 算数 大問5 (2): tier 3 — 分数÷分数
- 国語 大問3 設問2: tier 3 — 内容合致
```

## Step 5: test_schedule.json 更新

該当テストのステータスを完了に。次回テスト日が未登録なら追加（`tbd: true` でも可、artifacts は後日作成）。

**定例テストの場合**: 次回定例テストの `date` と `curriculum_range` は `data/textbooks/curriculum/curriculum.json` から自動引き出せる（test_date が次に該当する unit を抽出 → その unit と前回 unit の組み合わせが curriculum_range）。**公開模試の場合**: curriculum.json に日程は無いので、塾からの日程案内または既存 test_schedule.json の mock エントリから引く。

```json
{
  "tests": [
    {
      "date": "2026-MM-DD",
      "type": "regular",
      "name": "定例テスト第XX回",
      "status": "completed",
      ...
    },
    {
      "date": "2026-NN-DD",
      "type": "regular",
      "name": "定例テスト第YY回",
      "status": "upcoming",
      "artifacts": { ... }
    }
  ]
}
```

## Step 6: evidence_tier 更新

失点パターンごとに `data/weakness_profile.json` の該当エントリを更新:

```json
"evidence_tier": {
  "max_failed": 4,
  "last_failed_test": "定例テスト第XX回 大問4(1)(2)",
  "required_mastery_tier": 4
}
```

- `max_failed` は過去最大の失点 tier
- `required_mastery_tier` は max_failed と同じ（本番で取らせたい目標）
- 新規失点パターンは patterns[].id を追加し、severity/typical_errors も設定

## Step 7: timeline 追加

```json
"timeline": [
  ...,
  {
    "date": "2026-MM-DD",
    "test": "定例テスト第XX回",
    "math": {"score": 62, "avg": 69.4, "deviation": 47.2},
    "japanese": {"score": 78, "avg": 81.3, "deviation": 48.7},
    "main_weak_points": ["角度", "分数÷分数"]
  }
]
```

## Step 8: priority_queue 再計算

スコア計算式:

| 要素 | 重み |
|------|------|
| severity | critical=30, high=20, medium=10, low=5 |
| detection_count | ×3 |
| 最終検出からの日数 | ×(-5/日) |
| テスト失点との関連 | +20 |
| understanding_level=1 | +15 |

priority_queue 配列を新スコア順に並び替えて上書き。

## Step 9: 次テスト training-plan.md 更新

`test_schedule.json` の次テストの `training-plan.md` を読み、以下を反映:

- 「テスト情報」セクションの残り日数
- 「重点対策ポイント」に新規失点パターンを追加
- 「必達難易度ミックス」を失点 tier に合わせて調整
- 「## 現在地」セクションに今回テスト分析の反映履歴を追記

---

## 完了報告

```
## テスト分析完了（{テスト名} {日付}）

### スコア
- 算数 {点}/{満点} (平均{avg}, 偏差値{dev})
- 国語 {点}/{満点} (平均{avg}, 偏差値{dev})

### tier 付け
| 大問 | tier | 結果 | パターン |
|------|------|------|---------|

### 画像解析ダブルチェック
- 使用モデル: Codex + {Claude/Gemini}
- 解消した不一致: ...
- unresolved_questions: 0

### weakness_profile 更新
- 新規追加: ...
- evidence_tier 更新: ...
- priority_queue 変動: ...

### 次テスト training-plan.md 改訂
- 重点対策ポイント追加: ...
- 必達難易度ミックス変更: ...
```

---

## briefing との連携

analyze-test 完了後、通常は次の `/briefing` で新しい状態が反映される。テスト分析を挟んでから当日のレッスン生成を回したい場合は `/briefing` を再実行する。
