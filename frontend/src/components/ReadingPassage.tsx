import { useEffect, useRef } from 'react'
import type { ReadingPassage as ReadingPassageType } from '../lib/api'

interface ReadingPassageProps {
  passages: ReadingPassageType[]
  unlockedCount: number
  currentPassageIndex: number
}

const PARAGRAPH_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function ReadingPassage({
  passages,
  unlockedCount,
  currentPassageIndex,
}: ReadingPassageProps) {
  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([])
  const prevUnlockedCount = useRef(unlockedCount)

  useEffect(() => {
    if (unlockedCount > prevUnlockedCount.current) {
      const newlyUnlocked = unlockedCount - 1
      const el = paragraphRefs.current[newlyUnlocked]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    prevUnlockedCount.current = unlockedCount
  }, [unlockedCount])

  return (
    <div className="reading-passage" role="article" aria-label="読解文">
      {passages.map((passage, index) => {
        const isUnlocked = passage.position <= unlockedCount
        const isCurrent = index === currentPassageIndex
        const isNewlyUnlocked =
          isUnlocked && passage.position === unlockedCount && unlockedCount > 1

        let className = 'reading-passage__paragraph'
        if (!isUnlocked) className += ' reading-passage__paragraph--locked'
        if (isCurrent && isUnlocked) className += ' reading-passage__paragraph--current'
        if (isNewlyUnlocked) className += ' reading-passage__paragraph--unlocking'

        return (
          <div
            key={passage.id}
            ref={(el) => { paragraphRefs.current[index] = el }}
            className={className}
            aria-hidden={!isUnlocked}
          >
            <span className="reading-passage__number" aria-hidden="true">
              {PARAGRAPH_NUMBERS[index] ?? `(${index + 1})`}
            </span>
            {passage.paragraph_text}
          </div>
        )
      })}
    </div>
  )
}
