# juken-ai-kit アーキテクチャ

## 正本

環境構成の正は `docs/ops/environments.md`。本書は実装構造の概要を示す補助資料であり、環境 URL、デプロイ手順、D1 廃止後の運用ルールは `docs/ops/environments.md` を優先する。

## 教育設計コンセプト

このアプリ（表示名・キャラクター名は自由に変更してよい。既定は「AI家庭教師」）は、受験・資格試験などで頻出する知識、典型判断、分類ラベル、解法パターンを定着させる **「暗記特化ドリル × プロセスStep1」** の学習アプリとして運用する。現行の同梱サンプルは、志望校の国算2科合格を最上位目標にした中学受験向け構成である。長期計画の正本は `data/textbooks/curriculum/grade5-training-plan.md`、構造分析は `data/textbooks/curriculum/grade5-analysis.md`、志望校ターゲット校方針は `data/target-school/long-term-plan.md`。レッスン生成入口は `.claude/skills/generate-drill-lesson/SKILL.md` に一本化する。

| 領域 | 担当 |
|---|---|
| 基本計算力・基本国語力 | 既に体得済み（前提）。取りこぼし検出時だけ `warmup` で補強 |
| 記述・思考型問題 | 主に塾で扱う。本アプリでは短記述の型と根拠選択まで扱う |
| パターン暗記・即答化 | 本アプリで集中ドリル |
| 志望校型転移 | d4-d5 のStep1で図・基準量・根拠・消去理由を確認してから最終解答へ進む |

実装上の要点:
- d2-d3 は自然文穴埋めの `single_tier` を中心にする。
- d4-d5 算数は、最終数値だけを直接選ばせる `single_tier` を生成段階で破棄する。`two_tier` / `slot_two_tier` で、Step1に図・基準量・最初の式・方針・誤答診断を置く。
- d4-d5 国語は、`evidence_first` / `two_tier` を優先し、Step1に根拠行・消去理由・表現効果・設問条件確認を置く。
- score だけでなく `learning_signal` と `recommended_intervention` を使い、`concept_gap` は見分け問題、`procedure_gap` は手順穴埋め、`reading_load` は短文根拠、`careless_or_tap_noise` は確認動作、`fatigue_throwaway` は短いブロックまたは `optional_extra` に逃がす。
- レッスン負荷は現行 `ownership-contract.md` を正とし、通常日は本編20問目安、火・金は本編10問目安、追加問題は `optional_extra` として本編正答率から分離する。

### 問い方品質 5 原則（出し惜しみ禁止）

パターン暗記特化の構造ルール（single_tier・暗記テーブル）に加えて、**問い方そのものの質**を担保する 5 原則を必達。詳細正本は `.claude/skills/_shared/question-rules.md §4f`、単元別カタログは `.claude/skills/generate-drill-lesson/reference/question-style-canon.md`。

| # | 原則 | ルール |
|---|------|-------|
| Q1 | 順方向優先 | 順方向（核 → 即答）≥ 60%、逆方向 ≤ 40%。逆方向は同テーブル順方向問題が別 position に必須 |
| Q2 | 生活実感アンカー必須 | 各問の `question_text` にピザ/ケーキ/時計/お小遣い/通学路/教室/家族等を 1 つ登場 |
| Q3 | 即答性 15-60 秒 | d3=15秒 / d4=30秒 / d5=60秒。中間計算 3 段以上は書き直し |
| Q4 | 典型誤答の質 | distractor は隣の暗記行 or 公式混同 or 実誤答ログから取る |
| Q5 | 定型表現連結 | 中学受験定番（「正N角形⇔N等分⇔360/N°」「原因→だから→結果」等）を毎単元 1 個出題 |

**鉄則（出し惜しみ禁止）**: エージェントは小学生向け教育ロジックを毎レッスンで 100% 出し切る。「無難で薄い問い方」「核を逆算で答えさせるだけの問題」（例: 「中心角 45°→何分？ ヒント: 45÷360 を約分」）は禁止。世界共通の王道パターン（例: 「ピザ 8 等分→中心角は？」）を `question-style-canon.md` のカタログから優先採用する。未収録単元は執筆過程でカタログに先に追記してから本文を書く。

