import { test, expect, Page } from '@playwright/test'

const LESSON_URL = '/lesson/debug-kanji-gate?debug=1'
const TIMEOUT = 20_000

async function clickStart(page: Page): Promise<void> {
  const startBtn = page.getByRole('button', { name: /スタート/ })
  await expect(startBtn).toBeVisible({ timeout: TIMEOUT })
  await startBtn.click()
}

async function drawOneStroke(page: Page): Promise<void> {
  const canvas = page.locator('canvas.sketch-gate__canvas')
  await expect(canvas).toBeVisible({ timeout: TIMEOUT })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas の boundingBox が取得できません')
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 10 })
  await page.mouse.up()
}

test.describe('漢字スケッチゲート', () => {
  test.setTimeout(60_000)

  test('Q1: canvas 送信時に /api/sketch-feedback body へ kind=kanji を含め、選択肢が表示される', async ({ page }) => {
    let sketchBody: unknown = null
    await page.route('**/api/user-state', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'debug-kanji-gate-e2e',
          answer_history: [],
          lesson_completions: [],
          block_completions: [],
        }),
      })
    })
    await page.route('**/api/sketch-feedback', async route => {
      sketchBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, category: 'ok', comment: 'debug kanji ok', fallback: true }),
      })
    })

    await page.goto(LESSON_URL)
    await clickStart(page)

    const canvas = page.locator('canvas.sketch-gate__canvas')
    await expect(canvas).toBeVisible({ timeout: TIMEOUT })
    await expect(page.locator('.question-flash__choices')).toBeHidden()

    await drawOneStroke(page)
    const submitBtn = page.locator('.sketch-gate__btn--submit')
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 })
    await submitBtn.click()

    await expect(page.locator('.question-flash__choices')).toBeVisible({ timeout: TIMEOUT })
    await expect.poll(() => sketchBody).not.toBeNull()
    expect(sketchBody).toMatchObject({ kind: 'kanji', answer: '結ばれた' })
  })
})
