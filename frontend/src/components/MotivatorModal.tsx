import { useEffect } from 'react'

interface MotivatorModalProps {
  message: string
  onClose: () => void
}

export function MotivatorModal({ message, onClose }: MotivatorModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="motivator-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="せんせいからのメッセージ"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="motivator-modal">
        <div className="motivator-modal__avatar" aria-hidden="true">
          ✨
        </div>
        <p className="motivator-modal__message">{message}</p>
        <button
          className="motivator-modal__btn"
          onClick={onClose}
          autoFocus
        >
          わかった！
        </button>
      </div>
    </div>
  )
}
