import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Question, SlotConfig } from '../lib/api'
import { FractionText } from './FractionText'
import { SlotPicker } from './SlotPicker'

interface Choice {
  text: string
  isCorrect: boolean
}

interface QuestionFlashProps {
  question: Question
  choices: Choice[]
  correctCount: number
  totalQuestions: number
  currentQuestionNumber?: number
  stepIndex: number
  totalSteps: number
  subPrompt?: string
  timerProgress: number // 0.0 ~ 1.0
  timeLeft: number
  flashResult: 'correct' | 'incorrect' | null
  correctChoiceIndex: number | null // 不正解時に正解を示すインデックス
  chosenIndex: number | null // 選択したインデックス
  choicesReady: boolean
  readingLockRemaining?: number | null
  subject?: 'math' | 'japanese'
  onChoose: (choice: Choice, index: number) => void
  onNext?: () => void // 不正解時に「つぎへ」ボタンで進む（AIスキップ時）
  // 診断フェーズ props
  diagPhase?: 'none' | 'step1' | 'step2' | 'done'
  diagData?: { question_text: string; choices: { text: string; isCorrect: boolean }[]; solution_steps: string[] } | null
  diagChoices?: { text: string; isCorrect: boolean }[]
  diagFlash?: 'correct' | 'incorrect' | null
  diagFeedback?: string
  onDiagChoose?: (choice: { text: string; isCorrect: boolean }) => void
  onDiagNext?: () => void
  showYakubunCheck?: boolean
  // ---- デバッグ補助 UI (2026-04-23 追加) ----
  /** ?debug=1 のときだけ true */
  debugUI?: boolean
  /** 全問プレビュー中 (情報表示のみ) */
  previewMode?: boolean
  /** スキップボタン押下ハンドラ。debugUI=true のときのみ渡される */
  onSkip?: () => void
  // ---- 新問題形式 (2026-04-27 追加, optional) ----
  /** 'choice' = 既存の3択 / 'slot' = SlotPicker。未指定なら 'choice' (既存挙動) */
  inputMode?: 'choice' | 'slot'
  /** inputMode='slot' のときに渡す。SlotPicker に流し込む config */
  slotConfig?: SlotConfig
  /** slot mode で「決定」が押された時のハンドラ。文字列が完全一致するかは呼び出し側で判定 */
  onSlotSubmit?: (value: string) => void
  // ---- スケッチゲート (2026-06-11 追加, optional) ----
  /** choicesReady=false の間、考えタイムの代わりに表示するスケッチゲート */
  sketchGateSlot?: ReactNode
}

interface ChoiceSelection {
  questionId: string
  stepIndex: number
  choicesKey: string
  index: number
}

// Warm Studio: 3択 pill はすべて cream/white 基調で統一し、CSS の hover / selected で色が変わる
const CHOICE_COLORS = [
  { bg: 'var(--ws-choice-bg)', border: 'var(--ws-choice-bd)', text: 'var(--ws-cocoa)' },
  { bg: 'var(--ws-choice-bg)', border: 'var(--ws-choice-bd)', text: 'var(--ws-cocoa)' },
  { bg: 'var(--ws-choice-bg)', border: 'var(--ws-choice-bd)', text: 'var(--ws-cocoa)' },
  { bg: 'var(--ws-choice-bg)', border: 'var(--ws-choice-bd)', text: 'var(--ws-cocoa)' },
]

function splitJapaneseBodyPrompt(text: string): { body: string; prompt: string } | null {
  const bodyMarker = '本文：'
  const promptMarker = '設問：'
  if (!text.startsWith(bodyMarker)) return null
  const promptIndex = text.indexOf(promptMarker, bodyMarker.length)
  if (promptIndex < 0) return null
  const body = text.slice(bodyMarker.length, promptIndex).trim()
  const prompt = text.slice(promptIndex + promptMarker.length).trim()
  if (!body || !prompt) return null
  return { body, prompt }
}

