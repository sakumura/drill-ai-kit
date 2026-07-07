// =====================================================================
// frontend/src/lib/api.ts
//
// D1 を全廃し、コンテンツは frontend/public/data/*.json から fetch、
// 学習ログ・状態は R2 (GET /api/user-state, POST /api/log) で扱う構成。
//
// この層は次の系統に整理されている:
//   1. 型定義（既存と互換）
//   2. JSON fetch 系（読み取り、in-memory memoization）
//   3. R2 write 系（postLog ヘルパー）
//   4. R2 read 系（GET /api/user-state 経由）
//   5. 集計系（aggregate.ts に純関数化、ここでは I/O だけ）
// =====================================================================

import { computeStats, computeMentorMessage, computeCareless, emptyAccuracyMetrics, type LocalAnswerRecord } from './aggregate'
import { getJstTodayKey } from './dates'
import { writeQueue } from './writeQueue'
import { computeLearningDashboard } from './learningDashboard'
import type { LessonAnswerHistoryLike } from './lessonScoring'

// =====================================================================
// 1. 型定義（既存 page/component から import されているのでシグネチャ維持）
// =====================================================================

export interface ConceptCard {
  title: string
  text: string
  image_hint?: string
}

// ---- 新問題形式 (2026-04-27 追加) ----
export type SlotConfig =
  | { type: 'number'; digits: number; unit?: string; correct_value?: string }
  | {
      type: 'decimal'
      digit_string: string
      valid_positions: number[]
      correct_value?: string
    }
  | {
      type: 'unit'
      fixed_value: string
      unit_options: string[]
      correct_value?: string
    }
  | {
      type: 'kanji'
      left_options: string[]
      right_options: string[]
      correct_value?: string
    }
  | {
      type: 'okurigana'
      kanji: string
      options: string[]
      correct_value?: string
    }
  | { type: 'two_tier_slot'; tier1: SlotConfig; tier2: SlotConfig }

export type TierPurpose =
  | 'answer'
  | 'strategy'
  | 'formula'
  | 'diagram'
  | 'basis'
  | 'error_diagnosis'
  | 'evidence'
  | 'elimination_reason'
  | 'expression_effect'

export interface ChoiceMeta {
  step?: number
  choice_text: string
  role: 'correct' | 'distractor'
  purpose?: TierPurpose
  misconception_tag?: string
}

export type SketchKind = 'figure' | 'kanji'

export interface Question {
  id: string
  lesson_id: string
  position: number
  question_text: string
  figure_svg: string | null
  answer: string
  answer_unit: string | null
  hints: string[] | string[][]
  solution_steps: string[]
  common_mistakes: { mistake: string; guidance: string }[]
  diag_step1: {
    question_text: string
    choices: { text: string; isCorrect: boolean }[]
    solution_steps: string[]
  } | null
  diag_step2: {
    question_text: string
    choices: { text: string; isCorrect: boolean }[]
    solution_steps: string[]
  } | null
  question_type?: string
  unit_id?: string
  difficulty?: string
  tier2_correct_index?: number
  tier1_label?: string
  tier1_purpose?: TierPurpose
  tier2_label?: string
  tier2_purpose?: TierPurpose
  choice_meta?: ChoiceMeta[]
  slot_config?: SlotConfig | null
  remediation?: Remediation | null
  // スケッチゲート: true なら選択肢表示前に指描き作図を挟む（採点には影響しない）
  sketch_gate?: boolean
  sketch_kind?: SketchKind
  // AI 判定に渡す図形種の短い説明（例: 「横一本の線分図」）
  sketch_hint?: string
}

export interface Remediation {
  same_skill_question_id?: string
  transfer_question_id?: string
  micro_explanation?: string
  pattern_id?: string
}

export type LessonBlockKind = 'review' | 'main' | 'spiral' | 'exam' | 'confidence'
export type LessonBlockType =
  | 'warmup'
  | 'core'
  | 'weakness_spiral'
  | 'exam_transfer'
  | 'confidence_recovery'
  | 'optional_extra'

export interface LessonBlock {
  id: string
  title: string
  kind?: LessonBlockKind
  block_type?: LessonBlockType
  optional_extra?: boolean
  question_ids: string[]
}

export interface ReadingPassage {
  id: string
  lesson_id: string
  position: number
  paragraph_text: string
}

export interface ReadingQuestion {
  id: string
  passage_id: string
  lesson_id: string
  position: number
  question_type: 'choice4'
  question_text: string
  choices: { text: string; isCorrect: boolean }[]
  correct_answer: string
  explanation: string | null
  difficulty_tier: number
}

export interface Lesson {
  id: string
  unit_id: string
  title: string
  concept_cards: ConceptCard[]
  tips: string[]
  difficulty: number
  grade: number
  subject: 'math' | 'japanese'
  lesson_type?: 'flash' | 'reading'
  questions: Question[]
  passages?: ReadingPassage[]
  reading_questions?: ReadingQuestion[]
  blocks?: LessonBlock[]
}

