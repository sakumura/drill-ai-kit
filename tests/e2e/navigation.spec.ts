import { test, expect } from '@playwright/test'

test.describe('ナビゲーション', () => {
  test('ボトムナビのきろくタブに遷移できる', async ({ page }) => {
    await page.goto('/')
    await page.getByText('きろく').click()
    await expect(page).toHaveURL('/history')
  })

  test('レッスンタブに戻れる', async ({ page }) => {
    await page.goto('/history')
    await page.getByText('レッスン').click()
    await expect(page).toHaveURL('/')
  })
})
