import { describe, expect, it } from 'vitest'
import { buildAttemptResultsFromAnswerHistory, summarizeLessonResults } from '../lib/lessonScoring'

function result(questionId: string, correct: boolean) {
  return {
    question: { id: questionId },
    correct,
  }
}

describe('summarizeLessonResults', () => {
  it('separates first-pass correctness from final rescued correctness', () => {
    const summary = summarizeLessonResults(
      [
        result('q1', true),
        result('q2', false),
        result('q2', true),
        result('q3', false),
        result('q3', false),
      ],
      3,
    )

    expect(summary.firstCorrectCount).toBe(1)
    expect(summary.finalCorrectCount).toBe(2)
    expect(summary.rescuedCount).toBe(1)
    expect(summary.needsReviewCount).toBe(1)
    expect(summary.firstAttemptResults.map((r) => [r.question.id, r.correct])).toEqual([
      ['q1', true],
      ['q2', false],
      ['q3', false],
    ])
    expect(summary.needsReviewResults.map((r) => r.question.id)).toEqual(['q3'])
  })

  it('restores completed attempts from answer history without counting tier steps or duplicate sends as extra questions', () => {
    const restored = buildAttemptResultsFromAnswerHistory(
      [
        {
          question_id: 'q1',
          is_correct: 1,
          step: 1,
          user_answer: '答え',
          time_spent_sec: 2,
          answered_at: '2026-05-18T00:00:01.000Z',
        },
        {
          question_id: 'q1',
          is_correct: 1,
          step: 2,
          user_answer: '根拠',
          time_spent_sec: 3,
          answered_at: '2026-05-18T00:00:02.000Z',
        },
        {
          question_id: 'q1',
          is_correct: 1,
          step: 2,
          user_answer: '根拠',
          time_spent_sec: 3,
          answered_at: '2026-05-18T00:00:02.000Z',
        },
        {
          question_id: 'q2',
          is_correct: 1,
          step: 1,
          user_answer: '答え',
          time_spent_sec: 2,
          answered_at: '2026-05-18T00:00:03.000Z',
        },
        {
          question_id: 'q2',
          is_correct: 0,
          step: 2,
          user_answer: '誤答',
          time_spent_sec: 4,
          answered_at: '2026-05-18T00:00:04.000Z',
        },
        {
          question_id: 'q2',
          is_correct: 1,
          step: 1,
          user_answer: '答え',
          time_spent_sec: 2,
          answered_at: '2026-05-18T00:00:05.000Z',
        },
        {
          question_id: 'q2',
          is_correct: 1,
          step: 2,
          user_answer: '根拠',
          time_spent_sec: 3,
          answered_at: '2026-05-18T00:00:06.000Z',
        },
        {
          question_id: 'q3',
          is_correct: 0,
          step: 1,
          user_answer: '誤答',
          time_spent_sec: 5,
          answered_at: '2026-05-18T00:00:07.000Z',
        },
        {
          question_id: 'q3',
          is_correct: 0,
          step: 1,
          user_answer: '誤答',
          time_spent_sec: 5,
          answered_at: '2026-05-18T00:00:07.000Z',
        },
      ],
      [
        { id: 'q1', question_type: 'two_tier' },
        { id: 'q2', question_type: 'two_tier' },
        { id: 'q3', question_type: 'single_tier' },
      ],
    )

    expect(restored.map((r) => [r.question.id, r.correct])).toEqual([
      ['q1', true],
      ['q2', false],
      ['q2', true],
      ['q3', false],
    ])

    const summary = summarizeLessonResults(restored, 3)
    expect(summary.firstCorrectCount).toBe(1)
    expect(summary.finalCorrectCount).toBe(2)
    expect(summary.rescuedCount).toBe(1)
    expect(summary.needsReviewCount).toBe(1)
    expect(summary.firstAttemptResults).toHaveLength(3)
  })

  it('does not restore a duplicate single-tier correct answer as an extra attempt', () => {
    const restored = buildAttemptResultsFromAnswerHistory(
      [
        {
          question_id: 'q1',
          is_correct: 1,
          step: 1,
          user_answer: '正解',
          time_spent_sec: 3,
          answered_at: '2026-05-18T00:00:01.000Z',
        },
        {
          question_id: 'q1',
          is_correct: 1,
          step: 1,
          user_answer: '正解',
          time_spent_sec: 3,
          answered_at: '2026-05-18T00:00:01.000Z',
        },
      ],
      [{ id: 'q1', question_type: 'single_tier' }],
    )

    expect(restored.map((r) => [r.question.id, r.correct])).toEqual([['q1', true]])
    expect(summarizeLessonResults(restored, 1).firstAttemptResults).toHaveLength(1)
  })
})
