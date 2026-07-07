import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const postLog = vi.fn()

vi.mock('../lib/api', () => ({
  postLog,
}))

describe('writeQueue dead-letter handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    postLog.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    vi.resetModules()
  })

  it('moves an item to dead-letter after max attempts instead of dropping it', async () => {
    postLog.mockResolvedValue({ ok: false })
    const { writeQueue } = await import('../lib/writeQueue')

    writeQueue.enqueue('answer', { question_id: 'q1' })

    for (let i = 0; i < 8; i++) {
      await writeQueue.flush()
      await vi.advanceTimersByTimeAsync(64_000)
    }

    expect(writeQueue.pending()).toHaveLength(0)
    expect(writeQueue.deadLetters()).toEqual([
      expect.objectContaining({
        type: 'answer',
        payload: { question_id: 'q1' },
        attempts: 8,
      }),
    ])
  })

  it('preserves items enqueued during in-flight postLog (lost-update race fix)', async () => {
    // 2026-05-13 修正: await postLog 中に enqueue された item が
    // 旧コードの writeQueueToStorage(items.filter(...)) で消失していた回帰検証。
    const writeQueueModule = await import('../lib/writeQueue')
    const { writeQueue } = writeQueueModule

    // item-1 の postLog を解決前に保留して、その間に外部から item-2 を enqueue
    let resolveFirst: (v: { ok: boolean }) => void = () => {}
    postLog.mockImplementationOnce(
      () => new Promise<{ ok: boolean }>((res) => { resolveFirst = res }),
    )
    postLog.mockResolvedValue({ ok: true })

    writeQueue.enqueue('answer', { qid: 'q1' })

    // flush kick → 即 postLog 呼出。in-flight 中に q2 を enqueue
    const flushP = writeQueue.flush()
    await Promise.resolve()
    writeQueue.enqueue('answer', { qid: 'q2' })

    // post-q1 が解決 → ここで旧コードは pending を [] で上書きしていた
    resolveFirst({ ok: true })
    await flushP

    // 旧コードでは q2 が失われ postLog 呼出は 1 回しかない。
    // 修正後は q1 post 後の fresh re-read で q2 を保持し、続けて q2 を post → 2 回呼出。
    expect(postLog).toHaveBeenCalledTimes(2)
    expect(postLog.mock.calls[0][1]).toEqual({ qid: 'q1' })
    expect(postLog.mock.calls[1][1]).toEqual({ qid: 'q2' })
    expect(writeQueue.pending()).toHaveLength(0)
  })

  it('moves dead letters back to pending for manual retry', async () => {
    postLog.mockResolvedValue({ ok: false })
    const { writeQueue } = await import('../lib/writeQueue')

    writeQueue.enqueue('answer', { question_id: 'q1' })
    for (let i = 0; i < 8; i++) {
      await writeQueue.flush()
      await vi.advanceTimersByTimeAsync(64_000)
    }

    postLog.mockResolvedValue({ ok: true })
    writeQueue.retryDeadLetters()

    expect(writeQueue.deadLetters()).toHaveLength(0)
    expect(writeQueue.pending()).toEqual([
      expect.objectContaining({
        type: 'answer',
        payload: { question_id: 'q1' },
        attempts: 0,
      }),
    ])

    await writeQueue.flush()
    expect(writeQueue.pending()).toHaveLength(0)
  })

  it('accepts and persists sketch type items', async () => {
    // sketch は 2026-06-11 追加の advisory ログ。type 検証 2 箇所
    // （readQueue / readDeadLetters）が落とさず保持することを確認する。
    postLog.mockResolvedValue({ ok: false })
    const { writeQueue } = await import('../lib/writeQueue')

    writeQueue.enqueue('sketch', { question_id: 'q1', stroke_count: 5 })
    expect(writeQueue.pending()).toEqual([
      expect.objectContaining({
        type: 'sketch',
        payload: { question_id: 'q1', stroke_count: 5 },
      }),
    ])

    for (let i = 0; i < 8; i++) {
      await writeQueue.flush()
      await vi.advanceTimersByTimeAsync(64_000)
    }
    expect(writeQueue.deadLetters()).toEqual([
      expect.objectContaining({ type: 'sketch' }),
    ])
  })
})
