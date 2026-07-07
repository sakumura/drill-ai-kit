import { useState, useEffect } from 'react'
import { api, Lesson, Question } from '../lib/api'
import type { LessonAnswerHistoryLike } from '../lib/lessonScoring'

export type LessonState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'success'
      lesson: Lesson
      answeredIds: Set<string>
      answerHistory: LessonAnswerHistoryLike[]
      accuracy: number
      completionLogged: boolean
    }

function expectedStepCount(question: Question): number {
  const qType = question.question_type ?? 'single_tier'
  if (qType === 'two_tier' || qType === 'evidence_first' || qType === 'slot_two_tier') {
    return 2
  }
  return 1
}

export function completedQuestionIds(lesson: Lesson, results: LessonAnswerHistoryLike[]): Set<string> {
  const byQuestion = new Map<string, { correctSteps: Set<number> }>()
  for (const result of results) {
    const bucket = byQuestion.get(result.question_id) ?? {
      correctSteps: new Set<number>(),
    }
    if (result.is_correct) {
      bucket.correctSteps.add(result.step ?? 1)
    }
    byQuestion.set(result.question_id, bucket)
  }

  const completed = new Set<string>()
  for (const question of lesson.questions) {
    const bucket = byQuestion.get(question.id)
    if (!bucket) continue
    if (bucket.correctSteps.size >= expectedStepCount(question)) {
      completed.add(question.id)
    }
  }
  return completed
}

export function useLesson(lessonId?: string) {
  const [state, setState] = useState<LessonState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    setState({ status: 'loading' })

    const fetchLesson = lessonId ? api.getLesson(lessonId) : api.getTodayLesson()

    fetchLesson
      .then(async (lesson) => {
        if (cancelled) return

        let answeredIds = new Set<string>()
        let answerHistory: LessonAnswerHistoryLike[] = []
        let accuracy = 0
        let completionLogged = false
        try {
          const [results, hasCompletion] = await Promise.all([api.getLessonResults(lesson.id), api.hasLessonCompletion(lesson.id)])
          answerHistory = results
          completionLogged = hasCompletion
          answeredIds = completedQuestionIds(lesson, results)
          if (results.length > 0) {
            const correctCount = results.filter((r) => r.is_correct).length
            accuracy = correctCount / results.length
          }
        } catch {
          // results取得失敗は無視（最初から開始するだけ）
        }

        if (!cancelled) {
          setState({
            status: 'success',
            lesson,
            answeredIds,
            answerHistory,
            accuracy,
            completionLogged,
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '読み込みに失敗しました'
          setState({ status: 'error', message })
        }
      })

    return () => {
      cancelled = true
    }
  }, [lessonId])

  return state
}