export interface AnswerRecord {
  question_id: string
  lesson_id: string
  user_answer: string
  is_correct: boolean
  time_spent_sec: number
  hints_used: number
  ai_conversation?: string
  understanding_level?: number | null
  step?: number
  step_label?: string
  question_type?: string
  step_purpose?: TierPurpose
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

export interface LessonCompletionRecord {
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
  points_earned?: number
  completed_at: string
}

export interface BlockCompletionRecord {
  lesson_id: string
  block_id: string
  block_title?: string
  block_kind?: LessonBlockKind
  block_type?: LessonBlockType
  block_position?: number
  optional_extra?: boolean
  question_count?: number
  correct_count?: number
  completed_at: string
}

export interface DiagnoseStep {
  question_text: string
  choices: { text: string; isCorrect: boolean }[]
  solution_steps: string[]
}

export interface DiagnoseResponse {
  step1: DiagnoseStep
  step2: DiagnoseStep
}

export interface MentorMessage {
  praise: string | null
  encourage: string | null
  greeting: string | null
  careless_tip: string | null
  motivator: string | null
}

export interface UnitMastery {
  unit_id: string
  understanding_pct: number
  weak_points: string[]
  mastery_level: string
  last_study_date: string | null
}

export interface AccuracyMetricSummary {
  total_units: number
  total_attempts: number
  first_attempt_correct: number
  final_correct: number
  initially_wrong: number
  rescued: number
  timeout_attempts: number
  rushing_wrong_attempts: number
  first_attempt_accuracy: number
  final_accuracy: number
  rescue_rate: number
  timeout_rate: number
  rushing_wrong_rate: number
}

export interface AccuracyMetricsResponse {
  step: AccuracyMetricSummary
  question: AccuracyMetricSummary
}

export interface StatsResponse {
  calendar: { date: string; lesson_count: number; correct_rate: number }[]
  unit_accuracy: {
    unit_id: string
    unit_name: string
    total: number
    correct: number
    accuracy: number
  }[]
  trend: { date: string; accuracy: number }[]
  total_plays: number
  streak_days: number
  unit_mastery: UnitMastery[]
  accuracy_metrics: AccuracyMetricsResponse
}

export interface CarelessResponse {
  rushing: {
    question_text: string
    time_spent_sec: number
    correct_answer: string
  }[]
  repeated: {
    question_text: string
    wrong_count: number
    correct_answer: string
  }[]
  summary: { rushing_count: number; repeated_count: number; advice: string }
}

export interface LessonSummary {
  id: string
  title: string
  unit_id: string
  unit_name: string
  subject: 'math' | 'japanese'
  difficulty: number
  grade: number
  question_count: number
  progress_count: number
  scheduled_date: string | null
  status: 'not_started' | 'in_progress' | 'completed'
  meta_reviewed_at?: string | null
  parent_approved_at?: string | null
}

export type ReviewQueueReason = 'recent_wrong' | 'repeated_wrong' | 'slow_correct'

export interface ReviewQueueItem {
  question_id: string
  lesson_id: string
  lesson_title: string
  unit_id: string
  unit_name: string
  subject: 'math' | 'japanese'
  reason: ReviewQueueReason
  reason_label: string
  wrong_count: number
  last_answered_at: string
  time_spent_sec: number
}

export interface ReviewQueueResponse {
  subject: 'math' | 'japanese'
  items: ReviewQueueItem[]
}

export type LearningSignal =
  | 'concept_gap'
  | 'procedure_gap'
  | 'reading_load'
  | 'careless_or_tap_noise'
  | 'fatigue_throwaway'
  | 'question_quality_bug'

export type RecommendedIntervention =
  | 'concept_contrast'
  | 'process_scaffold'
  | 'short_reading_evidence'
  | 'slow_confirm'
  | 'rest_or_short_block'
  | 'fix_question'
  | 'maintain'

export interface LearningProfileWeakness {
  pattern_id: string
  subject: 'math' | 'japanese'
  score: number
  severity: string
  name?: string
  last_test_result?: string | null
  next_question_type?: string | null
  learning_signal?: LearningSignal | null
  signal_confidence?: number | null
  recommended_intervention?: RecommendedIntervention | null
  recent_valid_accuracy?: number | null
  recent_fast_wrong_rate?: number | null
  recent_late_drop_rate?: number | null
}

export interface LearningProfile {
  version: number
  last_updated: string
  signal_profile_generated_at?: string | null
  weaknesses: LearningProfileWeakness[]
}

export type LearningDashboardStatus = 'maintain' | 'review' | 'unfixed' | 'needs_exam_format'

export interface LearningDashboardRow {
  weakness_id: string
  weakness_name: string
  subject: 'math' | 'japanese'
  app_practice_count: number
  first_attempt_accuracy: number
  final_accuracy: number
  transfer_accuracy: number | null
  latest_test_result: string | null
  status: LearningDashboardStatus
  status_label: string
  next_question_type: string
  score: number
  severity: string
}

export interface LearningDashboardResponse {
  rows: LearningDashboardRow[]
  summary: {
    total_weaknesses: number
    practiced_weaknesses: number
    exam_gap_count: number
    unfixed_count: number
  }
}

export interface AnswerSaveResponse {
  ids?: string[]
  count?: number
  status?: string
}

// JSON ファイル特有の補助型（api 層内部で使う）
interface UnitRow {
  id: string
  name: string
  description?: string
  grade: number
  sort_order?: number
  subject: 'math' | 'japanese'
}

interface ScheduleRow {
  id: string
  date: string
  lesson_id: string
  status: 'pending' | 'completed' | 'in_progress' | string
  meta_reviewed_at: string | null
  parent_approved_at: string | null
}

interface MotivatorRow {
  id: string
  date: string
  message: string
  created_at?: string
}

// lessons.json の生レコード（subject/scheduled_date は派生で埋める）
interface LessonRaw extends Omit<Lesson, 'subject' | 'lesson_type'> {
  subject?: 'math' | 'japanese'
  lesson_type?: 'flash' | 'reading' | string | null
  archived?: number | boolean | null
  sort_order?: number
  created_at?: string
}

// =====================================================================
// R2 user_state 型（Workers 側の UserState と対応）
// =====================================================================

interface AnswerHistoryEntry {
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
  step_purpose?: TierPurpose
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

interface UserState {
  session_id: string
  answer_history: AnswerHistoryEntry[]
  lesson_completions?: LessonCompletionRecord[]
  block_completions?: BlockCompletionRecord[]
  updated_at: string
}

function emptyUserState(sessionId: string): UserState {
  return {
    session_id: sessionId,
    answer_history: [],
    lesson_completions: [],
    block_completions: [],
    updated_at: new Date().toISOString(),
  }
}

// =====================================================================
// 2. 共通: API base / debug / Error
// =====================================================================

const BASE = import.meta.env.VITE_API_BASE || '/api'

export function isDebugMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('debug')
}

export class ApiError extends Error {
  status: number
  code?: string
  body?: unknown
  constructor(status: number, statusText: string, body?: unknown) {
    const bodyObj = body as { error?: string } | undefined
    const code = bodyObj?.error
    super(code ? `API error: ${code}` : `API error: ${status} ${statusText}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

// =====================================================================
// 3. JSON fetch 系（読み取り・モジュールスコープ memoization）
// =====================================================================

const jsonCache = new Map<string, Promise<unknown>>()

export async function loadJsonData<T>(name: string): Promise<T> {
  const cached = jsonCache.get(name) as Promise<T> | undefined
  if (cached) return cached

  const promise = (async () => {
    const res = await fetch(`/data/${name}.json`, { cache: 'no-cache' })
    if (!res.ok) {
      jsonCache.delete(name)
      throw new ApiError(res.status, res.statusText)
    }
    return (await res.json()) as T
  })()

  jsonCache.set(name, promise as Promise<unknown>)
  promise.catch(() => jsonCache.delete(name))
  return promise
}

export function _clearJsonCache(): void {
  jsonCache.clear()
}

// ---------- JSON 補助 ----------

function jstTodayStr(): string {
  return getJstTodayKey()
}

function isApproved(s: ScheduleRow): boolean {
  return Boolean(s.meta_reviewed_at) && Boolean(s.parent_approved_at)
}

function buildUnitMap(units: UnitRow[]): Map<string, UnitRow> {
  return new Map(units.map((u) => [u.id, u]))
}

function deriveLesson(raw: LessonRaw, unitMap: Map<string, UnitRow>): Lesson {
  const unit = unitMap.get(raw.unit_id)
  const subject: 'math' | 'japanese' = raw.subject ?? unit?.subject ?? 'math'
  const lesson_type = raw.lesson_type === 'reading' || raw.lesson_type === 'flash' ? raw.lesson_type : undefined
  return {
    id: raw.id,
    unit_id: raw.unit_id,
    title: raw.title,
    concept_cards: raw.concept_cards ?? [],
    tips: raw.tips ?? [],
    difficulty: raw.difficulty,
    grade: raw.grade,
    subject,
    lesson_type,
    questions: raw.questions ?? [],
    passages: raw.passages ?? [],
    reading_questions: raw.reading_questions ?? [],
    blocks: raw.blocks ?? [],
  }
}

function reviewLessonId(subject: 'math' | 'japanese'): string {
  return `review-${subject}`
}

function reviewLessonTitle(subject: 'math' | 'japanese'): string {
  return subject === 'math' ? '今日の5問復習（算数）' : '今日の5問復習（国語）'
}

function isReviewLessonId(id: string): id is 'review-math' | 'review-japanese' {
  return id === 'review-math' || id === 'review-japanese'
}

function reviewSubjectFromLessonId(id: 'review-math' | 'review-japanese'): 'math' | 'japanese' {
  return id === 'review-math' ? 'math' : 'japanese'
}

async function loadAllLessonsRaw(): Promise<{
  lessons: LessonRaw[]
  units: UnitRow[]
  schedule: ScheduleRow[]
  unitMap: Map<string, UnitRow>
}> {
  const [lessons, units, schedule] = await Promise.all([loadJsonData<LessonRaw[]>('lessons'), loadJsonData<UnitRow[]>('units'), loadJsonData<ScheduleRow[]>('schedule')])
  return { lessons, units, schedule, unitMap: buildUnitMap(units) }
}

// =====================================================================
// 4. R2 write 系（POST /api/log）
// =====================================================================

const SESSION_ID_KEY = 'session_id'
const API_WRITE_TOKEN = import.meta.env.VITE_API_WRITE_TOKEN as string | undefined
const API_READ_TOKEN = import.meta.env.VITE_API_READ_TOKEN as string | undefined

function getOrCreateSessionId(): string {
  try {
    const cur = localStorage.getItem(SESSION_ID_KEY)
    if (cur) return cur
    const id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(SESSION_ID_KEY, id)
    return id
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

function newEventId(): string {
  return (crypto as { randomUUID?: () => string }).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export type LogType = 'answer' | 'lesson_complete' | 'block_complete' | 'sketch'

export interface PostLogResult {
  ok: boolean
  key?: string
}

export async function postLog(type: LogType, payload: Record<string, unknown>): Promise<PostLogResult> {
  const body = {
    type,
    session_id: getOrCreateSessionId(),
    event_id: newEventId(),
    occurred_at: new Date().toISOString(),
    payload,
  }
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (API_WRITE_TOKEN) headers['X-Write-Token'] = API_WRITE_TOKEN
    if (isDebugMode()) headers['X-Debug'] = '1'
    const res = await fetch(`${BASE}/log`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      return { ok: false }
    }
    let key: string | undefined
    try {
      const json = (await res.json()) as { key?: string }
      key = json?.key
    } catch {
      // 空 body / non-JSON は許容
    }
    return { ok: true, key }
  } catch (e) {
    console.error('[postLog] failed:', e)
    return { ok: false }
  }
}

// =====================================================================
// 4.5 スケッチゲート（POST /api/sketch-feedback + sketch イベントログ）
// =====================================================================

export interface SketchFeedbackResult {
  category: 'ok' | 'retry'
  comment: string
  fallback?: boolean
}

const SKETCH_FEEDBACK_FALLBACK: SketchFeedbackResult = {
  category: 'ok',
  comment: 'ずをかいてくれてありがとう！そのちょうしだよ！',
  fallback: true,
}

/**
 * スケッチ画像を Workers AI に advisory 判定させる。
 * fail-open: ネットワーク/サーバー異常時は固定の励ましコメントを返し、
 * 呼び出し側のレッスン進行を一切ブロックしない（throw しない）。
 */
export async function requestSketchFeedback(req: {
  question_id: string
  lesson_id: string
  image: string
  figure_hint: string
  kind?: SketchKind
  answer?: string
}): Promise<SketchFeedbackResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (API_WRITE_TOKEN) headers['X-Write-Token'] = API_WRITE_TOKEN
    if (isDebugMode()) headers['X-Debug'] = '1'
    const res = await fetch(`${BASE}/sketch-feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    })
    if (!res.ok) return SKETCH_FEEDBACK_FALLBACK
    const json = (await res.json()) as Record<string, unknown>
    if (
      json?.ok === true &&
      (json.category === 'ok' || json.category === 'retry') &&
      typeof json.comment === 'string' && json.comment.length > 0
    ) {
      return {
        category: json.category,
        comment: json.comment,
        fallback: json.fallback === true,
      }
    }
    return SKETCH_FEEDBACK_FALLBACK
  } catch {
    return SKETCH_FEEDBACK_FALLBACK
  }
}

