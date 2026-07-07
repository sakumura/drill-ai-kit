import { test, expect } from '@playwright/test'

test.describe('モバイル対応', () => {
  test('レイアウトが崩れない', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('AI家庭教師')).toBeVisible()

    // 横スクロールが発生しないことを確認
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)

    await page.screenshot({ path: 'tests/e2e/screenshots/05-mobile.png', fullPage: true })
  })

  test('ボトムナビが表示される', async ({ page }) => {
    await page.goto('/')
    // ナビリンクで特定（ローディングテキストとの衝突を回避）
    await expect(page.getByRole('link', { name: /レッスン/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /きろく/ })).toBeVisible()
  })
})
