# Dogfood レポートテンプレート

`data/analysis/dogfood-YYYY-MM-DD.md` に保存する。

```markdown
# Dogfoodレポート YYYY-MM-DD

## サマリー
- プレイしたレッスン数: X
- 確認した問題数: X
- 発見した問題: X件（❌ X件 / ⚠️ X件）

## 良いところ
- ...

## 改善が必要なところ
- ...

## 問題別の指摘

### lesson-xxx: タイトル
| # | 問題文 | 判定 | 指摘 |
|---|--------|------|------|
| 1 | ... | ✅/⚠️/❌ | ... |
| 2 | ... | ✅/⚠️/❌ | ... |

### lesson-yyy: タイトル
...

## 後続アクション
- [ ] lesson-xxx の問題 N を generate-drill-lesson で再生成
- [ ] lesson-yyy の問題 M を handwritten JSON 修正 + build_handwritten_to_json.py で修正
- [ ] deploy に進む
```

## サマリーの判定基準

| ❌ 件数 | 判断 |
|--------|------|
| 0 | deploy に進む |
| 1-2 | その場修正後 deploy |
| 3以上 | generate-drill-lesson で上書き再生成推奨 |
