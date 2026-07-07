import { useState, useEffect, useRef, useCallback } from 'react'

interface AudioSegment {
  index: number
  file: string
  title: string
  display_text: string
}

interface AudioLessonProps {
  lessonId: string
  onComplete: () => void
}

export function AudioLesson({ lessonId, onComplete }: AudioLessonProps) {
  const [segments, setSegments] = useState<AudioSegment[]>([])
  const [currentSegment, setCurrentSegment] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [allCompleted, setAllCompleted] = useState(false)
  const [audioStarted, setAudioStarted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  // stale closure 回避用: 最新値を ref で保持
  const currentSegmentRef = useRef(0)
  const segmentsRef = useRef<AudioSegment[]>([])
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  useEffect(() => {
    currentSegmentRef.current = currentSegment
  }, [currentSegment])

  // アンマウント時に音声・タイマーを停止・解放
  useEffect(() => {
    return () => {
      if (autoPlayTimerRef.current !== null) {
        clearTimeout(autoPlayTimerRef.current)
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeAttribute('src')
        audioRef.current.load()
        audioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/audio/${lessonId}/manifest.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`manifest not found: ${r.status}`)
        return r.json()
      })
      .then((data: AudioSegment[]) => setSegments(data))
      .catch((e) => { if (e.name !== 'AbortError') setLoadError(e.message) })
    return () => controller.abort()
  }, [lessonId])

  const playSegment = useCallback((index: number) => {
    const segs = segmentsRef.current
    if (segs.length === 0 || index >= segs.length) return

    // 既存の音声と自動再生タイマーを停止・解放
    if (autoPlayTimerRef.current !== null) {
      clearTimeout(autoPlayTimerRef.current)
      autoPlayTimerRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load() // リスナー付きインスタンスを確実に解放
      audioRef.current = null
    }

    const seg = segs[index]
    const src = `/audio/${lessonId}/${seg.file}`
    const audio = new Audio(src)

    const onTimeUpdate = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration)
      }
    }
    const onEnded = () => {
      setIsPlaying(false)
      setProgress(1)
      const nextIndex = currentSegmentRef.current + 1
      const totalSegments = segmentsRef.current.length
      if (nextIndex < totalSegments) {
        setCurrentSegment(nextIndex)
        autoPlayTimerRef.current = setTimeout(() => {
          autoPlayTimerRef.current = null
          playSegment(nextIndex)
        }, 400)
      } else {
        setAllCompleted(true)
      }
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onError = () => {
      setIsPlaying(false)
      setLoadError('音声の再生に失敗しました')
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)

    audioRef.current = audio
    setCurrentSegment(index)
    setProgress(0)

    audio.play().catch((e) => {
      console.warn('[AudioLesson] play failed:', e)
      setLoadError('音声の再生に失敗しました')
    })
  }, [lessonId])

  const handleStart = useCallback(() => {
    if (segmentsRef.current.length === 0) return
    setAudioStarted(true)
    playSegment(0)
  }, [playSegment])

  const handleReplay = useCallback(() => {
    if (allCompleted) {
      setAllCompleted(false)
      setCurrentSegment(0)
      playSegment(0)
    } else {
      playSegment(currentSegmentRef.current)
    }
  }, [playSegment, allCompleted])

  if (loadError) {
    return (
      <div className="audio-lesson audio-lesson--error">
        <p className="audio-lesson__error-msg">音声ファイルの読み込みに失敗しました</p>
        <button
          className="audio-lesson__next-btn audio-lesson__next-btn--active"
          onClick={onComplete}
        >
          つぎへ →
        </button>
      </div>
    )
  }

  if (segments.length === 0) {
    return (
      <div className="audio-lesson">
        <div className="audio-lesson__loading">読み込み中…</div>
      </div>
    )
  }

  const seg = segments[currentSegment]

  return (
    <div className="audio-lesson">
      {/* セグメント進捗ドット */}
      <div
        className="audio-lesson__dots"
        aria-label={`${segments.length}つのパートのうち${currentSegment + 1}番目`}
      >
        {segments.map((_, i) => (
          <span
            key={i}
            className={[
              'audio-lesson__dot',
              i < currentSegment ? 'audio-lesson__dot--done' : '',
              i === currentSegment ? 'audio-lesson__dot--current' : '',
            ].filter(Boolean).join(' ')}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* メインカード */}
      <div className="audio-lesson__card">
        {/* スピーカーアイコン */}
        <div
          className={`audio-lesson__speaker${isPlaying ? ' audio-lesson__speaker--playing' : ''}`}
          aria-hidden="true"
        >
          🔊
        </div>

        <h2 className="audio-lesson__title">{seg.title}</h2>
        <p className="audio-lesson__text">{seg.display_text}</p>

        {/* プログレスバー: 再生開始後のみ表示 */}
        {audioStarted && (
          <div
            className="audio-lesson__progress-bar"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="再生位置"
          >
            <div
              className="audio-lesson__progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* アクションボタン */}
      <div className="audio-lesson__actions">
        {!audioStarted ? (
          <button
            className="audio-lesson__start-btn"
            onClick={handleStart}
            aria-label="音声を再生する"
          >
            聞いてみよう！
          </button>
        ) : (
          <button
            className="audio-lesson__replay-btn"
            onClick={handleReplay}
            aria-label="もう一度聞く"
          >
            もういちど
          </button>
        )}

        <button
          className={`audio-lesson__next-btn${allCompleted ? ' audio-lesson__next-btn--active' : ''}`}
          onClick={onComplete}
          disabled={!allCompleted}
          aria-label={
            allCompleted ? 'つぎへ進む' : '最後まで聞いてからつぎへ進めます'
          }
        >
          つぎへ →
        </button>
      </div>

      {allCompleted && (
        <p className="audio-lesson__complete-msg" aria-live="polite">
          すべて聞き終わったよ！つぎへどうぞ
        </p>
      )}
    </div>
  )
}
