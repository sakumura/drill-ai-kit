// =====================================================================
// frontend/src/lib/writeQueue.ts
//
// R2 書き込み (POST /api/log) の永続キュー。
//
// 目的:
//   1. ネットワーク断・サーバー側 5xx でデータが消えないよう localStorage に
//      書き込み待ち行列を持つ
//   2. ページ離脱・タブクローズで送信中だったものが残る
//   3. 同期 API (`enqueue`) で楽観的更新を可能にする
//
// 仕様:
//   - localStorage キー: `pending_writes_v1`
//   - dead-letter キー: `dead_letter_writes_v1`
//   - backoff: 1s → 4s → 16s → 64s ...（指数 4 倍、上限 64s でクランプ）
//   - 最大 attempts=8 で dead-letter に退避（ユーザー操作で再送可能）
//   - flush は同時 1 つだけ実行（in-flight flag）
//   - モジュールロード時に setTimeout(0) で初回 flush を kick
//   - `online` イベントで再 flush
//
// この層は postLog() を内部依存とするだけで UI/aggregate には依存しない。
// =====================================================================

import { postLog, type LogType } from './api'

// ---------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------

export interface QueueItem {
  id: string
  type: LogType
  payload: unknown
  attempts: number
  next_retry_at: number // unix ms
}

export interface DeadLetterItem extends QueueItem {
  failed_at: string
}

const STORAGE_KEY = 'pending_writes_v1'
const DEAD_LETTER_STORAGE_KEY = 'dead_letter_writes_v1'
const MAX_ATTEMPTS = 8
const BACKOFF_BASE_MS = 1000
const BACKOFF_FACTOR = 4
const BACKOFF_MAX_MS = 64_000

// ---------------------------------------------------------------------
// localStorage I/O
// ---------------------------------------------------------------------

function readQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Array<Record<string, unknown>>)
      .map((row): QueueItem | null => {
        if (!row || typeof row !== 'object') return null
        const id = typeof row.id === 'string' ? row.id : ''
        const type = row.type as LogType
        const attempts = typeof row.attempts === 'number' ? row.attempts : 0
        const next_retry_at =
          typeof row.next_retry_at === 'number' ? row.next_retry_at : 0
        if (!id || (type !== 'answer' && type !== 'lesson_complete' && type !== 'block_complete' && type !== 'sketch')) {
          return null
        }
        return {
          id,
          type,
          payload: row.payload,
          attempts,
          next_retry_at,
        }
      })
      .filter((r): r is QueueItem => r !== null)
  } catch {
    return []
  }
}

function readDeadLetters(): DeadLetterItem[] {
  try {
    const raw = localStorage.getItem(DEAD_LETTER_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Array<Record<string, unknown>>)
      .map((row): DeadLetterItem | null => {
        if (!row || typeof row !== 'object') return null
        const id = typeof row.id === 'string' ? row.id : ''
        const type = row.type as LogType
        const attempts = typeof row.attempts === 'number' ? row.attempts : MAX_ATTEMPTS
        const next_retry_at =
          typeof row.next_retry_at === 'number' ? row.next_retry_at : 0
        const failed_at =
          typeof row.failed_at === 'string' ? row.failed_at : new Date().toISOString()
        if (!id || (type !== 'answer' && type !== 'lesson_complete' && type !== 'block_complete' && type !== 'sketch')) {
          return null
        }
        return {
          id,
          type,
          payload: row.payload,
          attempts,
          next_retry_at,
          failed_at,
        }
      })
      .filter((r): r is DeadLetterItem => r !== null)
  } catch {
    return []
  }
}

function writeQueueToStorage(items: QueueItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // quota over 等は諦め（致命的だが復旧手段なし）
  }
}

function writeDeadLettersToStorage(items: DeadLetterItem[]): void {
  try {
    localStorage.setItem(DEAD_LETTER_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // quota over 等は諦め（pending 側は既に失敗済みなので復旧手段なし）
  }
}

function moveToDeadLetter(item: QueueItem): void {
  const deadLetters = readDeadLetters()
  const failed: DeadLetterItem = {
    ...item,
    attempts: Math.max(item.attempts, MAX_ATTEMPTS),
    next_retry_at: 0,
    failed_at: new Date().toISOString(),
  }
  writeDeadLettersToStorage([...deadLetters.filter((d) => d.id !== item.id), failed])
}

function newId(): string {
  return (
    (crypto as { randomUUID?: () => string }).randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  )
}

function computeBackoff(attempts: number): number {
  // attempts=0 → 1s, 1 → 4s, 2 → 16s, 3 → 64s, それ以上は 64s でクランプ
  const ms = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempts)
  return Math.min(ms, BACKOFF_MAX_MS)
}

// ---------------------------------------------------------------------
// flush 制御
// ---------------------------------------------------------------------

let inFlight = false
let scheduledTimer: ReturnType<typeof setTimeout> | null = null
let flushRequestedWhileInFlight = false

function scheduleFlush(delayMs: number): void {
  if (typeof window === 'undefined') return
  if (inFlight) {
    flushRequestedWhileInFlight = true
    return
  }
  if (scheduledTimer) {
    clearTimeout(scheduledTimer)
  }
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null
    void flushImpl()
  }, Math.max(0, delayMs))
}

