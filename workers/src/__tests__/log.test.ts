import { describe, expect, it, vi, afterEach } from 'vitest'
import app from '../index'

function buildPayload(type: 'answer' | 'lesson_complete' | 'block_complete' | 'sketch', payload: Record<string, unknown>) {
  return {
    type,
    session_id: 'test-session',
    event_id: crypto.randomUUID(),
    occurred_at: '2026-05-06T00:00:00.000Z',
    payload,
  }
}

function createEnv(slackUrl?: string, writeToken?: string) {
  const puts: { key: string; value: unknown }[] = []
  const env = {
    PLAY_LOG: {
      get: vi.fn(async () => null),
      put: vi.fn(async (key: string, value: unknown) => {
        puts.push({ key, value })
      }),
    },
    SLACK_WEBHOOK_URL: slackUrl,
    API_WRITE_TOKEN: writeToken,
  }
  const pending: Promise<unknown>[] = []
  const executionCtx = {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      pending.push(promise)
    }),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  return { env, executionCtx, puts, pending }
}

describe('POST /api/log lesson_complete', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores lesson completion and posts to Slack when configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const { env, executionCtx, puts, pending } = createEnv('https://hooks.slack.test/services/test')

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('lesson_complete', {
          lesson_id: 'lesson1',
          lesson_title: '図形',
          subject: 'math',
          question_count: 30,
          correct_count: 28,
          attempts: 30,
          points_earned: 140,
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    expect(puts[0].key).toMatch(/^lesson_complete\/2026\/05\/06\//)
    expect(puts[1].key).toBe('lesson_complete_index/lesson1/test-session.json')
    expect(puts[2].key).toBe('user_state/test-session/latest.json')
    expect(String(puts[2].value)).toContain('"lesson_id":"lesson1"')
    expect(puts.map((item) => item.key)).not.toContain('user_state/seed-2026-04/latest.json')
    await Promise.all(pending)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('レッスン完了: 図形'),
      }),
    )
  })

  it('does not fail the log write when Slack is not configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { env, executionCtx, puts, pending } = createEnv()

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('lesson_complete', {
          lesson_id: 'lesson1',
          lesson_title: '図形',
          subject: 'math',
          question_count: 30,
          correct_count: 30,
          attempts: 30,
          points_earned: 150,
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    expect(puts).toHaveLength(3)
    expect(puts[1].key).toBe('lesson_complete_index/lesson1/test-session.json')
    expect(puts[2].key).toBe('user_state/test-session/latest.json')
    await Promise.all(pending)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('dedupes lesson completion before Slack and user_state updates', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    const { env, executionCtx, puts, pending } = createEnv('https://hooks.slack.test/services/test')
    env.PLAY_LOG.get = vi.fn(async (key: string) => {
      if (key === 'lesson_complete_index/lesson1/test-session.json') {
        return { text: async () => '{}' }
      }
      return null
    })

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('lesson_complete', {
          lesson_id: 'lesson1',
          lesson_title: '図形',
          subject: 'math',
          question_count: 30,
          correct_count: 30,
          attempts: 30,
          points_earned: 150,
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
      key: 'lesson_complete_index/lesson1/test-session.json',
    })
    expect(puts).toHaveLength(0)
    expect(executionCtx.waitUntil).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/log block metadata', () => {
  it('stores answer and block completion metadata in user_state', async () => {
    const { env, executionCtx, puts } = createEnv()

    const answerRes = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('answer', {
          question_id: 'q1',
          lesson_id: 'lesson1',
          user_answer: '6',
          is_correct: true,
          time_spent_sec: 4,
          hints_used: 0,
          answered_at: '2026-05-06T00:00:01.000Z',
          block_id: 'core',
          block_type: 'core',
          block_position: 1,
          block_question_position: 1,
          optional_extra: false,
          is_retry: true,
        })),
      },
      env,
      executionCtx,
    )

    expect(answerRes.status).toBe(200)
    const answerState = String(puts.find((item) => item.key === 'user_state/test-session/latest.json')?.value)
    expect(answerState).toContain('"block_id":"core"')
    expect(answerState).toContain('"block_type":"core"')
    expect(answerState).toContain('"block_question_position":1')
    expect(answerState).toContain('"is_retry":true')

    puts.length = 0
    const blockRes = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('block_complete', {
          lesson_id: 'lesson1',
          block_id: 'extra',
          block_title: '任意追加',
          block_type: 'optional_extra',
          block_position: 2,
          optional_extra: true,
          question_count: 2,
          correct_count: 1,
          completed_at: '2026-05-06T00:03:00.000Z',
        })),
      },
      env,
      executionCtx,
    )

    expect(blockRes.status).toBe(200)
    const blockState = String(puts.find((item) => item.key === 'user_state/test-session/latest.json')?.value)
    expect(blockState).toContain('"block_type":"optional_extra"')
    expect(blockState).toContain('"block_position":2')
    expect(blockState).toContain('"optional_extra":true')
  })
})

describe('POST /api/log debug mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts debug requests without writing to R2 or Slack', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { env, executionCtx, puts, pending } = createEnv('https://hooks.slack.test/services/test')

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug': '1' },
        body: JSON.stringify(buildPayload('lesson_complete', {
          lesson_id: 'lesson1',
          lesson_title: '図形',
          subject: 'math',
          question_count: 30,
          correct_count: 30,
          attempts: 30,
          points_earned: 150,
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, debug: true })
    expect(puts).toHaveLength(0)
    expect(env.PLAY_LOG.put).not.toHaveBeenCalled()
    expect(executionCtx.waitUntil).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/log authorization', () => {
  it('rejects writes when API_WRITE_TOKEN is configured and header is missing', async () => {
    const { env, executionCtx, puts } = createEnv(undefined, 'secret-write')

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('answer', {
          question_id: 'q1',
          lesson_id: 'lesson1',
          user_answer: '6',
          is_correct: true,
          time_spent_sec: 4,
          hints_used: 0,
          answered_at: '2026-05-06T00:00:01.000Z',
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(puts).toHaveLength(0)
  })

  it('accepts writes when API_WRITE_TOKEN header matches', async () => {
    const { env, executionCtx, puts } = createEnv(undefined, 'secret-write')

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Write-Token': 'secret-write' },
        body: JSON.stringify(buildPayload('answer', {
          question_id: 'q1',
          lesson_id: 'lesson1',
          user_answer: '6',
          is_correct: true,
          time_spent_sec: 4,
          hints_used: 0,
          answered_at: '2026-05-06T00:00:01.000Z',
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    expect(puts.some((item) => item.key === 'user_state/test-session/latest.json')).toBe(true)
  })
})

describe('POST /api/log sketch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores sketch event under sketch_log without touching user state', async () => {
    const { env, executionCtx, puts, pending } = createEnv()

    const res = await app.request(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('sketch', {
          question_id: 'q1',
          lesson_id: 'lesson1',
          stroke_count: 12,
          duration_sec: 45,
          ai_category: 'ok',
          ai_comment: 'せんぶんずがかけてるね',
          comment_shown: false,
          fallback: false,
        })),
      },
      env,
      executionCtx,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })
    expect(puts).toHaveLength(1)
    expect(puts[0].key).toMatch(/^sketch_log\/2026\/05\/06\//)
    // sketch は advisory ログ専用: user_state/latest.json を更新しない
    const stateKeys = puts.filter((p) => p.key.includes('user_state'))
    expect(stateKeys).toHaveLength(0)
    expect(executionCtx.waitUntil).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
  })
})
