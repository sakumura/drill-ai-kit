export interface LessonResultLike {
  question: {
    id: string
  }
  correct: boolean
}

export interface LessonQuestionLike {
  id: string
  question_type?: string
}

export interface LessonAnswerHistoryLike {
  question_id: string
  is_correct: boolean | number
  step?: number
  step_label?: string
  user_answer: string
  time_spent_sec: number
  answered_at: string
}

export interface LessonAnswerAttemptResult extends LessonResultLike {
  question: {
    id: string
  }
  correct: boolean
  timeTaken: number
  chosenText: string
  stepLabel?: string
}

export interface LessonScoreSummary<T extends LessonResultLike = LessonResultLike> {
  firstCorrectCount: number
  finalCorrectCount: number
  rescuedCount: number
  needsReviewCount: number
  firstAttemptResults: T[]
  needsReviewResults: T[]
}

export function summarizeLessonResults<T extends LessonResultLike>(
  results: T[],
  totalQuestions: number,
): LessonScoreSummary<T> {
  const byQuestion = new Map<string, T[]>()
  for (const result of results) {
    const attempts = byQuestion.get(result.question.id) ?? []
    attempts.push(result)
    byQuestion.set(result.question.id, attempts)
  }

  const firstAttemptResults: T[] = []
  const needsReviewResults: T[] = []
  let firstCorrectCount = 0
  let finalCorrectCount = 0
  let rescuedCount = 0

  for (const attempts of byQuestion.values()) {
    const first = attempts[0]
    if (!first) continue
    firstAttemptResults.push(first)
    if (first.correct) firstCorrectCount += 1

    const finalCorrect = attempts.some((attempt) => attempt.correct)
    if (finalCorrect) {
      finalCorrectCount += 1
      if (!first.correct) rescuedCount += 1
    } else {
      needsReviewResults.push(attempts[attempts.length - 1])
    }
  }

  return {
    firstCorrectCount,
    finalCorrectCount,
    rescuedCount,
    needsReviewCount: Math.max(0, totalQuestions - finalCorrectCount),
    firstAttemptResults,
    needsReviewResults,
  }
}

function expectedStepCount(question: LessonQuestionLike | undefined): number {
  const qType = question?.question_type ?? 'single_tier'
  if (qType === 'two_tier' || qType === 'evidence_first' || qType === 'slot_two_tier') {
    return 2
  }
  return 1
}

function normalizedStep(step: number | undefined): number {
  return typeof step === 'number' && Number.isFinite(step) && step > 0 ? Math.floor(step) : 1
}

function isCorrectAnswer(value: boolean | number): boolean {
  return value === true || value === 1
}

function sortedUniqueAnswerHistory(answers: LessonAnswerHistoryLike[]): LessonAnswerHistoryLike[] {
  const sorted = answers
    .map((answer, index) => ({ answer, index }))
    .sort((a, b) => {
      const aTime = a.answer.answered_at
      const bTime = b.answer.answered_at
      if (aTime && bTime && aTime !== bTime) return aTime.localeCompare(bTime)
      return a.index - b.index
    })

  const seen = new Set<string>()
  const unique: LessonAnswerHistoryLike[] = []
  for (const { answer, index } of sorted) {
    const key = [
      answer.question_id,
      normalizedStep(answer.step),
      isCorrectAnswer(answer.is_correct) ? '1' : '0',
      answer.user_answer ?? '',
      answer.answered_at ?? `idx:${index}`,
    ].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(answer)
  }
  return unique
}

function buildAttempt(questionId: string, answers: LessonAnswerHistoryLike[], correct: boolean): LessonAnswerAttemptResult {
  const last = answers[answers.length - 1]
  const timeTaken = answers.reduce((sum, answer) => sum + (answer.time_spent_sec ?? 0), 0)
  return {
    question: { id: questionId },
    correct,
    timeTaken,
    chosenText: last?.user_answer ?? '',
    stepLabel: last?.step_label,
  }
}

export function buildAttemptResultsFromAnswerHistory(
  answers: LessonAnswerHistoryLike[],
  questions: LessonQuestionLike[],
): LessonAnswerAttemptResult[] {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const byQuestion = new Map<string, LessonAnswerHistoryLike[]>()

  for (const answer of sortedUniqueAnswerHistory(answers)) {
    if (!questionById.has(answer.question_id)) continue
    const entries = byQuestion.get(answer.question_id) ?? []
    entries.push(answer)
    byQuestion.set(answer.question_id, entries)
  }

  const results: LessonAnswerAttemptResult[] = []
  for (const question of questions) {
    const entries = byQuestion.get(question.id) ?? []
    const expectedSteps = expectedStepCount(question)
    let currentAnswers: LessonAnswerHistoryLike[] = []
    let correctSteps = new Set<number>()

    for (const answer of entries) {
      currentAnswers.push(answer)
      if (!isCorrectAnswer(answer.is_correct)) {
        results.push(buildAttempt(question.id, currentAnswers, false))
        currentAnswers = []
        correctSteps = new Set<number>()
        continue
      }

      correctSteps.add(normalizedStep(answer.step))
      if (correctSteps.size >= expectedSteps) {
        results.push(buildAttempt(question.id, currentAnswers, true))
        currentAnswers = []
        correctSteps = new Set<number>()
      }
    }
  }

  return results
}
