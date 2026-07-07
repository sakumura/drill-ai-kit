# レッスン設計ルール

## 算数

d2-d3 は自然文 + 穴埋めの `single_tier`。選択肢は暗記テーブル値から取る。

d4-d5 はプロセスを問う tier 系にする。最終数値だけを選ばせる `single_tier` は禁止。

許可する `tier1_purpose`:

- `strategy`
- `diagram`
- `basis`
- `formula`
- `error_diagnosis`

暗記テーブル方式は算数 d3-d5 のみで使う。ただし d4-d5 では、tier1 で方針・基準量・式・図・誤答理由を問い、tier2 で最終答えを問う。`two_tier` の `hints` は `[tier1選択肢3個, tier2最終答え選択肢3個]` とし、`answer` は `hints[3]` と一致させる。

## 国語

暗記テーブル方式は使わない。本文照合を必須にする。

必須:

- 本文中に根拠行を置く
- 心情は直接語ではなく行動・情景・間接表現で示す
- distractor は本文に存在するが問いに答えない隣行情報を含める
- d4-d5 は `evidence_first` / `two_tier` で、根拠・消去理由・表現効果を先に問い、tier2 で最終答えを問う

許可する `tier1_purpose`:

- `evidence`
- `elimination_reason`
- `expression_effect`

## 問い方 5 原則

総論は `_shared/question-rules.md §4f 問い方品質 5 原則` を正本とする。

- 順方向優先
- 生活実感アンカー必須
- 即答性 15-60 秒
- 典型誤答の質
- 定型表現連結

## learning_signal 別の出題形式

`data/learning_signal_profile.json` と `frontend/public/data/learning_profile.json` を読み、
弱点 score だけでなく `learning_signal` / `recommended_intervention` で問い方を変える。
`signal_confidence < 0.4` は低信頼として、形式変更の決定打にしない。

| learning_signal | recommended_intervention | 出題形式 |
|---|---|---|
| `concept_gap` | `concept_contrast` | 見分け問題、概念対比、分類 |
| `procedure_gap` | `process_scaffold` | 式、図、基準量、途中手順穴埋め |
| `reading_load` | `short_reading_evidence` | 短文、根拠行選択、本文照合 |
| `careless_or_tap_noise` | `slow_confirm` | 難度据え置き、確認習慣、読み直し |
| `fatigue_throwaway` | `rest_or_short_block` | 同型反復禁止、短いブロック、任意追加 |
| `question_quality_bug` | `fix_question` | 当該問題を出題禁止、修正キューへ |

## 禁止パターン

以下は即 reject:

- d4-d5 で `question_type=single_tier`
- d4-d5 で `tier1_purpose=null`
- d4-d5 で `solution_steps` が複数なのに最終数値だけを問う
- distractor がランダム値、桁違い値、文量だけで正解が見える値

### 国語 Phase 2: 漢字 sketch gate・語彙・二要素記述

- 漢字書き取りの sketch gate は、画面表示される `sketch_hint` に正解漢字を書かない。読みのみ定型「『（よみ）』を漢字（と送りがな）で指書きしてから、答えを選ぼう」を使い、正解漢字はフロントから Worker へ `answer` として渡す。これは R18 漏洩防止のため。
- 語彙ブロックは `goi-kanyouku` / `goi-kotowaza` / `goi-bunpou` / `keigo` をローテーションする。正本は `data/vocabulary/*.md` で、status「本採用」のみ出題可。「候補」は出題しない。d2-d3 `single_tier`、意味→語の順方向、正解肢20字未満、同一ユニット最大3連続まで。
- 二要素記述（`niyouso-kijutsu`）は `evidence_first` を流用する。Step1 で必要2要素の組み合わせを根拠として選ばせ、Step2 で連結記述文を選ばせる。hints は6個、`answer == hints[3]`、記述肢は21-59字。素材・根拠は本文内の2ソースに分け、片要素だけで正解できないようにする。

