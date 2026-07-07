---
name: deploy
description: テスト→ビルド→デプロイ→本番スモークテストを一括実行。変更をCFにデプロイしたい時に使用。
allowed-tools: Bash, Read
---

# Deploy Skill - ビルド&デプロイ&スモークテスト

ユニットテスト → フロントエンドビルド → Workers/Pagesデプロイ → 本番スモークテスト を順番に実行します。

## 使用方法

```
/deploy              # フル実行（テスト→ビルド→デプロイ→スモークテスト）
/deploy --skip-test  # テストスキップ（緊急デプロイ用）
```

## 実行手順

いかなる場合も以下の順序を守ること。途中で失敗したらそこで停止し、修正を提案する。

### Step 1: フロントエンド ユニットテスト

```bash
cd frontend && npm test
```

**判定**: 全テストPASSで次へ。1つでも失敗したら停止。

### Step 2: フロントエンドビルド

```bash
cd frontend && npm run build
```

**判定**: vite build が成功し dist/ 以下に lessons.json 等が含まれれば次へ。型エラーがあれば停止。

### Step 3: Workers ユニットテスト

```bash
cd workers && npm test
```

**判定**: テストがない場合も 0 failed で OK。

### Step 4: Workers API デプロイ

```bash
cd workers && npx wrangler deploy
```

**判定**: Deployed juken-ai-kit-api が表示されれば次へ。

### Step 5: フロントエンド デプロイ (Pages)

```bash
npx wrangler pages deploy frontend/dist --project-name juken-ai-kit --commit-dirty=true
```

**判定**: Deployment complete! または Pages URL が表示されれば次へ。

**重要**: project-name は `juken-ai-kit`（`*.pages.dev` のサブドメインとは別物）。`YOUR-PROJECT.pages.dev` は Pages が発行するドメイン名で、project-name とは別。`npx wrangler pages project list` で確認可。`--commit-dirty=true` は git 未コミット時の警告を抑制する。

Pages のブランチプレビューは自動生成される。feature ブランチ push 時は CF が自動で preview URL を発行するため、手動デプロイ不要の場合もある。

### Step 6: 本番スモークテスト

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://juken-ai-kit-api.YOUR-SUBDOMAIN.workers.dev/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-PROJECT.pages.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-PROJECT.pages.dev/data/lessons.json
```

3 つすべて 200 で本番稼働確認。続いて https://YOUR-PROJECT.pages.dev に手動アクセスして表示を確認する。

新しく投入したレッスンの本番反映は以下で確認:

```bash
curl -s https://YOUR-PROJECT.pages.dev/data/lessons.json | python3 -c "import sys, json; ids = [l['id'] for l in json.load(sys.stdin)]; print('lesson-m-{MMDD} in production:', 'lesson-m-{MMDD}' in ids)"
```

**新フィールド追加直後のデプロイ**: lesson JSON に新フィールドを追加した変更を含む場合は、本番 `lessons.json` に当該フィールドが実際に含まれるかも確認する。`build_handwritten_to_json.py` は明示コピー実装のため、whitelist 追加漏れだと本番だけフィールドが欠落する（前科: `sketch_kind`）。

### Step 7: 結果報告

全ステップの結果をサマリーで報告:

```
## デプロイ完了

| Step | 結果 |
|------|------|
| frontend test | XX tests passed |
| frontend build | XX KiB |
| workers test | 0 failed |
| Workers デプロイ | version: xxx |
| Pages デプロイ | url |
| スモークテスト | 200 OK |
```
