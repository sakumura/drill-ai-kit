import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logRoutes } from './routes/log'
import { userStateRoutes } from './routes/user-state'
import { sketchFeedbackRoutes } from './routes/sketch-feedback'

type Bindings = {
  PLAY_LOG: R2Bucket
  AI: Ai
  SLACK_WEBHOOK_URL?: string
  PAGES_PROJECT?: string
  API_WRITE_TOKEN?: string
  API_READ_TOKEN?: string
}

type Variables = {
  debug: boolean
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors({
  origin: (origin, c) => {
    if (!origin) return null
    if (origin === 'http://localhost:5173') return origin
    // production + Pages branch preview（*.<PAGES_PROJECT>.pages.dev）
    // PAGES_PROJECT は wrangler.jsonc の vars で自分の Pages プロジェクト名に合わせる
    const project = (c.env as Bindings).PAGES_PROJECT ?? 'juken-ai-kit'
    const escaped = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`^https://([a-z0-9-]+\\.)?${escaped}\\.pages\\.dev$`).test(origin)) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Debug', 'X-Session-Id', 'X-Write-Token', 'X-Read-Token'],
}))

app.use('/api/*', async (c, next) => {
  c.set('debug', c.req.header('X-Debug') === '1')
  await next()
})

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.route('/api/log', logRoutes)
app.route('/api/user-state', userStateRoutes)
app.route('/api/sketch-feedback', sketchFeedbackRoutes)

export default app
