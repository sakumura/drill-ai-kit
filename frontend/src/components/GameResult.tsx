import { useEffect, useMemo, useRef, useState } from 'react'
import { Question } from '../lib/api'
import type { ErrorType } from '../lib/errorClassification'
import { FractionText } from './FractionText'
import type { LessonScoreSummary } from '../lib/lessonScoring'

export interface QuestionResult {
  question: Question
  correct: boolean
  score: number
  timeTaken: number
  chosenText: string
  stepLabel?: string
  isRetry?: boolean
  understandingLevel?: number | null
  diagConversation?: string
}


export interface CarelessMiss {
  type: ErrorType
  label: string
  question: Question
  timeTaken?: number
  guidance?: string
}

interface GameResultProps {
  isPerfect: boolean
  totalTime: number
  attempts: number
  totalQuestions: number
  scoreSummary: LessonScoreSummary<QuestionResult>
  wrongResults: QuestionResult[]
  carelessMisses?: CarelessMiss[]
  mustRetry?: boolean
  remediationLabel?: string
  remediationExplanation?: string
  onRetry: () => void
  onRetryWrong?: () => void
  onOptionalExtra?: () => void
  onDone: () => void
}

// パーティクル（星型）の生成
function StarParticles({ gold }: { gold: boolean }) {
  // useMemo でマウント時に一度だけ生成（リレンダーで位置が変わらないように）
  const particles = useMemo(
    () =>
      Array.from({ length: 20 }).map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 0.8}s`,
        size: `${0.8 + Math.random() * 1.2}rem`,
        // Warm Studio palette: gold は gold/coral、標準はcoral/sage/gold のミックス
        color: gold
          ? ['var(--ws-gold)', 'var(--ws-coral)', 'var(--ws-gold-bg)'][i % 3]
          : ['var(--ws-coral)', 'var(--ws-sage-d)', 'var(--ws-gold)', 'var(--ws-coral-d)'][i % 4],
      })),
    [gold],
  )

  return (
    <div className="game-result__particles" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="game-result__particle"
          style={{
            left: p.left,
            animationDelay: p.delay,
            fontSize: p.size,
            color: p.color,
          }}
        >
          ★
        </span>
      ))}
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const start = Date.now()
    const animate = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])

  return value
}

export function GameResult({
  isPerfect,
  totalTime,
  attempts,
  totalQuestions,
  scoreSummary,
  wrongResults,
  carelessMisses,
  remediationLabel,
  remediationExplanation,
  onRetry,
  onRetryWrong,
  onOptionalExtra,
  onDone,
}: GameResultProps) {
  const missCount = wrongResults.length
  const displayTime = useCountUp(totalTime)

  // Warm Studio: tier for hero band color
  const accuracy = totalQuestions > 0 ? (scoreSummary.finalCorrectCount / totalQuestions) * 100 : 0
  const tier: 'master' | 'good' | 'practice' = isPerfect || accuracy >= 90
    ? 'master'
    : accuracy >= 70
      ? 'good'
      : 'practice'

  return (
    <div className={`game-result game-result--${tier}${isPerfect ? ' game-result--perfect' : ''}`}>
      <StarParticles gold={isPerfect} />

      <div className="game-result__header">
        <div className="game-result__trophy" aria-hidden="true">
          {isPerfect ? '🏆' : '💪'}
        </div>
        <h2 className={`game-result__title${isPerfect ? ' game-result__title--perfect' : ''}`}>
          {isPerfect ? 'クリア！' : 'まだクリアではないよ'}
        </h2>
        {isPerfect && (
          <div className="game-result__perfect-badge" aria-label="クリア達成">
            全問正解！
          </div>
        )}
        {!isPerfect && (
          <p className="game-result__subtitle">
            まちがえた問題を正解するまでやり直そう。
          </p>
        )}
      </div>

      {/* ご褒美（全問正解のみ） */}
      {isPerfect && (
        <div className="game-result__reward">
          <p className="game-result__reward-text">
            📱 スマホ利用時間 <strong>+30分</strong> ゲット！
          </p>
          <p className="game-result__reward-sub">
            ※今日2つ目以降のクリアは+10分
          </p>
        </div>
      )}

      {/* クリアタイム + ミス回数 */}
      <div className="game-result__stats">
        <div className="game-result__stat">
          <span className="game-result__stat-label">クリアタイム</span>
          <span className="game-result__stat-value">
            {formatTime(displayTime)}
          </span>
        </div>
        <div className="game-result__stat">
          <span className="game-result__stat-label">問題数</span>
          <span className="game-result__stat-value">
            {totalQuestions}<span className="game-result__stat-denom">問</span>
          </span>
        </div>
        <div className="game-result__stat">
          <span className="game-result__stat-label">初回正解</span>
          <span className="game-result__stat-value">
            {scoreSummary.firstCorrectCount}<span className="game-result__stat-denom">問</span>
          </span>
        </div>
        <div className="game-result__stat">
          <span className="game-result__stat-label">最終クリア</span>
          <span className={`game-result__stat-value${scoreSummary.finalCorrectCount === totalQuestions ? ' game-result__stat-value--zero' : ''}`}>
            {scoreSummary.finalCorrectCount}<span className="game-result__stat-denom">問</span>
          </span>
        </div>
      </div>

      <div className="game-result__learning-summary" aria-label="学習到達の内訳">
        <div className="game-result__summary-item">
          <span className="game-result__summary-label">やり直し後クリア</span>
          <span className="game-result__summary-value">{scoreSummary.rescuedCount}問</span>
        </div>
        <div className="game-result__summary-item">
          <span className="game-result__summary-label">まだ復習が必要</span>
          <span className="game-result__summary-value">{scoreSummary.needsReviewCount}問</span>
        </div>
        <div className="game-result__summary-item">
          <span className="game-result__summary-label">解答ログ</span>
          <span className="game-result__summary-value">{attempts}回</span>
        </div>
      </div>

      {/* 間違えた問題の復習 */}
      {wrongResults.length > 0 && (
        <div className="game-result__review">
          <h3 className="game-result__review-title">復習しよう</h3>
          <ul className="game-result__review-list">
            {wrongResults.map((r, i) => (
              <li key={i} className="game-result__review-item">
                <p className="game-result__review-question">
                  <FractionText text={r.question.question_text} />
                </p>
                <p className="game-result__review-wrong">
                  <span className="game-result__review-wrong-label">あなたの答え</span>
                  <FractionText text={r.chosenText || 'タイムアウト'} />
                </p>
                <p className="game-result__review-correct">
                  <span className="game-result__review-correct-label">正解</span>
                  <FractionText text={
                    (Array.isArray(r.question.hints[0])
                      ? (r.question.hints as string[][])[0][0]
                      : (r.question.hints as string[])[0]
                    ) || r.question.answer
                  } />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}


      {/* ケアレスミスチェック */}
      {carelessMisses && carelessMisses.length > 0 && (
        <div className="game-result__careless">
          <h3 className="game-result__careless-title">まちがいタイプ</h3>
          {carelessMisses.map((miss, i) => (
            <p key={i} className="game-result__careless-item">
              <span className={`game-result__careless-badge game-result__careless-badge--${miss.type}`}>
                {miss.label}
              </span>
              <span>
                「<FractionText text={miss.question.question_text.slice(0, 20)} />」
                {miss.timeTaken !== undefined ? ` ${Math.round(miss.timeTaken)}秒。` : ' '}
                {miss.guidance}
              </span>
            </p>
          ))}
        </div>
      )}
      {wrongResults.length > 0 && (remediationLabel || remediationExplanation) && (
        <div className="game-result__remediation">
          {remediationLabel && (
            <h3 className="game-result__remediation-title">{remediationLabel}</h3>
          )}
          {remediationExplanation && (
            <p className="game-result__remediation-text">
              <FractionText text={remediationExplanation} />
            </p>
          )}
        </div>
      )}
      {/* ボタン */}
      <div className="game-result__actions">
        {missCount > 0 ? (
          <button
            className="game-result__btn game-result__btn--retry"
            onClick={onRetryWrong ?? onRetry}
          >
            {remediationLabel ?? 'まちがえた問題を正解するまでやり直す'}
          </button>
        ) : (
          <>
            <button
              className="game-result__btn game-result__btn--retry"
              onClick={onRetry}
            >
              もう一回！
            </button>
            {onOptionalExtra && (
              <button
                className="game-result__btn game-result__btn--retry-wrong"
                onClick={onOptionalExtra}
              >
                任意追加に進む
              </button>
            )}
            <button
              className="game-result__btn game-result__btn--done"
              onClick={onDone}
            >
              もどる
            </button>
          </>
        )}
      </div>
    </div>
  )
}
