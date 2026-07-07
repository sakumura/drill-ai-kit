// =====================================================================
// frontend/src/lib/aggregate.ts
//
// localStorage.answers + lessons/units/motivator JSON から
// 統計 / メンター / careless / streak / points を計算する純関数群。
//
// 設計原則:
//   - 副作用なし。fetch / localStorage / window への参照を持たない
//   - 入力は呼び出し側（api.ts）が組み立て、出力は既存 api.ts の型と完全互換
//   - 日付境界は dates.ts の getJstTodayKey() に集約
// =====================================================================

import type {
  Lesson,
  StatsResponse,
  CarelessResponse,
  MentorMessage,
  UnitMastery,
  AccuracyMetricSummary,
  AccuracyMetricsResponse,
  TierPurpose,
} from './api'
import { getJstTodayKey } from './dates'
import { getTotalSteps } from './questionEngine'

// ---------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------

/**
 * localStorage.answers のスキーマ。
 * Step 9 でも同型を直接読み出すので、aggregate.ts と api.ts で共有する。
 */
export interface LocalAnswerRecord {
  question_id: string
  lesson_id: string
  user_answer: string
  is_correct: boolean
  time_spent_sec: number
  hints_used: number
  answered_at: string // ISO 8601
  step?: number
  step_label?: string
  question_type?: string
  step_purpose?: TierPurpose
  misconception_tag?: string
  unit_id?: string
  difficulty?: string
  is_retry?: boolean
}

export interface MisconceptionCount {
  misconception_tag: string
  count: number
  step_purpose?: TierPurpose
}

export interface UnitRowLite {
  id: string
  name: string
  subject?: 'math' | 'japanese'
}

export interface MotivatorRowLite {
  date: string
  message: string
}

// ---------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------

/** ISO 文字列を JST の YYYY-MM-DD に変換（無効値は空文字を返す） */
function isoToJstDateKey(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return getJstTodayKey(new Date(t))
}

