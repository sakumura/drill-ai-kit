# 2 環境構成 運用ガイド (Development / Production)

**更新: 2026-04-30** — D1 全廃・全文 JSON 化（2026-04-27）完了により staging を廃止。
local + production の 2 環境に簡素化。

> このファイルを環境構成の source of truth とする。`docs/ARCHITECTURE.md`、`README.md`、エージェント向け指示に環境情報の差分がある場合は、本ファイルを正として更新する。

## 環境一覧

| 環境 | Worker URL | Pages URL | 触る人 | 用途 |
|------|-----------|-----------|-------|------|
| Development | `localhost:8787` | `localhost:5173` | エージェント | 日常コーディング、ローカル実験 |
| Production | `https://juken-ai-kit-api.YOUR-SUBDOMAIN.workers.dev` | `https://YOUR-PROJECT.pages.dev` | 学習者（プレイ）、エージェント（approve のみ） | 本番配信（毎日のレッスン配信） |

> **アーキテクチャ変更 (2026-04-27)**: content（lessons / units / schedule）は
> `frontend/public/data/*.json` の静的 JSON。answers / user_state は
> localStorage。DB（D1）は完全廃止。R2 はアーカイブ用途のみ。

> **ローカル開発の認証**: `wrangler.jsonc` に account_id を書かないテンプレート構成のため、
> `wrangler dev` / E2E 実行時は `.env` の `CLOUDFLARE_ACCOUNT_ID` を環境変数として通すこと
> （`set -a && source .env && set +a`）。未設定だと wrangler が /memberships 照会に行き、
> 権限の狭い API トークンでは起動に失敗する。

> **Workers AI binding (2026-06-11)**: `wrangler.jsonc` に `"ai": {"binding": "AI"}` を追加。
> `/api/sketch-feedback`（スケッチゲートの advisory 判定、llama-4-scout）だけが使用する。
> `wrangler dev` でも AI binding は**リモート実機に接続**する（ローカル実行でも無料枠 Neurons を消費）。
> sketch イベントは R2 prefix `sketch_log/` に記録され、`user_state/latest.json` は更新しない。
> `scripts/pull_r2_play_log.py --type sketch` で `data/play_log/YYYY-MM-DD-sketch.jsonl` に取得できる。

> **sketch_kind / answer (2026-06-13)**: `/api/sketch-feedback` は `kind: 'figure' | 'kanji'`
> （省略・不正値は figure）と任意の `answer`（最大50字、kanji のお手本漢字）を受ける。
> answer は AI プロンプトにのみ使い、ログには記録しない。漢字ゲートの設計詳細は
> `docs/ARCHITECTURE.md` の「Sketch gate / 漢字ゲート」を参照。

## デプロイ手順

### Workers API

```bash
cd workers

# Production（学習者の本番配信。最大限の注意）
npm run deploy:production # = wrangler deploy
```

`npm run deploy`（素の形）は **ガードで `exit 1`** します。必ず `deploy:production` を明示してください。

### Cloudflare Pages

```bash
cd frontend

# Production
npm run build:production
wrangler pages deploy dist --project-name juken-ai-kit --branch main
```

## コンテンツ更新（JSON 静的ファイル）

D1 廃止後、lessons / units / schedule の更新は `frontend/public/data/` 以下の JSON を
直接編集してコミット → Pages 再デプロイで反映する。

```bash
# 確認
cat frontend/public/data/lessons.json | python3 -m json.tool > /dev/null && echo "valid JSON"

# Pages 再デプロイ（main push で自動ビルド、または手動）
cd frontend
npm run build:production
wrangler pages deploy dist --project-name juken-ai-kit --branch main
```

## Scripts 呼び出しルール

D1 操作系の `--env {local,production}` / `--confirm-production` ルールは廃止済み。
現在のレッスン生成・検証スクリプトは、静的 JSON または手書き lesson JSON を明示して実行する。

```bash
# 手書き lesson JSON の検証
python3 scripts/validate_lesson_format.py --json data/lessons-handwritten/YYYY-MM-DD-math.json
```

## E2E テスト実行

```bash
# Local（webServer 自動起動）
npx playwright test

# Production（読み取りのみの smoke）
E2E_TARGET=production npx playwright test tests/e2e/smoke-prod.spec.ts
```

> **E2E の API ポート (2026-06-13)**: `frontend/.env.development` が
> `VITE_API_BASE=http://localhost:8787/api` を定義するため、dev モードのフロントは
> vite proxy を**経由せず** 8787 へ直接 fetch する。E2E では wrangler を
> `E2E_API_PORT`（デフォルト 18787）で起動するため、`playwright.config.ts` の
> webServer が vite に `VITE_API_BASE=http://localhost:${E2E_API_PORT}/api` を注入して
> 整合させている。これが無いと 8787 への fetch が WSL2 で pending のまま settle せず、
> ホームが「読み込み中…」でスタックする（2026-06-13 修正）。
> `reuseExistingServer: true` のため、**古い env で手動起動した vite が残っていると
> 再利用されて再発する**。E2E が不可解に落ちたら残留 vite / wrangler を kill する。

## `latest.json` 再構築

`user_state/{session}/latest.json` は UI resume 用のキャッシュ。正は R2 のイベントログであり、複数タブや並行送信で latest 側の取りこぼしが疑われる場合はイベントから再構築する。

```bash
# R2 から answer / lesson_complete を pull
python3 scripts/pull_r2_play_log.py --since 2026-05-01

# local の data/play_log/*.jsonl から latest 相当を再構築
python3 scripts/rebuild_user_state_from_events.py --session-id <session-id>
```

出力は既定で `data/play_log/user_state-<session-id>-latest.json`。必要に応じて内容確認後、R2 の `user_state/<session-id>/latest.json` へ手動反映する。

## 本番誤操作時のロールバック

| 事象 | 対処 |
|------|------|
| `wrangler deploy` で壊れた Worker が上がった | Cloudflare ダッシュボードの Deployments 履歴から前回の Version ID を Rollback |
| `frontend/public/data/*.json` を誤更新した | git revert してコミット → Pages 再デプロイ |

## よくある落とし穴

- **`npm run deploy` だけ叩く → 即 `exit 1`**。`deploy:production` を明示。
- **`validate_lesson_format.py` に `--json` を渡し忘れる → argparse エラー**。検証対象の手書き JSON を明示する。
- **Pages project 名と公開 URL を混同する** → project 名（例 `juken-ai-kit`）と公開 URL（`*.pages.dev` サブドメイン）は別物。
- **`frontend/public/data/*.json` を直接編集後に build/deploy を忘れる** → 本番に反映されない。
- **`data/weakness_profile.json` 更新後に `scripts/build_learning_profile.py` 実行を忘れる** → `/skill` `/history` ダッシュボードに古い weakness が表示。Pages deploy 前に必ず実行（ARCHITECTURE.md 参照）。
- **`wrangler pages deploy` で稀に `Invalid commit message, it must be a valid UTF-8 string`** → `--commit-message "..."` を明示して回避。git 最新コミットメッセージから自動抽出する仕様が原因。

## 関連ドキュメント

- プラン: `.claude/plans/warm-dazzling-galaxy.md`
- skill 呼び出し図: `docs/skill-call-graph.md`
- アーキテクチャ記録: `docs/ARCHITECTURE.md`
