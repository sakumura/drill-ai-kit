# SETUP — drill-ai-kit セットアップガイド

このファイルは**二重構造**です。

- **Part 1（人間向け）**: 何が起きるか・何を判断するか。読むのに5分
- **Part 2（AIエージェント向け）**: 実行手順。人間は読まなくてよい。「SETUP.md の Part 2 を実行して」と指示するか、`/setup` スキルを呼ぶ
- **Part 3（運用データの差し替え）**: 合成データを自分の学習者・試験仕様にする手順

> **先に [`PUBLICATION_SAFETY.md`](./PUBLICATION_SAFETY.md) に目を通してください。** データがどこへ送られるか・教材の著作権・人間だけが行うべき操作をまとめています。

---

## Part 1: 人間向け — 概要と判断ポイント

### 推奨AIエージェント: Claude Code

このキットは Claude Code での運用を推奨します。ChatGPT/Codex など他の外部AIエージェントやローカルLLMでも Part 2 の手順自体は実行できますが、それらには無い Claude Code 固有の委譲能力が2つあるためです:

1. **Cloudflare の管理画面操作までAIに任せられる**（claude-in-chrome 連携）。R2/Workers/Pages はほぼ CLI (`wrangler`) で完結しますが、アカウント作成やダッシュボード上の確認作業が発生した場合もブラウザ操作ごとエージェントに委譲できます
2. **アプリのデザイン調整もAIに任せられる**（Claude Design 連携）。ドリルアプリの見た目を変えたくなったとき、DESIGN.md のトークン運用も含めて任せられます

他のAIエージェントを使う場合も含め、外部AIを使う前提で、各サービスの学習利用拒否・データ保持・人間レビュー設定を確認してください。

### 全体像

セットアップが終わると、次の状態になります。

1. 自分の Cloudflare アカウント上で、レッスンアプリ（Pages）と記録API（Workers + R2）が動く
2. 学習者はスマホ・タブレットのブラウザでレッスンを解ける
3. AIエージェントに「/briefing」と言うと、記録の分析と翌日レッスンの生成が回る

### GitHub と Cloudflare について（最低限の前提知識）

このキットは2つの外部サービスを使う。どちらも無料で始められ、Claude Code が操作の大半を代行できるが、それぞれ何のためのサービスかを知らないと判断ポイントで迷う。

- **GitHub**: このリポジトリ（ソースコード一式）を自分の名前で保管する場所。アカウントが無ければ最初に作成する（メール確認は人間が行う）。Cloudflareとは別会社・別アカウント。
- **Cloudflare**: 複製したソースコードを実際に「動くアプリ」として動かすホスティングサービス。フロントエンド（Pages）とAPI（Workers）の2つを使う。

デプロイすると、Cloudflareが無料で自動発行する `https://<プロジェクト名>.pages.dev` のようなアドレスでアプリが動くようになる。**独自ドメイン（自分でお金を払って取得する `〇〇.com` のようなドメイン）は一切不要で、このキットは終始このデフォルトアドレスで完結する設計にしている。**

#### 「公開」という言葉について

このドキュメント群では「公開」を2つの異なる意味で使うので区別してほしい。

1. **GitHubリポジトリの公開範囲**（public/private）: ソースコードを誰でも見られる状態にするかどうか。学習者のデータを入れるなら必ず private にする（詳しくは `PUBLICATION_SAFETY.md`）。
2. **アプリが動く状態になること**（Cloudflareへのデプロイ）: これは「不特定多数に告知する」という意味の公開ではない。URLを検索エンジンに登録したり、SNSでリンクを共有したりしない限り、そのURLは誰にも知られておらず、実質的にはURLを知っている人（自分と学習者）だけが使える専用アプリになる。

このキットの利点は、ログイン画面やユーザー管理を作り込まなくても、**「特定少数（自分と学習者）だけが知っているURL」という形で、一般公開のWebサービスより大幅に手間を減らしながら安全に運用できる**ことにある。

#### 独自ドメインは付けない方が安全

