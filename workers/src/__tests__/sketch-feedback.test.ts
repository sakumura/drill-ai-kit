import { describe, expect, it, vi } from 'vitest'
import app from '../index'

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    question_id: 'q1',
    lesson_id: 'lesson1',
    image: `data:image/png;base64,${TINY_PNG_B64}`,
    figure_hint: '横一本の線分図',
    ...overrides,
  }
}

function createEnv(aiRun: ReturnType<typeof vi.fn>, writeToken?: string) {
  return {
    PLAY_LOG: { get: vi.fn(), put: vi.fn() },
    AI: { run: aiRun },
    API_WRITE_TOKEN: writeToken,
  }
}

function promptText(aiRun: ReturnType<typeof vi.fn>) {
  const args = aiRun.mock.calls[0] as unknown[]
  const input = args[1] as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
  return input.messages[0].content[0].text ?? ''
}

async function post(env: unknown, body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    '/api/sketch-feedback',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('POST /api/sketch-feedback', () => {
  it('rejects requests when API_WRITE_TOKEN is configured and header is missing', async () => {
    const aiRun = vi.fn()
    const res = await post(createEnv(aiRun, 'secret-write'), buildBody())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' })
    expect(aiRun).not.toHaveBeenCalled()
  })

  it('accepts requests when API_WRITE_TOKEN header matches', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|せんぶんずがかけてるね！' }))
    const res = await post(createEnv(aiRun, 'secret-write'), buildBody(), { 'X-Write-Token': 'secret-write' })

    expect(res.status).toBe(200)
    expect(aiRun).toHaveBeenCalled()
  })

  it('returns ok category with comment when AI answers Y', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|せんぶんずがかけてるね、すごい！' }))
    const res = await post(createEnv(aiRun), buildBody())

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, category: 'ok', comment: 'せんぶんずがかけてるね、すごい！' })
    expect(json.fallback).toBeUndefined()
    // scout には messages + content 配列（image_url data URI）形式で渡す
    const args = aiRun.mock.calls[0] as unknown[]
    expect(args[0]).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
    const input = args[1] as { messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(input.messages[0].content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` },
    })
  })

  it('returns retry category when AI answers N', async () => {
    const aiRun = vi.fn(async () => ({ response: 'N|つぎはもんだいのずをかいてみよう！' }))
    const res = await post(createEnv(aiRun), buildBody())

    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, category: 'retry', comment: 'つぎはもんだいのずをかいてみよう！' })
  })

  it('fails open with generic comment when AI throws', async () => {
    const aiRun = vi.fn(async () => {
      throw new Error('ai down')
    })
    const res = await post(createEnv(aiRun), buildBody())

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, category: 'ok', fallback: true })
    expect(typeof json.comment).toBe('string')
  })

  it('fails open when AI response is unparsable', async () => {
    const aiRun = vi.fn(async () => ({ tool_calls: [], usage: { completion_tokens: 1 } }))
    const res = await post(createEnv(aiRun), buildBody())

    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, category: 'ok', fallback: true })
  })

  it('returns dummy response without calling AI when X-Debug is set', async () => {
    const aiRun = vi.fn()
    const res = await post(createEnv(aiRun), buildBody(), { 'X-Debug': '1' })

    const json = await res.json() as Record<string, unknown>
    expect(json).toMatchObject({ ok: true, category: 'ok', comment: '(debug)', debug: true })
    expect(aiRun).not.toHaveBeenCalled()
  })

  it.each([
    ['missing question_id', buildBody({ question_id: '' })],
    ['non-png data url', buildBody({ image: 'data:image/jpeg;base64,abcd' })],
    ['not a data url', buildBody({ image: 'https://example.com/x.png' })],
    ['oversized image', buildBody({ image: `data:image/png;base64,${'A'.repeat(280 * 1024)}` })],
  ])('rejects invalid payload: %s', async (_label, body) => {
    const aiRun = vi.fn()
    const res = await post(createEnv(aiRun), body)

    expect(res.status).toBe(400)
    expect(aiRun).not.toHaveBeenCalled()
  })


  it('uses kanji prompt when kind is kanji', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|よくかけているね！' }))
    const res = await post(createEnv(aiRun), buildBody({ kind: 'kanji', figure_hint: '森' }))

    expect(res.status).toBe(200)
    expect(promptText(aiRun)).toContain('お手本の漢字: 森')
  })

  it('uses figure prompt when kind is omitted for backward compatibility', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|せんぶんずがかけてるね！' }))
    const res = await post(createEnv(aiRun), buildBody())

    expect(res.status).toBe(200)
    expect(promptText(aiRun)).toContain('お手本の図: 横一本の線分図')
  })

  it('falls back to figure prompt and returns 200 for invalid kind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const aiRun = vi.fn(async () => ({ response: 'Y|せんぶんずがかけてるね！' }))

    const res = await post(createEnv(aiRun), buildBody({ kind: 'banana' }))

    expect(res.status).toBe(200)
    expect(promptText(aiRun)).toContain('お手本の図: 横一本の線分図')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('parses Y/N and fails open on timeout with kanji prompt', async () => {
    vi.useFakeTimers()
    try {
      const aiRunOk = vi.fn(async () => ({ response: 'N|もういちどかいてみよう！' }))
      const resOk = await post(createEnv(aiRunOk), buildBody({ kind: 'kanji', figure_hint: '森' }))
      expect(await resOk.json()).toMatchObject({ ok: true, category: 'retry', comment: 'もういちどかいてみよう！' })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const aiRunTimeout = vi.fn(() => new Promise(() => {}))
      const pending = post(createEnv(aiRunTimeout), buildBody({ kind: 'kanji', figure_hint: '森' }))
      await vi.advanceTimersByTimeAsync(5000)
      const resTimeout = await pending
      expect(resTimeout.status).toBe(200)
      expect(await resTimeout.json()).toMatchObject({ ok: true, category: 'ok', fallback: true })
      warn.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })


  it('uses answer in kanji prompt when answer is provided', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|よくかけているね！' }))
    const res = await post(createEnv(aiRun), buildBody({ kind: 'kanji', figure_hint: '『むすばれた』を漢字で書こう', answer: '結ばれた' }))

    expect(res.status).toBe(200)
    const prompt = promptText(aiRun)
    expect(prompt).toContain('お手本の漢字: 結ばれた')
    expect(prompt).toContain('問題の指示: 『むすばれた』を漢字で書こう')
  })

  it('falls back to hint in kanji prompt when answer is omitted', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|よくかけているね！' }))
    const res = await post(createEnv(aiRun), buildBody({ kind: 'kanji', figure_hint: '森' }))

    expect(res.status).toBe(200)
    expect(promptText(aiRun)).toContain('お手本の漢字: 森')
  })

  it('truncates answer to 50 characters before adding it to kanji prompt', async () => {
    const aiRun = vi.fn(async () => ({ response: 'Y|よくかけているね！' }))
    const longAnswer = '結'.repeat(60)
    const res = await post(createEnv(aiRun), buildBody({ kind: 'kanji', figure_hint: '読みだけ', answer: longAnswer }))

    expect(res.status).toBe(200)
    expect(promptText(aiRun)).toContain(`お手本の漢字: ${'結'.repeat(50)}`)
    expect(promptText(aiRun)).not.toContain('結'.repeat(51))
  })

})
