---
name: dogfood
description: エージェントが自分でアプリをプレイしてUX・問題品質・バグを検証する品質チェックスキル。汎用 Playwright spec で全問自動検証し、追加でエージェントが目視観察する二段構成。
allowed-tools: Bash, Read, Write, Glob, Grep
---

# Dogfood - エージェントのセルフプレイ検証

`/generate-drill-lesson` 完了後の品質ゲート。**自動スペック（機械検証）**と**保護者目視（UX観察）**を組み合わせて全問チェックする。

## 使い方

```
/dogfood                    # pending の全レッスンを自動＋目視で検証
/dogfood "lesson-m-0423"    # 特定レッスンのみ
```

## 実行手順

### Step 1. 対象レッスン確定

```bash
cat frontend/public/data/schedule.json | jq '.[] | select(.status=="pending") | .id'
```

### Step 2. 自動スペック実行（6観察項目 × Nレッスン）

`tests/e2e/dogfood-lesson-complete.spec.ts` を使用。環境変数 `DOGFOOD_LESSONS` でレッスンを指定。

```bash
cd <repo-root>
DOGFOOD_LESSONS='lesson-m-0423,lesson-j-0423,lesson-m-0424,lesson-j-0424' \
  npx playwright test tests/e2e/dogfood-lesson-complete.spec.ts --reporter=list
```

**自動検証される 6 観察項目**:

| # | 項目 | 判定 |
|---|------|------|
| 1 | 全 N 問 hints[0] クリック → 正解 CSS 確認 | ✅/❌ |
| 2 | hints[1] クリック → 不正解フィードバック | ✅/⚠️/❌ |
| 3 | コンソールエラーなし | ✅/⚠️/❌ |
| 4 | 長文正解肢（20字以上）のビューポート内表示 | ✅/⚠️ |
| 5 | 漢字問題の正解肢テキスト一致（文字化けチェック） | ✅/❌ |
| 6 | figure_svg 問題の SVG 描画とスクショ保存 | ✅/❌ |

Spec は完了時に `data/analysis/dogfood-YYYY-MM-DD.md` にマトリクス付きレポートを自動出力する。
figure_svg 問題は `test-results/lesson-review/<lesson-id>/posNN.png` にスクショが保存される。

### Step 3. 図形問題のAI目視（必須）

figure_svg 問題が 1 問でもあるレッスンは、**エージェントが全スクショを `view_image` で開いて目視確認するまで dogfood 完了にしてはいけない**。自動スペックの「SVG 描画 ✅」は、図が壊れていないことだけを示す。問題として成立している保証ではない。

確認対象:
- 図のラベル・線・角度・長さが、問題文と同じ対象を指している
- Step 1 が「手順/式/根拠」を選ぶ画面なら、問題文も手順選択として自然に読める
- Step 2 の答え候補、`answer`、`solution_steps` が同じ計算結果を指す
- 図がダミーの四角・意味のないラベルだけになっていない
- 固定ナビやボタンが選択肢・確定ボタンを隠していない

判定:
- 1枚でも「意味不明」「図と文が矛盾」「Step 1と設問文が噛み合わない」があれば **目視 ❌** とし、`data/lessons-handwritten/*.json` を修正して再ビルド・再dogfoodする
- スクショを見ていない場合は **未完了**。報告文に「SVG崩れなし」とだけ書いてはいけない
- 完了報告には、確認した `lesson-id / posNN` と所見を短く列挙する

### Step 4. 保護者目視（UX/問題品質の質的観察）

Step 2 の自動チェックで拾えない項目をエージェントが手動で観察する。**実行前に `reference/checklist.md` を Read**。

目視対象（抜粋）:
- 問題文の小5適合性
- distractor（hints[1]/hints[2]）の誘惑性
- 解法ステップ（solution_steps）のわかりやすさ
- 分数表示（FractionText）崩れ
- タイマー秒数の適切さ
- 思考時間の動的調整挙動

### Step 5. レポート統合

自動出力された `data/analysis/dogfood-YYYY-MM-DD.md` に保護者目視の所見を追記。
テンプレートは `reference/report-template.md`。

## 後続アクション

| 検出内容 | 対応 |
|---------|------|
| 自動 ❌（hints[0] 不一致・文字化け・SVG 壊れ等） | 即修正（data/lessons-handwritten/*.json を直接編集 → python3 scripts/build_handwritten_to_json.py 再実行 → git commit） |
| 自動 ⚠️（コンソールエラー少数・ビューポートはみ出し） | 次回調整項目としてレポート記録 |
| 目視 ❌（図形/問題文不成立・正解肢論理破綻） | `data/lessons-handwritten/*.json` を直接修正、または generate-drill-lesson で該当レッスン上書き再生成 |
| 目視 ⚠️（UX改善余地） | レポート記録、まとめて次回 skill 改善 |

全項目 ✅ なら `/deploy` に進む。

## 本番 debug dogfood 中にバグを見つけた場合の強制ループ

保護者から「デプロイ後に debug mode で一問ずつ確認して」と依頼された場合、バグ検出で止めて報告だけしてはいけない。次のループをその場で完了する。

1. **実バグか dogfood spec 不備か切り分ける**
   - 実バグ: 学習者が正答不能、画面操作不能、保存ログが欠落、問題文/答え/slot_config が矛盾、step が進まない。
   - spec 不備: 新方式 UI（two_tier / evidence_first / slot_* / slot_two_tier）を dogfood spec が操作できていないだけ。
2. **実バグなら即修正**
   - 問題データの矛盾は `data/lessons-handwritten/{date}-{subject}.json` を直し、`python3 scripts/build_handwritten_to_json.py --date YYYY-MM-DD --subject {math|japanese}` で `frontend/public/data/*.json` を再生成する。
   - UI/採点/ログのバグは `frontend/src/` または `workers/src/` を修正する。
   - dogfood spec 不備は `tests/e2e/dogfood-lesson-complete.spec.ts` を新方式に合わせて更新する。
3. **ローカル検証**
   - `npm test`（frontend）
   - `npm run build:production`（frontend）
   - `npm test`（workers）
   - 対象レッスンだけ `DOGFOOD_LESSONS='lesson-...' npx playwright test tests/e2e/dogfood-lesson-complete.spec.ts --reporter=list` で再実行する。
4. **本番へ再デプロイ**
   - Workers 変更がある場合: `cd workers && npm run deploy:production`
   - Pages / JSON / frontend 変更がある場合: `cd frontend && npx wrangler pages deploy dist --project-name juken-ai-kit --branch main --commit-dirty=true`
5. **本番スモーク + dogfood 再実行**
   - `E2E_TARGET=production npx playwright test tests/e2e/smoke-prod.spec.ts --reporter=list`
   - `E2E_TARGET=dogfood DOGFOOD_LESSONS='lesson-m-MMDD,lesson-j-MMDD' npx playwright test tests/e2e/dogfood-lesson-complete.spec.ts --reporter=list`

完了報告は「修正内容」「再デプロイ先」「production smoke 結果」「dogfood 結果」「残る ⚠️」を必ず含める。

## spec メンテナンスノート

汎用 spec の仕様は `tests/e2e/dogfood-lesson-complete.spec.ts` 冒頭コメント参照。
レッスン固有の日付ハードコードは禁止。観察項目を追加する場合は
`test.describe` 内に新 `test()` を追記し、`lessonReport.results.push` でレポート行を登録する。
