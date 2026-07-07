import { describe, expect, it, vi } from 'vitest'
import app from '../index'

function createEnv(readToken?: string) {
  return {
    PLAY_LOG: {
      get: vi.fn(async () => null),
      put: vi.fn(),
    },
    API_READ_TOKEN: readToken,
  }
}

describe('GET /api/user-state authorization', () => {
  it('rejects reads when API_READ_TOKEN is configured and header is missing', async () => {
    const env = createEnv('secret-read')

    const res = await app.request(
      '/api/user-state',
      { headers: { 'X-Session-Id': 'test-session' } },
      env,
    )

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(env.PLAY_LOG.get).not.toHaveBeenCalled()
  })

  it('accepts reads when API_READ_TOKEN header matches', async () => {
    const env = createEnv('secret-read')

    const res = await app.request(
      '/api/user-state',
      { headers: { 'X-Session-Id': 'test-session', 'X-Read-Token': 'secret-read' } },
      env,
    )

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json.session_id).toBe('test-session')
    expect(env.PLAY_LOG.get).toHaveBeenCalled()
  })
})
