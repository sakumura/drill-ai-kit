---
name: generate-drill-lesson
description: 暗記特化ドリルの単一入口。弱点・テスト範囲・志望校アンカーに基づき、1日1科目の算数/国語レッスンを設計、執筆、4層ゲートで検証する。
allowed-tools: Bash, Read, Grep, Glob, Write, Edit
---

# Generate Drill Lesson

このアプリのレッスンは「暗記特化ドリル × 問い方 5 原則 × 志望校アンカー」で作る。思考型・記述型の訓練は塾（または家庭の主教材）に任せ、本アプリは志望校合格に必要な頻出値・判断規則・本文根拠選択を即答化する。過去の失敗、つまり d4-d5 を最終数値直接型 `single_tier` で量産した状態を最優先で再現禁止にする。

## 入口

`/generate-drill-lesson`

briefing Phase 4b から呼び出す。

## Step 1. 設定責任コントラクトを読む

必ず `reference/ownership-contract.md` を読み、重複ルールを作らない。

## Step 2. 必読データを読む

- `data/test_schedule.json`（次回テスト日程・範囲）
- `data/textbooks/curriculum/curriculum.json`（教材カリキュラム。単元・回・時期）
- `data/textbooks/curriculum/grade5-analysis.md`（学年ステージの構造分析）
- `data/textbooks/curriculum/grade5-training-plan.md`（長期計画・日次負荷の正本）
- `data/target-school/long-term-plan.md`（志望校ターゲット方針）
- `data/target-school/difficulty-anchor.md`（志望校アンカー難易度表）
- 次回テスト範囲の `analysis.md` / `training-plan.md`（存在する場合）
- 算数のとき: `data/target-school/math-analysis.md`（志望校算数過去問の同型問題プール＝exam_transfer ブロックの出題根拠）
- 国語のとき: `data/target-school/kokugo-analysis.md`（志望校と同帯校の国語アンカー。exam_transfer 国語ブロックの設問形式・出典テーマ・難易度の出題根拠。d 判定は同ファイル冒頭の国語 d 判定基準に従う）
- 算数のとき（任意規約）: 自分の教材から起こした `data/textbooks/<教材名>/算数/{回}回/計算/calc_list.md`（計算ドリルの式・答え・図形SVGの正本＝即答アトムの根拠。`data/textbooks/` 配下の実教材データは gitignore 管理のローカル資産。作り方は `SETUP.md` の教材ガイド参照）
- 国語のとき（任意規約）: 同様に起こした `data/textbooks/<教材名>/国語/{回}回/漢字/kanji_list.md`（漢字ブロックの出題語・読み・クロス出題メモの正本）
- `data/weakness_profile.json`
- `data/learning_signal_profile.json`
- `frontend/public/data/learning_profile.json`
- `data/test_difficulty_reference.md`
- `_shared/question-rules.md`
- `_shared/typical-errors.md`
- `_shared/unlearned-units-guard.md`

欠落があれば生成を止め、briefing の staleness check に戻す。

正本の役割:

- `grade5-training-plan.md`: 日次負荷、フェーズ、KPI、週次レビュー、科目別固定ルールの実行正本。
- `grade5-analysis.md`: 学年ステージの構造分析、横断ボトルネック、テスト別意味づけの正本。
- `data/target-school/long-term-plan.md`: 志望校の入試形式・合格者平均・得点ロードマップの根拠資料。
- `ownership-contract.md`: ブロック別レッスンサイズと必達難易度ミックスの所有ファイル。重複ルールを作らない。

## Step 3. レッスンサイズとブロック配分を確定

ブロック別サイズは `reference/ownership-contract.md` の正本に従う。30問固定に戻さない。

- 通常日: 本編20問目安 + 任意追加0〜5問
- 登塾日（`grade5-training-plan.md` で定義した曜日）: 本編10問目安 + 任意追加0〜3問
- block_type: `warmup` / `core` / `weakness_spiral` / `exam_transfer` / `confidence_recovery` / `optional_extra`

### maintenance 枠（維持リハーサル）

克服済みパターン（weakness score が降格済み・critical 解除済み）は、7日→14日→30日の間隔で `optional_extra` ブロックに1〜2問だけ混ぜる。これは本編負荷ではなく忘却防止の維持リハーサルとして扱い、本編の弱点集中枠を圧迫しない。

- 出題正本は自分の教材リスト（calc_list.md 等）。範囲外・未確認の値を補完しない。
- 状態管理は `data/maintenance_ledger.json`。各 entry は `pattern_id`, `demoted_date`, `stage`（7/14/30）, `last_served`, `next_due` を持つ。
- レッスン生成時は `next_due <= lesson date` の entry から最大2問を選び、`optional_extra` に入れる。served 後は `last_served` を当日、`stage` を 7→14→30（30は維持）、`next_due` を次 stage 分だけ進めて更新する。
- 初期 ledger は空配列相当から始め、実データ投入は briefing の weakness 降格確認時に行う。