**レッスン内ビルドアップ**: 同一レッスン内で「核を順方向で先行提示（先頭 1〜3 問）→ 生活素材で変奏（中盤）→ 逆方向・応用（後半）」の 3 段階を組む。逆算問題を初見の先頭 position に置かない。

**エージェント自己レビューゲート強化**: Step 4.2.8 (B) で各問について以下 5 項目を発話宣言してから次へ進む（空欄あれば書き直し）:
1. 暗記すべき核 = どのテーブルの何行か
2. 順方向 / 逆方向（逆なら同テーブル順問題の位置）
3. 生活実感アンカー（具体素材名）
4. 即答性目安（d3/4/5 で 15/30/60 秒以内に到達できるか）
5. distractor 出典（隣の行 / 公式混同 / 実誤答ログ）

## 現在のアーキテクチャ

juken-ai-kit は React SPA + Cloudflare Workers の薄い API で構成する。読み取りデータは Cloudflare Pages が配信する静的 JSON、動的データはブラウザ localStorage を即時 source とし、R2 に非同期同期する。

```
Frontend (Cloudflare Pages)
  ├─ GET /data/*.json
  │   ├─ lessons.json
  │   ├─ units.json
  │   ├─ schedule.json
  │   ├─ motivator.json
  │   └─ learning_profile.json
  ├─ localStorage
  │   ├─ answers / resume state
  │   ├─ pending_writes_v1
  │   └─ dead_letter_writes_v1
  └─ POST /api/log, GET /api/user-state
      ↓
Cloudflare Workers
  └─ R2 bucket: juken-ai-kit-play-log
```

D1、staging DB、Workers AI による採点 API は廃止済み。問題の正誤判定・集計はフロントエンドの純関数と localStorage/R2 user state で処理する。

誤答分類は `frontend/src/lib/errorClassification.ts` の純関数で推定する。`rushing` / `timeout` / `procedure` / `concept` / `transfer` は結果画面のフィードバック用途であり、現時点では answer payload や R2 user state に保存しない。`transfer` は lesson-level difficulty と question type による粗い推定であり、question-level difficulty metadata が入るまでは厳密な転移判定ではない。

学力向上 v1 では lesson JSON に任意の `blocks` と question-level `remediation` を持てる。`blocks` は短い学習ブロックの UI 区切りと `block_complete` ログに使い、未定義 lesson は単一ブロックとして従来通り進行する。`remediation` は結果画面のリトライ導線で同問 fallback、類題、転移問題の順に解決する。

`frontend/public/data/learning_profile.json` は `data/weakness_profile.json` から `scripts/build_learning_profile.py` で生成する表示用サマリー。**🚨 必須手順**: `data/weakness_profile.json` を更新したら、Pages deploy 前に **必ず** `python3 scripts/build_learning_profile.py` を実行して静的配信データを同期する。これを怠ると `/skill` と `/history` のダッシュボードに古い weakness が表示され続ける。`frontend/src/lib/learningDashboard.ts` が静的 weakness profile と R2/local answer history を join し、`/skill` と `/history` の学力向上ダッシュボードを構成する。国語の `reading_questions` は lesson `unit_id` 単位の練習履歴として dashboard に反映する。

## 技術構成

| レイヤー | 技術 |
|---|---|
| フロントエンド | React 19, Vite 6, Tailwind CSS v4 |
| ルーティング | React Router 7 |
| API | Hono on Cloudflare Workers |
| 静的データ | `frontend/public/data/*.json` |
| 動的データ | localStorage + Cloudflare R2 |
| テスト | Vitest + Playwright |

