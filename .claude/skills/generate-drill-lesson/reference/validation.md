# 自動検証（機械チェック）— validate_lesson_format.py の仕様書

> Current validation spec: `generate-drill-lesson` の機械検証仕様。運用フローの正本は `generate-drill-lesson/SKILL.md` と `reference/gates.md`。

**このファイルの責務**: `scripts/validate_lesson_format.py` が実装する機械的な NG パターン検出（R0-R24）の仕様を定義する。機械チェックは配信不能・採点不能・構造破損を止めるためのゲートであり、教育品質の最終判断は `validation-meta.md`（§9 保護者目視レビュー）と `meta_review_gate.py verify --strict-process-gate` に寄せる。

## 検証7項目（Step 8・スキップ禁止）

レッスン生成後、`data/lessons-handwritten/{YYYY-MM-DD}-{subject}.json` と `frontend/public/data/lessons.json` / `frontend/public/data/schedule.json` を対象に**必ず**配分を検証する。D1 は廃止済みなので SQL 検証を一次手段にしない。

必須入力:
- 手書き JSON: `data/lessons-handwritten/{YYYY-MM-DD}-{subject}.json`
- 配信用 JSON: `frontend/public/data/lessons.json`
- スケジュール JSON: `frontend/public/data/schedule.json`
- 弱点: `data/weakness_profile.json`

### 検証基準

1. **弱点スコア上位3パターンが問題数上位3に入っているか** — 入っていなければ即再生成
2. **克服済み（スコア40以下）パターンが最多になっていないか** — なっていれば即再生成
3. **スコア60以上のパターンに0問がないか** — あれば即追加（⚠️致命的）
4. **国語の漢字比率が25%以上か** — 下回っていれば漢字を追加
5. **難易度分布検証** — 下記参照

### 5. 難易度分布検証の詳細

- 各テーマについて `evidence_tier.required_mastery_tier` 以上の問題が**最低1問**含まれているか（§4d: tier は 3-5 で記録、旧 1-4 から +2 シフト済み）
- 定例テスト範囲については `training-plan.md` の「必達難易度ミックス」を満たすか（§4d: `d1-2:X / d3:Y / d4:Z / d5:W` の各目標値を下回らない）
- **d5 が最低3問含まれているか**（§4d 鉄則、前日WUのみ2問可）
- 満たさない場合は即再生成

検証時は各 question の `unit_id` / `pattern_id` / `difficulty` / `position` / `question_text` を JSON から直接読む。配信用 JSON で欠落している場合は、手書き JSON 側と突合して欠落原因を特定し、build をやり直す。

### unit_id チェックの限界（必読）

**過去の失敗 (4/7):** unit_id チェックでは `bunsu-tashizan-hikizan=40問` と表示されて問題なしに見えたが、`kakudo(85)` が0問、`baisuu-gcd-lcm(75)` が0問という致命的な漏れがあった。unit_id が粗すぎて検出できなかった。

このため**スコア60以上の全パターンについて、`question_text` にパターン関連キーワードが含まれるか個別検証**する。

パターン→キーワードマップ:

```
kakudo → 角, 度, 三角形, 四角形, 内角, 外角, 平行
jouhou-seiri → 1Lで, 1mで, 1時間, 1あたり, ぬれ, 歩, 走, 個あたり, 分あたり
baisuu-gcd-lcm → 最大公約数, 最小公倍数, GCD, LCM, 約数, 倍数, すだれ
baibun-ouyou → 倍分, 差が, 和が, 倍率
bunbo-kasan → 通分, 分母, +, 足し算 (分数加減の問題)
gyakuzan → □, あてはまる, 逆算
syousuu-warisan → ÷, 小数, わり算, あまり
yakubun → 約分, GCD
bunsuu-syousuu → 小数にすると, 分数にすると
keigo → 敬語, 尊敬語, 謙譲語, 丁寧語, おっしゃ, 召し上が, いらっしゃ, まいる, 申す, いただく
naiyou-gacchi → 読み取れる, 合っている, 書いていない, 明示
inga-kankei → 原因, 結果, ので, から, ため
hitei-sentaku → 正しくない, 合っていない
```

