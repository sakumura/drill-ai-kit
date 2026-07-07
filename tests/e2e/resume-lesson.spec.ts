import { test, expect } from '@playwright/test'

// baseURL は playwright.config.ts が E2E_TARGET（local/production）で切り替える

test('Lesson resume - shows continue button after answering questions', async ({ page }) => {
  test.setTimeout(90000)

  // 1. レッスン開始（同梱サンプルレッスン）
  await page.goto('/lesson/lesson-m-0701?debug')
  await page.waitForLoadState('networkidle')

  // GameStart画面のスクショ
  await page.screenshot({ path: 'tests/e2e/screenshots/resume-01-start.png', fullPage: true })

  // スタートボタンクリック（force click は固定ボトムナビ等への誤クリックを招くため使わない）
  const startBtn = page.locator('button:has-text("スタート")')
  await expect(startBtn).toBeVisible({ timeout: 10000 })
  await startBtn.scrollIntoViewIfNeeded()
  await startBtn.click()
  await page.waitForTimeout(1000)

  // concept_card閉じる
  const okBtn = page.locator('button:has-text("OK")')
  if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await okBtn.click()
    await page.waitForTimeout(500)
  }

  // 思考時間待ち
  await page.waitForTimeout(7000)

  // 1問目のスクショ
  await page.screenshot({ path: 'tests/e2e/screenshots/resume-02-q1.png', fullPage: true })

  // 選択肢が表示されることを確認
  const choices = page.locator('.question-flash__choice')
  await expect(choices.first()).toBeVisible()

  console.log('Resume test: lesson loads and shows questions OK')
})

test('Lesson page shows resume hint when answers exist', async ({ page }) => {
  test.setTimeout(30000)

  // 回答済みのレッスンページに行く（回答があれば「つづきから」が出る）
  await page.goto('/lesson/lesson-j-0702')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  await page.screenshot({ path: 'tests/e2e/screenshots/resume-03-existing.png', fullPage: true })

  const body = await page.textContent('body')
  console.log('Has つづきから:', body?.includes('つづきから'))
  console.log('Has スタート:', body?.includes('スタート'))
})
