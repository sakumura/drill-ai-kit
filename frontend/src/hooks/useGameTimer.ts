import { useState, useEffect, useRef, useCallback } from 'react'

function getTimerSeconds(subject?: 'math' | 'japanese'): number {
  return subject === 'math' ? 60 : 30
}

export interface GameTimerResult {
  timeLeft: number
  totalSeconds: number
  progress: number // 0.0 ~ 1.0 (1.0 = full, 0.0 = empty)
  isRunning: boolean
  start: () => void
  stop: () => void
  reset: () => void
  calcScore: () => number
}

export function useGameTimer(onTimeout: () => void, subject?: 'math' | 'japanese'): GameTimerResult {
  const timerSeconds = getTimerSeconds(subject)
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeoutRef = useRef(onTimeout)

  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  const clear = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    clear()
    setTimeLeft(timerSeconds)
    setIsRunning(true)

    const startedAt = Date.now()

    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      const remaining = Math.max(0, timerSeconds - elapsed)
      setTimeLeft(remaining)

      if (remaining <= 0) {
        clear()
        setIsRunning(false)
        onTimeoutRef.current()
      }
    }, 100)
  }, [clear, timerSeconds])

  const stop = useCallback(() => {
    clear()
    setIsRunning(false)
  }, [clear])

  const reset = useCallback(() => {
    clear()
    setIsRunning(false)
    setTimeLeft(timerSeconds)
  }, [clear, timerSeconds])

  const calcScore = useCallback((): number => {
    return Math.floor(timeLeft * 10)
  }, [timeLeft])

  useEffect(() => {
    return () => {
      clear()
    }
  }, [clear])

  return {
    timeLeft,
    totalSeconds: timerSeconds,
    progress: timeLeft / timerSeconds,
    isRunning,
    start,
    stop,
    reset,
    calcScore,
  }
}
