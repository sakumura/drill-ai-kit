import { useEffect, useRef, useState } from 'react'
import { writeQueue } from '../lib/writeQueue'

type Status = 'saving' | 'saved' | 'failed' | 'dead_letter' | 'idle'

const POLL_INTERVAL_MS = 1000
// 「保存済み」をフェードアウトするまでの猶予
const SAVED_DISPLAY_MS = 2500
// 8 回失敗で dead-letter 退避される前の warning 閾値
const FAILED_THRESHOLD = 5

/**
 * 控えめな保存ステータスバッジ。
 *
 * 表示ルール:
 *   - queue が空かつ過去 SAVED_DISPLAY_MS 以内に保存があった → 「保存済み」（淡くフェード）
 *   - queue にアイテムが 1 つ以上ある → 「保存中…」
 *   - queue 内のいずれかが attempts >= FAILED_THRESHOLD → 「保存失敗（再試行中）」
 *   - dead-letter が 1 つ以上ある → 「未送信ログあり」+ 再送ボタン
 *   - それ以外（起動直後など）→ 何も出さない
 *
 * 配置は Layout の右上絶対位置。学習者の集中を切らさないよう極小サイズ。
 */
export function SaveStatusBadge() {
  const [status, setStatus] = useState<Status>('idle')
  const [deadLetterCount, setDeadLetterCount] = useState(0)
  const lastPendingAtRef = useRef<number>(0)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      let pending: ReturnType<typeof writeQueue.pending>
      try {
        pending = writeQueue.pending()
      } catch {
        pending = []
      }
      const deadLetters = writeQueue.deadLetters()
      setDeadLetterCount(deadLetters.length)
      if (deadLetters.length > 0) {
        if (fadeTimerRef.current) {
          clearTimeout(fadeTimerRef.current)
          fadeTimerRef.current = null
        }
        setStatus('dead_letter')
        return
      }

      const hasFailed = pending.some((p) => p.attempts >= FAILED_THRESHOLD)
      const hasPending = pending.length > 0

      if (hasPending) {
        lastPendingAtRef.current = Date.now()
        if (fadeTimerRef.current) {
          clearTimeout(fadeTimerRef.current)
          fadeTimerRef.current = null
        }
        setStatus(hasFailed ? 'failed' : 'saving')
      } else {
        // queue が空。直前まで送信があったなら「保存済み」を一瞬出してフェード
        const since = Date.now() - lastPendingAtRef.current
        if (lastPendingAtRef.current > 0 && since < SAVED_DISPLAY_MS) {
          setStatus('saved')
          if (!fadeTimerRef.current) {
            fadeTimerRef.current = setTimeout(() => {
              setStatus('idle')
              fadeTimerRef.current = null
            }, SAVED_DISPLAY_MS - since)
          }
        } else if (status === 'saving' || status === 'failed') {
          // 直前まで saving だったケース（pendingAt が 0 の経路）
          setStatus('saved')
          if (!fadeTimerRef.current) {
            fadeTimerRef.current = setTimeout(() => {
              setStatus('idle')
              fadeTimerRef.current = null
            }, SAVED_DISPLAY_MS)
          }
        }
      }
    }

    tick()
    const id = window.setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = null
      }
    }
    // status 依存を入れるとループするので意図的に空配列
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'idle') return null

  const label =
    status === 'saving'
      ? '保存中…'
      : status === 'failed'
        ? '保存失敗（再試行中）'
        : status === 'dead_letter'
          ? `未送信ログあり（${deadLetterCount}件）`
          : '保存済み'

  const tone =
    status === 'dead_letter'
      ? 'bg-red-100/95 text-red-800 border-red-300'
      : status === 'failed'
      ? 'bg-red-100/90 text-red-700 border-red-200'
      : status === 'saving'
        ? 'bg-amber-50/90 text-amber-700 border-amber-200'
        : 'bg-emerald-50/90 text-emerald-700 border-emerald-200'

  const handleRetry = () => {
    writeQueue.retryDeadLetters()
    setStatus('saving')
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-2 right-2 z-50 select-none
                  rounded-full border px-2.5 py-0.5 text-[10px] leading-tight
                  shadow-sm backdrop-blur-sm transition-opacity duration-500
                  ${tone}
                  ${status === 'saved' ? 'opacity-60' : 'opacity-90'}`}
    >
      <span>{label}</span>
      {status === 'dead_letter' && (
        <button
          type="button"
          onClick={handleRetry}
          className="ml-2 rounded-full border border-red-300 bg-white/70 px-2 py-0.5 font-bold text-red-800"
        >
          再送
        </button>
      )}
    </div>
  )
}