function QuestionText({ text, subject }: { text: string; subject?: 'math' | 'japanese' }) {
  const split = subject === 'japanese' ? splitJapaneseBodyPrompt(text) : null
  if (!split) {
    return (
      <p className="question-flash__question-text">
        <FractionText text={text} />
      </p>
    )
  }

  return (
    <div className="question-flash__question-text question-flash__question-text--split">
      <section className="question-flash__text-section">
        <h2 className="question-flash__text-label">【本文】</h2>
        <p className="question-flash__text-body">
          <FractionText text={split.body} />
        </p>
      </section>
      <section className="question-flash__text-section">
        <h2 className="question-flash__text-label">【設問】</h2>
        <p className="question-flash__text-body">
          <FractionText text={split.prompt} />
        </p>
      </section>
    </div>
  )
}

function fitInlineSvg(svg: SVGSVGElement): void {
  const elements = Array.from(svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text'))
    .filter((el): el is SVGGraphicsElement => 'getBBox' in el)
  if (elements.length === 0) return

  const isVisibleSvgBox = (box: DOMRect | null): box is DOMRect => {
    if (box === null) return false
    return box.width > 0 || box.height > 0
  }

  const boxes = elements
    .map((el) => {
      try {
        return el.getBBox()
      } catch {
        return null
      }
    })
    .filter(isVisibleSvgBox)
  if (boxes.length === 0) return

  const bounds = boxes.reduce(
    (acc, box) => ({
      left: Math.min(acc.left, box.x),
      top: Math.min(acc.top, box.y),
      right: Math.max(acc.right, box.x + box.width),
      bottom: Math.max(acc.bottom, box.y + box.height),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  )
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  if (width <= 0 || height <= 0) return

  const padding = Math.max(8, Math.max(width, height) * 0.08)
  svg.setAttribute(
    'viewBox',
    `${bounds.left - padding} ${bounds.top - padding} ${width + padding * 2} ${height + padding * 2}`,
  )
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
}

export function QuestionFlash({
  question,
  choices,
  correctCount,
  totalQuestions,
  currentQuestionNumber,
  stepIndex,
  totalSteps,
  subPrompt,
  timerProgress,
  timeLeft,
  flashResult,
  correctChoiceIndex,
  chosenIndex,
  choicesReady,
  readingLockRemaining,
  subject,
  onChoose,
  onNext,
  diagPhase,
  diagData,
  diagChoices,
  diagFlash,
  diagFeedback,
  onDiagChoose,
  onDiagNext,
  showYakubunCheck,
  debugUI,
  previewMode,
  onSkip,
  inputMode,
  slotConfig,
  onSlotSubmit,
  sketchGateSlot,
}: QuestionFlashProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const figureRef = useRef<HTMLDivElement>(null)
  const [nextBtnReady, setNextBtnReady] = useState(false)
  const [selection, setSelection] = useState<ChoiceSelection | null>(null)
  const [confirmedChoiceIndex, setConfirmedChoiceIndex] = useState<number | null>(null)
  const choicesKey = useMemo(() => choices.map((choice) => choice.text).join('\u001f'), [choices])
  const selectedChoiceIndex =
    selection &&
    selection.questionId === question.id &&
    selection.stepIndex === stepIndex &&
    selection.choicesKey === choicesKey
      ? selection.index
      : null
  const debugTotalQuestions = Math.max(totalQuestions, 1)
  const debugQuestionNumber = Math.min(
    Math.max(currentQuestionNumber ?? question.position ?? correctCount + 1, 1),
    debugTotalQuestions,
  )

  useEffect(() => {
    setSelection(null)
    setConfirmedChoiceIndex(null)
  }, [question.id, stepIndex, choicesKey, flashResult])

  const confirmChoice = (index: number) => {
    if (flashResult !== null || confirmedChoiceIndex !== null) return
    if (index !== selectedChoiceIndex) return
    const choice = choices[index]
    if (!choice) return
    setConfirmedChoiceIndex(index)
    onChoose(choice, index)
  }

  const handleChoiceClick = (index: number) => {
    if (flashResult !== null || confirmedChoiceIndex !== null) return
    setSelection({
      questionId: question.id,
      stepIndex,
      choicesKey,
      index,
    })
  }

  // 不正解時に「つぎへ」ボタンを3秒後に表示
  useEffect(() => {
    if (flashResult === 'incorrect') {
      setNextBtnReady(false)
      const timer = setTimeout(() => setNextBtnReady(true), 10000)
      return () => clearTimeout(timer)
    } else {
      setNextBtnReady(false)
    }
  }, [flashResult, question.id])

  // フラッシュエフェクト: コンテナにクラスを付与
  useEffect(() => {
    const el = containerRef.current
    if (!el || !flashResult) return
    el.classList.remove('flash-correct', 'flash-incorrect')
    void el.offsetWidth // reflow to restart animation
    el.classList.add(flashResult === 'correct' ? 'flash-correct' : 'flash-incorrect')
    const timer = setTimeout(() => {
      el.classList.remove('flash-correct', 'flash-incorrect')
    }, 600)
    return () => clearTimeout(timer)
  }, [flashResult])

  useLayoutEffect(() => {
    const svg = figureRef.current?.querySelector('svg')
    if (svg) fitInlineSvg(svg)
  }, [question.id, question.figure_svg])

  const isLowTime = timeLeft <= 3
  // タイマーバーの色は CSS の --ws-timer-fill（coral→coral-d グラデ）に委譲

  return (
    <div ref={containerRef} className="question-flash">
      {/* ヘッダー: 星進捗 */}
      <div className="question-flash__header">
        <div className="question-flash__progress">
          {totalSteps > 1 && (
            <div className="question-flash__step-indicator">
              <span className={`question-flash__step-badge question-flash__step-badge--${stepIndex + 1}`}>
                Step {stepIndex + 1}
              </span>
              {subPrompt && (
                <span className="question-flash__step-name">
                  {subPrompt}
                </span>
              )}
            </div>
          )}
        </div>
        <div
          className="question-flash__stars"
          aria-label={`${correctCount}/${totalQuestions}もん クリア`}
          role="status"
        >
          {Array.from({ length: totalQuestions }).map((_, i) => (
            <span
              key={i}
              className={`question-flash__star${i < correctCount ? ' question-flash__star--filled' : ''}`}
              aria-hidden="true"
            >
              {i < correctCount ? '★' : '☆'}
            </span>
          ))}
          <span className="question-flash__clear-count">
            {correctCount}/{totalQuestions} クリア
          </span>
        </div>
      </div>

      {/* タイマーバー */}
      <div
        className="question-flash__timer-track"
        role="progressbar"
        aria-valuenow={Math.round(timeLeft)}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label="残り時間"
      >
        <div
          className={`question-flash__timer-bar${isLowTime ? ' question-flash__timer-bar--urgent' : ''}`}
          style={{
            width: `${timerProgress * 100}%`,
            transition: 'width 0.1s linear',
          }}
        />
      </div>

      {/* T5: 約分チェックバナー */}
      {showYakubunCheck && (
        <div className="question-flash__yakubun-check">
          約分チェック！
        </div>
      )}

      {/* 問題文 */}
      <div className="question-flash__question-wrap">
        {question.figure_svg && (
          <div
            ref={figureRef}
            className="question-flash__figure"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: question.figure_svg }}
          />
        )}
        <QuestionText text={question.question_text} subject={subject} />
      </div>

      {/* 選択肢グリッド or SlotPicker or スケッチゲート or 考えタイム */}
      {!choicesReady && flashResult === null ? (
        sketchGateSlot ?? (
          readingLockRemaining !== null && readingLockRemaining !== undefined ? (
            <div className="question-flash__locked-choices" aria-live="polite">
              <p className="question-flash__think-text">もんだいをよもう… {readingLockRemaining}</p>
              <div className="question-flash__choices question-flash__choices--locked" role="group" aria-label="選択肢はまだ選べません">
                {choices.map((choice, i) => {
                  const colors = CHOICE_COLORS[i % CHOICE_COLORS.length]
                  return (
                    <button
                      key={i}
                      type="button"
                      className="question-flash__choice question-flash__choice--locked"
                      style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                      disabled
                      aria-label={`選択肢${i + 1}: ${choice.text}。まだ選べません`}
                    >
                      <span className="question-flash__choice-num" aria-hidden="true">{i + 1}</span>
                      <span className="question-flash__choice-text"><FractionText text={choice.text} /></span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="question-flash__think-time">
              <p className="question-flash__think-text">{subject === 'math' ? '計算してから選ぼう！' : 'よく読んで...'}</p>
            </div>
          )
        )
      ) : inputMode === 'slot' && slotConfig ? (
        // 新問題形式: SlotPicker を描画 (2026-04-27 追加)
        // 採点は呼び出し側 (LessonPage) が onSlotSubmit で受け取った value と
        // tier.correctValue の完全一致で判定する。
        <div
          className="question-flash__slot-wrap"
          role="group"
          aria-label="数値を入力してください"
        >
          <SlotPicker
            slotConfig={slotConfig}
            onSubmit={(v) => onSlotSubmit?.(v)}
            disabled={flashResult !== null}
          />
        </div>
      ) : (
        <div
          className="question-flash__choices"
          role="group"
          aria-label="解法を選んでください"
        >
          {choices.map((choice, i) => {
            const colors = CHOICE_COLORS[i % CHOICE_COLORS.length]

            // 結果フィードバック中のスタイル判定
            let overrideStyle: CSSProperties = {}
            let extraClass = ''
            const isSelected = selectedChoiceIndex === i && flashResult === null
            const isConfirming = confirmedChoiceIndex === i && flashResult === null
            if (flashResult !== null) {
              if (i === correctChoiceIndex) {
                overrideStyle = {
                  backgroundColor: 'var(--ws-choice-correct-bg)',
                  borderColor: 'var(--ws-choice-correct-bd)',
                  color: 'var(--ws-sage-fg)',
                }
                extraClass = ' question-flash__choice--correct'
              } else if (i === chosenIndex && flashResult === 'incorrect') {
                overrideStyle = {
                  backgroundColor: 'var(--ws-choice-wrong-bg)',
                  borderColor: 'var(--ws-choice-wrong-bd)',
                  color: 'var(--ws-coral-d)',
                }
                extraClass = ' question-flash__choice--wrong'
              }
            } else if (isSelected) {
              extraClass = ' question-flash__choice--selected'
            }

            return (
              <button
                key={i}
                type="button"
                className={`question-flash__choice${extraClass}`}
                style={
                  flashResult !== null && (i === correctChoiceIndex || i === chosenIndex)
                    ? overrideStyle
                    : {
                        backgroundColor: colors.bg,
                        borderColor: colors.border,
                        color: colors.text,
                      }
                }
                onClick={() => handleChoiceClick(i)}
                aria-label={`選択肢${i + 1}: ${choice.text}${isSelected ? '。決定ボタンで確定' : ''}`}
                aria-pressed={isSelected}
                disabled={flashResult !== null || confirmedChoiceIndex !== null}
              >
                <span className="question-flash__choice-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="question-flash__choice-text"><FractionText text={choice.text} /></span>
                {isConfirming && (
                  <span className="question-flash__choice-pending-label" aria-hidden="true">
                    決定中
                  </span>
                )}
                {i === correctChoiceIndex && flashResult === 'incorrect' && (
                  <span className="question-flash__choice-answer-label" aria-hidden="true">
                    正解はこれ！
                  </span>
                )}
                {i === chosenIndex && flashResult === 'correct' && (
                  <span className="question-flash__choice-correct-mark" aria-hidden="true">
                    ○
                  </span>
                )}
              </button>
            )
          })}
          <button
            type="button"
            className="question-flash__confirm-btn"
            onClick={() => {
              if (selectedChoiceIndex !== null) confirmChoice(selectedChoiceIndex)
            }}
            disabled={selectedChoiceIndex === null || flashResult !== null || confirmedChoiceIndex !== null}
          >
            この答えで決定
          </button>
        </div>
      )}

      {/* 正解時の解法フラッシュ */}
      {flashResult === 'correct' && question.solution_steps.length > 0 && (
        <div className="question-flash__correct-solution">
          <FractionText text={question.solution_steps[0]} />
        </div>
      )}

      {/* 不正解・タイムアウト時の解法例（診断データがある場合は非表示） */}
      {flashResult === 'incorrect' && question.solution_steps.length > 0 && (!diagPhase || diagPhase === 'none') && (
        <div className="question-flash__solution">
          <div className="question-flash__solution-header">こうやって解くよ！</div>
          <ol className="question-flash__solution-steps">
            {question.solution_steps.map((step, i) => (
              <li key={i} className="question-flash__solution-step">
                <FractionText text={step} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 診断フェーズ: 同概念の簡単な確認問題 */}
      {flashResult === 'incorrect' && diagPhase && diagPhase !== 'none' && (
        <div className="question-flash__diagnosis">
          {(diagPhase === 'step1' || diagPhase === 'step2') && (
            <>
              <div className="question-flash__diag-label">
                もう1もん！
              </div>
              <div className="question-flash__diag-choices">
                {diagChoices?.map((choice, i) => {
                  const colors = CHOICE_COLORS[i % CHOICE_COLORS.length]
                  let style: CSSProperties = {
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    color: colors.text,
                  }
                  if (diagFlash !== null && choice.isCorrect) {
                    style = {
                      backgroundColor: 'var(--ws-choice-correct-bg)',
                      borderColor: 'var(--ws-choice-correct-bd)',
                      color: 'var(--ws-sage-fg)',
                    }
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      className="question-flash__choice"
                      style={style}
                      onClick={() => onDiagChoose?.(choice)}
                      aria-label={`診断の選択肢${i + 1}: ${choice.text}`}
                      disabled={diagFlash !== null}
                    >
                      <span className="question-flash__choice-num" aria-hidden="true">{i + 1}</span>
                      <span className="question-flash__choice-text">
                        <FractionText text={choice.text} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {diagPhase === 'done' && diagFeedback && (
            <div className="question-flash__diag-feedback">
              {diagFeedback}
            </div>
          )}
        </div>
      )}

      {/* デバッグ補助 UI: ?debug=1 のときのみ表示 (2026-04-23 追加)
          - フラッシュ・10秒待機・診断フェーズを全てバイパスして即次問へ
          - 通常モードでは描画されない (子供が誤って押せないように) */}
      {debugUI && onSkip && (
        <div className="question-flash__debug-bar" role="group" aria-label="デバッグ操作">
          <span className="question-flash__debug-status" aria-live="polite">
            {previewMode ? '🔍 プレビュー中 ' : '🐞 デバッグ '}
            Q{debugQuestionNumber}/{debugTotalQuestions}
          </span>
          <button
            type="button"
            className="question-flash__debug-skip"
            onClick={onSkip}
            aria-label="デバッグ: この問題をスキップして次へ"
          >
            スキップ ▶
          </button>
        </div>
      )}

      {/* 不正解時の「つぎへ」ボタン: 3秒後に表示 */}
      {flashResult === 'incorrect' && nextBtnReady && (
        (!diagPhase || diagPhase === 'none')
          ? (onNext && (
            <button className="question-flash__next-btn" onClick={onNext}>
              つぎへ →
            </button>
          ))
          : diagPhase === 'done'
            ? (onDiagNext && (
              <button className="question-flash__next-btn" onClick={onDiagNext}>
                つぎへ →
              </button>
            ))
            : null
      )}
    </div>
  )
}
