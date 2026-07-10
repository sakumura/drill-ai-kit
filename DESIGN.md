# DESIGN.md — drill-ai-kit (Warm Studio)

> 自動生成: 2026-04-23 (ui-coder, 既存コード走査結果から抽出)

## 起点

メインのデザインソースは `frontend/src/styles/global.css` の `:root` ブロックに集約された
`--ws-*` トークン。新規 UI を追加する際はこれらのトークンを再利用すること。

## カラー (Warm Studio Palette)

| 用途 | 変数 | 値 |
|------|------|-----|
| primary accent | `--ws-coral` | `#e76f51` |
| accent pressed | `--ws-coral-d` | `#c65738` |
| primary text | `--ws-cocoa` | `#3d2817` |
| secondary text | `--ws-cocoa-soft` | `#6b5345` |
| muted text | `--ws-cocoa-faint` | `#b09880` |
| card border | `--ws-border` | `#ece1cb` |
| nav border | `--ws-border-soft` | `#e6d9bf` |

## 形状

| 用途 | 変数 |
|------|------|
| pill ボタン | `--ws-radius-pill` (`999px`) |
| カード | `--ws-radius-card` |
| ボタン影 | `--ws-shadow-lesson-btn` |

## タイポグラフィ

`system-ui` 系。問題本文とボタンは 1.0–1.2rem。子供向けのため `font-weight: 700–900` を多用。

## デバッグ UI ガイドライン (本書の主要対象)

`?debug=1` のときだけ表示する補助 UI は次の規則に従う:

- 配色は **灰色〜beige 系** に固定し、本来のコンテンツ ( coral 系) と差別化する
  - `background: #efe6d4` (border 系トーン), `border: 1px solid var(--ws-border-soft)`
  - `color: var(--ws-cocoa-soft)`
- ラベル先頭に「🐞」または絵文字でデバッグ用と即判別できるようにする
- 通常モード (debug クエリなし) では `display: none` ではなく **DOM ごと出さない**
  (子供がスクリプト的に発火させられないように)
- スマホ 375px 幅で破綻しない最小サイズ (高さ 36–44px, 文字 0.8rem 程度)

## レスポンシブ方針

mobile-first。`max-width: 480px` 周辺をベースに設計。デバッグ UI はスペース消費を最小化。

## アクセシビリティ

- 主要ボタンは `aria-label` を持つ
- フィードバックは `role="status"` で読み上げ
- フォーカスリングはブラウザデフォルトを尊重 (Warm Studio は子供向けで visible focus を弱めない)