### 6. 科目別単独責任 JSON のソース検証

科目別単独 LLM が執筆した手書き JSON が存在し、30問が揃っているかを確認する:

**検証対象ファイル**:
- `data/lessons-handwritten/{YYYY-MM-DD}-{subject}.json` が存在すること

**確認内容**:
- `questions` 配列に 30 問が含まれていること（30問未満は NG）
- 各問題の `position` が 1-30 で連番になっていること
- 国語の場合: Codex CLI の出力が JSON parse 済みで格納されていること

**この検証が NG の場合**: `generate-drill-lesson` の Step 5 に戻り、当該科目の不足・NG 問題を再執筆・修理する（旧 write-handwritten-lesson は廃止済み）

### 8. 拡張機械チェック（R10-R16）

これらのルールは、単一問題ごとの自動検証だけでは検出できない、**レッスン全体を通して見て初めてわかる構造的な欠陥**を機械的に検出するために設けている:

- distractor が `[正解, 正解÷2, 正解×2]` のような機械テンプレになっている → 推測で当てられる
- pool間で同一問題が重複している
- `is_figure=true` だが `figure_svg=null` の問題で「図のように」「□cm」と書かれている
- 同一 `pattern_id` が連続しすぎている
- 問題文が崩壊している（テンプレ未展開の残骸、意味不明な文など）
- ダミー選択肢（「△場合による」等）が混入している

**実装ファイル:** `scripts/validate_lesson_format.py`（既存に追加）

#### NG パターン検出ルール（R10-R16）

**R10: distractor 機械テンプレ禁止（算数のみ）**

`hints[1]` または `hints[2]` を float 化し、`answer` の float 値と以下の比率で一致したら NG:
- `÷2` 系: `hint == answer * 0.5` （許容誤差 0.001）
- `×2` 系: `hint == answer * 2.0`
- `÷10` 系: `hint == answer * 0.1`
- `×10` 系: `hint == answer * 10.0`
- 符号反転: `hint == -answer`

該当判定: 2要素のうち1つでもマッチ → 警告（warn）、2つともマッチ → reject。
algorithm: 同レッスン内で R10 警告が **8問以上**発生したら reject に格上げ（=「÷2/×2が大半を占めるテンプレ多用」を検出）。8問未満の単独 warn は reject にしない。教育的に意味のある「÷2忘れ」「×2しすぎ」誤答が一定数含まれることは正常。

**R11: pool間重複禁止**

同一 `lesson_id` 内で以下の重複があれば reject:
- 同一 `reference_problem_id`（NULL は除外）
- 正規化済み `question_text` の完全一致（正規化: 句読点・全角/半角空白・括弧・絵文字を除去後の lowercase 比較）

**R12: figure_svg 必須**

「文章だけでは解けない問題」を機械的に検出して reject する。`figure_svg is null` または `len(figure_svg) < 10` のとき、以下のいずれかを満たす場合 reject:

1. `is_figure=true` フラグ
2. `question_text` に以下の **「図前提語」** のいずれかを含む:
   - 補助線, 対角線, 等積変形
   - 図のように, 次の図, 上の図, 下の図, 以下の図, 図1, 図2
   - 内部に, 内側に, 外側に
   - 影の部分, 影の三角形, 斜線部分, 斜線の部分, 色のついた部分, 色をつけた部分
   - 切り抜く, 切り抜いた, 切り取った, 切りとった
   - 重ねた, 重なった, 重なり, 重ねると
   - 点P, 点Q, 点M, 点N, 角ア, 角イ, 角ウ, 角エ, 角オ
   - 「△ABC」「△ABCD」など3文字以上の連続英大文字（頂点ラベル指定問題）

#### R12 例外（数値完結型として許容）

以下の **「寸法明示語」** を**いずれか含み**、かつ図前提語のうち「ABCD型頂点ラベル」のみが該当している場合、**警告のみで reject にしない**（例: 「四角形ABCDで角A=85°…」のような寸法完結問題）:

- 「縦」「横」「1辺」「底辺」「高さ」「上底」「下底」「半径」「直径」「対角線の長さ」 + 数値
- 「角A=NN°」「角B=NN°」「角C=NN°」「角D=NN°」など **角名+数値+°が2つ以上** ある場合（多角形の角度数値完結問題）