独自ドメインを付けると覚えやすくなる・見た目が良くなるという利点はあるが、その代わりドメイン登録やTLS証明書の発行が公開ログ（Certificate Transparencyログなど）に記録され、検索botやスキャナーに見つかりやすくなる。つまり独自ドメインは「特定少数だけが知っている」という前提を弱め、不正アクセスの可能性を積極的に高める側に働く。**積極的な理由がない限り、デフォルトの `*.pages.dev` / `*.workers.dev` のまま使うことを推奨する。** どうしても独自ドメインを付けたい場合は、Cloudflare Access 等でアクセス自体を制限する追加対策とセットで検討する。

### 費用

- 家庭利用の規模であれば Cloudflare（Pages / Workers / R2）は無料枠内で収まる想定です。ただし料金体系はサービス側の変更に依存するため断定はしません。支払い方法の登録や有料プランへのアップグレードを自分で行わない限り、無料枠超過分が勝手に課金されることはありません（超過時は制限がかかるだけです）
- スケッチゲート（指描き判定）だけ Workers AI の Neurons を消費します（無料枠あり）。使わない設定も可能
- AIエージェント側の費用は別途発生します。Claude Code の月額定額サブスクは Claude 分の費用を固定できますが、`analyze-test` の複数モデル照合（Codex/Gemini併用）はサブスクの対象外で別課金です。日次運用の中心を従量課金APIにすると、問題生成・画像解析・複数モデル照合の呼び出し量次第で総額が変動しやすいため、Claude本体は定額サブスクを軸にし、併用するCodex/Geminiの課金体系も別途確認することを推奨します

### 人間が判断・実行すること（ここだけはAIに任せられない）

| # | 判断ポイント | 備考 |
|---|---|---|
| 1 | GitHub アカウントの作成・ログイン | 無ければ最初に作成する。メール確認は人間が行う |
| 2 | Cloudflare アカウントの作成・ログイン | メール認証が必要。claude-in-chrome でブラウザ操作を代行できる場合も、最終認証は人間 |
| 3 | `wrangler login` のブラウザ承認 | OAuth の許可ボタンを押す |
| 4 | リポジトリを private に保つか | 学習者のデータを入れる前提なら、テンプレート複製時点から **private 必須**。public に実データを入れてから private 化する運用は禁止。`PUBLICATION_SAFETY.md` 参照 |
| 5 | Slack 通知を使うか | 任意。レッスン完了が Slack に届く |
| 6 | パスワード・2FAコード・APIトークンの入力 | **AIエージェントに渡さない。常に人間が入力する** |
| 7 | 課金設定・アカウント削除・リポジトリの公開範囲変更 | 取り消せない・影響が大きい操作は必ず人間が最終確認して実行する |
| 8 | 教材の文字起こし・外部AI分析の可否 | 塾・出版社・模試会社の利用規約、送信先AIの学習利用拒否設定、送信資料を確認してから許可する。`PUBLICATION_SAFETY.md` §4 参照 |
| 9 | API access control を設定するか | 実運用では `API_WRITE_TOKEN` / `API_READ_TOKEN` または Cloudflare Access を推奨 |
| 10 | 独自ドメインを付けるか | 付けない方が安全（前述「独自ドメインは付けない方が安全」参照）。付けるならCloudflare Access等の追加対策とセットで検討する |

### ブラウザ自動操作より CLI を優先する

claude-in-chrome は便利だが、Cloudflareダッシュボードの自動操作は誤操作時の影響が読みにくい。
**この SETUP.md の手順はほぼ `wrangler` CLI で完結する設計にしている。** ブラウザ操作が必要なのは
アカウント作成・OAuth承認など CLI で代替できない場面だけに限定すること。

### 所要時間

- Claude Code 主導で 15〜30分（アカウント作成済みの場合）

---

## Part 2: AIエージェント向け — 実行手順

> エージェントへ: 以下を順に実行する。破壊的操作（既存リソースの削除・上書き）は含まれない。
> 各ステップの完了条件を確認してから次へ進むこと。詳細は `.claude/skills/setup/SKILL.md` を正本とする。

### Step 0. リポジトリの複製と clone（初回のみ）

まだローカルに clone していない場合、`drill-ai-kit` のURLだけを渡されて起動したときはここから開始する。

```bash
gh auth status || gh auth login   # 未認証ならブラウザ承認を人間に依頼する
gh repo create <新しいリポジトリ名> --template sakumura/drill-ai-kit --private --clone
cd <新しいリポジトリ名>
```

