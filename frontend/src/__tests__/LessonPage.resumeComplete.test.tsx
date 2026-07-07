// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LessonPage } from '../pages/LessonPage'
import type { Lesson } from '../lib/api'
import type { LessonState } from '../hooks/useLesson'
import type { LessonAnswerHistoryLike } from '../lib/lessonScoring'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  saveAnswerRealtime: vi.fn(),
  saveLessonComplete: vi.fn(),
  saveBlockComplete: vi.fn(),
  lessonState: { current: null as LessonState | null },
}))

vi.mock('react-router', () => ({
  useParams: () => ({ id: 'lesson-resume' }),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../hooks/useLesson', () => ({
  useLesson: () => {
    if (!mocks.lessonState.current) throw new Error('missing mocked lesson state')
    return mocks.lessonState.current
  },
}))

vi.mock('../hooks/useGameTimer', () => ({
  useGameTimer: () => ({
    timeLeft: 60,
    totalSeconds: 60,
    progress: 1,
    isRunning: true,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    calcScore: () => 100,
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    isDebugMode: () => false,
    api: {
      ...actual.api,
      saveAnswerRealtime: mocks.saveAnswerRealtime,
      saveLessonComplete: mocks.saveLessonComplete,
      saveBlockComplete: mocks.saveBlockComplete,
    },
  }
})

vi.mock('../components/GameStart', () => ({
  GameStart: ({ onStart }: { onStart: () => void }) => <button onClick={onStart}>start lesson</button>,
}))

vi.mock('../components/QuestionFlash', () => ({
  QuestionFlash: ({
    choices,
    stepIndex,
    flashResult,
    onChoose,
    onNext,
  }: {
    choices: { text: string; isCorrect: boolean }[]
    stepIndex: number
    flashResult?: 'correct' | 'incorrect' | null
    onChoose: (choice: { text: string; isCorrect: boolean }, index: number) => void
    onNext?: () => void
  }) => {
    const correctIndex = choices.findIndex((choice) => choice.isCorrect)
    const wrongIndex = choices.findIndex((choice) => !choice.isCorrect)
    const correctChoice = correctIndex >= 0 ? choices[correctIndex] : { text: '正解2', isCorrect: true }
    const wrongChoice = wrongIndex >= 0 ? choices[wrongIndex] : { text: '誤答', isCorrect: false }

    return (
      <div data-testid={`question-step-${stepIndex + 1}`}>
        <button onClick={() => onChoose(correctChoice, Math.max(correctIndex, 0))}>answer current question</button>
        <button onClick={() => onChoose(wrongChoice, Math.max(wrongIndex, 0))}>answer current question wrong</button>
        {flashResult === 'incorrect' && onNext ? <button onClick={onNext}>next after wrong</button> : null}
      </div>
    )
  },
}))

vi.mock('../components/GameResult', () => ({
  GameResult: ({ onRetryWrong, onOptionalExtra }: { onRetryWrong?: () => void; onOptionalExtra?: () => void }) => (
    <div>
      result
      {onRetryWrong ? <button onClick={onRetryWrong}>retry wrong</button> : null}
      {onOptionalExtra ? <button onClick={onOptionalExtra}>optional extra</button> : null}
    </div>
  ),
}))

vi.mock('../components/ConceptCard', () => ({
  ConceptCards: () => null,
}))

vi.mock('../components/ReadingMode', () => ({
  ReadingMode: () => null,
}))

function question(id: string, position: number) {
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
    question_type: 'single_tier',
  }
}

function twoTierQuestion(id: string, position: number) {
  return {
    ...question(id, position),
    answer: '答え正解',
    hints: ['式正解', '式誤答1', '式誤答2', '答え正解', '答え誤答1', '答え誤答2'],
    solution_steps: ['式を選ぶ', '答えを選ぶ'],
    question_type: 'two_tier',
    tier1_label: '式を選ぼう',
    tier1_purpose: 'formula',
    tier2_label: '答えを選ぼう',
    tier2_purpose: 'answer',
    tier2_correct_index: 3,
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
  questions: [question('q1', 1), question('q2', 2)],
}

const twoTierLesson: Lesson = {
  ...lesson,
  id: 'lesson-two-tier',
  title: '二段階ログテスト',
  questions: [twoTierQuestion('q-two-tier', 1)],
  blocks: [
    {
      id: 'core',
      title: '本編',
      block_type: 'core',
      question_ids: ['q-two-tier'],
    },
  ],
}

function answerHistoryEntry(overrides: Partial<LessonAnswerHistoryLike> = {}): LessonAnswerHistoryLike {
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

beforeEach(() => {
  vi.clearAllMocks()
  window.scrollTo = vi.fn()
  mocks.saveAnswerRealtime.mockResolvedValue(undefined)
  mocks.saveLessonComplete.mockResolvedValue(true)
  mocks.lessonState.current = {
    status: 'success',
    lesson,
    answeredIds: new Set(['q1']),
    answerHistory: [answerHistoryEntry()],
    accuracy: 1,
    completionLogged: false,
  }
})

afterEach(() => {
  cleanup()
})

describe('LessonPage resumed completion logging', () => {
  it('sends one lesson_complete using restored answer history after finishing the remaining question', async () => {
    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: 'lesson-resume',
        question_count: 2,
        correct_count: 2,
        first_correct_count: 2,
        final_correct_count: 2,
        rescued_count: 0,
        needs_review_count: 0,
        attempts: 2,
      }),
    )
  })

  it('does not count duplicate restored single-tier answers as extra attempts', async () => {
    mocks.lessonState.current = {
      status: 'success',
      lesson,
      answeredIds: new Set(['q1']),
      answerHistory: [answerHistoryEntry(), answerHistoryEntry()],
      accuracy: 1,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        question_count: 2,
        first_correct_count: 2,
        final_correct_count: 2,
        attempts: 2,
      }),
    )
  })

  it('resumes to result instead of starting optional extra directly after main is complete', async () => {
    const blockedLesson: Lesson = {
      ...lesson,
      questions: [question('q1', 1), question('q2', 2), question('q3', 3)],
      blocks: [
        {
          id: 'core',
          title: '本編',
          block_type: 'core',
          question_ids: ['q1', 'q2'],
        },
        {
          id: 'extra',
          title: '任意追加',
          block_type: 'optional_extra',
          optional_extra: true,
          question_ids: ['q3'],
        },
      ],
    }
    mocks.lessonState.current = {
      status: 'success',
      lesson: blockedLesson,
      answeredIds: new Set(['q1', 'q2']),
      answerHistory: [
        answerHistoryEntry(),
        answerHistoryEntry({
          question_id: 'q2',
          answered_at: '2026-05-18T00:00:02.000Z',
        }),
      ],
      accuracy: 1,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))

    expect(await screen.findByRole('button', { name: 'optional extra' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'answer current question' })).toBeNull()
    expect(mocks.saveAnswerRealtime).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        question_count: 2,
        first_correct_count: 2,
        final_correct_count: 2,
        attempts: 2,
      }),
    )
  })

  it('logs block metadata and excludes optional extra from lesson completion stats', async () => {
    const blockedLesson: Lesson = {
      ...lesson,
      questions: [question('q1', 1), question('q2', 2), question('q3', 3)],
      blocks: [
        {
          id: 'core',
          title: '本編',
          block_type: 'core',
          question_ids: ['q1', 'q2'],
        },
        {
          id: 'extra',
          title: '任意追加',
          block_type: 'optional_extra',
          optional_extra: true,
          question_ids: ['q3'],
        },
      ],
    }
    mocks.lessonState.current = {
      status: 'success',
      lesson: blockedLesson,
      answeredIds: new Set(['q1']),
      answerHistory: [answerHistoryEntry()],
      accuracy: 1,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() =>
      expect(mocks.saveAnswerRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q2',
          block_id: 'core',
          block_type: 'core',
          block_position: 1,
          block_question_position: 2,
          optional_extra: false,
        }),
      ),
    )
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        question_count: 2,
        first_correct_count: 2,
        final_correct_count: 2,
        attempts: 2,
      }),
    )
    expect(mocks.saveBlockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'core',
        block_type: 'core',
        block_position: 1,
        optional_extra: false,
        question_count: 2,
        correct_count: 2,
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'optional extra' }, { timeout: 2500 }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))
    await waitFor(() =>
      expect(mocks.saveAnswerRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q3',
          block_id: 'extra',
          block_type: 'optional_extra',
          block_position: 2,
          block_question_position: 1,
          optional_extra: true,
        }),
      ),
    )
    expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1)
  })

  it('counts a two-tier question wrong when step1 is correct but step2 is wrong', async () => {
    mocks.lessonState.current = {
      status: 'success',
      lesson: twoTierLesson,
      answeredIds: new Set(),
      answerHistory: [],
      accuracy: 0,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(1))
    expect(mocks.saveAnswerRealtime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        question_id: 'q-two-tier',
        is_correct: true,
        step: 1,
        step_label: 'tier1',
        question_type: 'two_tier',
        step_purpose: 'formula',
        is_retry: false,
      }),
    )

    await screen.findByTestId('question-step-2', {}, { timeout: 2500 })
    fireEvent.click(screen.getByRole('button', { name: 'answer current question wrong' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(2))
    expect(mocks.saveAnswerRealtime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        question_id: 'q-two-tier',
        is_correct: false,
        step: 2,
        step_label: 'tier2',
        question_type: 'two_tier',
        step_purpose: 'answer',
        is_retry: false,
      }),
    )

    expect(mocks.saveLessonComplete).not.toHaveBeenCalled()
    expect(mocks.saveBlockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'core',
        question_count: 1,
        correct_count: 0,
      }),
    )
  })

  it('sends lesson_complete only after a wrong answer is corrected on retry', async () => {
    mocks.lessonState.current = {
      status: 'success',
      lesson,
      answeredIds: new Set(),
      answerHistory: [],
      accuracy: 0,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(2))
    expect(mocks.saveAnswerRealtime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        question_id: 'q1',
        is_correct: true,
        is_retry: true,
      }),
    )
    expect(mocks.saveLessonComplete).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 1600))
    fireEvent.click(screen.getByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: 'lesson-resume',
        question_count: 2,
        first_correct_count: 1,
        final_correct_count: 2,
        rescued_count: 1,
        needs_review_count: 0,
        attempts: 3,
      }),
    )
  })

  it('retries only questions that still need review after a partial remediation round', async () => {
    mocks.lessonState.current = {
      status: 'success',
      lesson,
      answeredIds: new Set(),
      answerHistory: [],
      accuracy: 0,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))

    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(3))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(4))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))

    await waitFor(() => screen.getByText('result'), { timeout: 2500 })
    fireEvent.click(screen.getByRole('button', { name: 'retry wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(5))
    await new Promise((resolve) => setTimeout(resolve, 1600))

    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(6))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(7))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))

    await waitFor(() => screen.getByText('result'), { timeout: 2500 })
    expect(mocks.saveLessonComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'retry wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(8))
    expect(mocks.saveAnswerRealtime).toHaveBeenNthCalledWith(8, expect.objectContaining({ question_id: 'q2' }))
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1), { timeout: 2500 })
  })

  it('does not send lesson_complete for retry subset until all original main questions are finally correct', async () => {
    const threeQuestionLesson: Lesson = {
      ...lesson,
      questions: [question('q1', 1), question('q2', 2), question('q3', 3)],
    }
    mocks.lessonState.current = {
      status: 'success',
      lesson: threeQuestionLesson,
      answeredIds: new Set(),
      answerHistory: [],
      accuracy: 0,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(1))

    await new Promise((resolve) => setTimeout(resolve, 1600))
    fireEvent.click(screen.getByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question wrong' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(3))
    fireEvent.click(await screen.findByRole('button', { name: 'next after wrong' }))

    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))
    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(4))

    await waitFor(() => screen.getByText('result'), { timeout: 2500 })
    expect(mocks.saveLessonComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'retry wrong' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(5))
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1), { timeout: 2500 })
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: 'lesson-resume',
        question_count: 3,
        first_correct_count: 2,
        final_correct_count: 3,
        rescued_count: 1,
        needs_review_count: 0,
        attempts: 5,
      }),
    )
  })

  it('counts a two-tier question once when both step1 and step2 are correct', async () => {
    mocks.lessonState.current = {
      status: 'success',
      lesson: twoTierLesson,
      answeredIds: new Set(),
      answerHistory: [],
      accuracy: 0,
      completionLogged: false,
    }

    render(<LessonPage />)

    fireEvent.click(screen.getByRole('button', { name: 'start lesson' }))
    fireEvent.click(await screen.findByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(1))
    await screen.findByTestId('question-step-2', {}, { timeout: 2500 })
    fireEvent.click(screen.getByRole('button', { name: 'answer current question' }))

    await waitFor(() => expect(mocks.saveAnswerRealtime).toHaveBeenCalledTimes(2))
    expect(mocks.saveAnswerRealtime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        question_id: 'q-two-tier',
        is_correct: true,
        step: 2,
        step_label: 'tier2',
        question_type: 'two_tier',
        step_purpose: 'answer',
      }),
    )
    await waitFor(() => expect(mocks.saveLessonComplete).toHaveBeenCalledTimes(1))
    expect(mocks.saveLessonComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: 'lesson-two-tier',
        question_count: 1,
        correct_count: 1,
        first_correct_count: 1,
        final_correct_count: 1,
        attempts: 1,
      }),
    )
    expect(mocks.saveBlockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'core',
        question_count: 1,
        correct_count: 1,
      }),
    )
  })
})
