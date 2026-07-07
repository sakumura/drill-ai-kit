# 学習信号プロファイル設計

Issue #31 Phase 2-3 では、`data/weakness_profile.json` を長期保存のスコア・根拠ストアとして維持し続ける。直近の解答ログの解釈は `data/learning_signal_profile.json` として生成し、正本の弱点ファイルを肥大化させずに介入モデルだけを変更できるようにする。

## フロー

1. `scripts/audit_learning_signals.py` が、初回不正解の試行を `learning_signal` のバケットに分類する。
2. `scripts/build_learning_signal_profile.py` が、それらの信号を `subject + pattern_id` 単位で集計する。
3. `scripts/build_learning_profile.py` が、弱点スコアの行と派生した信号プロファイルをマージし、`frontend/public/data/learning_profile.json` を書き出す。

## 派生フィールド

- `learning_signal`: そのパターンにおける直近の支配的な信号。
- `signal_confidence`: 最多信号の割合。直近の不正解試行が5件未満の場合は割り引かれる。
- `recommended_intervention`: 機械可読な介入ファミリー。
- `recent_valid_accuracy`: `fatigue_throwaway` と `question_quality_bug` の初回不正解グループを除外した後の最終正答率。
- `recent_fast_wrong_rate`: 3秒以内で不正解になった初回試行の割合（直近試行数に対する比率）。
- `recent_late_drop_rate`: 直近の遅い初回不正解グループの割合（遅いグループ全体に対する比率）。

`frontend/public/data/learning_profile.json` は低信頼の信号もデータとして保持するが、`next_question_type` は `signal_confidence >= 0.4` のときだけ `recommended_intervention` を使う。この閾値を下回る場合は、従来の弱点スコア/evidence-tierルールが表示・生成のヒントとして残る。

## 介入マッピング

| learning_signal | recommended_intervention | レッスン生成への含意 |
|---|---|---|
| `concept_gap` | `concept_contrast` | 転移の前に短い対比問題や分類問題を使う。 |
| `procedure_gap` | `process_scaffold` | 公式・図・根拠・手順穴埋めの問題を使う。 |
| `reading_load` | `short_reading_evidence` | 本文の分量を減らし、まず根拠1箇所の選択を問う。 |
| `careless_or_tap_noise` | `slow_confirm` | 難易度は据え置き、確認をゆっくり行う習慣を要求する。 |
| `fatigue_throwaway` | `rest_or_short_block` | その場での再挑戦はさせず、短いブロックまたは任意追加へ移す。 |
| `question_quality_bug` | `fix_question` | 採点に使う前に、当該問題を修正または除外する。 |
