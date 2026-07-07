import { describe, expect, it } from 'vitest'
import { computeLearningDashboard } from '../lib/learningDashboard'
import type { Lesson, LearningProfile } from '../lib/api'
import type { LocalAnswerRecord } from '../lib/aggregate'

const lessons: Lesson[] = [
  {
    id: 'lesson-m',
    unit_id: 'math',
    title: 'math',
    concept_cards: [],
    tips: [],
    difficulty: 4,
    grade: 5,
    subject: 'math',
    questions: [
      {
        id: 'q1',
        lesson_id: 'lesson-m',
        position: 1,
        question_text: '角度',
        figure_svg: null,
        answer: '60',
        answer_unit: null,
        hints: ['60', '120', '30'],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
        unit_id: 'kakudo',
        difficulty: 'd4',
      },
    ],
  },
  {
    id: 'lesson-r',
    unit_id: 'dokkai-setsumeibun',
    title: 'reading',
    concept_cards: [],
    tips: [],
    difficulty: 4,
    grade: 5,
    subject: 'japanese',
    lesson_type: 'reading',
    questions: [],
    reading_questions: [
      {
        id: 'rq1',
        passage_id: 'p1',
        lesson_id: 'lesson-r',
        position: 1,
        question_type: 'choice4',
        question_text: '内容合致',
        choices: [
          { text: 'ア', isCorrect: true },
          { text: 'イ', isCorrect: false },
          { text: 'ウ', isCorrect: false },
          { text: 'エ', isCorrect: false },
        ],
        correct_answer: 'ア',
        explanation: null,
        difficulty_tier: 4,
      },
    ],
  },
]

const profile: LearningProfile = {
  version: 1,
  last_updated: '2026-05-08',
  weaknesses: [
    {
      pattern_id: 'kakudo',
      subject: 'math',
      score: 86,
      severity: 'critical',
      name: '角度',
      last_test_result: '全国模試で再発',
    },
  ],
}

function answer(overrides: Partial<LocalAnswerRecord>): LocalAnswerRecord {
  return {
    question_id: 'q1',
    lesson_id: 'lesson-m',
    user_answer: 'x',
    is_correct: true,
    time_spent_sec: 10,
    hints_used: 0,
    answered_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('computeLearningDashboard', () => {
  it('marks practiced but test-failed weaknesses as exam-format gaps', () => {
    const dashboard = computeLearningDashboard({
      lessons,
      units: [{ id: 'kakudo', name: '角度', subject: 'math' }],
      answers: [
        answer({ is_correct: false, answered_at: '2026-05-08T00:00:01.000Z' }),
        answer({ is_correct: true, answered_at: '2026-05-08T00:00:02.000Z' }),
      ],
      profile,
    })

    expect(dashboard.rows[0]).toEqual(
      expect.objectContaining({
        app_practice_count: 2,
        first_attempt_accuracy: 0,
        final_accuracy: 100,
        status: 'needs_exam_format',
      }),
    )
    expect(dashboard.summary.exam_gap_count).toBe(1)
  })

  it('returns empty-safe summary when no profile rows exist', () => {
    const dashboard = computeLearningDashboard({
      lessons,
      units: [],
      answers: [],
      profile: { version: 1, last_updated: '', weaknesses: [] },
    })

    expect(dashboard.summary.total_weaknesses).toBe(0)
    expect(dashboard.rows).toEqual([])
  })

  it('counts reading question answers at lesson unit level', () => {
    const dashboard = computeLearningDashboard({
      lessons,
      units: [{ id: 'dokkai-setsumeibun', name: '説明文読解', subject: 'japanese' }],
      answers: [answer({ question_id: 'rq1', lesson_id: 'lesson-r', is_correct: true })],
      profile: {
        version: 1,
        last_updated: '2026-05-08',
        weaknesses: [
          {
            pattern_id: 'dokkai-setsumeibun',
            subject: 'japanese',
            score: 30,
            severity: 'watch',
            name: '説明文読解',
          },
        ],
      },
    })

    expect(dashboard.rows[0]).toEqual(
      expect.objectContaining({
        app_practice_count: 1,
        first_attempt_accuracy: 100,
        final_accuracy: 100,
      }),
    )
  })
})
