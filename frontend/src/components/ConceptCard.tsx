import { useState, useEffect } from 'react'
import { ConceptCard } from '../lib/api'
import { FractionText } from './FractionText'

interface ConceptCardsProps {
  cards: ConceptCard[]
  currentIndex: number
  onNext: () => void
}

export function ConceptCards({ cards, currentIndex, onNext }: ConceptCardsProps) {
  const [canProceed, setCanProceed] = useState(false)
  const card = cards[currentIndex]
  const isLast = currentIndex === cards.length - 1

  useEffect(() => {
    setCanProceed(false)
    const timer = setTimeout(() => setCanProceed(true), 5000)
    return () => clearTimeout(timer)
  }, [currentIndex])

  return (
    <div className="concept-cards">
      <div className="concept-cards__progress">
        {currentIndex + 1} / {cards.length}
      </div>
      <div className="concept-cards__card">
        <h2 className="concept-cards__title">{card.title}</h2>
        <p className="concept-cards__text">
          <FractionText text={card.text} />
        </p>
        {card.image_hint && (
          <p className="concept-cards__hint">{card.image_hint}</p>
        )}
      </div>
      <button
        className={`concept-cards__btn${canProceed ? ' concept-cards__btn--ready' : ''}`}
        onClick={onNext}
        disabled={!canProceed}
        aria-label={isLast ? 'じゅんびOK！ゲームを始める' : '次のカードへ'}
      >
        {isLast ? 'じゅんびOK！' : 'つぎ →'}
      </button>
    </div>
  )
}
