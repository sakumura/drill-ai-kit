<!---
last_updated: 2026-07-02
covered_tests:
  - 定例テスト第3回 (2026-05-23)
  - 定例テスト第4回 (2026-06-13)
difficulty_system: §4d (志望校アンカー基準 d1-d5 に統一)
target_anchor_ref: data/target-school/difficulty-anchor.md
-->

# テスト実難易度リファレンス（合成サンプル）

> **これは合成データです。** 塾テストの「大問位置 × 実難易度」を記録するハブ。
> テスト結果が出るたびに analyze-test（Phase 4c）が更新する。

## 使い方

- レッスン生成時、各テーマについて「本番で取らせたい下限 difficulty」を本ファイルから引く
- テスト結果が出るたびに Phase 4c のチェックリストに従って **必ず更新する**
- 更新忘れは Phase 1 の staleness check（`covered_tests` と `weakness_profile.timeline` の突合）で検出される

## difficulty 換算定義（§4d 志望校アンカー基準）

- 換算の正本は `data/target-school/difficulty-anchor.md` と `_shared/question-rules.md §4d`

## 算数

### 定例テスト

| 大問 | 内容 | 実難易度 |
|---|---|---|
| 1 | 計算・逆算の小問集合 | d2-d3 |
| 2 | 範囲単元の基本文章題 | d3 |
| 3 | 範囲単元の応用 | d4 |
| 4 | 複合応用 | d5 |

### 算数 直近失点マーキング

- 定例テスト第4回 大問1(3): 2演算逆算 d3 ×（gyakuzan）
- 定例テスト第4回 大問3(2): 逆算と分数の複合 d4 ×（gyakuzan）

## 国語

### 定例テスト

| 大問 | 内容 | 実難易度 |
|---|---|---|
| 一 | 漢字の読み書き | d2 |
| 二 | 語句・慣用句 | d2-d3 |
| 三 | 物語文 | d3-d5 |
| 四 | 説明文 | d3-d4 |

### 国語 直近失点マーキング

- 定例テスト第4回 大問3(4): 心情の変化 d4 ×（shinjou-henka）

## 運用ルール（Phase 4c チェックリストと連動）

1. 新テストの分析が終わったら `covered_tests` に追記する
2. 失点大問には弱点 pattern_id を必ず紐付ける