/**
 * sketch イベントを R2 に記録する。即時送信を試み、失敗時の再キューでは
 * image_b64 を落としてメタデータのみ enqueue する（localStorage quota 保護。
 * 画像はシャドー検証用の付加情報であり、学習シグナル本体ではないため欠落許容）。
 */
export async function saveSketchLog(payload: Record<string, unknown> & { kind?: SketchKind }): Promise<void> {
  const result = await postLog('sketch', payload)
  if (!result.ok) {
    const { image_b64: _dropped, ...metadataOnly } = payload
    writeQueue.enqueue('sketch', metadataOnly)
  }
}

// =====================================================================
// 5. R2 read 系（GET /api/user-state）
// =====================================================================

let userStateCache: UserState | null = null

/**
 * R2 の user_state/{session_id}/latest.json を取得する。
 * モジュールスコープでキャッシュし、同一セッション内での重複 fetch を避ける。
 * ネットワーク失敗時は空の UserState を返す（throw しない）。
 */
async function fetchUserState(): Promise<UserState> {
  if (userStateCache !== null) return userStateCache
  const sessionId = getOrCreateSessionId()
  try {
    const headers: Record<string, string> = {
      'X-Session-Id': sessionId,
    }
    if (API_READ_TOKEN) headers['X-Read-Token'] = API_READ_TOKEN
    if (isDebugMode()) headers['X-Debug'] = '1'
    const res = await fetch(`${BASE}/user-state`, { headers })
    if (!res.ok) {
      return emptyUserState(sessionId)
    }
    const parsed = (await res.json()) as UserState
    userStateCache = parsed
    return parsed
  } catch {
    return emptyUserState(sessionId)
  }
}