`weakness_profile.difficulty_policy` が明示されている場合だけ、総数を変えずに配分を上書きする。

## Step 4. 科目別に構成表を書く

`weakness_profile.json` の score は優先順位、`learning_signal_profile.json` / `learning_profile.json` の
`learning_signal` と `recommended_intervention` は出題形式の決定に使う。score 上位を機械的に同型反復で詰め込まない。
`signal_confidence < 0.4` は注意情報として扱い、テスト範囲・evidence_tier・既存設計ルールを強く上書きしない。

### 出題ソース方針

- 主ソースは自分の教材（`data/textbooks/` に置いた分析・リストファイル）と志望校過去問分析（`data/target-school/`）。
- 生成本文は教材に寄せるが、長い本文・解説・設問文の丸写しは禁止する。構造、数値レンジ、図の意味、問う操作を保ち、アプリ用に書き換える。
- 教材リストが無い単元は新規作成する。**個人ブログ・まとめサイト等、第三者が作成した教育コンテンツを無断で WebFetch して出題内容に転用しない**（著作権・利用規約上のリスク。教材の一次ソースは自分の塾教材か、権利者の許諾を得た情報に限定する）。

介入タイプの接続ルール:

- `concept_gap` / `concept_contrast`: 見分け問題・概念対比を先に置く。
- `procedure_gap` / `process_scaffold`: 式・図・基準量・途中手順穴埋めを先に問う。
- `reading_load` / `short_reading_evidence`: 短文化し、根拠行選択・本文照合を先に問う。
- `careless_or_tap_noise` / `slow_confirm`: 難度を上げず、確認習慣と選択肢の読み直しを問う。
- `fatigue_throwaway` / `rest_or_short_block`: 同型反復で追い込まず、短いブロックまたは任意追加に逃がす。
- `question_quality_bug` / `fix_question`: 当該問題は出題禁止。修正キューへ回し、弱点補強の根拠にしない。

算数の即答アトム（暗記すべき具体値）は、Step 2 で読んだ `calc_list.md` の式・答えを正本に作る（範囲外の数値を混ぜない）。図形問題は `calc_list.md` の SVG を figure に転記する（幾何問題は figure 必須＝validator R12）。リストの `status` が未確認の回・問は、そのまま量産せず生成前に保護者へ確認を促す。

国語は本文照合・間接表現・隣行 distractor を主軸にする。

国語の漢字ブロックは `kanji_list.md` の出題語のみから作る（範囲外の漢字を混ぜない）。読み・書きは同一語を両モードで出題する対構造なので、両モードを対で出す。各語の「メモ」にあるクロス出題・同音異義・読み分けを distractor 設計の根拠に使う。`status` が未確認の回はそのまま量産せず、生成前に保護者へ確認を促す。

構成表には全問について以下を先に書く。

- block_id
- block_type
- block_position
- block 内 question position
- position
- subject
- difficulty
- unit_id / pattern_id
- question_type
- tier1_purpose
- 使用テーブルまたは本文根拠
- distractor 出典
- target_anchor
- source_material_kind: `textbook` / `calc_list` / `bank` / `stock` / `external`
- source_section: 例 `演習` / `読解概念` / `漢字`
- source_page_or_image: 例 `curriculum math p.180-191`
- source: `bank:<bank_id>` / `repair:<bank_id>` / `new` / `stock:<topic>#<pos>`

## Step 4.5. problem bank selection

構成表を書いたら、先に problem bank の dry run を実行する。

```bash
python3 scripts/select_lesson_from_bank.py \
  --date <YYYY-MM-DD> \
  --subject <math|japanese> \
  --training-plan <次回テスト範囲/training-plan.md> \
  --analysis <次回テスト範囲/analysis.md> \
  --grade5-training-plan data/textbooks/curriculum/grade5-training-plan.md \
  --grade5-analysis data/textbooks/curriculum/grade5-analysis.md \
  --output /tmp/_bank_selection_<date>_<subject>.json
```

dry run report の `plan_context.sources` と各 blueprint slot の
`plan_source_kind` / `plan_source_path` / `plan_theme` を確認し、
training-plan / analysis / 全体計画から unit/theme が抽出されていない場合は
bank 採用へ進まず Step 4 に戻って構成表を修正する。

採用可能な bank 問題は以下をすべて満たすものだけ。

- `validation_status == "pass"`
- `quality.review_status == "semantic_pass"` または `"reviewed_pass"`
- `quality.reuse_grade >= 4`
- bank entry の `difficulty` が blueprint slot の `difficulty` と完全一致
- 図形問題は `svg_status == "visual_pass"`
- cooldown 違反なし
- 同一 lesson 内で同じ `content_hash` を再利用しない

