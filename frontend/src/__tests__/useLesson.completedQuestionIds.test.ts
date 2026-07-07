import { describe, expect, it } from 'vitest'
import { completedQuestionIds } from '../hooks/useLesson'
import type { Lesson } from '../lib/api'
import type { LessonAnswerHistoryLike } from '../lib/lessonScoring'

function question(id: string, position: number, questionType = 'single_tier') {
  return {
    id,
    lesson_id: 'lesson-resume',
    position,
    question_text: `${position}問目`,
    figure_svg: null,
    answer: '正解',
    answer_unit: null,
    hints: ['正解', '誤答1', '誤答2'],
    solution_steps: ['解く'],
    common_mistakes: [],
    diag_step1: null,
    diag_step2: null,
    question_type: questionType,
  }
}

const lesson: Lesson = {
  id: 'lesson-resume',
  unit_id: 'unit-1',
  title: '途中再開テスト',
  concept_cards: [],
  tips: [],
  difficulty: 3,
  grade: 5,
  subject: 'math',
  lesson_type: 'flash',
  questions: [question('q1', 1), question('q2', 2), question('q3', 3, 'two_tier')],
}

function answerHistoryEntry(overrides: Partial<LessonAnswerHistoryLike>): LessonAnswerHistoryLike {
  return {
    question_id: 'q1',
    is_correct: 1,
    step: 1,
    user_answer: '正解',
    time_spent_sec: 3,
    answered_at: '2026-05-18T00:00:01.000Z',
    ...overrides,
  }
}

describe('completedQuestionIds', () => {
  it('does not mark a question completed when its only restored attempt is wrong', () => {
    const completed = completedQuestionIds(lesson, [answerHistoryEntry({ question_id: 'q1', is_correct: 0 })])

    expect([...completed]).toEqual([])
  })

  it('marks single-tier questions completed only after their final result is correct', () => {
    const completed = completedQuestionIds(lesson, [
      answerHistoryEntry({ question_id: 'q1', is_correct: 0, answered_at: '2026-05-18T00:00:01.000Z' }),
      answerHistoryEntry({ question_id: 'q1', is_correct: 1, answered_at: '2026-05-18T00:00:02.000Z' }),
      answerHistoryEntry({ question_id: 'q2', is_correct: 1, answered_at: '2026-05-18T00:00:03.000Z' }),
    ])

    expect(completed).toEqual(new Set(['q1', 'q2']))
  })

  it('requires all two-tier steps to be correct before marking the question completed', () => {
    const onlyStep1Completed = completedQuestionIds(lesson, [
      answerHistoryEntry({ question_id: 'q3', is_correct: 1, step: 1 }),
    ])
    expect(onlyStep1Completed.has('q3')).toBe(false)

    const bothStepsCompleted = completedQuestionIds(lesson, [
      answerHistoryEntry({ question_id: 'q3', is_correct: 1, step: 1 }),
      answerHistoryEntry({ question_id: 'q3', is_correct: 1, step: 2 }),
    ])
    expect(bothStepsCompleted.has('q3')).toBe(true)
  })
})