それ以外の図前提語は数値が明示されていても **常に reject**（補助線・等積変形・影の部分などは数値だけでは図の関係が分からない）。

#### 適用範囲

reference_problems / lessons-handwritten / 配信用 lessons.json すべてに適用。**配信前に必ずこの R12 を pass すること。**

**R13: 連続同型禁止**

同一 `unit_id` が4問以上連続（position 連番）して並ぶ場合 reject。
ただし漢字パターン (`sk-kanji`) と通分・分母・bunbo-kasan 系の基礎ウォームアップは「冒頭5問まで連続OK」の例外を許可。

**R14: 問題文崩壊検出**

`question_text` に以下のいずれかが含まれていたら reject:
- `代表例の答え`、`代表例。`
- `（そのまま.*か？）`（正規表現）
- `。。`（連続句点）
- `□cm`、`□度`、`□人`、`□個`、`□枚`（位置不明判定）
- `与えられている`、`省略`、`〜略〜`
- `{{`, `}}`, `___`（テンプレ未展開残骸）
- 「または」「あるいは」が問題文の本筋に含まれる（条件分岐の問題崩壊）

**R15: ダミー選択肢禁止**

`hints` 配列のいずれかに以下が含まれていたら reject:
- `△場合による`、`△`、`△不明`
- `わからない`、`分からない`
- `その他`、`特になし`、`なし`
- `〜の場合`、`場合により異なる`

**R16: 30問全パターン分布**

同一 `unit_id` の問題数が全体の **60% を超える**場合 reject。
ただし「前日WUレッスン」（lesson title または daily_schedule note に `WU` `前日` を含む）は warn のみで reject しない。

**R17: 志望校同型 meta consistency**

`meta.target_anchor` を持つ問題は以下をすべて満たさないと reject:

- `target_anchor` は string
- `meta.match_type` は `exact` / `adjacent` / `none` のいずれか
- `meta.difficulty_from_anchor` は `d2`〜`d5` のいずれか
- `match_type == "none"` のとき `target_anchor` は文字列 `"none"`（anchor 無しを明示）
- `difficulty_from_anchor` と問題本体の `difficulty` が一致

**R19: slot_config 入力可能性**

`slot_*` 問題で、実際の `SlotPicker` から正解値を作れない設定を reject する。

- `slot_number`: `slot_config.type=number` かつ `answer` は整数文字列のみ。小数は `slot_decimal` を使う
- `slot_decimal`: `digit_string` と `valid_positions` から `answer` を作れること
- `slot_kanji`: `left_options × right_options` の連結で `answer` を作れること
- `slot_okurigana`: `kanji + option` で `answer` を作れること
- `slot_two_tier`: `slot_config.type=two_tier_slot`、`tier1/tier2` に `correct_value` があり、それぞれ入力可能であること

**R22: process_understanding は reject**

d4-d5 で、解説は複数手順なのに出題本体が最終答え選択に寄っている場合、`validate_lesson_format.py` は **R22 reject** を出す（d4-d5 でプロセス目的必須というルール自体は `docs/ARCHITECTURE.md` の教育設計コンセプトを参照）。`--strict-process-gate` は互換オプションで、指定の有無に関わらず常に reject する。

静的検出で判定できない意味的なプロセス分離（Step1 が本当にプロセスを問うているか）は、従来どおりエージェント自己解答ゲートと `meta_review_gate.py verify --strict-process-gate` で確定する。

**R24: calc_list 正本との answer 機械照合**

`meta.calc_ref = {"kai": <回>, "day": <日目>, "q": <問番号>}` を持つ問題は、
`data/textbooks/curriculum/算数/{回}回/計算/calc_list.md` の該当ドリル行と `answer` を機械照合する（NFKC 正規化・空白圧縮後の完全一致）。

- answer 不一致 → **reject**（正本との乖離は転記ミスか計算ミス）
- 対応行なし → **reject**（calc_ref の参照ミス）
- calc_list.md が無い環境 → warn のみ（教材は gitignore 管理のローカル資産のため、CI 等では照合スキップ）
- 7日目（応用・図形、テーブル形式でない）→ warn スキップ

