# Skill 呼び出しグラフ

**目的**: `.claude/skills/` の呼び出し関係・依存関係を可視化する。レッスン生成の単一入口は **`generate-drill-lesson`**。

新規レッスン生成では `.claude/skills/generate-drill-lesson/SKILL.md` と `reference/ownership-contract.md` を参照する。長期計画の正本は `data/textbooks/curriculum/grade5-training-plan.md`、構造分析は `data/textbooks/curriculum/grade5-analysis.md`、志望校ターゲット校方針は `data/target-school/long-term-plan.md`。

## 全体フロー

```mermaid
flowchart TD
    user([保護者]) -->|"/briefing"| briefing
    user -->|"/generate-drill-lesson"| generate_drill
    user -->|"/analyze-test"| analyze_test
    user -->|"/dogfood"| dogfood
    user -->|"/deploy"| deploy

    briefing["**briefing**<br/>オーケストレータ<br/>（Phase 1-4）"]
    briefing -->|Phase 1f/1g<br/>staleness / 未分析検出| stale_check{{"staleness ok?"}}
    stale_check -->|NG| staleness_exit[報告のみで終了]
    stale_check -->|OK + 未分析0| no_regen[Phase 3/4 スキップ]
    stale_check -->|OK + 未分析>=1| briefing_phase4

    briefing_phase4["**Phase 4**<br/>アクション実行"]
    briefing_phase4 -->|4a| weak_update[(weakness_profile.json<br/>更新)]
    briefing_phase4 -->|4b| generate_drill
    briefing_phase4 -->|4c| analyze_test

    generate_drill["**generate-drill-lesson**<br/>単一入口<br/>（設計・執筆・4層ゲート）"]
    grade5_docs[(主教材<br/>grade5-analysis.md<br/>grade5-training-plan.md)]
    target_school_plan[(data/target-school<br/>long-term-plan.md)]
    briefing -.->|Phase 1e/1f 必読| grade5_docs
    generate_drill -.->|Step 2 必読| grade5_docs
    generate_drill -.->|Step 2 必読| target_school_plan
    generate_drill -->|Step 4-5| anchor[(data/target-school/<br/>difficulty-anchor.md)]
    generate_drill -->|Step 5| shared_typical[(_shared/<br/>typical-errors.md)]
    generate_drill -->|Step 6| build_json["scripts/build_handwritten_to_json.py<br/>（handwritten → lessons.json）"]
    generate_drill -->|Step 7| meta_gate["scripts/prepare_semantic_review.py<br/>prepare / verify"]

    generate_drill -->|Step 2| shared_guard[(_shared/<br/>unlearned-units-guard.md)]
    generate_drill -->|Step 7 機械検証| validate_auto[(validate_lesson_format.py<br/>R0-R22 仕様)]
    validate_auto -.->|仕様準拠| validate_py["scripts/validate_lesson_format.py"]
    generate_drill -->|Step 7 目視| validate_meta[(semantic review<br/>10 項目)]

    analyze_test["**analyze-test**<br/>答案PDF → tier付け"]
    analyze_test -->|更新| weak_update
    analyze_test -->|更新| diff_ref[(data/<br/>test_difficulty_reference.md)]

    dogfood["**dogfood**<br/>Playwright QA + 保護者目視"]
    dogfood -.->|検証| cf

    deploy["**deploy**<br/>test → build → deploy"]
    deploy -.->|デプロイ| cf[CF Pages + Workers]

    style briefing fill:#e1f5fe
    style generate_drill fill:#fff3e0
    style shared_typical fill:#e8f5e9
    style shared_guard fill:#e8f5e9
    style anchor fill:#fff9c4
    style validate_auto fill:#fce4ec
    style validate_meta fill:#fce4ec
    style grade5_docs fill:#ede7f6
    style target_school_plan fill:#ede7f6
```

## 4 層ゲート（生成品質チェーン）

```mermaid
flowchart LR
    gen[generate-drill-lesson<br/>生成完了] --> gate1
    gate1["**(1) 自動 validation**<br/>validate_lesson_format.py<br/>R0-R22 機械チェック"]
    gate1 -->|exit 0| gate2
    gate1 -->|exit 1| retry1[該当問題のみ再生成]

    gate2["**(2) 視覚検証**<br/>図形SVGをPlaywrightで確認"]
    gate2 -->|OK| gate3
    gate2 -->|NG| retry2[図形問題を修正]

    gate3["**(3) 自己解答**<br/>全問をエージェントが解く"]
    gate3 -->|OK| gate4
    gate3 -->|NG| retry3[該当問題を修正]

    gate4["**(4) semantic review**<br/>prepare_semantic_review.py verify"]
    gate4 -->|OK| deliver[lessons.json へ反映]
    gate4 -->|NG| retry4[該当問題を修正]

    style gate1 fill:#e3f2fd
    style gate2 fill:#fff3e0
    style gate3 fill:#f1f8e9
    style gate4 fill:#f3e5f5
    style deliver fill:#c8e6c9
```

