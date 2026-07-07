import { describe, expect, it } from 'vitest'
import {
  computeLearningAccuracyMetrics,
  computeMisconceptionCounts,
  computeStats,
  type LocalAnswerRecord,
  type UnitRowLite,
} from '../lib/aggregate'
import type { Lesson } from '../lib/api'

function answer(overrides: Partial<LocalAnswerRecord>): LocalAnswerRecord {
  return {
    question_id: 'q1',
    lesson_id: 'lesson-math',
    user_answer: 'x',
    is_correct: true,
    time_spent_sec: 5,
    hints_used: 0,
    answered_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  }
}

const lessons: Lesson[] = [
  {
    id: 'lesson-math',
    unit_id: 'unit-math',
    title: '算数',
    concept_cards: [],
    tips: [],
    difficulty: 3,
    grade: 5,
    subject: 'math',
    questions: [
      {
        id: 'q-retry',
        lesson_id: 'lesson-math',
        position: 1,
        question_text: 'retry',
        figure_svg: null,
        answer: '1',
        answer_unit: null,
        hints: [],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
      },
      {
        id: 'q-two-tier',
        lesson_id: 'lesson-math',
        position: 2,
        question_text: 'two tier',
        figure_svg: null,
        answer: '1',
        answer_unit: null,
        hints: [],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
        question_type: 'two_tier',
      },
      {
        id: 'q-time',
        lesson_id: 'lesson-math',
        position: 3,
        question_text: 'time',
        figure_svg: null,
        answer: '1',
        answer_unit: null,
        hints: [],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
      },
      {
        id: 'q-nested-hints',
        lesson_id: 'lesson-math',
        position: 4,
        question_text: 'nested hints',
        figure_svg: null,
        answer: '1',
        answer_unit: null,
        hints: [
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
      },
    ],
  },
  {
    id: 'lesson-japanese',
    unit_id: 'unit-japanese',
    title: '国語',
    concept_cards: [],
    tips: [],
    difficulty: 3,
    grade: 5,
    subject: 'japanese',
    questions: [
      {
        id: 'q-japanese-timeout',
        lesson_id: 'lesson-japanese',
        position: 1,
        question_text: 'timeout',
        figure_svg: null,
        answer: '1',
        answer_unit: null,
        hints: [],
        solution_steps: [],
        common_mistakes: [],
        diag_step1: null,
        diag_step2: null,
      },
    ],
  },
]

describe('computeLearningAccuracyMetrics', () => {
  it('separates first attempt accuracy from final accuracy for retries', () => {
    const metrics = computeLearningAccuracyMetrics(lessons, [
      answer({
        question_id: 'q-retry',
        is_correct: false,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
      answer({
        question_id: 'q-retry',
        is_correct: true,
        answered_at: '2026-05-08T00:00:02.000Z',
      }),
    ])

    expect(metrics.step).toEqual(
      expect.objectContaining({
        total_units: 1,
        total_attempts: 2,
        first_attempt_correct: 0,
        final_correct: 1,
        rescued: 1,
        first_attempt_accuracy: 0,
        final_accuracy: 100,
        rescue_rate: 100,
      }),
    )
    expect(metrics.question.final_accuracy).toBe(100)
  })

  it('handles multi-step questions at both step and question levels', () => {
    const metrics = computeLearningAccuracyMetrics(lessons, [
      answer({
        question_id: 'q-two-tier',
        step: 1,
        step_label: 'tier1',
        is_correct: true,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
      answer({
        question_id: 'q-two-tier',
        step: 2,
        step_label: 'tier2',
        is_correct: false,
        answered_at: '2026-05-08T00:00:02.000Z',
      }),
      answer({
        question_id: 'q-two-tier',
        step: 2,
        step_label: 'tier2',
        is_correct: true,
        answered_at: '2026-05-08T00:00:03.000Z',
      }),
    ])

    expect(metrics.step).toEqual(
      expect.objectContaining({
        total_units: 2,
        first_attempt_correct: 1,
        final_correct: 2,
        first_attempt_accuracy: 50,
        final_accuracy: 100,
      }),
    )
    expect(metrics.question).toEqual(
      expect.objectContaining({
        total_units: 1,
        first_attempt_correct: 0,
        final_correct: 1,
        rescued: 1,
      }),
    )
  })

  it('tracks timeout and rushing wrong attempts without changing accuracy denominators', () => {
    const metrics = computeLearningAccuracyMetrics(lessons, [
      answer({
        question_id: 'q-time',
        is_correct: false,
        time_spent_sec: 3,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
      answer({
        question_id: 'q-time',
        is_correct: true,
        time_spent_sec: 60,
        answered_at: '2026-05-08T00:00:02.000Z',
      }),
      answer({
        lesson_id: 'lesson-japanese',
        question_id: 'q-japanese-timeout',
        is_correct: false,
        time_spent_sec: 30,
        answered_at: '2026-05-08T00:00:03.000Z',
      }),
    ])

    expect(metrics.step).toEqual(
      expect.objectContaining({
        total_units: 2,
        total_attempts: 3,
        timeout_attempts: 2,
        rushing_wrong_attempts: 1,
        timeout_rate: 66.7,
        rushing_wrong_rate: 33.3,
      }),
    )
  })

  it('does not mark a legacy nested-hints question final correct when later steps are missing', () => {
    const metrics = computeLearningAccuracyMetrics(lessons, [
      answer({
        question_id: 'q-nested-hints',
        step: 1,
        step_label: 'tier1',
        is_correct: true,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
    ])

    expect(metrics.question).toEqual(
      expect.objectContaining({
        total_units: 1,
        first_attempt_correct: 0,
        final_correct: 0,
        first_attempt_accuracy: 0,
        final_accuracy: 0,
      }),
    )
  })

  it('marks a legacy nested-hints question final correct only after all final steps are correct', () => {
    const metrics = computeLearningAccuracyMetrics(lessons, [
      answer({
        question_id: 'q-nested-hints',
        step: 1,
        step_label: 'tier1',
        is_correct: true,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
      answer({
        question_id: 'q-nested-hints',
        step: 2,
        step_label: 'tier2',
        is_correct: false,
        answered_at: '2026-05-08T00:00:02.000Z',
      }),
      answer({
        question_id: 'q-nested-hints',
        step: 2,
        step_label: 'tier2',
        is_correct: true,
        answered_at: '2026-05-08T00:00:03.000Z',
      }),
      answer({
        question_id: 'q-nested-hints',
        step: 3,
        step_label: 'tier3',
        is_correct: true,
        answered_at: '2026-05-08T00:00:04.000Z',
      }),
    ])

    expect(metrics.question).toEqual(
      expect.objectContaining({
        total_units: 1,
        first_attempt_correct: 0,
        final_correct: 1,
        final_accuracy: 100,
      }),
    )
  })

  it('does not count timeout attempts when the lesson subject is unknown', () => {
    const metrics = computeLearningAccuracyMetrics([], [
      answer({
        question_id: 'unknown-subject',
        lesson_id: 'unknown-lesson',
        is_correct: false,
        time_spent_sec: 999,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
    ])

    expect(metrics.step.timeout_attempts).toBe(0)
    expect(metrics.step.timeout_rate).toBe(0)
  })
})

describe('computeMisconceptionCounts', () => {
  it('counts incorrect answers by choice-derived misconception tag and purpose', () => {
    const counts = computeMisconceptionCounts([
      answer({ is_correct: false, misconception_tag: 'outer_only', step_purpose: 'strategy' }),
      answer({ is_correct: false, misconception_tag: 'outer_only', step_purpose: 'strategy' }),
      answer({ is_correct: false, misconception_tag: 'wrong_formula', step_purpose: 'formula' }),
      answer({ is_correct: true, misconception_tag: 'outer_only', step_purpose: 'strategy' }),
    ])

    expect(counts).toEqual([
      { misconception_tag: 'outer_only', step_purpose: 'strategy', count: 2 },
      { misconception_tag: 'wrong_formula', step_purpose: 'formula', count: 1 },
    ])
  })
})

describe('computeStats', () => {
  it('includes learning accuracy metrics with existing stats response fields', () => {
    const units: UnitRowLite[] = [{ id: 'unit-math', name: '算数', subject: 'math' }]
    const stats = computeStats(lessons, units, [
      answer({
        question_id: 'q-retry',
        is_correct: false,
        answered_at: '2026-05-08T00:00:01.000Z',
      }),
      answer({
        question_id: 'q-retry',
        is_correct: true,
        answered_at: '2026-05-08T00:00:02.000Z',
      }),
    ])

    expect(stats).toEqual(expect.objectContaining({
      calendar: expect.any(Array),
      unit_accuracy: expect.any(Array),
      trend: expect.any(Array),
      total_plays: 2,
      streak_days: expect.any(Number),
      unit_mastery: expect.any(Array),
      accuracy_metrics: expect.objectContaining({
        step: expect.objectContaining({ final_accuracy: 100 }),
        question: expect.objectContaining({ final_accuracy: 100 }),
      }),
    }))
  })
})
