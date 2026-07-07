# 設定責任コントラクト

同じルールを複数箇所に書かない。所有ファイルを変更し、参照側はリンクだけ更新する。

| ルール                   | 所有ファイル                        | 参照先                 |
| ------------------------ | ----------------------------------- | ---------------------- |
| 設計コンセプト           | `generate-drill-lesson/SKILL.md`    | briefing, CLAUDE.md    |
| ブロック別レッスンサイズ | 本ファイル                          | SKILL.md, briefing     |
| 必達難易度ミックス       | 本ファイル                          | SKILL.md, gates.md     |
| 問い方品質 5 原則        | `_shared/question-rules.md`         | lesson-design-rules.md |
| 算数暗記テーブル抽出     | `lesson-design-rules.md`            | SKILL.md               |
| d4-d5 プロセス問題ルール | `lesson-design-rules.md`            | validator, gates.md    |
| 国語本文照合ルール       | `lesson-design-rules.md`            | gates.md               |
| 志望校アンカー §4d         | `data/target-school/difficulty-anchor.md`  | SKILL.md, gates.md     |
| 機械検証仕様             | `scripts/validate_lesson_format.py` | gates.md               |

## ブロック別レッスンサイズ

30問固定は禁止。通常日の本編は18〜22問、追加演習は `optional_extra` として本編正解率から分離する。

| 曜日               |     本編 | optional_extra | 標準ブロック                                                                    |
| ------------------ | -------: | -------------: | ------------------------------------------------------------------------------- |
| 月・水・木・土・日 | 20問目安 |         0〜5問 | warmup 4 / core 8 / weakness_spiral 4 / exam_transfer 2 / confidence_recovery 2 |
| 火・金             | 10問目安 |         0〜3問 | warmup 2 / core 4 / weakness_spiral 2 / exam_transfer 1 / confidence_recovery 1 |

`blocks[].block_type` は次のいずれかにする:

- `warmup`
- `core`
- `weakness_spiral`
- `exam_transfer`
- `confidence_recovery`
- `optional_extra`

`optional_extra` は `optional_extra: true` を明示し、疲労時に飛ばせる追加扱いにする。
登塾日である火・金はテスト前日でも体力負荷を優先する。`fatigue_throwaway` / `rest_or_short_block`
が強い単元は、同型反復を本編に詰め込まず `optional_extra` へ逃がす。
