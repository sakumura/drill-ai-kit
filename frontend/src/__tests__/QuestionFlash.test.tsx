// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestionFlash } from '../components/QuestionFlash'
import type { Question } from '../lib/api'

const question: Question = {
  id: 'q-choice-1',
  lesson_id: 'lesson-1',
  position: 1,
  question_text: '1 + 1 は？',
  figure_svg: null,
  answer: '2',
  answer_unit: null,
  hints: ['2', '3', '4'],
  solution_steps: ['1 + 1 = 2'],
  common_mistakes: [],
  diag_step1: null,
  diag_step2: null,
}

const choices = [
  { text: '2', isCorrect: true },
  { text: '3', isCorrect: false },
  { text: '4', isCorrect: false },
]

function renderQuestionFlash(overrides: Partial<Parameters<typeof QuestionFlash>[0]> = {}) {
  const onChoose = vi.fn()
  render(
    <QuestionFlash
      question={question}
      choices={choices}
      correctCount={0}
      totalQuestions={1}
      stepIndex={0}
      totalSteps={1}
      timerProgress={1}
      timeLeft={10}
      flashResult={null}
      correctChoiceIndex={null}
      chosenIndex={null}
      choicesReady={true}
      onChoose={onChoose}
      {...overrides}
    />,
  )
  return { onChoose }
}

afterEach(() => {
  cleanup()
})

describe('QuestionFlash choice confirmation', () => {
  it('selects a choice without submitting until the confirm button is pressed', () => {
    const { onChoose } = renderQuestionFlash()

    const firstChoice = screen.getByRole('button', { name: /選択肢1/ })
    const confirm = screen.getByRole('button', { name: 'この答えで決定' }) as HTMLButtonElement

    expect(confirm.disabled).toBe(true)

    fireEvent.click(firstChoice)

    expect(onChoose).not.toHaveBeenCalled()
    expect(firstChoice.getAttribute('aria-pressed')).toBe('true')
    expect(firstChoice.className).toContain('question-flash__choice--selected')
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(choices[0], 0)
  })

  it('does not submit on repeated choice clicks; only the confirm button submits', () => {
    const { onChoose } = renderQuestionFlash()
    const secondChoice = screen.getByRole('button', { name: /選択肢2/ })

    fireEvent.click(secondChoice)
    fireEvent.click(secondChoice)
    fireEvent.click(secondChoice)

    expect(onChoose).not.toHaveBeenCalled()
    expect(secondChoice.getAttribute('aria-pressed')).toBe('true')

    const confirm = screen.getByRole('button', { name: 'この答えで決定' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(choices[1], 1)
  })

  it('switches selection without submitting when a different choice is clicked', () => {
    const { onChoose } = renderQuestionFlash()
    const firstChoice = screen.getByRole('button', { name: /選択肢1/ })
    const thirdChoice = screen.getByRole('button', { name: /選択肢3/ })

    fireEvent.click(firstChoice)
    expect(firstChoice.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(thirdChoice)
    expect(firstChoice.getAttribute('aria-pressed')).toBe('false')
    expect(thirdChoice.getAttribute('aria-pressed')).toBe('true')
    expect(onChoose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'この答えで決定' }))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(choices[2], 2)
  })

  it('shows the current question number in the debug skip bar', () => {
    renderQuestionFlash({
      debugUI: true,
      onSkip: vi.fn(),
      currentQuestionNumber: 7,
      totalQuestions: 30,
    })

    expect(screen.getByText(/Q7\/30/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /この問題をスキップして次へ/ })).toBeTruthy()
  })

  it('shows locked choices and countdown without enabling submission during reading lock', () => {
    const { onChoose } = renderQuestionFlash({ choicesReady: false, readingLockRemaining: 5 })

    expect(screen.getByText('もんだいをよもう… 5')).toBeTruthy()
    const lockedChoice = screen.getByRole('button', { name: /選択肢1: 2。まだ選べません/ }) as HTMLButtonElement
    expect(lockedChoice.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'この答えで決定' })).toBeNull()

    fireEvent.click(lockedChoice)
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('shows correct feedback without a required acknowledgement button', () => {
    renderQuestionFlash({
      flashResult: 'correct',
      correctChoiceIndex: 0,
      chosenIndex: 0,
    })

    expect(screen.getByText('1 + 1 = 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /理解/ })).toBeNull()
  })

  it('resets local selection when the step changes', () => {
    const { rerender } = render(
      <QuestionFlash
        question={question}
        choices={choices}
        correctCount={0}
        totalQuestions={1}
        stepIndex={0}
        totalSteps={2}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /選択肢1/ }))
    expect(screen.getByRole('button', { name: /選択肢1/ }).getAttribute('aria-pressed')).toBe('true')

    rerender(
      <QuestionFlash
        question={question}
        choices={choices}
        correctCount={0}
        totalQuestions={1}
        stepIndex={1}
        totalSteps={2}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /選択肢1/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('does not carry a selected index into a different question before effects run', () => {
    const onChoose = vi.fn()
    const nextQuestion = {
      ...question,
      id: 'q-choice-2',
      question_text: '2 + 2 は？',
      answer: '4',
      hints: ['4', '5', '6'],
    }
    const nextChoices = [
      { text: '4', isCorrect: true },
      { text: '5', isCorrect: false },
      { text: '6', isCorrect: false },
    ]
    const { rerender } = render(
      <QuestionFlash
        question={question}
        choices={choices}
        correctCount={0}
        totalQuestions={2}
        stepIndex={0}
        totalSteps={1}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={onChoose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /選択肢2/ }))
    expect((screen.getByRole('button', { name: 'この答えで決定' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(
      <QuestionFlash
        question={nextQuestion}
        choices={nextChoices}
        correctCount={0}
        totalQuestions={2}
        stepIndex={0}
        totalSteps={1}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={onChoose}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'この答えで決定' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('clears selection when the parent remounts the same question run', () => {
    const onChoose = vi.fn()
    const { rerender } = render(
      <QuestionFlash
        key="run-1"
        question={question}
        choices={choices}
        correctCount={0}
        totalQuestions={1}
        stepIndex={0}
        totalSteps={1}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={onChoose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /選択肢2/ }))
    expect((screen.getByRole('button', { name: 'この答えで決定' }) as HTMLButtonElement).disabled).toBe(false)

    rerender(
      <QuestionFlash
        key="run-2"
        question={question}
        choices={choices}
        correctCount={0}
        totalQuestions={1}
        stepIndex={0}
        totalSteps={1}
        timerProgress={1}
        timeLeft={10}
        flashResult={null}
        correctChoiceIndex={null}
        chosenIndex={null}
        choicesReady={true}
        onChoose={onChoose}
      />,
    )

    expect(screen.getByRole('button', { name: /選択肢2/ }).getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByRole('button', { name: 'この答えで決定' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