/**
 * user_state キャッシュを破棄する。
 * writeQueue の flush 完了後など、R2 側が更新された可能性があるときに呼ぶ。
 */
export function invalidateUserStateCache(): void {
  userStateCache = null
}

/**
 * UserState の answer_history を LocalAnswerRecord[] に変換する。
 */
function userStateToLocalAnswers(state: UserState): LocalAnswerRecord[] {
  return state.answer_history.map(
    (a): LocalAnswerRecord => ({
      question_id: a.question_id,
      lesson_id: a.lesson_id,
      user_answer: a.user_answer,
      is_correct: a.is_correct,
      time_spent_sec: a.time_spent_sec,
      hints_used: a.hints_used,
      answered_at: a.answered_at,
      step: a.step,
      step_label: a.step_label,
      question_type: a.question_type,
      step_purpose: a.step_purpose,
      misconception_tag: a.misconception_tag,
      unit_id: a.unit_id,
      difficulty: a.difficulty,
      is_retry: a.is_retry,
    }),
  )
}

function isAnswerHistoryEntry(value: unknown): value is AnswerHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.question_id === 'string' &&
    typeof row.lesson_id === 'string' &&
    typeof row.user_answer === 'string' &&
    typeof row.is_correct === 'boolean' &&
    typeof row.time_spent_sec === 'number' &&
    typeof row.hints_used === 'number' &&
    typeof row.answered_at === 'string'
  )
}