calc_list 由来の即答アトム（算数 d2-d3）には `meta.calc_ref` を必ず付ける（付与ルールは SKILL.md Step 5）。calc_ref が無い問題は照合対象外なので、付け忘れは R24 をすり抜ける点に注意。

#### YAML 補助設定

```yaml
# validate_lesson_format.py はこの YAML ブロックをパースして参照する
long_answer_allowed_units:
  - kokoro-kansetsu
  - dokkai-setsumeibun
  - dokkai-shoujiki
  - sk-gacchi
  - sk-hitei
  - sk-inga
  - naiyou-gacchi
  - hitei-sentaku
  - inga-kankei
  - hyougen-koukou
  # 正解肢フォーマット検証は answer/hints[0] の混入検出が目的。
  # 算数プロセス説明や可能・自発・受身の概念説明は正解肢ではなく
  # solution_steps / tier1 / slot_config へ置くため、長文許容に入れない。
  - seikaku-kijutsu
  - hyougen-gihou-meishou
  - hyougen-gihou-yakuwari
  - sinergi-kijutsu
  - shijigo
  - fukujoshi-bakari
  - bunmatu-*       # 文末分類 (katako/teinei/kibou/ishi/gimon/hango/hango-denbun)
  - niyouso-kijutsu
idiom_vocabulary_units:
  - sk-kanji
  - vocabulary
  - kanyouku
  - kotowaza
  - yojijukugo
  - goi-*
```

```yaml
# validate_lesson_format.py が R13 の例外単元を判定するために使う
r13_warmup_exception_units:
  - sk-kanji
  - bunbo-kasan
  - bunsuu-kasan
r16_wu_lesson_title_keywords:
  - WU
  - 前日
  - 軽復習
```

#### 判定ルール

- **R10-R19 / R22 / R24 のいずれかが reject 判定を出したら、そのレッスン全体を不合格とし `data/generation-failures/YYYYMMDD.json` に追記**
- **R22 は reject**。意味的なプロセス分離の最終確定はエージェント自己解答ゲート
- R10 の警告（warn 単独）は reject にしないが、同一 lesson 内 **8問以上**で reject に格上げ
- Exit Code: OK=0 / NG=1（既存と統合）

#### TDD 方針

`tests/validate_lesson_format_test.py` に R10-R16 各ルールの「OK ケース」「NG ケース」を最低2件ずつ追加し、R10/R11/R13/R14/R15 が NG を返すことを reference テストとして固定する。

---

## §7: 正解肢フォーマット検証

**目的:** 正解肢 (`hints[0]` / `answer`) に解法ヒント文・公式文字列・解法概念が混入すると、学習者がそれを押しても正解扱いされてしまう。これを防ぐため、`_shared/question-rules.md §4-禁則` を一次ソースとして、ここで機械検出ルールと実装を定義する。

**実装ファイル:** `scripts/validate_lesson_format.py`（新規、JSON/D1 両対応）

**NG パターン検出ルール（Python 正規表現）:**

0. `hints[0]` と `answer` が**一致しない** → フロント採点バグ直結（最優先・1問でも不一致でレッスン全体NG）
   ただし算数の表示用単位サフィックス（例: `18.84 cm`, `42 cm²`, `90°`）だけは、`answer` が単位なし数値でも許容する。
   参照: question-rules.md §4「hints[0] と answer は一致」
   条件0 単独で即NG。他条件との合算なし。