## API

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | Worker ヘルスチェック |
| POST | `/api/log` | 解答/レッスン/ブロック完了/スケッチイベントを R2 に追記し `user_state/{session}/latest.json` を更新（sketch は `sketch_log/` のみで latest 非更新） |
| GET | `/api/user-state` | `X-Session-Id` を使って R2 から最新の user state を読む |
| POST | `/api/sketch-feedback` | スケッチゲートの advisory 判定（Workers AI llama-4-scout、2値 Y/N + 励まし）。fail-open・5秒 race・`X-Debug` ダミー |

`POST /api/log` は `X-Debug: 1` を受け付ける。デバッグリクエストはバリデーションは通るが、R2への書き込み・`latest.json`の更新・Slack通知の投稿は一切行わない。

### スケッチゲート / 漢字ゲート

- 問題は `sketch_gate: true` + `sketch_kind: 'figure' | 'kanji'`（省略・不正値は figure）+ `sketch_hint` でオプトインする。選択肢表示前に canvas 指描きステップが入り、判定は advisory only で `is_correct` に影響しない。
- `/api/sketch-feedback` のリクエストは `kind` と任意の `answer`（最大50字）を受ける。**kanji では answer（正解漢字）をお手本としてプロンプトに使う**。answer は AI 判定にのみ使い、sketch ログには記録しない。
- **答え漏洩防止**: `sketch_hint` は画面表示されるため、kanji では読みのみ定型（「『ムスばれた』を漢字と送りがなで指書きしてから、答えを選ぼう」）。validator R18 が「`question_text` に現れない正解漢字が hint に混入」を reject する。
- シャドーモード: AI コメントは `SKETCH_COMMENT_VISIBLE`（LessonPage.tsx）が false の間は固定文。sketch イベント（`kind` 含む）は R2 `sketch_log/` に縮小画像つきで記録され、`scripts/pull_r2_play_log.py --type sketch` で取得して実筆跡照合する。

## データフロー

### レッスンコンテンツ

1. 手書きレッスンは `data/lessons-handwritten/` 配下で管理する。
2. `scripts/build_handwritten_to_json.py` がレッスン JSON を `frontend/public/data/lessons.json` にマージする。手書きの question `remediation` とレッスン単位の `blocks` は保持される。既存の `blocks` は、手書きソース側が明示的に置き換えを供給しない限り維持される。**注意**: question フィールドは whitelist 方式でコピーされる。新フィールドを lesson JSON に追加するときは build スクリプトへのコピー追加が必須。追加を忘れると、そのフィールドだけ本番配信 JSON から欠落する。
3. `frontend/public/data/*.json` はコミットされ、Cloudflare Pages でデプロイされる。
4. レッスンサイズと必達難易度ミックスは曜日に応じて変わる。正本は `.claude/skills/generate-drill-lesson/reference/ownership-contract.md`。通常日（月・水・木・土・日）は本編20問目安 + `optional_extra` 0〜5問、登塾日の火・金は本編10問目安 + `optional_extra` 0〜3問。`optional_extra` は疲労時に飛ばせる追加扱いで、本編正答率から分離する。

`blocks` を有効化する場合は、Pages フロントエンドと同時かそれより先に Worker をデプロイする。古い Worker は新しい `block_complete` ログ種別を拒否するため、解答ログ自体は動作していてもブロック完了の書き込みだけがローカルのデッドレターキューに滞留することがある。

### プレイログ

1. UIはまずローカルに解答を記録するため、ネットワークを待たずにレッスンの再開ができる。
2. `frontend/src/lib/writeQueue.ts` が各書き込みを `pending_writes_v1` にキューイングする。
3. キューは指数バックオフで `/api/log` にイベントを送信する。
4. 失敗が繰り返されると、項目は `dead_letter_writes_v1` に移動し、UIがリトライ導線を表示する。
5. `scripts/pull_r2_play_log.py` が R2 のイベントオブジェクトを `data/play_log/` に取得し分析に使う。

### User State

`user_state/{session}/latest.json` はイベントから再構築されるキャッシュ。並行書き込みにより古くなっている疑いがある場合は、R2ログを取得して以下を実行する:

```bash
python3 scripts/pull_r2_play_log.py --since 2026-05-01
python3 scripts/rebuild_user_state_from_events.py --session-id <session-id>
```