function pendingAnswerHistory(): AnswerHistoryEntry[] {
  return writeQueue
    .pending()
    .filter((item) => item.type === 'answer')
    .map((item) => item.payload)
    .filter(isAnswerHistoryEntry)
}

function isLessonCompletionRecord(value: unknown): value is LessonCompletionRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.lesson_id === 'string' && typeof row.completed_at === 'string'
}

function pendingLessonCompletions(): LessonCompletionRecord[] {
  return writeQueue
    .pending()
    .filter((item) => item.type === 'lesson_complete')
    .map((item) => item.payload)
    .filter(isLessonCompletionRecord)
}

function mergeAnswerHistory(current: AnswerHistoryEntry[], incoming: AnswerHistoryEntry[]): AnswerHistoryEntry[] {
  const byKey = new Map<string, AnswerHistoryEntry>()
  for (const entry of [...current, ...incoming]) {
    byKey.set(`${entry.question_id}:${entry.step ?? 1}:${entry.answered_at}`, entry)
  }
  return [...byKey.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
}

function mergeLessonCompletions(
  current: LessonCompletionRecord[] | undefined,
  incoming: LessonCompletionRecord[],
): LessonCompletionRecord[] {
  const byLesson = new Map<string, LessonCompletionRecord>()
  for (const entry of [...(current ?? []), ...incoming]) {
    const existing = byLesson.get(entry.lesson_id)
    if (!existing || existing.completed_at < entry.completed_at) {
      byLesson.set(entry.lesson_id, entry)
    }
  }
  return [...byLesson.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at))
}

function expectedStepCount(question: Pick<Question, 'question_type'>): number {
  const qType = question.question_type ?? 'single_tier'
  return qType === 'two_tier' || qType === 'evidence_first' || qType === 'slot_two_tier' ? 2 : 1
}

function regularFlashQuestions(raw: LessonRaw): Question[] {
  const optionalQuestionIds = new Set<string>()
  for (const block of raw.blocks ?? []) {
    if (block.optional_extra === true || block.block_type === 'optional_extra') {
      for (const id of block.question_ids) optionalQuestionIds.add(id)
    }
  }
  return (raw.questions ?? []).filter((question) => !optionalQuestionIds.has(question.id))
}

function attemptedFlashQuestionIds(questions: Question[] | undefined, answers: AnswerHistoryEntry[]): Set<string> {
  const questionIds = new Set((questions ?? []).map((question) => question.id))
  const attempted = new Set<string>()
  for (const answer of answers) {
    if (questionIds.has(answer.question_id)) attempted.add(answer.question_id)
  }
  return attempted
}

function finalCorrectFlashQuestionIds(questions: Question[] | undefined, answers: AnswerHistoryEntry[]): Set<string> {
  const byQuestion = new Map<string, { correctSteps: Set<number> }>()
  for (const answer of answers) {
    if (!answer.is_correct) continue
    const bucket = byQuestion.get(answer.question_id) ?? {
      correctSteps: new Set<number>(),
    }
    bucket.correctSteps.add(answer.step ?? 1)
    byQuestion.set(answer.question_id, bucket)
  }

  const completed = new Set<string>()
  for (const question of questions ?? []) {
    const bucket = byQuestion.get(question.id)
    if (!bucket) continue
    if (bucket.correctSteps.size >= expectedStepCount(question)) {
      completed.add(question.id)
    }
  }
  return completed
}

function computeLessonProgress(raw: LessonRaw, answers: AnswerHistoryEntry[]): number {
  const flashCount = attemptedFlashQuestionIds(regularFlashQuestions(raw), answers).size
  const readingQuestionIds = new Set((raw.reading_questions ?? []).map((q) => q.id))
  let readingCount = 0
  for (const id of readingQuestionIds) {
    if (answers.some((a) => a.question_id === id && a.lesson_id === raw.id)) {
      readingCount += 1
    }
  }
  return flashCount + readingCount
}

function computeLessonFinalCorrectCount(raw: LessonRaw, answers: AnswerHistoryEntry[]): number {
  const flashCount = finalCorrectFlashQuestionIds(regularFlashQuestions(raw), answers).size
  const readingQuestionIds = new Set((raw.reading_questions ?? []).map((q) => q.id))
  let readingCount = 0
  for (const id of readingQuestionIds) {
    if (answers.some((a) => a.question_id === id && a.lesson_id === raw.id && a.is_correct)) {
      readingCount += 1
    }
  }
  return flashCount + readingCount
}

function applyOptimisticAnswers(answers: AnswerHistoryEntry[]): void {
  if (answers.length === 0) return
  const sessionId = getOrCreateSessionId()
  const base = userStateCache ?? emptyUserState(sessionId)
  userStateCache = {
    ...base,
    answer_history: mergeAnswerHistory(base.answer_history, answers),
    updated_at: new Date().toISOString(),
  }
}

function applyOptimisticLessonCompletion(completion: LessonCompletionRecord): void {
  const sessionId = getOrCreateSessionId()
  const base = userStateCache ?? emptyUserState(sessionId)
  userStateCache = {
    ...base,
    lesson_completions: mergeLessonCompletions(base.lesson_completions, [completion]),
    updated_at: new Date().toISOString(),
  }
}