/** YYYY-MM-DD の N 日前（JST 想定の純粋日付演算） */
function shiftDateKey(dateKey: string, deltaDays: number): string {
  // YYYY-MM-DD を UTC 0時として扱い ±N 日（タイムゾーン非依存の純粋計算）
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

/** lesson_id -> Lesson のマップ */
function buildLessonMap(lessons: Lesson[]): Map<string, Lesson> {
  return new Map(lessons.map((l) => [l.id, l]))
}

/** question_id -> question_text のマップ（reading_questions も含む） */
function buildQuestionTextMap(lessons: Lesson[]): Map<string, { text: string; correct: string }> {
  const map = new Map<string, { text: string; correct: string }>()
  for (const l of lessons) {
    for (const q of l.questions ?? []) {
      map.set(q.id, { text: q.question_text, correct: q.answer })
    }
    for (const rq of l.reading_questions ?? []) {
      const correct =
        rq.choices?.find((c) => c.isCorrect)?.text ?? rq.correct_answer ?? ''
      map.set(rq.id, { text: rq.question_text, correct })
    }
  }
  return map
}

/** lesson_id -> unit_id 解決 */
function lessonIdToUnitId(lessonMap: Map<string, Lesson>, lessonId: string): string | null {
  return lessonMap.get(lessonId)?.unit_id ?? null
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function buildQuestionStepMap(lessons: Lesson[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const lesson of lessons) {
    for (const question of lesson.questions ?? []) {
      map.set(`${lesson.id}:${question.id}`, getTotalSteps(question))
    }
    for (const question of lesson.reading_questions ?? []) {
      map.set(`${lesson.id}:${question.id}`, 1)
    }
  }
  return map
}

function buildLessonSubjectMap(lessons: Lesson[]): Map<string, 'math' | 'japanese'> {
  return new Map(lessons.map((lesson) => [lesson.id, lesson.subject]))
}

function timeoutThresholdSec(subject: 'math' | 'japanese' | undefined): number {
  if (subject === 'math') return 60
  if (subject === 'japanese') return 30
  return Number.POSITIVE_INFINITY
}

function toMetricSummary(groups: AccuracyGroup[]): AccuracyMetricSummary {
  let firstAttemptCorrect = 0
  let finalCorrect = 0
  let initiallyWrong = 0
  let rescued = 0
  let timeoutAttempts = 0
  let rushingWrongAttempts = 0
  let totalAttempts = 0

  for (const group of groups) {
    totalAttempts += group.attempt_count
    if (group.first_correct) firstAttemptCorrect += 1
    if (group.final_correct) finalCorrect += 1
    if (!group.first_correct) initiallyWrong += 1
    if (!group.first_correct && group.final_correct) rescued += 1
    timeoutAttempts += group.timeout_attempts
    rushingWrongAttempts += group.rushing_wrong_attempts
  }

  return {
    total_units: groups.length,
    total_attempts: totalAttempts,
    first_attempt_correct: firstAttemptCorrect,
    final_correct: finalCorrect,
    initially_wrong: initiallyWrong,
    rescued,
    timeout_attempts: timeoutAttempts,
    rushing_wrong_attempts: rushingWrongAttempts,
    first_attempt_accuracy: roundPct(firstAttemptCorrect, groups.length),
    final_accuracy: roundPct(finalCorrect, groups.length),
    rescue_rate: roundPct(rescued, initiallyWrong),
    timeout_rate: roundPct(timeoutAttempts, totalAttempts),
    rushing_wrong_rate: roundPct(rushingWrongAttempts, totalAttempts),
  }
}

interface AccuracyGroup {
  first_correct: boolean
  final_correct: boolean
  attempt_count: number
  timeout_attempts: number
  rushing_wrong_attempts: number
}

export function emptyAccuracyMetrics(): AccuracyMetricsResponse {
  const empty: AccuracyMetricSummary = {
    total_units: 0,
    total_attempts: 0,
    first_attempt_correct: 0,
    final_correct: 0,
    initially_wrong: 0,
    rescued: 0,
    timeout_attempts: 0,
    rushing_wrong_attempts: 0,
    first_attempt_accuracy: 0,
    final_accuracy: 0,
    rescue_rate: 0,
    timeout_rate: 0,
    rushing_wrong_rate: 0,
  }
  return { step: { ...empty }, question: { ...empty } }
}

export function computeLearningAccuracyMetrics(
  lessons: Lesson[],
  answers: LocalAnswerRecord[],
): AccuracyMetricsResponse {
  const lessonSubjectMap = buildLessonSubjectMap(lessons)
  const questionStepMap = buildQuestionStepMap(lessons)
  const sorted = [...answers].sort((a, b) => a.answered_at.localeCompare(b.answered_at))

  const stepBuckets = new Map<string, LocalAnswerRecord[]>()
  const questionBuckets = new Map<string, LocalAnswerRecord[]>()
  for (const answer of sorted) {
    const step = answer.step ?? 1
    const stepKey = `${answer.lesson_id}:${answer.question_id}:${step}`
    const questionKey = `${answer.lesson_id}:${answer.question_id}`
    const stepBucket = stepBuckets.get(stepKey) ?? []
    stepBucket.push(answer)
    stepBuckets.set(stepKey, stepBucket)
    const questionBucket = questionBuckets.get(questionKey) ?? []
    questionBucket.push(answer)
    questionBuckets.set(questionKey, questionBucket)
  }

  const buildAttemptCounts = (bucketAnswers: LocalAnswerRecord[]) => {
    const timeoutAttempts = bucketAnswers.filter((answer) => {
      const subject = lessonSubjectMap.get(answer.lesson_id)
      return answer.time_spent_sec >= timeoutThresholdSec(subject)
    }).length
    const rushingWrongAttempts = bucketAnswers.filter(
      (answer) => answer.time_spent_sec <= 3 && !answer.is_correct,
    ).length
    return { timeoutAttempts, rushingWrongAttempts }
  }

  const stepGroups: AccuracyGroup[] = Array.from(stepBuckets.values()).map((bucketAnswers) => {
    const first = bucketAnswers[0]
    const last = bucketAnswers[bucketAnswers.length - 1]
    const counts = buildAttemptCounts(bucketAnswers)
    return {
      first_correct: first?.is_correct ?? false,
      final_correct: last?.is_correct ?? false,
      attempt_count: bucketAnswers.length,
      timeout_attempts: counts.timeoutAttempts,
      rushing_wrong_attempts: counts.rushingWrongAttempts,
    }
  })

  const questionGroups: AccuracyGroup[] = Array.from(questionBuckets.entries()).map(([key, bucketAnswers]) => {
    const [lessonId, questionId] = key.split(':')
    const expectedSteps = questionStepMap.get(`${lessonId}:${questionId}`) ?? 1
    const firstByStep = new Map<number, LocalAnswerRecord>()
    const finalByStep = new Map<number, LocalAnswerRecord>()
    for (const answer of bucketAnswers) {
      const step = answer.step ?? 1
      if (!firstByStep.has(step)) firstByStep.set(step, answer)
      finalByStep.set(step, answer)
    }
    const steps = Array.from({ length: expectedSteps }, (_, i) => i + 1)
    const firstCorrect = steps.every((step) => firstByStep.get(step)?.is_correct === true)
    const finalCorrect = steps.every((step) => finalByStep.get(step)?.is_correct === true)
    const counts = buildAttemptCounts(bucketAnswers)
    return {
      first_correct: firstCorrect,
      final_correct: finalCorrect,
      attempt_count: bucketAnswers.length,
      timeout_attempts: counts.timeoutAttempts,
      rushing_wrong_attempts: counts.rushingWrongAttempts,
    }
  })

  return {
    step: toMetricSummary(stepGroups),
    question: toMetricSummary(questionGroups),
  }
}

export function computeMisconceptionCounts(answers: LocalAnswerRecord[]): MisconceptionCount[] {
  const counts = new Map<string, MisconceptionCount>()
  for (const answer of answers) {
    const tag = answer.misconception_tag?.trim()
    if (!tag || answer.is_correct) continue
    const key = `${tag}:${answer.step_purpose ?? ''}`
    const current = counts.get(key)
    if (current) {
      current.count += 1
    } else {
      counts.set(key, {
        misconception_tag: tag,
        count: 1,
        step_purpose: answer.step_purpose,
      })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.misconception_tag.localeCompare(b.misconception_tag))
}

// ---------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------

/**
 * 弱点 → 既存 D1 schema 互換の mastery_level に変換。
 * 閾値: not_started / beginner(1-40%) / intermediate(41-70%) / advanced(71-90%) / mastered(91+)
 */
function masteryLevelFromAccuracy(total: number, correct: number): string {
  if (total === 0) return 'not_started'
  const pct = (correct / total) * 100
  if (pct <= 40) return 'beginner'
  if (pct <= 70) return 'intermediate'
  if (pct <= 90) return 'advanced'
  return 'mastered'
}

/**
 * streak 計算。
 * - 今日プレイ済 → 今日起算で連続日数をカウント
 * - 今日未プレイ → 昨日起算で連続日数をカウント（既存 D1 実装と同じ仕様）
 * - 連続が途切れたら停止
 */
function computeStreakDays(playedDateKeys: Set<string>, todayKey: string): number {
  if (playedDateKeys.size === 0) return 0
  let cursor = todayKey
  if (!playedDateKeys.has(cursor)) {
    cursor = shiftDateKey(cursor, -1)
  }
  let streak = 0
  while (playedDateKeys.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

export function computeStats(
  lessons: Lesson[],
  units: UnitRowLite[],
  answers: LocalAnswerRecord[],
): StatsResponse {
  const lessonMap = buildLessonMap(lessons)
  const todayKey = getJstTodayKey()

  // ---- calendar: 日付ごとの (lesson_count, correct_rate) ----
  // lesson_count は「その日にプレイした distinct lesson_id 数」
  const perDay = new Map<
    string,
    { lessonIds: Set<string>; total: number; correct: number }
  >()
  for (const a of answers) {
    const day = isoToJstDateKey(a.answered_at)
    if (!day) continue
    let bucket = perDay.get(day)
    if (!bucket) {
      bucket = { lessonIds: new Set(), total: 0, correct: 0 }
      perDay.set(day, bucket)
    }
    bucket.lessonIds.add(a.lesson_id)
    bucket.total += 1
    if (a.is_correct) bucket.correct += 1
  }

  const calendar = Array.from(perDay.entries())
    .map(([date, b]) => ({
      date,
      lesson_count: b.lessonIds.size,
      correct_rate: b.total === 0 ? 0 : Math.round((b.correct / b.total) * 1000) / 10,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // ---- unit_accuracy: unit_id ごと ----
  const perUnit = new Map<string, { total: number; correct: number }>()
  for (const a of answers) {
    const unitId = lessonIdToUnitId(lessonMap, a.lesson_id)
    if (!unitId) continue
    let bucket = perUnit.get(unitId)
    if (!bucket) {
      bucket = { total: 0, correct: 0 }
      perUnit.set(unitId, bucket)
    }
    bucket.total += 1
    if (a.is_correct) bucket.correct += 1
  }

  const unitNameMap = new Map(units.map((u) => [u.id, u.name]))
  const unit_accuracy = Array.from(perUnit.entries())
    .map(([unit_id, b]) => ({
      unit_id,
      unit_name: unitNameMap.get(unit_id) ?? unit_id,
      total: b.total,
      correct: b.correct,
      accuracy: b.total === 0 ? 0 : Math.round((b.correct / b.total) * 1000) / 10,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)

  // ---- trend: 直近 14 日（プレイした日のみ採録、無ければ 0% で埋めない） ----
  const trendStart = shiftDateKey(todayKey, -13)
  const trend = calendar
    .filter((row) => row.date >= trendStart && row.date <= todayKey)
    .map((row) => ({ date: row.date, accuracy: row.correct_rate }))

  // ---- streak ----
  const playedDays = new Set(calendar.map((r) => r.date))
  const streak_days = computeStreakDays(playedDays, todayKey)

  // ---- unit_mastery: unit_accuracy をベースに mastery_level を導出 ----
  // 出題実績ゼロの unit も not_started として全件返す
  const unit_mastery: UnitMastery[] = units.map((u) => {
    const bucket = perUnit.get(u.id)
    const total = bucket?.total ?? 0
    const correct = bucket?.correct ?? 0
    const understanding_pct = total === 0 ? 0 : Math.round((correct / total) * 100)
    const mastery_level = masteryLevelFromAccuracy(total, correct)
    // 最終学習日: その unit に紐付く answers の最大 answered_at
    let last_study_date: string | null = null
    for (const a of answers) {
      const unitId = lessonIdToUnitId(lessonMap, a.lesson_id)
      if (unitId !== u.id) continue
      const day = isoToJstDateKey(a.answered_at)
      if (day && (last_study_date === null || day > last_study_date)) {
        last_study_date = day
      }
    }
    return {
      unit_id: u.id,
      understanding_pct,
      weak_points: [], // weak_points は別途プロファイル管理（D1 列の互換空配列）
      mastery_level,
      last_study_date,
    }
  })

  return {
    calendar,
    unit_accuracy,
    trend,
    total_plays: answers.length,
    streak_days,
    unit_mastery,
    accuracy_metrics: computeLearningAccuracyMetrics(lessons, answers),
  }
}

// ---------------------------------------------------------------------
// computeMentorMessage
// ---------------------------------------------------------------------

/** 質問テキストを冒頭 N 文字で切る（'?' '？' で区切る、既存 D1 実装と同じ） */
function shortenQuestion(text: string, max = 20): string {
  const head = text.split(/[？?]/)[0] ?? text
  return head.length > max ? head.slice(0, max) + '…' : head
}

/** 直近 N 件の answers を返す（answered_at 降順） */
function recentAnswers(answers: LocalAnswerRecord[], n: number): LocalAnswerRecord[] {
  return [...answers]
    .sort((a, b) => (a.answered_at < b.answered_at ? 1 : -1))
    .slice(0, n)
}

export function computeMentorMessage(
  answers: LocalAnswerRecord[],
  motivatorMessages: MotivatorRowLite[],
  lessons: Lesson[] = [],
): MentorMessage {
  const todayKey = getJstTodayKey()
  const motivator =
    motivatorMessages.find((m) => m.date === todayKey)?.message ?? null

  // 直近 30 件で praise / encourage / careless_tip を判定
  const recent = recentAnswers(answers, 30)
  const qTextMap = buildQuestionTextMap(lessons)

  // 何もプレイしていない初回起動状態
  if (recent.length === 0) {
    return {
      praise: null,
      encourage: null,
      greeting: '今日もいっしょにがんばろう！',
      careless_tip: null,
      motivator,
    }
  }

  const correctOnes = recent.filter((r) => r.is_correct)
  const wrongOnes = recent.filter((r) => !r.is_correct)
  const total = recent.length
  const rate = Math.round((correctOnes.length / total) * 100)

  // praise: 直近で正解した最新の question_text を引用
  let praise: string | null = null
  if (correctOnes.length > 0) {
    const head = correctOnes[0]
    const qt = qTextMap.get(head.question_id)?.text ?? ''
    const best = shortenQuestion(qt || head.user_answer || 'もんだい')
    if (rate >= 80) {
      praise = `前回は${rate}%正解！「${best}」バッチリだったね！`
    } else if (rate >= 50) {
      praise = `「${best}」正解できたね！その調子！`
    } else {
      praise = `「${best}」は正解できたよ！一歩ずつ前進してる！`
    }
  }

  // encourage: 直近で間違えた最新の question_text を引用
  let encourage: string | null = null
  if (wrongOnes.length > 0) {
    const head = wrongOnes[0]
    const qt = qTextMap.get(head.question_id)?.text ?? ''
    const weak = shortenQuestion(qt || head.user_answer || 'もんだい')
    encourage = `「${weak}」今日もう一回やってみよう！きっとできるよ！`
  }

  // careless_tip: 直近で「3秒以下 × 不正解」率が 20% 以上
  const rushingWrong = recent.filter(
    (r) => r.time_spent_sec <= 3 && !r.is_correct,
  )
  const rushingRate = total > 0 ? rushingWrong.length / total : 0
  const careless_tip: string | null =
    rushingRate >= 0.2
      ? '最近あわてて答えちゃうことが多いよ。問題文を最後まで読んでから選ぼう！'
      : null

  // greeting: 今日の解答数で簡易メッセージを切替
  const todaysAnswers = answers.filter(
    (a) => isoToJstDateKey(a.answered_at) === todayKey,
  )
  const greeting =
    todaysAnswers.length === 0
      ? '今日もいっしょにがんばろう！'
      : '今日もよくがんばってるね！'

  return { praise, encourage, greeting, careless_tip, motivator }
}

// ---------------------------------------------------------------------
// computeCareless
// ---------------------------------------------------------------------

export function computeCareless(
  answers: LocalAnswerRecord[],
  lessons: Lesson[],
  lessonId?: string,
): CarelessResponse {
  const qTextMap = buildQuestionTextMap(lessons)
  const filtered = lessonId
    ? answers.filter((a) => a.lesson_id === lessonId)
    : answers

  // rushing: time_spent_sec < 5 かつ 不正解
  const rushing = filtered
    .filter((a) => a.time_spent_sec < 5 && !a.is_correct)
    .map((a) => {
      const meta = qTextMap.get(a.question_id)
      return {
        question_text: meta?.text ?? a.question_id,
        time_spent_sec: a.time_spent_sec,
        correct_answer: meta?.correct ?? '',
      }
    })

  // repeated: 同 question_id を 3 回以上不正解
  const wrongCount = new Map<string, number>()
  for (const a of filtered) {
    if (!a.is_correct) {
      wrongCount.set(a.question_id, (wrongCount.get(a.question_id) ?? 0) + 1)
    }
  }
  const repeated = Array.from(wrongCount.entries())
    .filter(([, n]) => n >= 3)
    .map(([qid, n]) => {
      const meta = qTextMap.get(qid)
      return {
        question_text: meta?.text ?? qid,
        wrong_count: n,
        correct_answer: meta?.correct ?? '',
      }
    })
    .sort((a, b) => b.wrong_count - a.wrong_count)

  const rushing_count = rushing.length
  const repeated_count = repeated.length

  let advice = ''
  if (rushing_count > 0 && repeated_count > 0) {
    advice = '問題をよく読んでから答えよう！同じ問題をもう一回やってみよう！'
  } else if (rushing_count > 0) {
    advice = '問題をよく読んでから答えよう！'
  } else if (repeated_count > 0) {
    advice = '同じ問題をもう一回やってみよう！'
  }

  return {
    rushing,
    repeated,
    summary: { rushing_count, repeated_count, advice },
  }
}

