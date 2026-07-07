// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameResult, type QuestionResult } from '../components/GameResult'
import type { LessonScoreSummary } from '../lib/lessonScoring'

const question = {
  id: 'q1',
  lesson_id: 'lesson1',
  position: 1,
  question_text: '1+1は？',
  figure_svg: null,
  answer: '2',
  answer_unit: null,
  hints: ['2', '1', '3'],
  solution_steps: [],
  common_mistakes: [],
  diag_step1: null,
  diag_step2: null,
}

const wrongResult: QuestionResult = {
  question,
  correct: false,
  score: 0,
  timeTaken: 5,
  chosenText: '1',
  isRetry: true,
}

function summary(overrides: Partial<LessonScoreSummary<QuestionResult>> = {}): LessonScoreSummary<QuestionResult> {
  return {
    firstCorrectCount: 0,
    finalCorrectCount: 0,
    rescuedCount: 0,
    needsReviewCount: 1,
    firstAttemptResults: [wrongResult],
    needsReviewResults: [wrongResult],
    ...overrides,
  }
}

describe('GameResult retry gating', () => {
  it('does not show a back button while any question still needs review', () => {
    const onRetryWrong = vi.fn()
    const onDone = vi.fn()

    render(
      <GameResult
        isPerfect={false}
        totalTime={30}
        attempts={2}
        totalQuestions={1}
        scoreSummary={summary()}
        wrongResults={[wrongResult]}
        onRetry={vi.fn()}
        onRetryWrong={onRetryWrong}
        onDone={onDone}
      />,
    )

    expect(screen.getByRole('heading', { name: 'まだクリアではないよ' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'もどる' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'まちがえた問題を正解するまでやり直す' }))
    expect(onRetryWrong).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows the back button after every question is finally correct', () => {
    render(
      <GameResult
        isPerfect={true}
        totalTime={30}
        attempts={1}
        totalQuestions={1}
        scoreSummary={summary({
          firstCorrectCount: 1,
          finalCorrectCount: 1,
          needsReviewCount: 0,
          firstAttemptResults: [{ ...wrongResult, correct: true }],
          needsReviewResults: [],
        })}
        wrongResults={[]}
        onRetry={vi.fn()}
        onDone={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'クリア！' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'もどる' })).toBeTruthy()
  })
})