- リポジトリ名は人間に確認する（既定は `drill-ai-kit` のままでよい）
- 実運用（学習者のデータを入れる）前提なら `--private` を必ず付ける。試しに合成データだけ触る場合に限り `--public` でも可
- 既にローカルに clone 済みでこのディレクトリで作業している場合はこの Step を丸ごとスキップする

### Step 1. 前提確認

```bash
# 以降のステップは .env を読み込んだシェルで実行する（Step 2 以降で必須）
# set -a && source .env && set +a
node --version    # v20 以上
python3 --version # 3.11 以上
npm install
npx wrangler --version
```

### Step 2. Cloudflare 認証

```bash
npx wrangler whoami || npx wrangler login   # ブラウザ承認は人間に依頼する
```

複数アカウントがある場合は `.env` に `CLOUDFLARE_ACCOUNT_ID` を設定（`.env.example` 参照）。

### Step 3. R2 バケット作成

```bash
npx wrangler r2 bucket create juken-ai-kit-play-log
```

バケット名を変える場合は `workers/wrangler.jsonc` の `bucket_name` と `.env` の `R2_BUCKET` を揃える。

### Step 4. Worker デプロイ

実運用する場合は、デプロイ前に共有トークンを Worker secret として設定する。公開URLを広く共有する場合は、これに加えて Cloudflare Access 等でサイト自体を保護する。

```bash
cd workers
npx wrangler secret put API_WRITE_TOKEN
npx wrangler secret put API_READ_TOKEN
cd ..
```

```bash
cd workers && npm run deploy:production
```

完了条件: `Deployed juken-ai-kit-api` が表示され、`https://juken-ai-kit-api.<subdomain>.workers.dev/api/health` が `{"status":"ok"}` を返す。

### Step 5. フロントエンド設定とデプロイ

1. `cp frontend/.env.production.example frontend/.env.production`（`.env.production` は gitignore 済み。自分のURLをコミットしないための分離）
2. コピーした `frontend/.env.production` の `VITE_API_BASE` を Step 4 の Worker URL + `/api` に書き換える
3. Step 4 で `API_WRITE_TOKEN` / `API_READ_TOKEN` を設定した場合は、`frontend/.env.production` の `VITE_API_WRITE_TOKEN` / `VITE_API_READ_TOKEN` も同じ値にする
4. `workers/wrangler.jsonc` の `vars.PAGES_PROJECT` を使う Pages プロジェクト名に揃える（既定: `juken-ai-kit`）。変えた場合は Worker を再デプロイ

`VITE_*` の値はブラウザに配信されるため、これは誤送信・無差別投稿を減らすための簡易ガードです。強い認証が必要な場合は Cloudflare Access を使ってください。

```bash
cd frontend && npm run build
npx wrangler pages project create juken-ai-kit --production-branch main
npx wrangler pages deploy dist --project-name juken-ai-kit --branch main --commit-message "initial deploy"
```

完了条件: 表示された `*.pages.dev` URL でホーム画面が開くこと。同梱サンプルレッスンは `/lesson/lesson-m-0701` に直接アクセスして確認する（ホームの一覧は「今週」の日付のレッスンのみ表示するため）。

### Step 6. スモークテスト

```bash
# .env に PROD_URL / PROD_API_URL を設定してから
set -a && source .env && set +a
npx playwright test tests/e2e/smoke-prod.spec.ts
```

### Step 7.（任意）Slack 通知

```bash
cd workers && npx wrangler secret put SLACK_WEBHOOK_URL
```

### Step 8. デモパイプラインの一周確認

```bash
python3 scripts/validate_lesson_format.py --json data/lessons-handwritten/2026-07-01-math.json
python3 scripts/summarize_play_log.py --mode summary
python3 scripts/build_learning_signal_profile.py --start-date 2026-06-22 --end-date 2026-07-06
python3 scripts/build_learning_profile.py
python3 scripts/validate_static_json.py
```

すべて exit 0 なら、合成データで生成〜検証〜分析のループが一周している。

### Step 9. 実運用開始前セーフティチェック（合成データを実データに差し替えた後は必須）

