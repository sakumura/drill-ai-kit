# 主教材 5年生 志望校合格トレーニングプラン（合成サンプル）

> **これは合成データです。** 自分の塾教材（カリキュラム表・テキスト）から同じ構成で書き直して使う。
> briefing / generate-drill-lesson の Step 2 必読データ。日次負荷・フェーズ・科目別固定ルールの実行正本。

## 正本の読み順

1. このファイル（日次負荷・フェーズ・固定ルール）
2. `grade5-analysis.md`（構造分析・ボトルネック）
3. `data/target-school/long-term-plan.md`（志望校方針）
4. 次回テスト範囲の `training-plan.md` / `analysis.md`

## 最上位KPI

- 定例テストで対策単元の正答率 80% 以上を維持する
- 公開模試で d3 帯の取りこぼしを 2問以内に抑える

## レッスン負荷

| 曜日 | 本編 | optional_extra |
|---|---|---|
| 月・水・木・土・日（通常日） | 20問目安 | 0〜5問 |
| 火・金（通塾日） | 10問目安 | 0〜3問 |

## 難易度配分

- 通常日: d2:2 / d3:8 / d4:8 / d5:2 を下限目安
- 通塾日: d2:1 / d3:3 / d4:5 / d5:1
- `weakness_profile.difficulty_policy` が明示されている場合だけ総数を変えずに上書き

## 日次ブロック仕様

- warmup（2〜4問）→ core（テスト範囲）→ weakness_spiral（既習弱点）→ exam_transfer（過去問同型 0〜2問）→ optional_extra

## 算数固定ルール

1. 計算・逆算の即答アトムを毎レッスン warmup に置く
2. d4 以上は two_tier で Step1（式・基準量・図）を先に問う
3. 図形問題は figure_svg 必須（validator R12）

## 国語固定ルール

1. 漢字は読み・書きを対で出題する
2. 心情・理由は evidence_first で根拠から問う
3. 語彙ブロックは `data/vocabulary/*.md` の「本採用」項目のみ

## Phase 1: テンプレート導入期（現在）

- 弱点検出 → 翌日レッスン反映のループを確立する
- source_policy_updated: 2026-07-01

## Phase 2: 夏休み

- 既習範囲のスパイラル比率を上げ、exam_transfer を毎レッスン1問入れる

## 週次レビュー

- 土曜の briefing で週間正答率・弱点スコアの推移を確認し、翌週の配分を調整する