## 品質ゲート

マージ前にはルートの check コマンドを使う:

```bash
npm run check
```

これはフロントエンドのビルド/型検査、Workersの型検査、Vitest、レッスンJSON検証、ローカル Playwright スモークテストを実行する。本番スモークテストは読み取り専用で、CIのworkflow dispatch経由で別途実行する。

### レッスン検証（R0-R24）

`scripts/validate_lesson_format.py` が `data/lessons-handwritten/{date}-{subject}.json` に対して R0-R24 を強制する。プロセス理解の許容ルールは validator と `generate-drill-lesson/reference/gates.md` が所有しており、d4-d5 を最終解答のみのsingle-tier数値に押し込めることなく、方針・図・根拠・公式・証拠スタイルの解答をカバーする。

R18 は tier / step / slot_config の UI・採点整合に加えて、`sketch_kind` の enum（figure/kanji）と漢字ゲートの答え漏洩（`question_text` 未出の正解漢字が `sketch_hint` に混入）を reject する。

国語の語彙ユニット `goi-kanyouku` / `goi-kotowaza` / `goi-bunpou`（+ 既存 `keigo`）の正本は git 管理の `data/vocabulary/*.md`。status「本採用」（2 ソース以上一致）のみ出題可。二要素記述 `niyouso-kijutsu` は `evidence_first` 流用で、記述肢 21-59 字を `long_answer_allowed_units` で許可する。

`load_allowed_units` は YAML のインラインコメント（`- foo # ...`）を取り除くため、説明コメント付きの既存 whitelist エントリも正しく解決できる。R12 の figure-svg 検出はキーワードベースであり、幾何マーカーをたまたま含むトピック文の問題（例: つるかめ算 `円玉` のコインバリエーション）は、`nenrei` や `shuugou` のような SVG 不要のストック代替に差し替えるべき。

### 4段階レッスンゲート（`generate-drill-lesson` Step 7）

`validate_lesson_format.py` を通過した後も、`frontend/public/data/lessons.json` へビルドされる前に `generate-drill-lesson/reference/gates.md` のチェックをクリアしなければならない:

1. **機械検証** — `scripts/validate_lesson_format.py --json <file>` を実行する。
2. **図形視覚レビュー** — `is_figure=true` の全問題をレンダリングし、SVGパス・viewBox・本文と図の整合性を確認する。
3. **自己解答ゲート** — メタが本文/図/設問だけから全問を解き、Step1と最終答えを検証する。
4. **セマンティックレビュー** — `scripts/prepare_semantic_review.py prepare --lesson-id <lesson-id>` を実行し、10項目チェックリストを `verify` する。

### レッスンUI送信ゲート（`QuestionFlash`）

選択肢のクリックは選択状態を切り替えるだけ。送信は明示的な確定ボタン（`question-flash__confirm-btn`、ラベル「この答えで決定」）を押した時**のみ**発火する。「同じ選択肢を2回タップして確定」のような、誤クリックを誘発する送信経路は設けていない。プレイログから弱点を分析する際、5秒以内の不正解は誤クリックの疑いとして扱う: 弱点スコアの加算はスキップし、代わりに次のレッスンで同じパターンを再テストする。

### 誤答時の即時再出題

`LessonPage.tsx` の `handleNextAfterWrong` に、誤答した問題を **1 回だけ即座に再出題** するロジックを実装。誤答→「次へ」ボタン押下→同じ問題を選択肢シャッフル状態で再表示→正答 or 2 回目誤答で次の問題へ進む。`retriedQuestionsRef: Set<string>` で `qid:stepIndex` ごとに retry 履歴を保持する。

評価ロジックは **1 回目の回答のみ** を採点対象として `results` 配列・R2 ログに記録する（2 回目以降はローカル UI のみ）。これにより weakness profile は「実力」を反映し続け、再出題は「解法暗記の即時定着」だけを目的とする。

`diag_step1` が定義された問題は従来通り診断フェーズへ進む（即時再出題はスキップ）。これらは互いに独立に動作する。
