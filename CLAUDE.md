# drill-ai-kit エージェントガイド

## ミッション

このリポジトリは日々の学習アプリを支えている。レッスン品質、確実な進捗記録、保守可能なデリバリー、運用ミス発生時の迅速な復旧を最優先で最適化する。

**教育設計コンセプト（2026-05-14、保護者更新・全レッスン生成の最上位原則）:** このアプリは**「パターン暗記ドリル」**である。学習者は基本的な計算力・読解力をすでに持っており、記述式・思考型の問題解決は塾が担当する。このアプリは、**入試で繰り返し出題される具体的な数値・分数・分類ラベル・判断規則・本文根拠選択を暗記すること**に集中する。算数 d2-d3 は暗記テーブルからの自然文穴埋め `single_tier` を使う。算数 d4-d5 と国語 d4-d5 は、最終解答の前に方針・根拠・公式・図・誤答診断・証拠・消去理由・表現効果のいずれかを問う tier 形式の問題を使わなければならない。最終解答のみを問う d4-d5 の `single_tier` 問題は検証で reject される。詳細ルール: `.claude/skills/generate-drill-lesson/SKILL.md`。

学習者個人の文脈、成績履歴、志望校固有の戦略、家庭固有のメモは、追跡対象のエージェント指示ではなく、gitignore 対象の `PRIVATE_CONTEXT.md` に置く。

## テンプレートとしての位置づけ

これは公開テンプレート **drill-ai-kit** である。`data/` および `frontend/public/data/` 配下に同梱されているデータはすべて**合成データ**（架空の学校「架空学園中等部」、架空の成績・ログ）。初回セットアップは `SETUP.md`（または `setup` スキル）に従う。合成データを実際の学習者のデータに差し替える手順は `SETUP.md` Part 3 に記載。著作権のある教材や実在する子どものデータを公開リポジトリにコミットしてはならない。

## 現在のアーキテクチャ

環境構成とデプロイの正本は `docs/ops/environments.md`。

- フロントエンド: React 19 + Vite 6 + Tailwind v4 on Cloudflare Pages
- API: Hono on Cloudflare Workers
- 静的データ: `frontend/public/data/*.json`
- 動的データ: ブラウザ localStorage、Workers `PLAY_LOG` 経由で非同期に R2 へ同期
- データベース: D1 は廃止済み。新規の D1 依存を追加しない
- AIランタイムAPI: 旧 `/api/check` と `/api/diagnose` は廃止済みで、再導入しない。唯一の Workers AI ルートは `/api/sketch-feedback`（スケッチゲート、advisory only、fail-open、2026-06-11 追加）
- テスト: Vitest + Playwright

現行の Worker API:

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック |
| POST | `/api/log` | 解答/レッスン/ブロック完了/スケッチイベントを R2 に追記 |
| GET | `/api/user-state` | `X-Session-Id` を使って最新の R2 user state を読む |
| POST | `/api/sketch-feedback` | Workers AI（llama-4-scout）によるスケッチゲート作図の advisory 判定。`is_correct` には一切影響せず、fail-open。`X-Debug` はダミー値を返す |

スケッチゲートに関する注記: 問題は `sketch_gate: true`（+ 任意で `sketch_hint`）でオプトインする。`sketch` イベントは R2 の `sketch_log/` プレフィックスへ送られ、`user_state/latest.json` を更新してはならない。フロントエンドのフラグ `SKETCH_COMMENT_VISIBLE`（LessonPage.tsx）は、シャドー検証期間中は AI コメントを非表示のままにする。

## 開発コマンド

```bash
npm run dev
npm run dev:api
npm test
npm run check
```

`npm run check` はマージ前の品質ゲート: フロントエンドのビルド/型検査、Workers の型検査、Vitest、レッスンJSON検証、ローカル Playwright スモークテスト。

## データルール

- 静的なレッスンコンテンツは `frontend/public/data/*.json` にビルドされ、Pages でデプロイされる。
- 手書きレッスンのソースファイルは `data/lessons-handwritten/` 配下にある。
- `scripts/validate_lesson_format.py --json <file>` がレッスン品質ゲート。
- `user_state/{session}/latest.json` はキャッシュであり、R2 のイベントログが正本。
- `scripts/pull_r2_play_log.py` でログを取得した後、`scripts/rebuild_user_state_from_events.py` で最新状態を再構築する。
- デバッグモードは R2 ログを書き込んではならない。`X-Debug: 1` リクエストは成功形のダミーレスポンスを返すべき。

## 実装ルール

- 小さく、挙動を保つ変更を優先する。
- UIの挙動は `DESIGN.md` と既存の Warm Studio トークンに一致させる。
- 純粋なレッスン/問題ロジックはページコンポーネントの中ではなく `frontend/src/lib/` に置く。
- 書き込みキューの失敗で学習者のログを黙って失ってはならない。デッドレターストレージとリトライ経路を使う。
- 無関係な dirty ファイルに触れない。特に、生成済みまたは日次のレッスンJSONにはすでにユーザーの変更が含まれている場合がある。

## 主要なパス

- `frontend/src/pages/LessonPage.tsx` - レッスンUIのオーケストレーション
- `frontend/src/lib/questionEngine.ts` - 問題tierとstepのロジック
- `frontend/src/lib/slotScoring.ts` - スロット解答の採点
- `frontend/src/lib/writeQueue.ts` - R2書き込みキューとデッドレター処理
- `workers/src/routes/log.ts` - R2ログ追記エンドポイント
- `docs/ops/environments.md` - 環境構成の正本
