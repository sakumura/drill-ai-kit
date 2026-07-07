// =====================================================================
// workers/src/routes/log.ts
//
// POST /api/log: イベントを R2 に記録し、user_state/latest.json を更新する。
// =====================================================================

import { Hono } from 'hono'
import {
  emptyUserState,
  type UserState,
  type AnswerHistoryEntry,
  type LessonCompletionEntry,
  type BlockCompletionEntry,
} from './user-state'

type Bindings = {
  PLAY_LOG: R2Bucket
  SLACK_WEBHOOK_URL?: string
  API_WRITE_TOKEN?: string
}

type Variables = {
  debug: boolean
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

interface LogPayload {
  type: 'answer' | 'lesson_complete' | 'block_complete' | 'sketch'
  session_id: string
  event_id: string
  occurred_at: string
  payload: Record<string, unknown>
}

const TYPE_TO_PREFIX: Record<LogPayload['type'], string> = {
  answer: 'play_log',
  lesson_complete: 'lesson_complete',
  block_complete: 'block_complete',
  sketch: 'sketch_log',
}

const SEED_SESSION_ID = 'seed-2026-04'
const ALLOWED_TIER_PURPOSES = new Set(['answer', 'strategy', 'formula', 'diagram', 'basis', 'error_diagnosis', 'evidence', 'elimination_reason', 'expression_effect'])
const BLOCK_TYPES = new Set(['warmup', 'core', 'weakness_spiral', 'exam_transfer', 'confidence_recovery', 'optional_extra'])
const LEGACY_BLOCK_KINDS = new Set(['review', 'main', 'spiral', 'exam', 'confidence'])

// briefing が JST で集計するため、key の日付パーティションも JST で切る
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function buildKey(body: LogPayload): string {
  const prefix = TYPE_TO_PREFIX[body.type]
  // R2 key 命名: <prefix>/YYYY/MM/DD/<session>-<unix_ms>-<rand8>.jsonl
  const utc = new Date(body.occurred_at)
  if (Number.isNaN(utc.getTime())) {
    throw new Error('invalid occurred_at')
  }
  const jst  = new Date(utc.getTime() + JST_OFFSET_MS)
  const yyyy = jst.getUTCFullYear().toString()
  const mm   = (jst.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd   = jst.getUTCDate().toString().padStart(2, '0')
  const ms   = Date.now().toString()
  const rand = crypto.randomUUID().slice(0, 8)
  return `${prefix}/${yyyy}/${mm}/${dd}/${body.session_id}-${ms}-${rand}.jsonl`
}

function safeKeyPart(value: unknown): string {
  const raw = typeof value === 'string' && value.length > 0 ? value : 'unknown'
  return raw.replace(/[^a-zA-Z0-9._=-]/g, '_')
}

function buildAnswerIndexKey(body: LogPayload): string | null {
  if (body.type !== 'answer') return null
  const payload = body.payload
  const lessonId = safeKeyPart(payload.lesson_id)
  const questionId = safeKeyPart(payload.question_id)
  const sessionId = safeKeyPart(body.session_id)
  const answeredAt = safeKeyPart(payload.answered_at ?? body.occurred_at)
  const step = typeof payload.step === 'number' ? payload.step : 1
  return `answer_index/${lessonId}/${sessionId}/${questionId}/step-${step}/${answeredAt}.json`
}

function buildLessonCompleteIndexKey(body: LogPayload): string | null {
  if (body.type !== 'lesson_complete') return null
  const payload = body.payload
  const lessonId = safeKeyPart(payload.lesson_id)
  const sessionId = safeKeyPart(body.session_id)
  return `lesson_complete_index/${lessonId}/${sessionId}.json`
}

function isValidPayload(x: unknown): x is LogPayload {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    (o.type === 'answer' || o.type === 'lesson_complete' || o.type === 'block_complete' || o.type === 'sketch') &&
    typeof o.session_id === 'string' && o.session_id.length > 0 &&
    typeof o.event_id === 'string' && o.event_id.length > 0 &&
    typeof o.occurred_at === 'string' && o.occurred_at.length > 0 &&
    typeof o.payload === 'object' && o.payload !== null
  )
}

function isAuthorized(c: { env: Bindings; req: { header: (name: string) => string | undefined } }): boolean {
  const token = c.env.API_WRITE_TOKEN
  if (!token) return true
  return c.req.header('X-Write-Token') === token
}

function formatLessonCompleteMessage(body: LogPayload): string {
  const payload = body.payload
  const title = typeof payload.lesson_title === 'string' ? payload.lesson_title : 'レッスン'
  const subject = payload.subject === 'japanese' ? '国語' : payload.subject === 'math' ? '算数' : '不明'
  const correct = typeof payload.correct_count === 'number' ? payload.correct_count : 0
  const total = typeof payload.question_count === 'number' ? payload.question_count : 0
  const attempts = typeof payload.attempts === 'number' ? payload.attempts : 0
  return [
    `レッスン完了: ${title}`,
    `科目: ${subject}`,
    `正解: ${correct}/${total}`,
    `回答数: ${attempts}`,
  ].join('\n')
}

async function postLessonCompleteToSlack(webhookUrl: string | undefined, body: LogPayload): Promise<void> {
  if (!webhookUrl) {
    console.warn('[lesson_complete] SLACK_WEBHOOK_URL is not configured')
    return
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatLessonCompleteMessage(body) }),
    })
    if (!res.ok) {
      console.error('[lesson_complete] Slack post failed', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[lesson_complete] Slack post failed', err)
  }
}

