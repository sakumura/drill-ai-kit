// =====================================================================
// workers/src/routes/user-state.ts
//
// GET /api/user-state: R2 の user_state/{session_id}/latest.json を返す。
// X-Session-Id ヘッダが source of truth。
// =====================================================================

import { Hono } from 'hono'

type Bindings = {
  PLAY_LOG: R2Bucket
  API_READ_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

export type LessonBlockType =
  | 'warmup'
  | 'core'
  | 'weakness_spiral'
  | 'exam_transfer'
  | 'confidence_recovery'
  | 'optional_extra'

export type LegacyLessonBlockKind = 'review' | 'main' | 'spiral' | 'exam' | 'confidence'

export interface AnswerHistoryEntry {
  question_id: string
  lesson_id: string
  user_answer: string
  is_correct: boolean
  time_spent_sec: number
  hints_used: number
  answered_at: string
  step?: number
  step_label?: string
  question_type?: string
  step_purpose?: 'answer' | 'strategy' | 'formula' | 'diagram' | 'basis' | 'error_diagnosis' | 'evidence'
  misconception_tag?: string
  unit_id?: string
  difficulty?: string
  block_id?: string
  block_type?: LessonBlockType
  block_position?: number
  block_question_position?: number
  optional_extra?: boolean
  is_retry?: boolean
}

export interface LessonCompletionEntry {
  lesson_id: string
  lesson_title?: string
  subject?: 'math' | 'japanese'
  question_count?: number
  correct_count?: number
  first_correct_count?: number
  final_correct_count?: number
  rescued_count?: number
  needs_review_count?: number
  attempts?: number
  completed_at: string
}

export interface BlockCompletionEntry {
  lesson_id: string
  block_id: string
  block_title?: string
  block_kind?: LegacyLessonBlockKind
  block_type?: LessonBlockType
  block_position?: number
  optional_extra?: boolean
  question_count?: number
  correct_count?: number
  completed_at: string
}

export interface UserState {
  session_id: string
  answer_history: AnswerHistoryEntry[]
  lesson_completions: LessonCompletionEntry[]
  block_completions: BlockCompletionEntry[]
  updated_at: string
}

export function emptyUserState(session_id: string): UserState {
  return {
    session_id,
    answer_history: [],
    lesson_completions: [],
    block_completions: [],
    updated_at: new Date().toISOString(),
  }
}

function parseBlockType(value: unknown): LessonBlockType | undefined {
  return value === 'warmup' ||
    value === 'core' ||
    value === 'weakness_spiral' ||
    value === 'exam_transfer' ||
    value === 'confidence_recovery' ||
    value === 'optional_extra'
    ? value
    : undefined
}

function parseLegacyBlockKind(value: unknown): LegacyLessonBlockKind | undefined {
  return value === 'review' ||
    value === 'main' ||
    value === 'spiral' ||
    value === 'exam' ||
    value === 'confidence'
    ? value
    : undefined
}

function parseLessonCompletions(value: unknown): LessonCompletionEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row): LessonCompletionEntry | null => {
      if (!row || typeof row !== 'object') return null
      const entry = row as Record<string, unknown>
      const lesson_id = typeof entry.lesson_id === 'string' ? entry.lesson_id : ''
      const completed_at = typeof entry.completed_at === 'string' ? entry.completed_at : ''
      if (!lesson_id || !completed_at) return null
      return {
        lesson_id,
        lesson_title: typeof entry.lesson_title === 'string' ? entry.lesson_title : undefined,
        subject: entry.subject === 'math' || entry.subject === 'japanese' ? entry.subject : undefined,
        question_count: typeof entry.question_count === 'number' ? entry.question_count : undefined,
        correct_count: typeof entry.correct_count === 'number' ? entry.correct_count : undefined,
        first_correct_count: typeof entry.first_correct_count === 'number' ? entry.first_correct_count : undefined,
        final_correct_count: typeof entry.final_correct_count === 'number' ? entry.final_correct_count : undefined,
        rescued_count: typeof entry.rescued_count === 'number' ? entry.rescued_count : undefined,
        needs_review_count: typeof entry.needs_review_count === 'number' ? entry.needs_review_count : undefined,
        attempts: typeof entry.attempts === 'number' ? entry.attempts : undefined,
        completed_at,
      }
    })
    .filter((entry): entry is LessonCompletionEntry => entry !== null)
}