`generate-drill-lesson/reference/gates.md` が品質ゲートの正本。D1 は退役済みで、配信用 lesson は `frontend/public/data/lessons.json` に反映する。

## _shared/ 参照関係

```mermaid
flowchart LR
    shared_qr["_shared/question-rules.md<br/>（§4d 志望校アンカー正本、§4f 問い方品質 5 原則、<br/>英略禁止、数式全角統一、SVG 共通クラス）"]
    lesson_rules["generate-drill-lesson/reference/<br/>lesson-design-rules.md<br/>（算数/国語の問い方ルール、learning_signal別形式）"]
    shared_typical["_shared/typical-errors.md<br/>（distractor 11 カテゴリ + 禁止パターン）"]
    shared_guard["_shared/unlearned-units-guard.md<br/>（unlock_date テーブル）"]

    briefing -.->|§4d / 禁則| shared_qr
    gd[generate-drill-lesson] -.->|§4d / §4f / 禁則 / guard| shared_qr
    gd -.->|Step 2| shared_guard
    gd -.->|設計ルール| lesson_rules
    gd -.->|distractor| shared_typical
    anchor["data/target-school/<br/>difficulty-anchor.md"]
    gd -.->|志望校同型判定| anchor
    shared_qr -.->|§4d 一次ソース| anchor

    style shared_qr fill:#e8f5e9
    style shared_typical fill:#e8f5e9
    style shared_guard fill:#e8f5e9
    style lesson_rules fill:#e3f2fd
    style anchor fill:#fff9c4
```

## skill 一覧

| skill | 種別 | 行数 | 責務 |
|------|------|------|------|
| **briefing** | オーケストレータ | 267 | Phase 1-4。状況把握→再設計提案→generate-drill-lesson/analyze-test 呼び出し |
| **generate-drill-lesson** | 単一入口 | - | 弱点・テスト範囲・志望校アンカーに基づき、設計・執筆・JSON化・4層ゲートを実行 |
| **analyze-test** | atomic | 190 | 答案 PDF → tier 付け → weakness_profile / test_difficulty_reference 更新 |
| **fetch-school-kakomon** | atomic | - | 志望校の公式サイトが無料公開する過去問だけを検索・保護者確認・取得（第三者サイトは対象外） |
| **dogfood** | atomic | 81 | Playwright QA + 保護者目視 |
| **deploy** | atomic | 83 | test → build → deploy |
| **setup** | atomic | - | 初期セットアップ（Cloudflare 認証 → R2 → デプロイ → スモーク） |

## _shared/ 配下

| ファイル | 責務 | 参照元 |
|---------|------|--------|
| `data/textbooks/curriculum/grade5-analysis.md` | 5年ステージIII全体分析。単元連鎖・横断ボトルネック・志望校合格から逆算した重点 | briefing / generate-drill-lesson |
| `data/textbooks/curriculum/grade5-training-plan.md` | 5年ステージIII全体トレーニング計画。フェーズ計画・既習弱点スパイラル・科目別固定ルール・調整ルール | briefing / generate-drill-lesson |
| `data/target-school/long-term-plan.md` | 志望校入試形式・合格者平均・国算140〜150点ロードマップの根拠資料 | briefing / generate-drill-lesson |
| `question-rules.md` | §4d 志望校アンカー定義（正本）+ §4f 問い方品質 5 原則（出し惜しみ禁止）+ 禁則ルール全集 | briefing / generate-drill-lesson + reference 配下 |
| `typical-errors.md` | distractor カテゴリ 11 種 + 禁止パターン 3 種 | generate-drill-lesson Step 5 |
| `unlearned-units-guard.md` | 未学習単元の unlock_date テーブル | generate-drill-lesson Step 2 |

## generate-drill-lesson/reference/ 配下

| ファイル | 責務 | 参照元 |
|---------|------|--------|
| `ownership-contract.md` | ブロック別レッスンサイズ、必達難易度ミックス、設定責任 | generate-drill-lesson Step 1 |
| `lesson-design-rules.md` | 算数/国語の問い方、d4-d5プロセス問題、learning_signal別形式 | generate-drill-lesson Step 5 |
| `gates.md` | 機械検証、視覚検証、自己解答、semantic review | generate-drill-lesson Step 7 |

## 設計方針の補足

- 外部サイトの過去問・解説等を無断 WebFetch して出題内容に転用することはしない（著作権・利用規約上のリスクがあるため、`generate-drill-lesson/SKILL.md` に不採用の方針を明記）。
- レッスン生成は `generate-drill-lesson` に一本化されている。d2-d3 は自然文穴埋め `single_tier`、d4-d5算数は `two_tier` / `slot_two_tier`、d4-d5国語は `evidence_first` / `two_tier` を優先し、Step1で図・式・基準量・根拠・消去理由を問う。`scripts/validate_lesson_format.py` の R22 process_understanding は reject（d4-d5 でプロセス目的必須）。