// =====================================================================
// user_state/latest.json の read-merge-put
// =====================================================================

async function readLatestState(bucket: R2Bucket, sessionId: string): Promise<UserState> {
  const key = `user_state/${sessionId}/latest.json`
  try {
    const obj = await bucket.get(key)
    if (!obj) return emptyUserState(sessionId)
    const text = await obj.text()
    const parsed = JSON.parse(text) as Partial<UserState>
    return {
      session_id: sessionId,
      answer_history: Array.isArray(parsed.answer_history) ? parsed.answer_history : [],
      lesson_completions: Array.isArray(parsed.lesson_completions) ? parsed.lesson_completions : [],
      block_completions: Array.isArray(parsed.block_completions) ? parsed.block_completions : [],
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date().toISOString(),
    }
  } catch {
    return emptyUserState(sessionId)
  }
}

function mergeBlockComplete(state: UserState, payload: Record<string, unknown>): UserState {
  const entry: BlockCompletionEntry = {
    lesson_id: typeof payload.lesson_id === 'string' ? payload.lesson_id : '',
    block_id: typeof payload.block_id === 'string' ? payload.block_id : '',
    block_title: typeof payload.block_title === 'string' ? payload.block_title : undefined,
    block_kind: typeof payload.block_kind === 'string' && LEGACY_BLOCK_KINDS.has(payload.block_kind)
      ? payload.block_kind as BlockCompletionEntry['block_kind']
      : undefined,
    block_type: typeof payload.block_type === 'string' && BLOCK_TYPES.has(payload.block_type)
      ? payload.block_type as BlockCompletionEntry['block_type']
      : undefined,
    block_position: typeof payload.block_position === 'number' ? payload.block_position : undefined,
    optional_extra: typeof payload.optional_extra === 'boolean' ? payload.optional_extra : undefined,
    question_count: typeof payload.question_count === 'number' ? payload.question_count : undefined,
    correct_count: typeof payload.correct_count === 'number' ? payload.correct_count : undefined,
    completed_at: typeof payload.completed_at === 'string' ? payload.completed_at : new Date().toISOString(),
  }
  if (!entry.lesson_id || !entry.block_id) return state

  const byBlock = new Map<string, BlockCompletionEntry>()
  for (const item of state.block_completions) {
    byBlock.set(`${item.lesson_id}:${item.block_id}`, item)
  }
  const key = `${entry.lesson_id}:${entry.block_id}`
  const existing = byBlock.get(key)
  if (!existing || existing.completed_at < entry.completed_at) {
    byBlock.set(key, entry)
  }

  return {
    ...state,
    block_completions: [...byBlock.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
    updated_at: new Date().toISOString(),
  }
}

function mergeAnswer(state: UserState, payload: Record<string, unknown>): UserState {
  const stepPurpose = typeof payload.step_purpose === 'string' && ALLOWED_TIER_PURPOSES.has(payload.step_purpose)
    ? payload.step_purpose as AnswerHistoryEntry['step_purpose']
    : undefined
  const entry: AnswerHistoryEntry = {
    question_id: typeof payload.question_id === 'string' ? payload.question_id : '',
    lesson_id: typeof payload.lesson_id === 'string' ? payload.lesson_id : '',
    user_answer: typeof payload.user_answer === 'string' ? payload.user_answer : '',
    is_correct: payload.is_correct === true,
    time_spent_sec: typeof payload.time_spent_sec === 'number' ? payload.time_spent_sec : 0,
    hints_used: typeof payload.hints_used === 'number' ? payload.hints_used : 0,
    answered_at: typeof payload.answered_at === 'string' ? payload.answered_at : new Date().toISOString(),
    step: typeof payload.step === 'number' ? payload.step : undefined,
    step_label: typeof payload.step_label === 'string' ? payload.step_label : undefined,
    question_type: typeof payload.question_type === 'string' ? payload.question_type : undefined,
    step_purpose: stepPurpose,
    misconception_tag: typeof payload.misconception_tag === 'string' ? payload.misconception_tag : undefined,
    unit_id: typeof payload.unit_id === 'string' ? payload.unit_id : undefined,
    difficulty: typeof payload.difficulty === 'string' ? payload.difficulty : undefined,
    block_id: typeof payload.block_id === 'string' ? payload.block_id : undefined,
    block_type: typeof payload.block_type === 'string' && BLOCK_TYPES.has(payload.block_type)
      ? payload.block_type as AnswerHistoryEntry['block_type']
      : undefined,
    block_position: typeof payload.block_position === 'number' ? payload.block_position : undefined,
    block_question_position: typeof payload.block_question_position === 'number' ? payload.block_question_position : undefined,
    optional_extra: typeof payload.optional_extra === 'boolean' ? payload.optional_extra : undefined,
    is_retry: typeof payload.is_retry === 'boolean' ? payload.is_retry : undefined,
  }
  if (!entry.question_id) return state

  // dedup: question_id + step + answered_at が同一なら skip（step なしは 1 扱い）
  const exists = state.answer_history.some(
    (a) =>
      a.question_id === entry.question_id &&
      (a.step ?? 1) === (entry.step ?? 1) &&
      a.answered_at === entry.answered_at,
  )
  if (exists) return state

  return {
    ...state,
    answer_history: [...state.answer_history, entry],
    updated_at: new Date().toISOString(),
  }
}

function mergeLessonComplete(state: UserState, payload: Record<string, unknown>): UserState {
  const entry: LessonCompletionEntry = {
    lesson_id: typeof payload.lesson_id === 'string' ? payload.lesson_id : '',
    lesson_title: typeof payload.lesson_title === 'string' ? payload.lesson_title : undefined,
    subject: payload.subject === 'math' || payload.subject === 'japanese' ? payload.subject : undefined,
    question_count: typeof payload.question_count === 'number' ? payload.question_count : undefined,
    correct_count: typeof payload.correct_count === 'number' ? payload.correct_count : undefined,
    first_correct_count: typeof payload.first_correct_count === 'number' ? payload.first_correct_count : undefined,
    final_correct_count: typeof payload.final_correct_count === 'number' ? payload.final_correct_count : undefined,
    rescued_count: typeof payload.rescued_count === 'number' ? payload.rescued_count : undefined,
    needs_review_count: typeof payload.needs_review_count === 'number' ? payload.needs_review_count : undefined,
    attempts: typeof payload.attempts === 'number' ? payload.attempts : undefined,
    completed_at: typeof payload.completed_at === 'string' ? payload.completed_at : new Date().toISOString(),
  }
  if (!entry.lesson_id) return state

  const byLesson = new Map<string, LessonCompletionEntry>()
  for (const item of state.lesson_completions) {
    byLesson.set(item.lesson_id, item)
  }
  const existing = byLesson.get(entry.lesson_id)
  if (!existing || existing.completed_at < entry.completed_at) {
    byLesson.set(entry.lesson_id, entry)
  }

  return {
    ...state,
    lesson_completions: [...byLesson.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
    updated_at: new Date().toISOString(),
  }
}

async function updateLatestState(
  bucket: R2Bucket,
  body: LogPayload,
  sessionId = body.session_id,
  maxRetry = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    try {
      const current = await readLatestState(bucket, sessionId)
      let next: UserState
      if (body.type === 'answer') {
        next = mergeAnswer(current, body.payload)
      } else if (body.type === 'lesson_complete') {
        next = mergeLessonComplete(current, body.payload)
      } else {
        // type === 'block_complete'（answer/lesson_complete/block_complete 以外ではこの関数は呼ばれない）
        next = mergeBlockComplete(current, body.payload)
      }
      const key = `user_state/${sessionId}/latest.json`
      await bucket.put(key, JSON.stringify(next), {
        httpMetadata: { contentType: 'application/json' },
      })
      return // 成功
    } catch {
      if (attempt === maxRetry - 1) {
        console.error('[updateLatestState] failed after retries')
      }
    }
  }
}

// =====================================================================
// POST /api/log
// =====================================================================

app.post('/', async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }
  if (!isValidPayload(body)) {
    return c.json({ ok: false, error: 'invalid_payload' }, 400)
  }

  let key: string
  try {
    key = buildKey(body)
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 400)
  }

  if (c.get('debug')) {
    return c.json({ ok: true, debug: true })
  }

  const line = JSON.stringify(body) + '\n'
  try {
    const answerIndexKey = buildAnswerIndexKey(body)
    if (answerIndexKey) {
      const existing = await c.env.PLAY_LOG.get(answerIndexKey)
      if (existing) {
        return c.json({ ok: true, duplicate: true, key: answerIndexKey })
      }
    }
    const lessonCompleteIndexKey = buildLessonCompleteIndexKey(body)
    if (lessonCompleteIndexKey) {
      const existing = await c.env.PLAY_LOG.get(lessonCompleteIndexKey)
      if (existing) {
        return c.json({ ok: true, duplicate: true, key: lessonCompleteIndexKey })
      }
    }
    await c.env.PLAY_LOG.put(key, line, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })
    if (answerIndexKey) {
      await c.env.PLAY_LOG.put(answerIndexKey, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
      })
    }
    if (lessonCompleteIndexKey) {
      await c.env.PLAY_LOG.put(lessonCompleteIndexKey, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
      })
    }
  } catch (err) {
    return c.json({ ok: false, error: 'storage_error', detail: (err as Error).message }, 500)
  }

  if (body.type === 'answer' || body.type === 'lesson_complete' || body.type === 'block_complete') {
    await updateLatestState(c.env.PLAY_LOG, body)
  } else if (body.type === 'sketch') {
    // sketch は advisory ログ専用。user_state/latest.json を更新しない（updated_at 汚染防止）
  }

  if (body.type === 'lesson_complete') {
    c.executionCtx.waitUntil(
      postLessonCompleteToSlack(c.env.SLACK_WEBHOOK_URL, body),
    )
  }

  return c.json({ ok: true, key })
})

export { app as logRoutes }
