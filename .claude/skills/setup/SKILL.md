---
name: setup
description: drill-ai-kit の初期セットアップ。Cloudflare 認証 → R2 作成 → Worker/Pages デプロイ → スモークテスト → デモパイプライン確認までを、人間の判断ポイントを挟みながら実行する。
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, WebFetch
---

# Setup — 初期セットアップ

`SETUP.md` Part 2 の実行手順の正本。テンプレートリポジトリの URL だけを渡された状態、または clone 直後のリポジトリを、自分の Cloudflare アカウントで動く状態にする。

**着手前に `PUBLICATION_SAFETY.md` を読む。** データ送信先・著作権・人間専用操作・外部AIの学習利用拒否確認が書かれている。

このキットは高性能な外部AIエージェントを前提にする。性能の低いローカルLLMだけで実戦運用する方針にはしない。AI費用は月額定額サブスクを主に想定し、日次運用を従量課金API中心にしない。

## 原則

- **人間の判断ポイントでは必ず止まって確認する**: アカウント作成、OAuth 承認、課金に関わる操作、名前の決定（バケット名・プロジェクト名）
- **パスワード・2FAコード・APIトークンの入力は人間に依頼する。エージェントが代行しない**
- 可能な操作は `wrangler` CLI・設定ファイル編集で完結させる。ブラウザ操作（claude-in-chrome 等）はアカウント作成・OAuth承認など CLI で代替できない場面に限定する
- 破壊的操作（既存リソースの削除・上書き）はこのスキルの範囲外。既存の同名リソースを見つけたら、上書きせずに人間へ報告する
- 各 Step の完了条件を確認してから次へ進む。失敗した Step は原因を報告し、勝手に代替手段へ切り替えない

## 事前準備: リポジトリの複製と clone（初回のみ）

まだローカルに clone していない場合、`drill-ai-kit` の URL だけを渡されて起動したときはここから開始する。

```bash
gh auth status || gh auth login   # 未認証ならブラウザ承認を人間に依頼する
gh repo create <新しいリポジトリ名> --template sakumura/drill-ai-kit --private --clone
cd <新しいリポジトリ名>
```

- リポジトリ名は人間に確認する（既定は `drill-ai-kit` のままでよい）
- 実運用（子どものデータを入れる）前提なら `--private` を必ず付ける。合成データだけ試す場合に限り `--public` でも可
- 既にローカルに clone 済みでこのディレクトリで作業している場合はこの準備をスキップし、そのまま Step 0 から始める

## Step 0. 前提確認

```bash
node --version    # v20+
python3 --version # 3.11+
npm install
npx wrangler --version
```

失敗時: Node.js / Python のインストールを人間に案内する（nvm / パッケージマネージャ）。

## Step 1. Cloudflare アカウント

```bash
npx wrangler whoami
```

- 認証済みならアカウント名と account_id が出る → Step 2 へ
- 未認証なら `npx wrangler login` を実行し、**ブラウザの承認ボタンは人間に押してもらう**
- アカウント自体が無い場合: https://dash.cloudflare.com/sign-up の作成を案内する。ブラウザ操作ツール（claude-in-chrome 等）が使える環境なら入力を代行してよいが、**メール認証と規約同意は必ず人間が行う**
- 複数アカウントの場合: `cp .env.example .env` して `CLOUDFLARE_ACCOUNT_ID` を設定

## Step 2. R2 バケット

```bash
npx wrangler r2 bucket create juken-ai-kit-play-log
```

- 名前を変える場合は人間に確認し、`workers/wrangler.jsonc` の `bucket_name` と `.env` の `R2_BUCKET` を揃える
- 完了条件: `npx wrangler r2 bucket list` に表示される

## Step 3. Worker デプロイ

実運用する場合は、デプロイ前に API access control を設定する。

```bash
cd workers
npx wrangler secret put API_WRITE_TOKEN
npx wrangler secret put API_READ_TOKEN
cd ..
```

公開URLを広く共有する場合は、共有トークンだけでなく Cloudflare Access 等でサイト自体を保護する。

```bash
cd workers && npm run deploy:production
```

- 完了条件: `curl https://juken-ai-kit-api.<subdomain>.workers.dev/api/health` が `{"status":"ok",...}` を返す
- `<subdomain>` はデプロイ出力に表示される。以後の手順で使うため記録する

## Step 4. フロントエンド

1. `frontend/.env.production` の `VITE_API_BASE` を Step 3 の URL + `/api` に書き換える
2. `API_WRITE_TOKEN` / `API_READ_TOKEN` を設定した場合は、`frontend/.env.production` の `VITE_API_WRITE_TOKEN` / `VITE_API_READ_TOKEN` も同じ値にする
3. Pages プロジェクト名を人間に確認（既定 `drill-ai-kit`）。変える場合は `workers/wrangler.jsonc` の `vars.PAGES_PROJECT` も変えて Worker を再デプロイ（CORS 許可オリジンの判定に使うため）

```bash
cd frontend && npm run build
npx wrangler pages project create juken-ai-kit --production-branch main
npx wrangler pages deploy dist --project-name juken-ai-kit --branch main --commit-message "initial deploy"
```

完了条件: 表示された `*.pages.dev` URL でホーム画面が開き、サンプルレッスンが見える。

## Step 5. スモークテスト

```bash
# .env の PROD_URL / PROD_API_URL を Step 3-4 の URL に設定してから
set -a && source .env && set +a
npx playwright test tests/e2e/smoke-prod.spec.ts
```

Playwright 未導入なら `npx playwright install chromium` を先に実行。

## Step 6.（任意）Slack 通知

人間が希望した場合のみ:

```bash
cd workers && npx wrangler secret put SLACK_WEBHOOK_URL
```

## Step 7. デモパイプライン一周

```bash
python3 scripts/validate_lesson_format.py --json data/lessons-handwritten/2026-07-01-math.json
python3 scripts/summarize_play_log.py --mode summary
python3 scripts/build_learning_signal_profile.py --start-date 2026-06-22 --end-date 2026-07-06
python3 scripts/build_learning_profile.py
python3 scripts/validate_static_json.py
```

全部 exit 0 を確認。

## Step 8. 公開前セーフティチェック

```bash
python3 scripts/check_publication_safety.py
```

警告が出た場合は `PUBLICATION_SAFETY.md` に従って対処する。必要条件のみのチェックであり、
これが通っても公開して安全とは限らないことを人間に伝える。

## Step 9. 完了報告

以下を人間へ報告する:

- Pages URL / Worker URL
- 作成したリソース一覧（R2 バケット、Pages プロジェクト、Worker）
- スモークテスト結果
- 次のアクション: `SETUP.md` Part 3（自分のデータへの差し替え）と `/briefing` の運用開始
