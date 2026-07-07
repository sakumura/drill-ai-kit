import { test, expect } from '@playwright/test'

test.describe('local smoke', () => {
  test('home and health endpoints are reachable', async ({ page, request }) => {
    const apiPort = process.env.E2E_API_PORT || '18787'
    const health = await request.get(`http://localhost:${apiPort}/api/health`)
    expect(health.ok()).toBeTruthy()
    const body = await health.json()
    expect(body.status).toBe('ok')

    await page.goto('/')
    await expect(page.locator('.home-header__title')).toBeVisible({ timeout: 15000 })
  })
})
