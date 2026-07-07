import { test, expect } from '@playwright/test'

test.describe('ゲームフロー', () => {
  test('トップページにレッスン一覧が表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('AI家庭教師')).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'tests/e2e/screenshots/01-home.png' })
  })

  test('レッスン詳細→スタート画面が表示される', async ({ page }) => {
    // ホームは「今週のレッスン」のみ表示するため、同梱サンプル（過去日付）へは直接遷移する
    await page.goto('/lesson/lesson-m-0701')
    await expect(page.getByRole('button', { name: /スタート/ })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: 'tests/e2e/screenshots/02-game-start.png' })
  })
})
