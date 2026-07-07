/**
 * sketch-gate.spec.ts (2026-06-11 追加)
 *
 * スケッチゲート機能の E2E テスト:
 *   1. sketch_gate=true の問題では canvas が先に表示され、選択肢はまだ無い
 *   2. 描画前は「できた！」ボタンが disabled
 *   3. 1 ストローク描くと「できた！」が有効化される
 *   4. 「できた！」クリック → ゲートが閉じ、選択肢が表示される
 *   5. .sketch-toast に固定コメント「ずをかいてくれてありがとう」が出る
 *   6. sketch_gate なしの Q2 では canvas が出ず、選択肢が表示される
 *
 * テストレッスン: debug-sketch-gate?debug=1
 *   Q1: sketch_gate=true（消去算）
 *   Q2: sketch_gate なし（三角形の内角の和）
 */

import { test, expect, Page } from '@playwright/test'

const LESSON_URL = '/lesson/debug-sketch-gate?debug=1'
const TIMEOUT = 20_000

/**
 * ゲームスタート画面からスタートボタンを押して playing フェーズへ移行する。
 * debug モードのため R2 書き込みは発生しない。
 */
async function clickStart(page: Page): Promise<void> {
  const startBtn = page.getByRole('button', { name: /スタート/ })
  await expect(startBtn).toBeVisible({ timeout: TIMEOUT })
  await startBtn.click()
}

/**
 * canvas 上で 1 ストローク描画する。
 * PointerEvent は page.mouse でも発火するため Pixel 5 (モバイル) でも動作する。
 */
async function drawOneStroke(page: Page): Promise<void> {
  const canvas = page.locator('canvas.sketch-gate__canvas')
  await expect(canvas).toBeVisible({ timeout: TIMEOUT })

  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas の boundingBox が取得できません')

  const startX = box.x + box.width * 0.2
  const startY = box.y + box.height * 0.3
  const endX = box.x + box.width * 0.8
  const endY = box.y + box.height * 0.3

  await canvas.dispatchEvent('pointerdown', {
    bubbles: true,
    pointerId: 1,
    pointerType: 'touch',
    clientX: startX,
    clientY: startY,
  })
  await canvas.dispatchEvent('pointermove', {
    bubbles: true,
    pointerId: 1,
    pointerType: 'touch',
    clientX: endX,
    clientY: endY,
  })
  await canvas.dispatchEvent('pointerup', {
    bubbles: true,
    pointerId: 1,
    pointerType: 'touch',
    clientX: endX,
    clientY: endY,
  })
}

test.describe('スケッチゲート', () => {
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(LESSON_URL)
    await page.waitForLoadState('networkidle')
    await clickStart(page)
  })

  test('Q1: canvas が表示され、選択肢はまだ無く、「できた！」が disabled', async ({ page }) => {
    // スケッチゲートの canvas が表示されること
    const canvas = page.locator('canvas.sketch-gate__canvas')
    await expect(canvas).toBeVisible({ timeout: TIMEOUT })

    // 選択肢グリッドはまだ表示されていないこと
    const choices = page.locator('.question-flash__choices')
    await expect(choices).toBeHidden()

    // 「できた！」ボタンは disabled であること
    const submitBtn = page.locator('.sketch-gate__btn--submit')
    await expect(submitBtn).toBeVisible({ timeout: TIMEOUT })
    await expect(submitBtn).toBeDisabled()
  })

  test('Q1: 1 ストローク描くと「できた！」が有効化される', async ({ page }) => {
    const submitBtn = page.locator('.sketch-gate__btn--submit')
    await expect(submitBtn).toBeDisabled()

    await drawOneStroke(page)

    // ストローク後は有効になること
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 })
  })

  test('Q1: 「できた！」クリック → 選択肢が表示され、.sketch-toast が出る', async ({ page }) => {
    await drawOneStroke(page)

    const submitBtn = page.locator('.sketch-gate__btn--submit')
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 })
    await submitBtn.click()

    // ゲートが閉じて選択肢が表示されること
    const choices = page.locator('.question-flash__choices')
    await expect(choices).toBeVisible({ timeout: TIMEOUT })

    // sketch-toast に感謝コメントが出ること
    const toast = page.locator('.sketch-toast')
    await expect(toast).toBeVisible({ timeout: TIMEOUT })
    await expect(toast).toContainText('ずをかいてくれてありがとう')
  })

  test('Q2: debug スキップ後、canvas が出ず選択肢が表示される', async ({ page }) => {
    // Q1 でスケッチゲートが出ていることを確認してからスキップ
    const canvas = page.locator('canvas.sketch-gate__canvas')
    await expect(canvas).toBeVisible({ timeout: TIMEOUT })

    // debug スキップボタンで Q2 へ進む
    const skipBtn = page.locator('.question-flash__debug-skip')
    await expect(skipBtn).toBeVisible({ timeout: TIMEOUT })
    await skipBtn.click()

    // Q2 は sketch_gate なし: canvas が表示されないこと
    // debug=1 なので choicesReady は即座に true になり、選択肢が表示される
    const choices = page.locator('.question-flash__choices')
    await expect(choices).toBeVisible({ timeout: TIMEOUT })

    // canvas は出ていないこと
    const canvas2 = page.locator('canvas.sketch-gate__canvas')
    await expect(canvas2).toBeHidden()
  })
})