function applyOptimisticBlockCompletion(completion: BlockCompletionRecord): void {
  const sessionId = getOrCreateSessionId()
  const base = userStateCache ?? emptyUserState(sessionId)
  const current = base.block_completions ?? []
  const byKey = new Map<string, BlockCompletionRecord>()
  for (const entry of [...current, completion]) {
    const key = `${entry.lesson_id}:${entry.block_id}`
    const existing = byKey.get(key)
    if (!existing || existing.completed_at < entry.completed_at) {
      byKey.set(key, entry)
    }
  }
  userStateCache = {
    ...base,
    block_completions: [...byKey.values()].sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
    updated_at: new Date().toISOString(),
  }
}

function slowThresholdSec(subject: 'math' | 'japanese'): number {
  return subject === 'math' ? 45 : 20
}

function reviewReasonLabel(reason: ReviewQueueReason): string {
  if (reason === 'recent_wrong') return '直近でまちがえた問題'
  if (reason === 'repeated_wrong') return 'くり返しまちがえた問題'
  return '正解したけれど時間がかかった問題'
}

function buildReviewLesson(
  subject: 'math' | 'japanese',
  queue: ReviewQueueResponse,
  lessons: LessonRaw[],
  unitMap: Map<string, UnitRow>,
): Lesson {
  const reviewId = reviewLessonId(subject)
  const questionIds = new Set(queue.items.map((item) => item.question_id))
  const questions: Question[] = []
  for (const raw of lessons) {
    const lesson = deriveLesson(raw, unitMap)
    if (lesson.subject !== subject) continue
    for (const question of lesson.questions ?? []) {
      if (questionIds.has(question.id)) questions.push({ ...question, lesson_id: reviewId })
    }
  }

  return {
    id: reviewId,
    unit_id: `${subject}-review`,
    title: reviewLessonTitle(subject),
    concept_cards: [],
    tips: ['今日やるべき復習を5問だけ集めました。'],
    difficulty: 3,
    grade: 5,
    subject,
    lesson_type: 'flash',
    questions: queue.items
      .map((item) => questions.find((question) => question.id === item.question_id))
      .filter((question): question is Question => Boolean(question)),
    passages: [],
    reading_questions: [],
  }
}

