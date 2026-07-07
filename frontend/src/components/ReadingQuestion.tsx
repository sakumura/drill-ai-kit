import type { ReadingQuestion as ReadingQuestionType } from '../lib/api'

interface ReadingQuestionProps {
  question: ReadingQuestionType
  onAnswer: (isCorrect: boolean, chosenText: string) => void
  showResult: boolean
  chosenIndex: number | null
}

const TIER_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: '事実確認', className: 'reading-question__tier-badge--1' },
  2: { label: '因果関係', className: 'reading-question__tier-badge--2' },
  3: { label: '心情理解', className: 'reading-question__tier-badge--3' },
  4: { label: '要旨把握', className: 'reading-question__tier-badge--4' },
}

const CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ']

export function ReadingQuestion({
  question,
  onAnswer,
  showResult,
  chosenIndex,
}: ReadingQuestionProps) {
  const tier = TIER_LABELS[question.difficulty_tier] ?? TIER_LABELS[1]
  const correctIndex = question.choices.findIndex((c) => c.isCorrect)

  function getChoiceClassName(index: number): string {
    let base = 'reading-question__choice'
    if (!showResult) return base
    if (index === correctIndex && index === chosenIndex) return base + ' reading-question__choice--correct'
    if (index === chosenIndex && !question.choices[index].isCorrect) return base + ' reading-question__choice--incorrect'
    if (index === correctIndex) return base + ' reading-question__choice--highlight'
    return base
  }

  return (
    <div className="reading-question" role="form" aria-label="設問">
      <span className={`reading-question__tier-badge ${tier.className}`} aria-label={`難易度: ${tier.label}`}>
        {tier.label}
      </span>

      <p className="reading-question__text">{question.question_text}</p>

      <div className="reading-question__choices" role="group" aria-label="選択肢">
        {question.choices.map((choice, i) => (
          <button
            key={i}
            className={getChoiceClassName(i)}
            onClick={() => !showResult && onAnswer(choice.isCorrect, choice.text)}
            disabled={showResult}
            aria-label={`選択肢${CHOICE_LABELS[i] ?? i + 1}: ${choice.text}`}
            aria-pressed={chosenIndex === i}
          >
            <span className="reading-question__choice-label" aria-hidden="true">
              {CHOICE_LABELS[i] ?? i + 1}
            </span>
            {choice.text}
          </button>
        ))}
      </div>

      {showResult && question.explanation && (
        <div className="reading-question__explanation" role="note" aria-live="polite">
          <span className="reading-question__explanation-icon" aria-hidden="true">
            {chosenIndex === correctIndex ? '○' : '✕'}
          </span>
          {question.explanation}
        </div>
      )}
    </div>
  )
}