1. `answer` フィールドに `→` `=` `∪` `∩` `√` のいずれかを含む → 式・公式の疑い
2. `answer` に `・` が **3回以上連続列挙パターン** で含まれる（算数の `2・3・5` のような列挙正答は許容、「A・B・C」のような3項列挙はNG判定対象外、ただし式記号としての `・` 使用はNG）
3. `answer` の文字数が **20字以上**。ただし「長文正答許容ユニット一覧」に含まれる `unit_id` は閾値を **60字** に緩和
4. `answer` に助詞（「は」「が」「を」「に」「で」「の」）が **3つ以上** 含まれ、かつ数値を1つも含まない → 解法文の疑い。慣用句/ことわざ/語彙系ユニット (`idiom_vocabulary_units`) と本文合致選択ユニット (`long_answer_allowed_units`) は閾値を **5** に引き上げ（本文合致選択の正答は本文からの抜粋で助詞が多数入るため）
5. `answer` が「〜する」「〜できる」「〜なる」「〜ない」で終わらず、かつ `options` の他の選択肢と比べて長さ比が **0.5 未満 or 2.0 超**（ラベル型/数値型の正解肢だけが極端に短い/長いのは想定されるので、この条件のみでは NG にしない。条件1-4 のどれかと合わさった場合にのみ最終 NG 判定）

**長文正答許容ユニット一覧（ホワイトリスト）:**

```yaml
# validate_lesson_format.py はこの YAML ブロックをパースして参照する
long_answer_allowed_units:
  - kokoro-kansetsu
  - dokkai-setsumeibun
  - dokkai-shoujiki
  - sk-gacchi
  - sk-hitei
  - sk-inga
  - naiyou-gacchi
  - hitei-sentaku
  - inga-kankei
  - hyougen-koukou
  # 正解肢フォーマット検証は answer/hints[0] の混入検出が目的。
  # 算数プロセス説明や可能・自発・受身の概念説明は正解肢ではなく
  # solution_steps / tier1 / slot_config へ置くため、長文許容に入れない。
  - seikaku-kijutsu
  - hyougen-gihou-meishou
  - hyougen-gihou-yakuwari
  - sinergi-kijutsu
  - shijigo
  - fukujoshi-bakari
  - bunmatu-*       # 文末分類 (katako/teinei/kibou/ishi/gimon/hango/hango-denbun)
  - niyouso-kijutsu
idiom_vocabulary_units:
  - sk-kanji
  - vocabulary
  - kanyouku
  - kotowaza
  - yojijukugo
  - goi-*
```

**判定ルール:**

- 条件 1-4 のいずれか1つでも NG → **そのレッスン全体を不合格（再生成）**
- 条件 5 単独は NG にしない（条件 1-4 と合わさった時のみ補助的に考慮）
- 不合格ログは `data/generation-failures/YYYYMMDD.json` に追記
- Exit Code: OK=0 / NG=1

**パイプライン統合:**

`generate-drill-lesson/SKILL.md` のゲートで自動リトライループを回す:

```
Step 8: 検証
  ├─ 既存検証（項目1-6）
  ├─ validate_lesson_format.py を実行（項目7）
  ├─ Exit Code 0 → build_handwritten_to_json.py 実行済みなら配信前目視へ
  └─ Exit Code 1 → Step 4（生成）に戻って NG 問題のみ再生成
       ├─ 3 回連続 NG → 保護者に報告して手動介入（無限ループ防止）
       └─ data/generation-failures/YYYYMMDD.json にログ追記
```

**TDD 方針:**

`scripts/validate_lesson_format.py` の実装・保守時は、テスト駆動で正規表現をチューニングする:

- NG サンプル: 解法ヒント文が正解肢に混入しているケース（例: 図形の解法説明文、文法概念の説明文）
- OK サンプル: 数値正答、漢字・合致選択の短答正答

---

## 関連ファイル

- `validation-meta.md` — §9 保護者目視レビュー（機械チェック後の人間判断）
- `overwrite-and-rules.md` — 鉄則 + 上書き再生成 + 問題設計ルール
- `scripts/validate_lesson_format.py` — 本ファイルの実装

### R18: sketch_kind と漢字 hint 漏洩ガード

- `sketch_kind` は省略可。指定する場合は `figure` または `kanji` のみ。`sketch_kind` を指定した問題は `sketch_gate: true` 必須。
- `sketch_kind: "kanji"` では、`answer` に含まれる CJK 統合漢字のうち、`question_text` に現れない漢字が `sketch_hint` に含まれていたら reject。`sketch_hint` は画面表示されるため、読みのみ hint は OK、正解漢字の漏洩は NG。
- 問題文にすでに出ている漢字が hint に再掲されるケースは漏洩扱いしない。

