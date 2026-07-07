import { useState, useCallback, useMemo } from 'react'
import type { Lesson, ReadingQuestion as ReadingQuestionType } from '../lib/api'
import { ReadingPassage } from './ReadingPassage'
import { ReadingQuestion } from './ReadingQuestion'

export interface ReadingResult {
  question: ReadingQuestionType
  correct: boolean
  chosenText: string
}

interface ReadingModeProps {
  lesson: Lesson
  onComplete: (results: ReadingResult[]) => void
}

type Phase = 'answering' | 'explanation'

function shuffleChoices(choices: ReadingQuestionType['choices']): ReadingQuestionType['choices'] {
  const copy = [...choices]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function ReadingMode({ lesson, onComplete }: ReadingModeProps) {
  const passages = lesson.passages ?? []
  const readingQuestions = useMemo(
    () => (lesson.reading_questions ?? []).slice().sort((a, b) => a.position - b.position),
    [lesson.reading_questions],
  )

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [unlockedParagraphs, setUnlockedParagraphs] = useState(1)
  const [results, setResults] = useState<ReadingResult[]>([])
  const [phase, setPhase] = useState<Phase>('answering')
  const [chosenIndex, setChosenIndex] = useState<number | null>(null)
  const [shuffledChoices, setShuffledChoices] = useState<ReadingQuestionType['choices']>(
    () => readingQuestions[0] ? shuffleChoices(readingQuestions[0].choices) : [],
  )

  const currentQuestion = readingQuestions[currentQuestionIndex]
  const totalQuestions = readingQuestions.length
  const answeredCount = results.length
  const remainingSeconds = (totalQuestions - answeredCount) * 45
  const remainingMinutes = Math.ceil(remainingSeconds / 60)

  const progressPct = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0

  const currentPassageIndex = useMemo(() => {
    if (!currentQuestion) return 0
    return passages.findIndex((p) => p.id === currentQuestion.passage_id)
  }, [currentQuestion, passages])

  const handleAnswer = useCallback(
    (isCorrect: boolean, chosenText: string) => {
      if (!currentQuestion) return

      const chosen = currentQuestion.choices.findIndex((c) => c.text === chosenText)
      setChosenIndex(chosen)
      setPhase('explanation')

      setResults((prev) => [
        ...prev,
        { question: currentQuestion, correct: isCorrect, chosenText },
      ])
    },
    [currentQuestion],
  )

  const handleNext = useCallback(() => {
    if (!currentQuestion) return

    setResults((prev) => {
      const lastResult = prev[prev.length - 1]
      const wasCorrect = lastResult?.correct ?? false

      if (wasCorrect) {
        const nextIndex = currentQuestionIndex + 1

        if (nextIndex >= totalQuestions) {
          // 全問完了: 次のレンダーサイクルで onComplete を呼ぶ
          setTimeout(() => onComplete(prev), 0)
          return prev
        }

        const nextQuestion = readingQuestions[nextIndex]
        const nextPassageIndex = passages.findIndex((p) => p.id === nextQuestion.passage_id)
        const nextPassagePosition = passages[nextPassageIndex]?.position ?? nextPassageIndex + 1

        setUnlockedParagraphs((cur) => Math.max(cur, nextPassagePosition))
        setCurrentQuestionIndex(nextIndex)
        setShuffledChoices(shuffleChoices(nextQuestion.choices))
        setChosenIndex(null)
        setPhase('answering')
      } else {
        setShuffledChoices(shuffleChoices(currentQuestion.choices))
        setChosenIndex(null)
        setPhase('answering')
      }

      return prev
    })
  }, [currentQuestion, currentQuestionIndex, totalQuestions, readingQuestions, passages, onComplete])

  if (!currentQuestion) {
    return (
      <div className="reading-mode">
        <p>読解問題がありません。</p>
      </div>
    )
  }

  const questionWithShuffled: ReadingQuestionType = {
    ...currentQuestion,
    choices: shuffledChoices,
  }

  return (
    <div className="reading-mode">
      <div className="reading-mode__progress">
        <span>{answeredCount}/{totalQuestions}問</span>
        <span>あと約{remainingMinutes}分</span>
      </div>
      <div
        className="reading-mode__progress-bar"
        role="progressbar"
        aria-valuenow={answeredCount}
        aria-valuemin={0}
        aria-valuemax={totalQuestions}
        aria-label={`進捗: ${answeredCount}/${totalQuestions}問`}
      >
        <div
          className="reading-mode__progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ReadingPassage
        passages={passages}
        unlockedCount={unlockedParagraphs}
        currentPassageIndex={currentPassageIndex}
      />

      <ReadingQuestion
        question={questionWithShuffled}
        onAnswer={handleAnswer}
        showResult={phase === 'explanation'}
        chosenIndex={chosenIndex}
      />

      {phase === 'explanation' && (
        <button
          className="reading-question__next-btn"
          onClick={handleNext}
          aria-label="次の問題へ進む"
        >
          {results[results.length - 1]?.correct ? 'つぎへ →' : 'もう一度 →'}
        </button>
      )}
    </div>
  )
}