```bash
python3 scripts/check_publication_safety.py
```

警告が出た場合は `PUBLICATION_SAFETY.md` に従って対処してから先へ進む。

---

## Part 3: 合成データを自分の学習者・試験仕様に差し替える

同梱データはすべて架空です。次の順に自分のデータへ置き換えると実運用になります。

### 3-1. 志望校データ（`data/target-school/`）

1. 志望校の過去問を入手する。方法は2通り:
   - **`/fetch-school-kakomon "志望校名"` を使う**（推奨）: 学校が自校の公式サイトで無料公開している過去問だけを検索・特定し、保護者確認を経て取得する。第三者サイト・塾ポータルには一切アクセスしない設計（`.claude/skills/fetch-school-kakomon/SKILL.md`）
   - 市販の過去問集を購入する。**「購入した」＝「AIに文字起こし・分析させてよい」ではない。** 出版社・模試会社の利用規約を確認してから次に進む（`PUBLICATION_SAFETY.md` §4）
2. AIエージェントに過去問の構成・配点・頻出単元を分析させ、同梱の4ファイルと同じ構成で書き直す。外部AIへ送る前に、利用規約と学習利用拒否設定を確認する:
   `long-term-plan.md` / `difficulty-anchor.md` / `math-analysis.md` / `kokugo-analysis.md`
3. **重要**: 分析結果には実在校名が入る。リポジトリは private のまま運用する

### 3-2. 教材データ（`data/textbooks/`）

1. 自分の塾のカリキュラム表から `data/textbooks/curriculum/curriculum.json` を作り直す
2. 全体分析 `grade5-analysis.md` / 全体計画 `grade5-training-plan.md` を自分の教材で書き直す。外部AIへ教材OCR結果や写真を送る場合は、送信先AIの学習利用拒否設定と保持条件を確認する
3. **教材本体（スキャン画像・PDF等）は `data/textbooks/<教材名>/` に置く。この領域は gitignore 済み** — 著作物をコミットしない設計。ただし gitignore は「コミットしない」ことしか保証しない。**教材を丸ごとOCRし外部AIに送信してよいかは別問題であり、塾との契約・出版社の規約を確認してから行う**
4. （任意規約）計算教材から `算数/{回}回/計算/calc_list.md`、漢字教材から `国語/{回}回/漢字/kanji_list.md` をエージェントに文字起こしさせると、validator R24 が答えの機械照合をしてくれる。フォーマットは同梱サンプルレッスンの `meta.calc_ref` と `validate_lesson_format.py` の R24 を参照

### 3-3. 語彙データ（`data/vocabulary/*.md`）

同梱の慣用句・ことわざ・敬語・文法の各ファイルは、あくまで**フォーマット見本**であり、そのまま実運用に使い続けるものではない。語彙選定は志望校の過去問傾向（頻出テーマ・難易度）に紐づくため、汎用サンプルのままにせず、自分の志望校・お子さんの学年に合わせてAIエージェントに作り直させる。既存ファイルの表構造（番号・語・意味・例文・distractor・出典・status・確認列）はそのまま流用してよい。

### 3-4. テスト日程（`data/test_schedule.json`）

塾の年間予定から `regular`（定例テスト）/ `mock`（公開模試）のエントリを作る。
artifacts の training-plan / analysis は `data/plan/regular-05/` の同梱サンプルが書式見本。

### 3-5. 弱点プロファイルの初期化

最初は実データがないので、`data/weakness_profile.json` の patterns を空に近い状態から始めてよい。
学習者が数レッスン解いた後、AIエージェントに `/briefing` を実行させると、
プレイログから弱点・学習信号が自動構築される。

### 3-6. 合成プレイログの削除

実運用開始時に `data/play_log/*.jsonl` の合成分（2026-07-01, 2026-07-02）を削除する。
以後は `scripts/pull_r2_play_log.py` が R2 から実ログを取得する。

### 3-7. 日々の運用

```
朝または前夜: AIエージェントで /briefing
  → プレイログ分析 → 弱点更新 → 翌日レッスン生成（4層ゲート）→ 保護者が承認
学習者: ブラウザでレッスンを解く
```

cron で自動化する場合は `scripts/cron-lesson-prep.sh` を参照。