採用禁止:

- `reuse_grade == null`
- `quality.review_status == "unreviewed"`
- `quality.review_status == "auto_rejected"`
- `validation_status != "pass"`
- `difficulty` 不一致（採用するなら `repair:<bank_id>` 扱いで再レビュー）
- 図形問題で `svg_status != "visual_pass"`
- `svg_status == "svg_present_unreviewed"`（SVG文字列があるだけで視覚確認済みではない）

dry run report の `selected` は構成表の source を `bank:<bank_id>` にする。
`missing_slots` は `new` または `repair:<bank_id>` として Step 5 で新規執筆・修理する。
`stock:<topic>#<pos>` は互換用として残してよいが、最終的には problem bank に取り込む。

selection report を lesson draft に流し込む場合は以下を使う。これは最終 lesson ではなく、
bank 採用問題と不足 placeholder を並べた composition draft である。

```bash
python3 scripts/apply_bank_selection_to_lesson.py \
  --selection-report /tmp/_bank_selection_<date>_<subject>.json \
  --lesson-id <lesson-id> \
  --output /tmp/_bank_lesson_draft_<date>_<subject>.json
```

draft の `source: bank:<bank_id>` はそのまま採用候補、`requires_generation: true`
は Step 5 の新規執筆・修理対象として扱う。

bank 採用問題も最終 lesson の `validate_lesson_format.py` は必ず通す。
新規生成分・修理分だけ、従来通り自己解答と semantic review を重点実施する。

最終 lesson に採用した bank 問題は、lesson JSON の各 question `meta` に
`bank_id` / `content_hash` / `source: "bank:<bank_id>"` を残し、配信前に usage を記録する。

```bash
python3 scripts/record_problem_bank_usage.py --kind lesson --input <lesson-json>
```

## Step 5. 不足分だけ問題本文を執筆・修理

詳細は `reference/lesson-design-rules.md` に従う。単元別の王道問い方は `reference/question-style-canon.md`（単元別カタログ）を必ず参照し、収録単元はそのテンプレを優先採用、未収録単元は**先にカタログへ追記してから**本文を書く（`docs/ARCHITECTURE.md` 出し惜しみ禁止の鉄則）。

- `bank:<bank_id>`: 本文を作り直さず、構成表上の位置に配置する。必要なメタデータのみ補う。
- `repair:<bank_id>`: 教育意図は活かすが、SVG・選択肢・表記・難度などを修理する。修理後は hash が変わるため再レビュー対象。
- `new`: bank で埋まらない pattern / difficulty / SVG 図形だけ新規作成する。
- d2-d3: `single_tier`。自然文 + 穴埋め。算数の選択肢は暗記テーブル値。
- calc_list 由来の即答アトムには `meta.calc_ref = {"kai": <回>, "day": <日目>, "q": <問番号>}` を必ず付ける。validator R24 が calc_list.md の正本と answer を機械照合する（付け忘れると照合がすり抜けるので、calc_list の式・答えを使った問題には例外なく付与）。
- d4-d5 算数: `two_tier` / `slot_two_tier` 優先。`two_tier` は Step1=プロセス、Step2=最終答え。`tier1_purpose` は `strategy`, `diagram`, `basis`, `formula`, `error_diagnosis` のいずれか、`tier2_purpose` は `answer`。

### 多段計算の「中ボス / ラスボス」語彙系

多段計算（消去算 `shoukyozan`・差集め算 `sashuume` など、中間値→最終解の構造を持つ算数問題全般）では、解説文で中間値を「中ボス」、最終解を「ラスボス」と呼ぶ。最終工程まで進ませるための語彙として使い、問い方品質5原則と既存 validation ルールは変更しない。

