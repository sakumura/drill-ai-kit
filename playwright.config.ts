import { defineConfig, devices } from '@playwright/test'

const target = process.env.E2E_TARGET || 'local'

const baseURL =
  target === 'production'
    ? process.env.PROD_URL || 'https://YOUR-PROJECT.pages.dev'
    : 'http://localhost:5173'

const localApiPort = Number(process.env.E2E_API_PORT || 18787)

const webServer =
  target === 'local'
    ? [
        {
          command: `cd workers && npx wrangler dev --port ${localApiPort}`,
          port: localApiPort,
          reuseExistingServer: true,
          timeout: 30000,
        },
        {
          command: `cd frontend && E2E_API_PORT=${localApiPort} VITE_API_BASE=http://localhost:${localApiPort}/api npx vite --port 5173`,
          port: 5173,
          reuseExistingServer: true,
          timeout: 15000,
        },
      ]
    : undefined

const projects =
  target === 'production'
    ? [
        {
          name: 'Mobile Chrome',
          testMatch: /smoke-prod\.spec\.ts/,
          use: {
            ...devices['Pixel 5'],
          },
        },
      ]
    : [
        {
          name: 'Mobile Chrome',
          use: {
            ...devices['Pixel 5'],
          },
        },
        {
          name: 'Mobile Safari',
          use: {
            ...devices['iPhone SE'],
            browserName: 'chromium',
          },
        },
      ]

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL,
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects,
  ...(webServer ? { webServer } : {}),
})
