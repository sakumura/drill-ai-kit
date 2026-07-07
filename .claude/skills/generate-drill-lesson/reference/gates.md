# 4層ゲート

自動 validation と UI dogfood は semantic review の代替ではない。
これらは「構造が壊れていない」「画面で描画できる」ことを確認するだけで、
問題文・図・選択肢・解法が教材として成立しているかは止められない。
生成完了を名乗るには、エージェントが全問を自己解答し、下記の目視項目を 1 問ずつ OK/NG で記録する。

## 1. 機械検証

```bash
python3 scripts/validate_lesson_format.py --json <lesson-json>
```

R10-R16 と R22 reject を必須にする。R22 は warn に戻さない。

## 2. 視覚検証

図形問題だけ Playwright MCP で SVG を表示確認する。
SVG ノードが存在するだけでは pass にしない。

確認項目:

- 図が空白でない
- 線・ラベル・角度・影が重ならない
- 問題文の寸法と SVG が一致する
- 色・影・補助線が、問題文で問う部分と一致する
- solution_steps の式で使う数値が図上のラベルから読み取れる

## 3. エージェント自己解答ゲート

全問について distractor と正答欄を見ずに解く。自動 validation の pass はこの代替にならない。

正答照合規約:

- `single_tier`: `hints[0]` が正答。`answer` と意味的に一致すること。
- `two_tier` / `evidence_first`: Step1 は `hints[0]`、Step2 は `hints[3]`。Step1 がプロセス・根拠・式・図・誤答理由を問い、Step2 が最終答えになっていること。
- `slot_*`: `slot_config.correct_value` が正答。`correct_value` がなければ `answer` と採点実装で正答が一意に作れること。
- `slot_two_tier`: `slot_config.tier1.correct_value` と `slot_config.tier2.correct_value` を別々に確認する。tier1 が最終答えだけなら NG。

一致しない場合、または Step1/Step2 の意味分離が崩れている場合は、その問題だけ再生成または手直しする。

## 4. 保護者目視ゲート

`scripts/prepare_semantic_review.py prepare --lesson-id <lesson-id>` で全問のレビューシートを作り、
各問の review item を埋める。`verify` が pass するまで完了扱いにしない。

prepare 後、保護者目視の前に必ず外部LLM拒否ゲートを走らせる。

```bash
python3 scripts/run_semantic_reviewers.py --review /tmp/_semantic_review_<lesson-id>.json
```

Codex / Claude / Antigravity Gemini 3.5 Flash (Medium) は解答者ではなく「問題成立レビューア」として扱う。
少しでも意味が不明、条件不足、答えが一意でない、解答契約や solution_steps と矛盾、
Step1/Step2 が噛み合わない場合は `verdict=NG` にする。1モデルでも NG が残る場合、
`prepare_semantic_review.py verify` は失敗する。該当問題を修正してから prepare → 外部レビュー → verify をやり直す。

10項目:

1. 曜日別総数
2. 難易度配分
3. 志望校アンカー整合
4. d2-d3 の自然文穴埋め
5. d4-d5 tier 系
6. tier1_purpose 許可値
7. 問題文が小5に通る語彙・論理になっている
8. 図と数値・式・選択肢・solution_steps が一致している
9. 選択肢が意味的に成立し、distractor が実在の誤答になっている
10. solution_steps が正答理由になっており、5/14 失敗パターンに戻っていない

fail は該当問題のみ最大3回再生成する。

以下のいずれかが残る場合、完了報告で「完了」と言ってはいけない。

- semantic review の未判定がある
- Codex / Claude / Antigravity Gemini 3.5 Flash (Medium) の外部レビューが未実施、または1つでも NG
- 自己解答していない問題がある
- 図形問題で SVG 表示だけを見て、寸法・式・選択肢との照合をしていない
- `two_tier` / `evidence_first` の Step1/Step2 分離を確認していない