function parseBlockCompletions(value: unknown): BlockCompletionEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row): BlockCompletionEntry | null => {
      if (!row || typeof row !== 'object') return null
      const entry = row as Record<string, unknown>
      const lesson_id = typeof entry.lesson_id === 'string' ? entry.lesson_id : ''
      const block_id = typeof entry.block_id === 'string' ? entry.block_id : ''
      const completed_at = typeof entry.completed_at === 'string' ? entry.completed_at : ''
      if (!lesson_id || !block_id || !completed_at) return null
      return {
        lesson_id,
        block_id,
        block_title: typeof entry.block_title === 'string' ? entry.block_title : undefined,
        block_kind: parseLegacyBlockKind(entry.block_kind),
        block_type: parseBlockType(entry.block_type),
        block_position: typeof entry.block_position === 'number' ? entry.block_position : undefined,
        optional_extra: typeof entry.optional_extra === 'boolean' ? entry.optional_extra : undefined,
        question_count: typeof entry.question_count === 'number' ? entry.question_count : undefined,
        correct_count: typeof entry.correct_count === 'number' ? entry.correct_count : undefined,
        completed_at,
      }
    })
    .filter((entry): entry is BlockCompletionEntry => entry !== null)
}

// 単一学習者（この家庭の子ども1人）想定。session_id 不一致でも seed の救出データに必ずフォールバック
const SEED_SESSION_ID = 'seed-2026-04'

function isAuthorized(c: { env: Bindings; req: { header: (name: string) => string | undefined } }): boolean {
  const token = c.env.API_READ_TOKEN
  if (!token) return true
  return c.req.header('X-Read-Token') === token
}

async function loadUserState(bucket: R2Bucket, sessionId: string): Promise<UserState | null> {
  const key = `user_state/${sessionId}/latest.json`
  const obj = await bucket.get(key)
  if (!obj) return null
  try {
    const parsed = JSON.parse(await obj.text()) as UserState
    return {
      session_id: sessionId,
      answer_history: Array.isArray(parsed.answer_history) ? parsed.answer_history : [],
      lesson_completions: parseLessonCompletions(parsed.lesson_completions),
      block_completions: parseBlockCompletions(parsed.block_completions),
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function mergeBlockCompletions(
  primary: BlockCompletionEntry[],
  fallback: BlockCompletionEntry[],
): BlockCompletionEntry[] {
  const byBlock = new Map<string, BlockCompletionEntry>()
  for (const entry of [...fallback, ...primary]) {
    const key = `${entry.lesson_id}:${entry.block_id}`
    const existing = byBlock.get(key)
    if (!existing || existing.completed_at < entry.completed_at) {
      byBlock.set(key, entry)
    }
  }
  return [...byBlock.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at))
}

function mergeAnswerHistory(primary: AnswerHistoryEntry[], fallback: AnswerHistoryEntry[]): AnswerHistoryEntry[] {
  const byKey = new Map<string, AnswerHistoryEntry>()
  for (const entry of [...fallback, ...primary]) {
    byKey.set(`${entry.question_id}:${entry.step ?? 1}:${entry.answered_at}`, entry)
  }
  return [...byKey.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
}

function mergeLessonCompletions(
  primary: LessonCompletionEntry[],
  fallback: LessonCompletionEntry[],
): LessonCompletionEntry[] {
  const byLesson = new Map<string, LessonCompletionEntry>()
  for (const entry of [...fallback, ...primary]) {
    const existing = byLesson.get(entry.lesson_id)
    if (!existing || existing.completed_at < entry.completed_at) {
      byLesson.set(entry.lesson_id, entry)
    }
  }
  return [...byLesson.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at))
}

function mergeWithFallback(primary: UserState, fallback: UserState, sessionId: string): UserState {
  return {
    ...primary,
    session_id: sessionId,
    answer_history: mergeAnswerHistory(primary.answer_history, fallback.answer_history),
    lesson_completions: mergeLessonCompletions(primary.lesson_completions, fallback.lesson_completions),
    block_completions: mergeBlockCompletions(primary.block_completions, fallback.block_completions),
    updated_at: primary.updated_at > fallback.updated_at ? primary.updated_at : fallback.updated_at,
  }
}

// GET /api/user-state
// Header: X-Session-Id: <session_id>
// 1. 自セッション + seed-2026-04（D1 救出データ）を進捗履歴だけマージして返す
// 2. 自セッションが無ければ seed にフォールバックして返す
app.get('/', async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const sessionId = c.req.header('X-Session-Id')
  if (!sessionId) {
    return c.json({ ok: false, error: 'missing_session_id' }, 400)
  }
  const own = await loadUserState(c.env.PLAY_LOG, sessionId)
  if (sessionId !== SEED_SESSION_ID) {
    const seed = await loadUserState(c.env.PLAY_LOG, SEED_SESSION_ID)
    if (own && seed) return c.json(mergeWithFallback(own, seed, sessionId))
    if (own) return c.json(own)
    if (seed) return c.json({ ...seed, session_id: sessionId })
  }
  if (own) return c.json(own)
  return c.json(emptyUserState(sessionId))
})

export { app as userStateRoutes }
