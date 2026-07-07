# ブリーフィング報告テンプレート

Phase 2 の状況報告と Phase 4e の完了報告で使うテンプレート。

## Phase 2: ブリーフィング報告

```markdown
## ブリーフィング（YYYY-MM-DD）

### ⚠️ Staleness Alert（ある場合のみ）
- test_schedule.json: ...
- test_difficulty_reference.md: ...
- artifacts 欠落: ...

### プレイログ
| 科目 | 回答数 | 正答率 | 平均時間 |
|------|--------|--------|---------|

※ 集計は `data/play_log/invalidations.json` の invalidation filter、`answered_at > weakness_profile.last_updated` の datetime filter、`question_id + step + answered_at` dedup、lesson metadata join 済みであること。join 未完了の `unknown` 行が残る場合は、弱点更新の根拠にしない。

### 不正解分析
| 問題 | 学習者の回答 | 正解 | パターン |
|------|---------|------|---------|

### プレイ済みレッスン詳細内訳（1h で取得したもの）

各未分析レッスンについて、どのパターンをどの難易度でどれだけ解いたかを表にする:

| レッスンID | パターン | step数 | 問題数 | 正答step | 含まれた難易度（§4d） | 備考 |
|-----------|---------|------:|------:|------:|---------------|------|
| lesson-m-MMDD | keisan-junjo | N | N | N | d3-d5（志望校アンカー） | 分配法則含む、d5 は過去問 大問 3(3)(4) 相当 |

**克服マーク**: 直近の不正解と同一パターンが再出題されて正解になっていれば「✓克服」と明記する。

### 弱点スコア（変動あり）
| パターン | 前回 | 今回 | 変動 | 状況 | 実難易度ターゲット |
|---------|------|------|------|------|-------------------|

### 新発見の弱点
- ...

### 次テスト対策（14日以内の場合）
- **テスト日**: YYYY-MM-DD（残り N 日）
- **範囲**: 主教材 第X回・第Y回（or 全既習範囲）
- **analysis.md 要点**: （核心概念、出題予測、学習者の弱点との重なりを3行程度）
- **training-plan.md 要点**: （重点対策ポイント、Day別配分の現在地、**必達難易度ミックス（§4d: d1-2/d3/d4/d5、d5最低3問）**）
- **消化度**: Day M/Total 完了、残り N 日分のレッスン生成必要
- **test_difficulty_reference.md の該当行**: 本番の大問構造と学習者の現状を対比で報告

### 今後のスケジュール
| 日付 | 算数 | 国語 | チェッカー | 状態 |
|------|------|------|-----------|------|

### 既存レッスン配分チェック（2段階）

Step 1: unit_idレベル（粗い粒度）
Step 2: パターンレベル（スコア50以上の全パターンについてキーワード検証）

判定基準:
- スコア60以上のパターンに0問 → **即再生成を推奨アクションに含める**（⚠️印付き）
- スコア50以上のパターンに0問 → 注意として報告

※ 詳細は `generate-drill-lesson/reference/gates.md` と `scripts/validate_lesson_format.py` の unit / pattern coverage 参照

### 実行可否ゲート
| チェック | 状態 | 判定 |
|---------|------|------|
| play_log invalidation 適用 | OK/NG | blocker if NG |
| 未分析ログ datetime filter + dedup | OK/NG | blocker if NG |
| lesson metadata join | OK/NG | blocker if unknown remains |
| 次 定例テスト artifacts | OK/NG | blocker if NG |
| 次 公開模試 training_plan | OK/WARN/NG | 14日以内 NG は blocker |
| 未分析テスト | なし/あり | ありなら analyze-test を先行 |
| pending 2日分 | OK/不足 | 不足なら generate-drill-lesson |

### 推奨アクション
1. ...
2. ...
3. ...
```

## Phase 3: 再設計方針の自動提案

```markdown
## 再設計方針（エージェントの自動提案）

### A. 弱点スコア調整（score-logic.md の降格テーブルに従う）
| パターン | 現score | 根拠（今回プレイ内訳） | 新score |
|---------|---------|----------------------|--------|

### B. 難易度昇格/降格（score-logic.md の昇格ロジックに従う）
| Day | 日付 | 原案ミックス | 改訂ミックス | 理由 |
|-----|------|-------------|-------------|------|

### C. パターン配分の重み変更
降格したテーマは問題数を減らし、まだ未検証・スコア据え置きのテーマは d3-4 で再検証する。

### D. 実行アクション（Phase 4 で実行）
1. 未分析テストがあれば analyze-test を先行し、Phase 1 を再確認
2. weakness_profile.json を更新（スコア降格 + last_updated を最新分析済み answer datetime まで進める）
3. training-plan.md の「現在地」に改訂履歴を追記
4. lesson-X-MMDD を上書き再生成（手書き JSON 更新 → build_handwritten_to_json.py）
5. lesson-Y-MMDD を新規生成（鉄則2の2日分 pending 維持）
```

**保護者に聞くのはこれだけ:**
1. 「この方針で Phase 4 を回していい？」

**聞かないこと（エージェントが決める）:**
- 個別の降格幅 / 難易度昇格幅
- どのレッスンを上書きするか
- どの漢字を入れるか

## Phase 4e: アクション完了報告

```markdown
## アクション完了

### 弱点プロファイル更新
- 新規: ...
- 変動: ...
- evidence_tier 更新: ...

### 生成したレッスン
| 日付 | 科目 | レッスン | 強化 | 維持 | 新規 | 合計 | difficulty分布 |
|------|------|---------|------|------|------|------|----------------|

### 問題配分詳細
- {pattern_id} (score=XX, required_tier=Y): N問 [強化] d{X} × k問

### 検証結果（自動 + 目視）
- [1] 上位3パターン: ✓
- [2] 克服済み最多チェック: ✓
- [3] スコア60以上ゼロ問チェック: ✓
- [4] 漢字25%: ✓
- [5] 難易度分布: ✓ / ✗（詳細）
- [6] 科目別単独責任 JSON ソース検証: ✓ / ✗
- [7] validate_lesson_format.py R0-R19: ✓ / ✗
- [8] 保護者目視レビュー: ✓ / ✗
- [9] 保護者 debug skip mode 目視待ち: ✓ / pending

### 自己監査
- 未分析ログ検出: OK/NG
- dedup: OK/NG
- lesson join: OK/NG
- artifact check: OK/WARN/NG
- test analysis ordering: OK/NG
- pending 2日維持: OK/NG
```