- 中間値をそのまま正解に見せる distractor は「中ボスの変装」と扱う。該当 distractor を選んだ際の解説は必ず「それは中ボス！ラスボスは〜」の形で、最後に必要な工程を指す。
- d4-d5 の `error_diagnosis` tier には「中間値で止まった架空の答案を見せて、どこで止まっているかを問う」型を追加してよい。例: 「ある子の答案: 850−520=330 → 答え330円。この答案はどこの中ボスで止まってる？」
- 解説では「差額を出しただけ」「1あたりの差を出しただけ」「余りを出しただけ」などを中ボスとして明示し、ラスボス（何人分・何個分・最終金額など）へ進ませる。
- d4-d5 国語: `evidence_first` / `two_tier` 優先。Step1 は根拠・消去理由・表現効果、Step2 は最終答え。`tier1_purpose` は `evidence`, `elimination_reason`, `expression_effect` のいずれか、`tier2_purpose` は `answer`。
- d4-d5 の最終数値直接型 `single_tier` は生成段階で破棄する。
- スケッチゲート: 作図が解法の核になる図形問題（figure_svg あり、線分図・面積図など）には `"sketch_gate": true` と `"sketch_kind": "figure"` と `"sketch_hint": "<図形種の短い説明>"` を付与できる。選択肢表示前に指描き作図ステップが入る（採点には影響しない advisory）。1レッスン1〜2問まで。
- 国語の漢字書き取り問題には最大3問/レッスンまで `"sketch_gate": true` + `"sketch_kind": "kanji"` を付与できる。`sketch_hint` は画面表示されるため、正解漢字を書いてはならない。読みのみ定型「『（よみ）』を漢字（と送りがな）で指書きしてから、答えを選ぼう」を使う。AI 判定用の正解漢字はフロントが `answer` を Worker へ送るため、hint に正解を漏洩させない。
- 国語の語彙ブロックは `goi-kanyouku` / `goi-kotowaza` / `goi-bunpou` / 既存 `keigo` をローテーションする。正本は `data/vocabulary/*.md`、status「本採用」のみ出題可（「候補」は禁止）。d2-d3 `single_tier`、意味→語の順方向、正解肢20字未満、同一ユニット最大3連続まで。
- 二要素記述は `unit_id: "niyouso-kijutsu"`、`question_type: "evidence_first"` を流用する。`tier1_purpose="evidence"`、tier1 は必要2要素の組み合わせ選択、tier2 は連結記述文選択。`hints` は6個、`answer == hints[3]` を厳密一致させ、記述肢は21-59字に収める（`long_answer_allowed_units` 登録済み）。

## Step 6. JSON 化

既存呼び出し方を維持する。

```bash
python3 scripts/build_handwritten_to_json.py
```

**build whitelist の罠（必読）**: `build_handwritten_to_json.py` は question のフィールドを明示コピーする実装のため、lesson JSON に**新フィールドを追加するときは同スクリプトへのコピー処理追加とセット**で行う。追加漏れは validator を素通りして本番配信 JSON からフィールドが欠落する（前科: `sketch_kind`）。デプロイ後は本番 `lessons.json` に新フィールドが実際に含まれるかを確認する（deploy skill Step 6）。

## Step 7. 4層ゲート

`reference/gates.md` に従う。

1. 機械検証: `python3 scripts/validate_lesson_format.py --json <file>`
2. 視覚検証: 図形問題のみ Playwright MCP で SVG を確認
3. エージェント自己解答: distractor を隠して全問解く。`single_tier` は `hints[0]`、`two_tier` / `evidence_first` は `hints[0]`=Step1正解・`hints[3]`=Step2最終答え、slot は `correct_value` と一致確認
4. レビューシート作成: `python3 scripts/prepare_semantic_review.py prepare --lesson-id <lesson-id>` で全問レビューシートを作る
5. 外部LLM拒否ゲート: `python3 scripts/run_semantic_reviewers.py --review /tmp/_semantic_review_<lesson-id>.json` で複数の外部LLM（手元で使えるCLIエージェント2〜3種）に「意味不明なら回答拒否=NG」判定をさせる。判定は **2/3 ルール**: 3モデル中2モデル以上OKで合格。NGが2モデル以上（2/3・3/3 NG）は実際の設計欠陥が多く必ず修正。1モデルのみNGは指摘内容をエージェントが確認し、実欠陥なら修正・誤検知なら合格として記録する。レビュー自体の省略は不可
6. 保護者目視: 外部レビュー結果と10項目チェックリストを埋めて `python3 scripts/prepare_semantic_review.py verify --lesson-id <lesson-id>` を通す

fail は該当問題だけ再生成。最大3回。4回目は手動介入要請。

## Step 8. 完了報告

- 生成した lesson path
- 難易度配分
- d4-d5 tier 系数
- R22 reject が 0 件であること
- 図形視覚確認対象と結果
- 自己解答ゲート結果
- 目視ゲート結果
- bank 採用数 / 新規生成数 / SVG新規必要数
- problem bank usage 記録結果
- `python3 scripts/problem_bank_metrics.py --selection-report <dry-run-report>` の要約

完了報告には、PR を作らない直接コミット・直接デプロイ運用でも必ず次のブロックを含める。

```md
## Semantic Review Result

- Math reviewed questions: 22/22 or N/A
- Japanese reviewed questions: 22/22 or N/A
- Self-solved all questions: yes/no
- Figure consistency checked: yes/no/N/A
- Step1/Step2 semantic separation checked: yes/no/N/A
- Semantic review file: /tmp/_semantic_review_<lesson-id>.json or path
- External semantic reviewers: 2/3以上OK（NGがあれば position と対応〔修正済み/誤検知判定〕を列挙）
- Known unchecked items: none / list
```

`no` または `unchecked` が 1 つでも残る場合は「完了」と言ってはいけない。
その場合は残件を明示し、対象問題を修正して Step 7 を再実行する。
