import { test, expect } from '@playwright/test'

const PROD_URL = process.env.PROD_URL || 'https://YOUR-PROJECT.pages.dev'
const API_URL = process.env.PROD_API_URL || 'https://juken-ai-kit-api.YOUR-SUBDOMAIN.workers.dev'

interface LessonSummary {
  id: string
  questions?: unknown[]
  title?: string
}

async function fetchLessons(request: import('@playwright/test').APIRequestContext): Promise<LessonSummary[]> {
  const res = await request.get(`${PROD_URL}/data/lessons.json`)
  expect(res.ok()).toBeTruthy()
  const lessons = await res.json()
  expect(Array.isArray(lessons)).toBeTruthy()
  expect(lessons.length).toBeGreaterThan(0)
  return lessons as LessonSummary[]
}

async function latestMathLesson(request: import('@playwright/test').APIRequestContext): Promise<LessonSummary> {
  const lessons = await fetchLessons(request)
  const mathLesson = lessons
    .filter((l) => /^lesson-m-\d{4}$/.test(l.id))
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0]
  expect(mathLesson, '算数レッスンが存在すること').toBeTruthy()
  return mathLesson
}

test.describe('本番スモークテスト', () => {
  test('API ヘルスチェック', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/health`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  test('静的レッスン一覧が返る', async ({ request }) => {
    const lessons = await fetchLessons(request)
    expect(lessons.some((lesson) => /^lesson-m-\d{4}$/.test(lesson.id))).toBeTruthy()
  })

  test('トップページが表示される', async ({ page }) => {
    await page.goto(PROD_URL)
    await expect(page.locator('.home-header__title')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: 'tests/e2e/screenshots/prod-home.png' })
  })

  test('レッスン直接URL→ゲーム開始画面が表示される', async ({ page, request }) => {
    // 静的 JSON から最新の算数レッスン ID を取得（日付依存を避ける）
    const mathLesson = await latestMathLesson(request)
    await page.goto(`${PROD_URL}/lesson/${mathLesson.id}?debug`)
    await expect(page.getByRole('button', { name: /スタート/ })).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: 'tests/e2e/screenshots/prod-game-start.png' })
  })

  test('ゲーム開始画面にレッスン情報と制限時間が表示される', async ({ page, request }) => {
    const mathLesson = await latestMathLesson(request)
    await page.goto(`${PROD_URL}/lesson/${mathLesson.id}?debug`)
    const startBtn = page.getByRole('button', { name: /スタート/ })
    await expect(startBtn).toBeVisible({ timeout: 15000 })
    // 算数は 60 秒 / 国語は 30 秒（2026-04-20 以降）。算数テストなので 60 秒 or 40 秒のいずれかを許容
    await expect(page.getByText(/1問(40|60)秒/)).toBeVisible()
    const questionCount = mathLesson.questions?.length ?? 0
    expect(questionCount, `${mathLesson.id} の問題数が取得できること`).toBeGreaterThan(0)
    // デバッグボタンと区別するため info-value クラスで絞り込む。
    await expect(page.locator('.game-start__info-value').filter({ hasText: `${questionCount}問` })).toBeVisible()
    await page.screenshot({ path: 'tests/e2e/screenshots/prod-game-start-detail.png' })
  })

  test('user-state 読み取りが動作する', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/user-state`, {
      headers: { 'X-Session-Id': 'smoke-prod-readonly' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.session_id).toBe('smoke-prod-readonly')
    expect(typeof body.current_points).toBe('number')
    expect(Array.isArray(body.user_cards)).toBeTruthy()
  })

  test('log API が不正 payload を拒否する（本番書き込みなし）', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/log`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        type: 'answer',
        payload: { smoke: true },
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_payload')
  })

  test('log API debug mode は valid payload を受けても本番書き込みしない', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/log`, {
      headers: { 'Content-Type': 'application/json', 'X-Debug': '1' },
      data: {
        type: 'answer',
        session_id: 'smoke-prod-debug-no-write',
        event_id: `smoke-${Date.now()}`,
        occurred_at: new Date().toISOString(),
        payload: {
          question_id: 'smoke-question',
          lesson_id: 'smoke-lesson',
          user_answer: 'debug',
          is_correct: true,
          time_spent_sec: 1,
          hints_used: 0,
        },
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toEqual({ ok: true, debug: true })
  })
})