async function flushImpl(): Promise<void> {
  if (inFlight) {
    flushRequestedWhileInFlight = true
    return
  }
  inFlight = true
  try {
    // 各イテレーションで再 readQueue する（await 中に外部 enqueue で
    // 追加されたアイテムを保持するため）。
    // 過去 (2026-05-13 修正前) は loop 開始時の snapshot に対して
    // filter→writeQueueToStorage していたため、await postLog の間に enqueue
    // された item が overwrite で消失する lost-update race があった。
    while (true) {
      const items = readQueue()
      if (items.length === 0) break

      const now = Date.now()
      // 送信可能なもの（next_retry_at <= now）を先頭から1件処理。
      const item = items.find((q) => q.next_retry_at <= now)
      if (!item) {
        // すべて future retry 待ち
        break
      }

      const result = await postLog(
        item.type,
        item.payload as Record<string, unknown>,
      )

      // post 中に外部 enqueue が走ったかもしれないので必ず再 read
      const fresh = readQueue()

      if (result.ok) {
        // 成功 → queue から該当 item のみ削除
        writeQueueToStorage(fresh.filter((q) => q.id !== item.id))
        continue
      }

      // 失敗 → attempts++ + backoff 設定
      const nextAttempts = item.attempts + 1
      if (nextAttempts >= MAX_ATTEMPTS) {
        console.warn(
          `[writeQueue] moving to dead-letter after ${MAX_ATTEMPTS} attempts:`,
          item.type,
          item.id,
        )
        moveToDeadLetter({ ...item, attempts: nextAttempts })
        writeQueueToStorage(fresh.filter((q) => q.id !== item.id))
        continue
      }
      const backoff = computeBackoff(nextAttempts - 1)
      const updated: QueueItem = {
        ...item,
        attempts: nextAttempts,
        next_retry_at: Date.now() + backoff,
      }
      writeQueueToStorage(fresh.map((q) => (q.id === item.id ? updated : q)))
    }

    // 残りで future の retry が必要なら schedule
    const remaining = readQueue()
    if (remaining.length > 0) {
      const earliest = remaining
        .map((q) => q.next_retry_at)
        .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
      const delay = Math.max(0, earliest - Date.now())
      scheduleFlush(delay)
    }
  } finally {
    inFlight = false
    if (flushRequestedWhileInFlight) {
      flushRequestedWhileInFlight = false
      const remaining = readQueue()
      if (remaining.length > 0) {
        const now = Date.now()
        const earliest = remaining
          .map((q) => q.next_retry_at)
          .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
        scheduleFlush(Math.max(0, earliest - now))
      }
    }
  }
}

// ---------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------

export const writeQueue = {
  /**
   * 新規アイテムを queue に積み、即座に flush を kick する。
   * 楽観的更新を支えるため synchronous（fire-and-forget）。
   */
  enqueue(type: LogType, payload: unknown): void {
    // debug モード時は R2 への書き込みを完全に抑止（briefing pull の汚染防止）
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
      return
    }
    const item: QueueItem = {
      id: newId(),
      type,
      payload,
      attempts: 0,
      next_retry_at: 0,
    }
    const items = readQueue()
    items.push(item)
    writeQueueToStorage(items)
    scheduleFlush(0)
  },

  /**
   * 明示的に flush を起動する（テスト・初期化用）。
   * 既に in-flight なら 1 度だけ完走を待つ形になる。
   */
  flush(): Promise<void> {
    return flushImpl()
  },

  /** 現在 queue にあるアイテムのスナップショットを返す（デバッグ用） */
  pending(): QueueItem[] {
    return readQueue()
  },

  /** 最大リトライ到達後に退避された未送信ログを返す */
  deadLetters(): DeadLetterItem[] {
    return readDeadLetters()
  },

  /** dead-letter の全件を pending に戻して即時再送する */
  retryDeadLetters(): void {
    const deadLetters = readDeadLetters()
    if (deadLetters.length === 0) return
    const pending = readQueue()
    const retried = deadLetters.map((item): QueueItem => ({
      id: newId(),
      type: item.type,
      payload: item.payload,
      attempts: 0,
      next_retry_at: 0,
    }))
    writeQueueToStorage([...pending, ...retried])
    writeDeadLettersToStorage([])
    scheduleFlush(0)
  },

  /** テスト用に queue を空にする */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 無視
    }
    try {
      localStorage.removeItem(DEAD_LETTER_STORAGE_KEY)
    } catch {
      // 無視
    }
    if (scheduledTimer) {
      clearTimeout(scheduledTimer)
      scheduledTimer = null
    }
    flushRequestedWhileInFlight = false
  },
}

// ---------------------------------------------------------------------
// ブートストラップ: モジュールロード時に 1 回 flush を kick + online で再 flush
// ---------------------------------------------------------------------

if (typeof window !== 'undefined') {
  // 初回ロード（リロード後の queue 復旧）
  setTimeout(() => {
    void flushImpl()
  }, 0)

  window.addEventListener('online', () => {
    // online 復帰時は backoff を待たず即時試行
    // （失敗した item の next_retry_at が将来でも、ユーザー操作直後の試行を優先）
    const items = readQueue()
    if (items.length === 0) return
    const reset = items.map((q) => ({ ...q, next_retry_at: 0 }))
    writeQueueToStorage(reset)
    scheduleFlush(0)
  })
}