function selectReviewQueue(
  subject: 'math' | 'japanese',
  lessons: LessonRaw[],
  unitMap: Map<string, UnitRow>,
  answerHistory: AnswerHistoryEntry[],
): ReviewQueueResponse {
  // MVP scope: review queues only target flash questions. Reading questions need
  // passage context and a reading-mode review lesson, so they are intentionally
  // excluded until that flow is implemented.
  const questionMeta = new Map<string, { lesson: Lesson; unit: UnitRow | undefined }>()
  for (const raw of lessons) {
    if (raw.archived === true) continue
    const lesson = deriveLesson(raw, unitMap)
    if (lesson.subject !== subject) continue
    const unit = unitMap.get(lesson.unit_id)
    for (const question of lesson.questions ?? []) {
      questionMeta.set(question.id, { lesson, unit })
    }
  }

  const answersByQuestion = new Map<string, AnswerHistoryEntry[]>()
  for (const answer of answerHistory) {
    if (!questionMeta.has(answer.question_id)) continue
    const bucket = answersByQuestion.get(answer.question_id) ?? []
    bucket.push(answer)
    answersByQuestion.set(answer.question_id, bucket)
  }

  const candidates = Array.from(answersByQuestion.entries())
    .map(([questionId, answers]) => {
      const meta = questionMeta.get(questionId)
      if (!meta) return null
      const sorted = [...answers].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
      const last = sorted[sorted.length - 1]
      const wrongCount = sorted.filter((answer) => !answer.is_correct).length
      const isSlowCorrect = last.is_correct && last.time_spent_sec >= slowThresholdSec(subject)
      if (last.is_correct && wrongCount < 2 && !isSlowCorrect) return null

      const reason: ReviewQueueReason = !last.is_correct
        ? 'recent_wrong'
        : wrongCount >= 2
          ? 'repeated_wrong'
          : 'slow_correct'
      const recency = Date.parse(last.answered_at) || 0
      const score =
        (!last.is_correct ? 1_000_000 : 0) +
        wrongCount * 10_000 +
        (isSlowCorrect ? 1_000 + last.time_spent_sec : 0) +
        recency / 1_000_000_000

      return {
        item: {
          question_id: questionId,
          lesson_id: meta.lesson.id,
          lesson_title: meta.lesson.title,
          unit_id: meta.lesson.unit_id,
          unit_name: meta.unit?.name ?? meta.lesson.unit_id,
          subject,
          reason,
          reason_label: reviewReasonLabel(reason),
          wrong_count: wrongCount,
          last_answered_at: last.answered_at,
          time_spent_sec: last.time_spent_sec,
        } satisfies ReviewQueueItem,
        score,
      }
    })
    .filter((candidate): candidate is { item: ReviewQueueItem; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score)

  return {
    subject,
    items: candidates.slice(0, 5).map((candidate) => candidate.item),
  }
}

// =====================================================================
// 6. api 公開 API（既存シグネチャ互換）
// =====================================================================

export const api = {
  // ---------- Lesson 取得（JSON 化） ----------

  getTodayLesson: async (): Promise<Lesson> => {
    const { lessons, schedule, unitMap } = await loadAllLessonsRaw()
    const today = jstTodayStr()
    const todays = schedule.filter((s) => s.date === today && isApproved(s))
    if (todays.length === 0) {
      throw new ApiError(404, 'no lesson scheduled for today')
    }
    for (const s of todays) {
      const raw = lessons.find((l) => l.id === s.lesson_id)
      if (raw) return deriveLesson(raw, unitMap)
    }
    throw new ApiError(404, 'lesson not found in lessons.json')
  },

  getAllLessons: async (subject?: 'math' | 'japanese'): Promise<LessonSummary[]> => {
    const { lessons, schedule, unitMap } = await loadAllLessonsRaw()
    const state = await fetchUserState()
    const answerHistory = mergeAnswerHistory(state.answer_history, pendingAnswerHistory())
    const lessonCompletions = mergeLessonCompletions(state.lesson_completions, pendingLessonCompletions())
    const completedLessonIds = new Set(lessonCompletions.map((entry) => entry.lesson_id))

    const scheduleByLesson = new Map<string, ScheduleRow>()
    for (const s of schedule) {
      scheduleByLesson.set(s.lesson_id, s)
    }

    // archived: true の lesson は HomePage から非表示（stats 集計用には残す）
    const visibleLessons = lessons.filter((raw) => raw.archived !== true)

    const summaries: LessonSummary[] = visibleLessons.map((raw) => {
      const unit = unitMap.get(raw.unit_id)
      const lessonSubject: 'math' | 'japanese' = raw.subject ?? unit?.subject ?? 'math'
      const sch = scheduleByLesson.get(raw.id)
      const questionCount = regularFlashQuestions(raw).length + (raw.reading_questions?.length ?? 0)
      const lessonAnswers = answerHistory.filter((a) => a.lesson_id === raw.id)
      const computedProgress = Math.min(questionCount, computeLessonProgress(raw, lessonAnswers))
      const computedFinalCorrect = Math.min(questionCount, computeLessonFinalCorrectCount(raw, lessonAnswers))
      const completedByLog = completedLessonIds.has(raw.id)
      const completedByAnswers = questionCount > 0 && computedFinalCorrect >= questionCount
      const progressCount =
        completedByLog && computedProgress === 0
          ? questionCount
          : computedProgress
      const status: LessonSummary['status'] =
        completedByLog || completedByAnswers
          ? 'completed'
          : progressCount > 0 || sch?.status === 'in_progress' || sch?.status === 'completed'
            ? 'in_progress'
            : 'not_started'
      return {
        id: raw.id,
        title: raw.title,
        unit_id: raw.unit_id,
        unit_name: unit?.name ?? raw.unit_id,
        subject: lessonSubject,
        difficulty: raw.difficulty,
        grade: raw.grade,
        question_count: questionCount,
        progress_count: progressCount,
        scheduled_date: sch?.date ?? null,
        status,
        meta_reviewed_at: sch?.meta_reviewed_at ?? null,
        parent_approved_at: sch?.parent_approved_at ?? null,
      }
    })

    return subject ? summaries.filter((s) => s.subject === subject) : summaries
  },

  getLesson: async (id: string): Promise<Lesson> => {
    const { lessons, unitMap } = await loadAllLessonsRaw()
    if (isReviewLessonId(id)) {
      const subject = reviewSubjectFromLessonId(id)
      const queue = await api.getReviewQueue(subject)
      return buildReviewLesson(subject, queue, lessons, unitMap)
    }
    const raw = lessons.find((l) => l.id === id)
    if (!raw) {
      throw new ApiError(404, `lesson not found: ${id}`)
    }
    return deriveLesson(raw, unitMap)
  },

  getReviewQueue: async (subject: 'math' | 'japanese'): Promise<ReviewQueueResponse> => {
    try {
      const [rawData, state] = await Promise.all([loadAllLessonsRaw(), fetchUserState()])
      const answerHistory = mergeAnswerHistory(state.answer_history, pendingAnswerHistory())
      return selectReviewQueue(subject, rawData.lessons, rawData.unitMap, answerHistory)
    } catch (err) {
      console.error('[getReviewQueue] failed:', err)
      return { subject, items: [] }
    }
  },

  /**
   * lesson 単位の解答結果を R2 user_state から取得する。
   */
  getLessonResults: async (id: string): Promise<LessonAnswerHistoryLike[]> => {
    const state = await fetchUserState()
    const answerHistory = mergeAnswerHistory(state.answer_history, pendingAnswerHistory())
    return answerHistory
      .filter((a) => a.lesson_id === id)
      .map((a) => {
        const result: LessonAnswerHistoryLike = {
          question_id: a.question_id,
          is_correct: a.is_correct ? 1 : 0,
          user_answer: a.user_answer,
          time_spent_sec: a.time_spent_sec,
          answered_at: a.answered_at,
        }
        if (a.step !== undefined) result.step = a.step
        if (a.step_label !== undefined) result.step_label = a.step_label
        return result
      })
  },

  hasLessonCompletion: async (id: string): Promise<boolean> => {
    const state = await fetchUserState()
    const lessonCompletions = mergeLessonCompletions(state.lesson_completions, pendingLessonCompletions())
    return lessonCompletions.some((entry) => entry.lesson_id === id)
  },

  // ---------- 解答送信（R2 write） ----------

  saveAnswers: async (answers: AnswerRecord[]): Promise<AnswerSaveResponse> => {
    if (!Array.isArray(answers) || answers.length === 0) {
      return { ids: [], count: 0, status: 'ok' }
    }
    const now = new Date().toISOString()

    // R2 書き込みは writeQueue へ（楽観的、失敗しても queue が retry）
    const optimisticAnswers: AnswerHistoryEntry[] = []
    for (const a of answers) {
      const entry = { ...a, answered_at: now }
      writeQueue.enqueue('answer', entry)
      optimisticAnswers.push(entry)
    }

    // R2 反映前に画面を戻っても「つづきから」が即時に効くよう、同一タブでは楽観反映する。
    applyOptimisticAnswers(optimisticAnswers)

    // 採点 UI を /api/log の応答待ちにしない。送信は writeQueue が即時 kick し、
    // 失敗時は pending_writes_v1 に残って次回起動/online で再送される。

    return {
      ids: [],
      count: answers.length,
      status: 'ok',
    }
  },

  saveAnswerRealtime: (answer: AnswerRecord): Promise<void> => {
    return api
      .saveAnswers([answer])
      .then(() => undefined)
      .catch((e) => {
        console.error('[save] failed:', e)
      })
  },

  saveLessonComplete: async (payload: {
    lesson_id: string
    lesson_title: string
    subject: 'math' | 'japanese'
    question_count: number
    correct_count: number
    first_correct_count?: number
    final_correct_count?: number
    rescued_count?: number
    needs_review_count?: number
    attempts: number
  }): Promise<boolean> => {
    const completedAt = new Date().toISOString()
    const completion = {
      ...payload,
      completed_at: completedAt,
    }
    writeQueue.enqueue('lesson_complete', completion)
    applyOptimisticLessonCompletion(completion)
    await writeQueue.flush()
    return !writeQueue
      .pending()
      .some((item) => item.type === 'lesson_complete' && (item.payload as Record<string, unknown>).completed_at === completedAt)
  },

  saveBlockComplete: async (payload: {
    lesson_id: string
    block_id: string
    block_title?: string
    block_kind?: LessonBlockKind
    block_type?: LessonBlockType
    block_position?: number
    optional_extra?: boolean
    question_count: number
    correct_count: number
  }): Promise<boolean> => {
    const completedAt = new Date().toISOString()
    const completion = {
      ...payload,
      completed_at: completedAt,
    }
    writeQueue.enqueue('block_complete', completion)
    applyOptimisticBlockCompletion(completion)
    await writeQueue.flush()
    return !writeQueue
      .pending()
      .some((item) => item.type === 'block_complete' && (item.payload as Record<string, unknown>).completed_at === completedAt)
  },


  // ---------- 集計系（R2 user_state から LocalAnswerRecord[] を取得して aggregate.ts に委譲） ----------

  getMentorMessage: async (): Promise<MentorMessage> => {
    const [lessonsRes, motivatorRes, stateRes] = await Promise.allSettled([loadAllLessonsRaw(), loadJsonData<MotivatorRow[]>('motivator'), fetchUserState()])
    const lessons: Lesson[] = lessonsRes.status === 'fulfilled' ? lessonsRes.value.lessons.map((raw) => deriveLesson(raw, lessonsRes.value.unitMap)) : []
    const motivatorRows: MotivatorRow[] = motivatorRes.status === 'fulfilled' ? motivatorRes.value : []
    const state: UserState = stateRes.status === 'fulfilled' ? stateRes.value : emptyUserState(getOrCreateSessionId())

    return computeMentorMessage(userStateToLocalAnswers(state), motivatorRows, lessons)
  },

  getStats: async (): Promise<StatsResponse> => {
    try {
      const [rawData, state] = await Promise.all([loadAllLessonsRaw(), fetchUserState()])
      const { lessons: rawLessons, units, unitMap } = rawData
      const lessons: Lesson[] = rawLessons.map((r) => deriveLesson(r, unitMap))
      return computeStats(lessons, units, userStateToLocalAnswers(state))
    } catch (err) {
      console.error('[getStats] failed:', err)
      return {
        calendar: [],
        unit_accuracy: [],
        trend: [],
        total_plays: 0,
        streak_days: 0,
        unit_mastery: [],
        accuracy_metrics: emptyAccuracyMetrics(),
      }
    }
  },

  getLearningDashboard: async (): Promise<LearningDashboardResponse> => {
    try {
      const [rawData, state, profile] = await Promise.all([
        loadAllLessonsRaw(),
        fetchUserState(),
        loadJsonData<LearningProfile>('learning_profile').catch(() => ({
          version: 1,
          last_updated: '',
          weaknesses: [],
        })),
      ])
      const lessons: Lesson[] = rawData.lessons.map((r) => deriveLesson(r, rawData.unitMap))
      return computeLearningDashboard({
        lessons,
        units: rawData.units,
        answers: userStateToLocalAnswers(state),
        profile,
      })
    } catch (err) {
      console.error('[getLearningDashboard] failed:', err)
      return {
        rows: [],
        summary: {
          total_weaknesses: 0,
          practiced_weaknesses: 0,
          exam_gap_count: 0,
          unfixed_count: 0,
        },
      }
    }
  },

  getCarelessAnalysis: async (lessonId?: string): Promise<CarelessResponse> => {
    try {
      const [rawData, state] = await Promise.all([loadAllLessonsRaw(), fetchUserState()])
      const { lessons: rawLessons, unitMap } = rawData
      const lessons: Lesson[] = rawLessons.map((r) => deriveLesson(r, unitMap))
      return computeCareless(userStateToLocalAnswers(state), lessons, lessonId)
    } catch {
      return {
        rushing: [],
        repeated: [],
        summary: { rushing_count: 0, repeated_count: 0, advice: '' },
      }
    }
  },
}
