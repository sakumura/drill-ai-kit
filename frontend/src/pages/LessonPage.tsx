import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useLesson } from '../hooks/useLesson'
import { useGameTimer } from '../hooks/useGameTimer'
import { api, isDebugMode, requestSketchFeedback, saveSketchLog, Question, DiagnoseResponse, LessonBlock, AnswerRecord, LessonBlockKind, LessonBlockType } from '../lib/api'
import { buildErrorClassification } from '../lib/errorClassification'
import { buildStepLabel, buildTiersForQuestion, getStepProgress, getTotalSteps, needsReadingLock, resolveChoiceMeta, type Choice, type Tier } from '../lib/questionEngine'
import { buildRemediationPlan, remediationStageLabel } from '../lib/remediation'
import { isSlotAnswerCorrect } from '../lib/slotScoring'
import { buildAttemptResultsFromAnswerHistory, summarizeLessonResults, type LessonAnswerHistoryLike } from '../lib/lessonScoring'
import { GameStart } from '../components/GameStart'
import { QuestionFlash } from '../components/QuestionFlash'
import { SketchGate, type SketchSubmission } from '../components/SketchGate'
import { GameResult, QuestionResult, CarelessMiss } from '../components/GameResult'
import { ConceptCards } from '../components/ConceptCard'
import { ReadingMode } from '../components/ReadingMode'
import type { ReadingResult } from '../components/ReadingMode'

type GamePhase = 'start' | 'concept' | 'playing' | 'reading' | 'result'
type DiagPhase = 'none' | 'step1' | 'step2' | 'done'

// スケッチゲートのシャドーモードフラグ:
// false の間は AI コメントを表示せず固定の感謝文のみ（AI 判定はログに記録される）。
// sketch ログの実画像照合で精度確認後に true へ切り替えて再デプロイする。
const SKETCH_COMMENT_VISIBLE = false
const SKETCH_FIXED_COMMENT = 'ずをかいてくれてありがとう！'
const SKETCH_TOAST_MS = 4000

// 同日にチュートリアル(concept_cards)を表示済みかを localStorage で日付キーで記録
// 同じ日に何度も表示されるとストレスになるため、2回目以降はスキップする
function conceptSeenKey(lessonId: string | undefined): string {
  const today = new Date().toISOString().slice(0, 10)
  return `concept_seen_${lessonId ?? 'unknown'}_${today}`
}
function hasSeenConceptToday(lessonId: string | undefined): boolean {
  if (!lessonId) return false
  try {
    return localStorage.getItem(conceptSeenKey(lessonId)) === '1'
  } catch {
    return false
  }
}
function markConceptSeen(lessonId: string | undefined): void {
  if (!lessonId) return
  try {
    localStorage.setItem(conceptSeenKey(lessonId), '1')
  } catch {
    /* noop */
  }
}

function detectCarelessMisses(results: QuestionResult[], subject?: 'math' | 'japanese', difficulty?: number): CarelessMiss[] {
  const misses: CarelessMiss[] = []
  for (const r of results) {
    const classification = buildErrorClassification({
      is_correct: r.correct,
      time_spent_sec: Math.round(r.timeTaken),
      timeTaken: r.timeTaken,
      subject,
      step_label: r.stepLabel,
      question_type: r.question.question_type,
      common_mistakes: r.question.common_mistakes,
      difficulty,
      mistakeGuidance: r.question.common_mistakes?.[0]?.guidance,
    })
    if (!classification) continue
    misses.push({
      type: classification.type,
      label: classification.label,
      question: r.question,
      timeTaken: classification.timeTaken,
      guidance: classification.guidance,
    })
  }
  return misses
}

function isMultiStep(question: Question): boolean {
  return Array.isArray(question.hints) && Array.isArray(question.hints[0])
}

function buildChoicesForStep(hints: string[]): Choice[] {
  const safeHints = Array.isArray(hints) ? hints : []
  const correct: Choice = { text: safeHints[0] ?? '', isCorrect: true }
  const wrongs: Choice[] = safeHints.slice(1, 3).map((h) => ({ text: h, isCorrect: false }))
  const all = [...wrongs, correct]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

function buildChoices(question: Question, stepIndex = 0): Choice[] {
  // 新形式 two_tier / evidence_first: hints は string[6] (flat)
  // Tier1=hints[0..2], Tier2=hints[3..5] を stepIndex で切替
  const qType = question.question_type
  if ((qType === 'two_tier' || qType === 'evidence_first') && Array.isArray(question.hints) && !Array.isArray(question.hints[0])) {
    const flat = question.hints as string[]
    const slice = stepIndex === 0 ? flat.slice(0, 3) : flat.slice(3, 6)
    return buildChoicesForStep(slice)
  }
  if (isMultiStep(question)) {
    const steps = question.hints as string[][]
    return buildChoicesForStep(steps[stepIndex] ?? [])
  }
  // 1ステップ: hintsの最初3要素を使う
  const hints = question.hints as string[]
  return buildChoicesForStep(hints.slice(0, 3))
}

function buildAnswerMetadata(
  question: Question,
  tier: Tier | undefined,
  choiceText: string,
  step: number,
): Pick<AnswerRecord, 'question_type' | 'step_purpose' | 'misconception_tag' | 'unit_id' | 'difficulty'> {
  const choiceMeta = resolveChoiceMeta(question.choice_meta, choiceText, step)
  return {
    question_type: question.question_type,
    step_purpose: choiceMeta?.purpose ?? tier?.purpose,
    misconception_tag: choiceMeta?.misconception_tag,
    unit_id: question.unit_id,
    difficulty: question.difficulty,
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function sampleCheckerQuestions(questions: Question[], count = 8): Question[] {
  const threeStep = questions.filter((q) => Array.isArray(q.hints) && Array.isArray(q.hints[0]) && (q.hints as string[][]).length === 3)
  const twoStep = questions.filter((q) => Array.isArray(q.hints) && Array.isArray(q.hints[0]) && (q.hints as string[][]).length === 2)
  const half = Math.floor(count / 2)
  const picked = [...shuffle(threeStep).slice(0, half), ...shuffle(twoStep).slice(0, half)]
  return shuffle(picked).map((q, i) => ({ ...q, position: i + 1 }))
}

function getSubPrompt(question: Question, stepIndex: number): string | undefined {
  if (isMultiStep(question)) {
    return question.solution_steps[stepIndex]
  }
  return undefined
}

function scrollToTop() {
  window.scrollTo(0, 0)
}

const BUILD_VERSION = '2026-05-17-v2-no-understand-gate'
const STEP_CORRECT_FEEDBACK_MS = 1500
const READING_LOCK_SECONDS = 5

// weakness_profile.json score >= 90 のユニット（弱点集中矯正対象）
const HIGH_WEAKNESS_UNITS = new Set(['shousu-to-bunsu', 'bunsu-to-bunsu', 'yakubun-checker', 'yakusu-baisu', 'shousu-kakezan-warizan'])

const LEGACY_BLOCK_TYPE: Record<LessonBlockKind, LessonBlockType> = {
  review: 'warmup',
  main: 'core',
  spiral: 'weakness_spiral',
  exam: 'exam_transfer',
  confidence: 'confidence_recovery',
}

const BLOCK_TYPE_TO_KIND: Record<LessonBlockType, LessonBlockKind> = {
  warmup: 'review',
  core: 'main',
  weakness_spiral: 'spiral',
  exam_transfer: 'exam',
  confidence_recovery: 'confidence',
  optional_extra: 'spiral',
}

function lessonBlocks(questions: Question[], blocks: LessonBlock[] | undefined): LessonBlock[] {
  if (blocks && blocks.length > 0) return blocks
  return [
    {
      id: 'all',
      title: '今日の学習',
      kind: 'main',
      block_type: 'core',
      question_ids: questions.map((question) => question.id),
    },
  ]
}

function blockType(block: LessonBlock): LessonBlockType {
  if (block.block_type) return block.block_type
  if (block.kind) return LEGACY_BLOCK_TYPE[block.kind]
  return 'core'
}

function blockKind(block: LessonBlock): LessonBlockKind {
  if (block.kind) return block.kind
  return BLOCK_TYPE_TO_KIND[blockType(block)]
}

function isOptionalBlock(block: LessonBlock): boolean {
  return block.optional_extra === true || blockType(block) === 'optional_extra'
}

function blockForQuestion(blocks: LessonBlock[], question: Question | undefined): LessonBlock | null {
  if (!question) return null
  return blocks.find((block) => block.question_ids.includes(question.id)) ?? null
}

function answerBlockMetadata(blocks: LessonBlock[], question: Question | undefined): Pick<AnswerRecord, 'block_id' | 'block_type' | 'block_position' | 'block_question_position' | 'optional_extra'> {
  const block = blockForQuestion(blocks, question)
  if (!block || !question) return {}
  return {
    block_id: block.id,
    block_type: blockType(block),
    block_position: blocks.indexOf(block) + 1,
    block_question_position: block.question_ids.indexOf(question.id) + 1,
    optional_extra: isOptionalBlock(block),
  }
}

function blockProgress(block: LessonBlock | null, results: QuestionResult[]): { correct: number; done: number; total: number } {
  if (!block) return { correct: 0, done: 0, total: 0 }
  const ids = new Set(block.question_ids)
  const latest = new Map<string, QuestionResult>()
  for (const result of results) {
    if (ids.has(result.question.id)) latest.set(result.question.id, result)
  }
  const completed = [...latest.values()]
  return {
    correct: completed.filter((result) => result.correct).length,
    done: completed.length,
    total: block.question_ids.length,
  }
}

function mainQuestionIds(questions: Question[], blocks: LessonBlock[]): Set<string> {
  const optionalIds = new Set(blocks.filter(isOptionalBlock).flatMap((block) => block.question_ids))
  const required = questions.filter((question) => !optionalIds.has(question.id))
  return new Set((required.length > 0 ? required : questions).map((question) => question.id))
}

function optionalQuestionIds(blocks: LessonBlock[]): Set<string> {
  return new Set(blocks.filter(isOptionalBlock).flatMap((block) => block.question_ids))
}

function filterQuestionResults(results: QuestionResult[], questionIds: Set<string>): QuestionResult[] {
  return results.filter((result) => questionIds.has(result.question.id))
}

function restoreResultsFromAnswerHistory(lesson: { questions: Question[] }, answerHistory: LessonAnswerHistoryLike[]): QuestionResult[] {
  const questionById = new Map(lesson.questions.map((question) => [question.id, question]))
  return buildAttemptResultsFromAnswerHistory(answerHistory, lesson.questions)
    .map((attempt): QuestionResult | null => {
      const question = questionById.get(attempt.question.id)
      if (!question) return null
      return {
        question,
        correct: attempt.correct,
        score: attempt.correct ? 100 : 0,
        timeTaken: attempt.timeTaken,
        chosenText: attempt.chosenText,
        stepLabel: attempt.stepLabel,
      }
    })
    .filter((result): result is QuestionResult => result !== null)
}

export function LessonPage() {
  console.log('[LessonPage] version:', BUILD_VERSION)
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lessonState = useLesson(id)

  const [phase, setPhase] = useState<GamePhase>('start')
  const [conceptIndex, setConceptIndex] = useState(0)
  const [roundNumber, setRoundNumber] = useState(1)
  const [qIndex, setQIndex] = useState(0)
  const [choices, setChoices] = useState<Choice[]>([])
  const [results, setResults] = useState<QuestionResult[]>([])
  const [flashResult, setFlashResult] = useState<'correct' | 'incorrect' | null>(null)
  const [correctChoiceIndex, setCorrectChoiceIndex] = useState<number | null>(null)
  const [chosenIndex, setChosenIndex] = useState<number | null>(null)
  const [startTime, setStartTime] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [totalSteps, setTotalSteps] = useState(1)
  // 新問題形式: 現在の問題の Tier 配列 (buildTiersForQuestion 結果)
  // single_tier では length=1。stepIndex を tier index としても流用する。
  const [currentTiers, setCurrentTiers] = useState<Tier[]>([])
  const [wrongOnlyIndices, setWrongOnlyIndices] = useState<number[] | null>(null)
  const [remediationLabel, setRemediationLabel] = useState<string | undefined>(undefined)
  const [remediationExplanation, setRemediationExplanation] = useState<string | undefined>(undefined)
  const [showYakubunCheck, setShowYakubunCheck] = useState(false)
  // Sampled question set for the current game round (yakubun-checker gets 8 random; others get all)
  const [gameQuestions, setGameQuestions] = useState<Question[]>([])

  const [choicesReady, setChoicesReady] = useState(false)
  const [questionRunKey, setQuestionRunKey] = useState(0)

  // スケッチゲート: 採点に影響しない advisory 専用の作図ステップ
  const [sketchGateActive, setSketchGateActive] = useState(false)
  const [readingLockRemaining, setReadingLockRemaining] = useState<number | null>(null)
  const readingLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sketchToast, setSketchToast] = useState<string | null>(null)
  // 問題遷移ごとに増分し、遅れて届いた AI 結果（stale）を破棄するためのトークン
  const sketchRunIdRef = useRef(0)
  const sketchToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ?debug=1 のとき有効化されるデバッグ補助 UI 用フラグ
  // - スキップボタンの表示
  // - 全問プレビューモード
  const debugUI = isDebugMode()
  const [previewMode, setPreviewMode] = useState(false)
  const previewModeRef = useRef(false)

  const [diagPhase, setDiagPhase] = useState<DiagPhase>('none')
  const [diagData, setDiagData] = useState<DiagnoseResponse | null>(null)
  const [diagStep1Result, setDiagStep1Result] = useState<boolean | null>(null)
  const [diagChoices, setDiagChoices] = useState<Choice[]>([])
  const [diagFlash, setDiagFlash] = useState<'correct' | 'incorrect' | null>(null)
  const [diagFeedback, setDiagFeedback] = useState<string>('')

  const questionStartRef = useRef<number>(Date.now())
  const processingRef = useRef(false)
  const qIndexRef = useRef(0)
  const stepIndexRef = useRef(0)
  const correctAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref mirror of gameQuestions so callbacks always see the current sampled set
  const gameQuestionsRef = useRef<Question[]>([])
  const resultsRef = useRef<QuestionResult[]>([])
  const completionSentRef = useRef(false)
  const blockCompletionSentRef = useRef<Set<string>>(new Set())
  // 2026-05-13: 即時再出題用。誤答した (question_id + step) を一度だけ再表示するために記録する。
  // 初回 attempt は weakness 用に保持し、再出題 attempt は final/rescued 集計用に区別して保存する。
  const retriedQuestionsRef = useRef<Set<string>>(new Set())
  const activeRetryKeyRef = useRef<string | null>(null)

  const clearCorrectAdvanceTimer = useCallback(() => {
    if (correctAdvanceTimerRef.current) {
      clearTimeout(correctAdvanceTimerRef.current)
      correctAdvanceTimerRef.current = null
    }
  }, [])

  useEffect(() => clearCorrectAdvanceTimer, [clearCorrectAdvanceTimer])

  useEffect(() => {
    resultsRef.current = results
  }, [results])

  const activeLessonId = lessonState.status === 'success' ? lessonState.lesson.id : id

  useEffect(() => {
    completionSentRef.current = false
    blockCompletionSentRef.current = new Set()
  }, [activeLessonId])

  const handleTimeout = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true

    if (lessonState.status !== 'success') {
      processingRef.current = false
      return
    }
    const q = gameQuestionsRef.current[qIndexRef.current]
    // デバッグモード中の放置タイムアップは記録・採点しない（結果カウント/ポイント/R2送信を汚さない）
    if (q && !debugUI) {
      const blocks = lessonBlocks(gameQuestionsRef.current, lessonState.lesson.blocks)
      const timeoutSec = lessonState.lesson.subject === 'math' ? 60 : 30
      const tiers = currentTiers.length > 0 ? currentTiers : buildTiersForQuestion(q)
      const step = stepIndexRef.current
      const tier = tiers[step]
      const retryKey = `${q.id}:${step}`
      const isRetry = activeRetryKeyRef.current === retryKey
      setResults((prev) => [
        ...prev,
        {
          question: q,
          correct: false,
          score: 0,
          timeTaken: timeoutSec,
          chosenText: '',
          stepLabel: buildStepLabel(tiers, step),
          isRetry,
        },
      ])
      activeRetryKeyRef.current = null
      await api.saveAnswerRealtime({
        question_id: q.id,
        lesson_id: q.lesson_id,
        user_answer: '',
        is_correct: false,
        time_spent_sec: timeoutSec,
        hints_used: 0,
        step: step + 1,
        step_label: buildStepLabel(tiers, step),
        ...buildAnswerMetadata(q, tier, '', step + 1),
        ...answerBlockMetadata(blocks, q),
        is_retry: isRetry,
      })
    }

    setFlashResult('incorrect')
    const correctIdx = lessonState.status === 'success' ? choices.findIndex((c) => c.isCorrect) : null
    setCorrectChoiceIndex(correctIdx)
    // ボタンクリックで次へ進む（自動遷移しない）
  }, [lessonState, choices, currentTiers, debugUI]) // eslint-disable-line react-hooks/exhaustive-deps

  const subject = lessonState.status === 'success' ? lessonState.lesson.subject : undefined
  const timer = useGameTimer(handleTimeout, subject)

  const clearReadingLockTimer = useCallback(() => {
    if (readingLockTimerRef.current) {
      clearTimeout(readingLockTimerRef.current)
      readingLockTimerRef.current = null
    }
  }, [])

  const showChoicesNow = useCallback(() => {
    clearReadingLockTimer()
    setReadingLockRemaining(null)
    questionStartRef.current = Date.now()
    setChoicesReady(true)
    timer.start()
  }, [clearReadingLockTimer, timer])

  useEffect(() => clearReadingLockTimer, [clearReadingLockTimer])

  const showSketchToast = useCallback((message: string) => {
    if (sketchToastTimerRef.current) clearTimeout(sketchToastTimerRef.current)
    setSketchToast(message)
    sketchToastTimerRef.current = setTimeout(() => {
      sketchToastTimerRef.current = null
      setSketchToast(null)
    }, SKETCH_TOAST_MS)
  }, [])

  useEffect(() => () => {
    if (sketchToastTimerRef.current) clearTimeout(sketchToastTimerRef.current)
  }, [])

  // 問題単位の入口（新しい問題を表示する全経路がここを通る）。
  // sketch_gate 付きならゲートを開いてタイマーを止めたまま待ち、
  // それ以外は従来どおり即座に選択肢表示 + タイマー開始。
  // 5/14 の selectedChoiceIndex 持ち越しバグの教訓: 状態は遷移ごとに必ず確定させる。
  const enterQuestion = useCallback((q: Question | undefined) => {
    setQuestionRunKey((prev) => prev + 1)
    sketchRunIdRef.current += 1 // 前問スケッチの遅延 AI 結果を無効化
    clearReadingLockTimer()
    setReadingLockRemaining(null)
    setSketchToast(null)
    timer.stop()
    if (q?.sketch_gate) {
      setSketchGateActive(true)
      setChoicesReady(false)
    } else {
      setSketchGateActive(false)
      if (q && needsReadingLock(q, subject) && stepIndexRef.current === 0 && activeRetryKeyRef.current === null) {
        setChoicesReady(false)
        setReadingLockRemaining(READING_LOCK_SECONDS)
        let remaining = READING_LOCK_SECONDS
        const tick = () => {
          remaining -= 1
          if (remaining <= 0) {
            showChoicesNow()
            return
          }
          setReadingLockRemaining(remaining)
          readingLockTimerRef.current = setTimeout(tick, 1000)
        }
        readingLockTimerRef.current = setTimeout(tick, 1000)
      } else {
        showChoicesNow()
      }
    }
  }, [clearReadingLockTimer, showChoicesNow, subject, timer])

  // スケッチ提出: 即座にゲートを閉じて選択肢へ進む（AI 応答を待たない）。
  // AI 判定とログ記録は裏で進め、stale なら表示を破棄する。
  const handleSketchSubmit = useCallback((submission: SketchSubmission) => {
    const q = gameQuestionsRef.current[qIndexRef.current]
    setSketchGateActive(false)
    showChoicesNow()
    if (!q) return
    // シャドー期間は提出直後に固定の感謝コメントだけ出す
    if (!SKETCH_COMMENT_VISIBLE) showSketchToast(SKETCH_FIXED_COMMENT)
    const runId = sketchRunIdRef.current
    const sketchKind = q.sketch_kind ?? 'figure'
    void (async () => {
      const feedback = submission.imageDataUrl
        ? await requestSketchFeedback({
            question_id: q.id,
            lesson_id: q.lesson_id,
            image: submission.imageDataUrl,
            figure_hint: q.sketch_hint ?? '',
            kind: sketchKind,
            ...(sketchKind === 'kanji' ? { answer: q.answer } : {}),
          })
        : { category: 'ok' as const, comment: '', fallback: true }
      const stale = runId !== sketchRunIdRef.current
      const commentShown = !stale && SKETCH_COMMENT_VISIBLE && feedback.comment.length > 0
      if (commentShown) showSketchToast(feedback.comment)
      void saveSketchLog({
        question_id: q.id,
        lesson_id: q.lesson_id,
        stroke_count: submission.strokeCount,
        duration_sec: submission.durationSec,
        kind: sketchKind,
        ai_category: feedback.category,
        ai_comment: feedback.comment,
        comment_shown: commentShown,
        fallback: feedback.fallback === true,
        ...(submission.imageBase64 ? { image_b64: submission.imageBase64 } : {}),
      })
    })()
  }, [showChoicesNow, showSketchToast])

  const wrongOnlyRef = useRef<number[] | null>(null)
  const advanceRef = useRef<() => void>(() => {})

  const advance = useCallback(() => {
    if (lessonState.status !== 'success') return
    const questions = gameQuestionsRef.current
    const indices = wrongOnlyRef.current

    const nextQIndex = (currentIdx: number): number | null => {
      if (indices) {
        const currentPos = indices.indexOf(currentIdx)
        const nextPos = currentPos + 1
        if (nextPos >= indices.length) return null
        return indices[nextPos]
      } else {
        const next = currentIdx + 1
        if (next >= questions.length) return null
        return next
      }
    }

    const nextIdx = nextQIndex(qIndexRef.current)
    if (nextIdx === null) {
      timer.stop()
      setPhase('result')
      return
    }

    const nextQ = questions[nextIdx]
    if (!indices) {
      const blocks = lessonBlocks(questions, lessonState.lesson.blocks)
      const optionalIds = optionalQuestionIds(blocks)
      if (optionalIds.has(nextQ.id)) {
        const mainIds = mainQuestionIds(questions, blocks)
        const mainResults = filterQuestionResults(resultsRef.current, mainIds)
        const mainSummary = summarizeLessonResults(mainResults, mainIds.size)
        if (mainSummary.firstAttemptResults.length >= mainIds.size) {
          timer.stop()
          setPhase('result')
          return
        }
      }
    }

    activeRetryKeyRef.current = null
    const nextTiers = buildTiersForQuestion(nextQ)
    stepIndexRef.current = 0
    setStepIndex(0)
    setCurrentTiers(nextTiers)
    setTotalSteps(nextTiers.length || getTotalSteps(nextQ))
    qIndexRef.current = nextIdx
    setQIndex(nextIdx)
    setChoices(nextTiers[0]?.choices ?? buildChoices(nextQ, 0))
    scrollToTop()
    enterQuestion(nextQ)
  }, [lessonState, timer, enterQuestion])

  advanceRef.current = advance

  const advanceAfterCorrectFeedback = useCallback(() => {
    clearCorrectAdvanceTimer()
    correctAdvanceTimerRef.current = setTimeout(() => {
      correctAdvanceTimerRef.current = null
      setFlashResult(null)
      setCorrectChoiceIndex(null)
      setChosenIndex(null)
      processingRef.current = false
      advanceRef.current()
    }, STEP_CORRECT_FEEDBACK_MS)
  }, [clearCorrectAdvanceTimer])

  // ---- デバッグ用スキップ ----
  // 仕様 (2026-04-23 追加):
  // - ?debug=1 のときだけ表示・呼び出し可
  // - 答案 API は呼ばない（DB の is_correct INTEGER NOT NULL 制約により
  //   skip を NULL 保存できない。「skip="0" として保存」すると briefing 集計が
  //   不正解として記録され analytics 汚染となるため、保存自体を行わない）
  // - フラッシュ・10秒待機・診断フェーズを全てバイパスして即次問へ
  const handleSkip = useCallback(() => {
    if (!debugUI) return
    if (lessonState.status !== 'success') return
    // 進行中フラグを強制リセット
    processingRef.current = false
    timer.stop()
    setFlashResult(null)
    setCorrectChoiceIndex(null)
    setChosenIndex(null)
    clearCorrectAdvanceTimer()
    resetDiagState()
    advanceRef.current()
  }, [debugUI, lessonState, timer, clearCorrectAdvanceTimer])

  // result フェーズに到達したら previewMode を解除
  useEffect(() => {
    if (phase === 'result' && previewModeRef.current) {
      previewModeRef.current = false
      setPreviewMode(false)
    }
  }, [phase])

  const handleChoose = useCallback(
    async (choice: Choice, index: number) => {
      if (processingRef.current || !timer.isRunning) return
      processingRef.current = true

      const elapsed = (Date.now() - questionStartRef.current) / 1000
      const timeTaken = Math.min(elapsed, timer.totalSeconds)
      setChosenIndex(index)

      if (lessonState.status !== 'success') {
        processingRef.current = false
        return
      }
      const q = gameQuestionsRef.current[qIndexRef.current]
      if (!q) {
        processingRef.current = false
        return
      }
      const blocks = lessonBlocks(gameQuestionsRef.current, lessonState.lesson.blocks)

      const correctIdx = choices.findIndex((c) => c.isCorrect)
      setCorrectChoiceIndex(correctIdx)
      const tiers = currentTiers.length > 0 ? currentTiers : buildTiersForQuestion(q)
      const currentStepNumber = stepIndexRef.current + 1
      const currentTier = tiers[stepIndexRef.current]
      const metadata = buildAnswerMetadata(q, currentTier, choice.text, currentStepNumber)
      const retryKey = `${q.id}:${stepIndexRef.current}`
      const isRetry = activeRetryKeyRef.current === retryKey

      if (choice.isCorrect) {
        const currentStep = stepIndexRef.current
        const steps = tiers.length || getTotalSteps(q)
        const stepProgress = getStepProgress(currentStep, steps)

        const nextStep = stepProgress.nextStep
        if (!stepProgress.isFinalStep && nextStep !== null) {
          // 途中ステップ正解 → 緑フラッシュ後に次のステップへ（タイマーリセット）
          // 次ステップへ進む前に、直前ステップの answer flush を完了させる。
          timer.stop()
          await api.saveAnswerRealtime({
            question_id: q.id,
            lesson_id: q.lesson_id,
            user_answer: choice.text,
            is_correct: true,
            time_spent_sec: Math.round(timeTaken),
            hints_used: 0,
            step: currentStep + 1,
            step_label: buildStepLabel(tiers, currentStep),
            ...metadata,
            ...answerBlockMetadata(blocks, q),
            is_retry: isRetry,
          })
          setFlashResult('correct')
          setTimeout(() => {
            activeRetryKeyRef.current = null
            stepIndexRef.current = nextStep
            setStepIndex(nextStep)
            // 新形式 Tier がある場合は tiers[nextStep].choices を優先
            const tierNext = tiers[nextStep]
            if (tierNext?.mode === 'choice' && tierNext.choices) {
              setChoices(tierNext.choices)
            } else {
              setChoices(buildChoices(q, nextStep))
            }
            setFlashResult(null)
            setCorrectChoiceIndex(null)
            setChosenIndex(null)
            processingRef.current = false
            showChoicesNow()
            // 最終ステップに入る瞬間に「約分チェック！」バナーを表示（約分が関係する単元のみ）
            const lessonUnit = lessonState.status === 'success' ? lessonState.lesson.unit_id : undefined
            if (nextStep === steps - 1 && lessonUnit === 'yakubun-checker') {
              setShowYakubunCheck(true)
              setTimeout(() => setShowYakubunCheck(false), 1500)
            }
          }, STEP_CORRECT_FEEDBACK_MS)
        } else {
          // 最終ステップ正解 → 結果記録して次の問題へ
          timer.stop()
          setResults((prev) => [
            ...prev,
            {
              question: q,
              correct: true,
              score: timer.calcScore(),
              timeTaken,
              chosenText: choice.text,
              stepLabel: buildStepLabel(tiers, stepIndexRef.current),
              isRetry,
            },
          ])
          activeRetryKeyRef.current = null
          await api.saveAnswerRealtime({
            question_id: q.id,
            lesson_id: q.lesson_id,
            user_answer: choice.text,
            is_correct: true,
            time_spent_sec: Math.round(timeTaken),
            hints_used: 0,
            step: stepIndexRef.current + 1,
            step_label: buildStepLabel(tiers, stepIndexRef.current),
            ...metadata,
            ...answerBlockMetadata(blocks, q),
            is_retry: isRetry,
          })
          setFlashResult('correct')
          advanceAfterCorrectFeedback()
        }
      } else {
        // 不正解 → タイマー停止・全ステップ正解表示・次へ
        timer.stop()
        setResults((prev) => [
          ...prev,
          {
            question: q,
            correct: false,
            score: 0,
            timeTaken,
            chosenText: choice.text,
            stepLabel: buildStepLabel(tiers, stepIndexRef.current),
            isRetry,
          },
        ])
        activeRetryKeyRef.current = null
        await api.saveAnswerRealtime({
          question_id: q.id,
          lesson_id: q.lesson_id,
          user_answer: choice.text,
          is_correct: false,
          time_spent_sec: Math.round(timeTaken),
          hints_used: 0,
          step: stepIndexRef.current + 1,
          step_label: buildStepLabel(tiers, stepIndexRef.current),
          ...metadata,
          ...answerBlockMetadata(blocks, q),
          is_retry: isRetry,
        })
        setFlashResult('incorrect')
        // 診断データがあれば即座に診断フェーズ開始（同概念の簡単な確認問題）
        if (q.diag_step1) {
          setDiagData({
            step1: q.diag_step1,
            step2: q.diag_step2 ?? q.diag_step1,
          })
          setDiagPhase('step1')
          setDiagChoices(shuffleChoices(q.diag_step1.choices))
        }
      }
    },
    [timer, lessonState, choices, currentTiers, showChoicesNow, advanceAfterCorrectFeedback],
  )

  // 新問題形式: SlotPicker から「決定」が押された時のハンドラ
  // tier.correctValue と完全一致なら正解 Choice、そうでなければ不正解 Choice を生成して
  // 既存 handleChoose 経路に流し込む。これで採点・answer 保存・進行が全て従来通り動く。
  const handleSlotSubmit = useCallback(
    (value: string) => {
      const tier = currentTiers[stepIndexRef.current]
      if (!tier || tier.mode !== 'slot') return
      const userStr = String(value ?? '').trim()
      const correctStr = String(tier.correctValue ?? '').trim()
      const isCorrect = isSlotAnswerCorrect(tier.slotConfig, userStr, correctStr)
      const synthetic: Choice = { text: value, isCorrect }
      handleChoose(synthetic, 0)
    },
    [currentTiers, handleChoose],
  )

  function shuffleChoices(apiChoices: { text: string; isCorrect: boolean }[]): Choice[] {
    const shuffled = apiChoices.map((c) => ({
      text: c.text,
      isCorrect: c.isCorrect,
    }))
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  function resetDiagState() {
    setDiagPhase('none')
    setDiagData(null)
    setDiagStep1Result(null)
    setDiagChoices([])
    setDiagFlash(null)
    setDiagFeedback('')
  }

  const startGame = useCallback(
    (skipAnswered = true) => {
      if (lessonState.status !== 'success') return
      const allQuestions = lessonState.lesson.questions
      if (allQuestions.length === 0) return

      // yakubun-checker: randomly sample 4 needs-reduction + 4 no-reduction questions
      const isChecker = lessonState.lesson.unit_id === 'yakubun-checker'
      const questions = isChecker ? sampleCheckerQuestions(allQuestions) : allQuestions
      gameQuestionsRef.current = questions
      setGameQuestions(questions)

      // 途中再開: answeredIds を使って未回答の最初の問題を見つける
      let startIdx = 0
      let restoredResults: QuestionResult[] = []
      if (skipAnswered && !isChecker) {
        const answered = lessonState.answeredIds
        if (answered.size > 0 || lessonState.completionLogged) {
          const blocks = lessonBlocks(questions, lessonState.lesson.blocks)
          const requiredMainIds = mainQuestionIds(questions, blocks)
          const optionalIds = optionalQuestionIds(blocks)
          const firstMainUnanswered = questions.findIndex((q) => requiredMainIds.has(q.id) && !answered.has(q.id))
          const hasUnansweredOptional = questions.some((q) => optionalIds.has(q.id) && !answered.has(q.id))
          if (lessonState.completionLogged) {
            restoredResults = restoreResultsFromAnswerHistory(lessonState.lesson, lessonState.answerHistory)
            wrongOnlyRef.current = null
            setWrongOnlyIndices(null)
            setRemediationLabel(undefined)
            setRemediationExplanation(undefined)
            qIndexRef.current = 0
            setQIndex(0)
            stepIndexRef.current = 0
            setStepIndex(0)
            setCurrentTiers([])
            setTotalSteps(1)
            setResults(restoredResults)
            resultsRef.current = restoredResults
            activeRetryKeyRef.current = null
            retriedQuestionsRef.current = new Set()
            setFlashResult(null)
            setCorrectChoiceIndex(null)
            setChosenIndex(null)
            clearCorrectAdvanceTimer()
            setStartTime(Date.now())
            processingRef.current = false
            setChoices([])
            resetDiagState()
            setPhase('result')
            scrollToTop()
            return
          }
          if (firstMainUnanswered === -1) {
            if (hasUnansweredOptional) {
              restoredResults = restoreResultsFromAnswerHistory(lessonState.lesson, lessonState.answerHistory)
              wrongOnlyRef.current = null
              setWrongOnlyIndices(null)
              setRemediationLabel(undefined)
              setRemediationExplanation(undefined)
              qIndexRef.current = 0
              setQIndex(0)
              stepIndexRef.current = 0
              setStepIndex(0)
              setCurrentTiers([])
              setTotalSteps(1)
              setResults(restoredResults)
              resultsRef.current = restoredResults
              activeRetryKeyRef.current = null
              retriedQuestionsRef.current = new Set()
              setFlashResult(null)
              setCorrectChoiceIndex(null)
              setChosenIndex(null)
              clearCorrectAdvanceTimer()
              setStartTime(Date.now())
              processingRef.current = false
              setChoices([])
              resetDiagState()
              setPhase('result')
              scrollToTop()
              return
            }
            // 本編も任意追加も全問回答済み → 最初からリプレイ（startIdx = 0のまま）
          } else {
            startIdx = firstMainUnanswered
            restoredResults = restoreResultsFromAnswerHistory(lessonState.lesson, lessonState.answerHistory)
          }
        }
      }

      // debug=1 + pos=N でジャンプ（E2E 用・既存ロジックより優先）
      const params = new URLSearchParams(window.location.search)
      if (params.get('debug') === '1') {
        const posStr = params.get('pos')
        if (posStr) {
          const posNum = parseInt(posStr, 10)
          if (!Number.isNaN(posNum) && posNum >= 1 && posNum <= questions.length) {
            startIdx = posNum - 1
          } else {
            console.warn(`[LessonPage] debug pos="${posStr}" is out of range (1-${questions.length}), ignored`)
          }
        }
      }

      wrongOnlyRef.current = null
      setWrongOnlyIndices(null)
      setRemediationLabel(undefined)
      setRemediationExplanation(undefined)
      qIndexRef.current = startIdx
      setQIndex(startIdx)
      stepIndexRef.current = 0
      setStepIndex(0)
      const startTiers = buildTiersForQuestion(questions[startIdx])
      setCurrentTiers(startTiers)
      setTotalSteps(startTiers.length || getTotalSteps(questions[startIdx]))
      setResults(restoredResults)
      activeRetryKeyRef.current = null
      retriedQuestionsRef.current = new Set()
      setFlashResult(null)
      setCorrectChoiceIndex(null)
      setChosenIndex(null)
      clearCorrectAdvanceTimer()
      setStartTime(Date.now())
      processingRef.current = false
      setChoices(startTiers[0]?.choices ?? buildChoices(questions[startIdx], 0))
      resetDiagState()
      setPhase('playing')
      scrollToTop()
      enterQuestion(questions[startIdx])
    },
    [lessonState, enterQuestion, clearCorrectAdvanceTimer],
  )

  const handleStart = useCallback(() => {
    if (lessonState.status !== 'success') return

    setRoundNumber(1)

    const unitId = lessonState.lesson.unit_id
    const isHighWeakness = HIGH_WEAKNESS_UNITS.has(unitId)

    if (lessonState.lesson.lesson_type === 'reading') {
      // 初回プレイ: 弱点スコア90以上＋今日未表示のときだけconcept表示
      if (lessonState.lesson.concept_cards.length > 0 && isHighWeakness && !hasSeenConceptToday(id)) {
        setConceptIndex(0)
        setPhase('concept')
      } else {
        setPhase('reading')
      }
      return
    }

    const questions = lessonState.lesson.questions
    if (questions.length === 0) return

    // 初回プレイ: 弱点スコア90以上＋今日未表示のときだけconcept表示
    if (lessonState.lesson.concept_cards.length > 0 && isHighWeakness && !hasSeenConceptToday(id)) {
      setConceptIndex(0)
      setPhase('concept')
      return
    }

    startGame()
  }, [lessonState, startGame])

  // デバッグ用: 全問プレビュー開始
  // - プレビュー中ラベルを出し、スキップボタンで手動確認する
  // - concept カードはスキップ（問題の目視確認が目的）
  const handlePreview = useCallback(() => {
    if (!debugUI) return
    if (lessonState.status !== 'success') return
    previewModeRef.current = true
    setPreviewMode(true)
    setRoundNumber(1)
    startGame()
  }, [debugUI, lessonState, startGame])

  const handleRetry = useCallback(() => {
    setRoundNumber(1)
    setRemediationLabel(undefined)
    setRemediationExplanation(undefined)
    setPhase('start')
    timer.reset()
  }, [timer])

  const handleOptionalExtra = useCallback(() => {
    if (lessonState.status !== 'success') return
    const sourceQuestions = lessonState.lesson.questions
    const blocks = lessonBlocks(sourceQuestions, lessonState.lesson.blocks)
    const optionalIds = optionalQuestionIds(blocks)
    const answered = new Set(resultsRef.current.map((result) => result.question.id))
    const optionalQuestions = sourceQuestions.filter((question) => optionalIds.has(question.id) && !answered.has(question.id))
    if (optionalQuestions.length === 0) return

    setRoundNumber(2)
    gameQuestionsRef.current = optionalQuestions
    setGameQuestions(optionalQuestions)
    setWrongOnlyIndices(null)
    wrongOnlyRef.current = null
    setRemediationLabel(undefined)
    setRemediationExplanation(undefined)
    qIndexRef.current = 0
    setQIndex(0)
    stepIndexRef.current = 0
    setStepIndex(0)
    const firstQuestion = optionalQuestions[0]
    const optionalTiers = buildTiersForQuestion(firstQuestion)
    setCurrentTiers(optionalTiers)
    setTotalSteps(optionalTiers.length || getTotalSteps(firstQuestion))
    setResults([])
    resultsRef.current = []
    retriedQuestionsRef.current = new Set()
    setFlashResult(null)
    setCorrectChoiceIndex(null)
    setChosenIndex(null)
    clearCorrectAdvanceTimer()
    setStartTime(Date.now())
    processingRef.current = false
    setChoices(optionalTiers[0]?.choices ?? buildChoices(firstQuestion, 0))
    resetDiagState()
    activeRetryKeyRef.current = null
    setPhase('playing')
    scrollToTop()
    enterQuestion(firstQuestion)
  }, [lessonState, enterQuestion, clearCorrectAdvanceTimer])

  const handleRetryWrong = useCallback(() => {
    if (lessonState.status !== 'success') return
    setRoundNumber((prev) => prev + 1)
    const { lesson } = lessonState
    const blocks = lessonBlocks(lesson.questions, lesson.blocks)
    const mainIds = mainQuestionIds(lesson.questions, blocks)
    const scoreResults = filterQuestionResults(results, mainIds)
    const scoreSummary = summarizeLessonResults(scoreResults, mainIds.size)
    const remediation = buildRemediationPlan(lesson.questions, scoreSummary.needsReviewResults)
    const questions = remediation.questions
    if (questions.length === 0) return

    const firstIdx = 0
    const firstQ = questions[firstIdx]

    gameQuestionsRef.current = questions
    setGameQuestions(questions)
    setWrongOnlyIndices(null)
    wrongOnlyRef.current = null
    setRemediationLabel(remediationStageLabel(remediation.stage, remediation.fallback))
    setRemediationExplanation(remediation.micro_explanation)
    qIndexRef.current = firstIdx
    setQIndex(firstIdx)
    stepIndexRef.current = 0
    setStepIndex(0)
    const retryTiers = buildTiersForQuestion(firstQ)
    setCurrentTiers(retryTiers)
    setTotalSteps(retryTiers.length || getTotalSteps(firstQ))
    // Keep the full lesson-session answer history while replaying only the remediation subset.
    // lesson_complete, rescued_count, needs_review_count, and attempts are lesson-wide metrics.
    retriedQuestionsRef.current = new Set()
    setFlashResult(null)
    setCorrectChoiceIndex(null)
    setChosenIndex(null)
    clearCorrectAdvanceTimer()
    setStartTime(Date.now())
    processingRef.current = false
    setChoices(retryTiers[0]?.choices ?? buildChoices(firstQ, 0))
    resetDiagState()
    activeRetryKeyRef.current = null

    setPhase('playing')
    scrollToTop()
    enterQuestion(firstQ)
  }, [lessonState, results, enterQuestion, clearCorrectAdvanceTimer])

  const handleNextAfterWrong = useCallback(() => {
    console.log('[diag] handleNextAfterWrong called, diagPhase:', diagPhase)
    if (diagPhase === 'none' && lessonState.status === 'success') {
      const q = gameQuestionsRef.current[qIndexRef.current]
      const retryKey = q ? `${q.id}:${stepIndexRef.current}` : ''

      // 2026-05-13: 即時再出題ロジック
      // 誤答した問題を 1 回だけ即座にやり直しさせる（解法暗記促進・繰り返し効果）。
      // 1 回目の誤答は保持しつつ、2 回目以降は final/rescued 集計で別指標として扱う。
      // diag フェーズ問題は従来通り diag を優先（その後 advance）。
      if (q && retryKey && !retriedQuestionsRef.current.has(retryKey) && !q.diag_step1) {
        retriedQuestionsRef.current.add(retryKey)
        activeRetryKeyRef.current = retryKey
        setQuestionRunKey((prev) => prev + 1)
        const tier = currentTiers[stepIndexRef.current]
        if (tier?.mode === 'choice' && tier.choices) {
          setChoices(shuffleChoices(tier.choices))
        } else {
          setChoices(buildChoices(q, stepIndexRef.current))
        }
        setFlashResult(null)
        setCorrectChoiceIndex(null)
        setChosenIndex(null)
        processingRef.current = false
        showChoicesNow()
        return
      }

      // 診断問題があれば従来通り
      console.log('[diag] question:', q?.id, 'diag_step1:', q?.diag_step1 ? 'EXISTS' : 'NULL', typeof q?.diag_step1)
      if (q?.diag_step1) {
        const data = {
          step1: q.diag_step1,
          step2: q.diag_step2 ?? q.diag_step1,
        }
        console.log('[diag] setting diagPhase to step1, choices:', data.step1.choices?.length)
        setDiagData(data)
        setDiagPhase('step1')
        setDiagChoices(shuffleChoices(data.step1.choices))
        return
      }
    }
    console.log('[diag] skipping diagnosis, going to next question')
    // 不正解の保存は handleChoose 不正解ブランチで完了済み（重複防止のため当ブロックは削除）
    resetDiagState()
    activeRetryKeyRef.current = null
    setFlashResult(null)
    setCorrectChoiceIndex(null)
    setChosenIndex(null)
    processingRef.current = false
    advanceRef.current()
  }, [diagPhase, lessonState, currentTiers, showChoicesNow])

  const handleDiagChoose = useCallback(
    (choice: Choice) => {
      if (diagFlash !== null) return

      if (choice.isCorrect) {
        setDiagFlash('correct')
        if (diagPhase === 'step1') {
          setDiagStep1Result(true)
          setTimeout(() => {
            setDiagFeedback('やり方はわかってるね！')
            setDiagPhase('done')
            setDiagFlash(null)
          }, 500)
        } else if (diagPhase === 'step2') {
          setTimeout(() => {
            setDiagFeedback('ここからステップアップしよう！')
            setDiagPhase('done')
            setDiagFlash(null)
          }, 500)
        }
      } else {
        setDiagFlash('incorrect')
        if (diagPhase === 'step1') {
          setDiagStep1Result(false)
          setTimeout(() => {
            if (diagData) {
              setDiagPhase('step2')
              setDiagChoices(shuffleChoices(diagData.step2.choices))
            }
            setDiagFlash(null)
          }, 500)
        } else if (diagPhase === 'step2') {
          setTimeout(() => {
            setDiagFeedback('ここから復習しよう！')
            setDiagPhase('done')
            setDiagFlash(null)
          }, 500)
        }
      }
    },
    [diagPhase, diagData, diagFlash],
  )

  const handleDiagNext = useCallback(() => {
    let level: number | null = null
    const lastResult = results[results.length - 1]
    if (diagStep1Result === true) {
      level = lastResult && lastResult.timeTaken < 3 ? 3 : 2
    } else if (diagStep1Result === false) {
      level = 1
    }

    const conversation = JSON.stringify({
      source: 'static-diag',
      original: {
        user_answer: lastResult?.chosenText,
        time_spent_sec: lastResult?.timeTaken,
      },
      step1_correct: diagStep1Result,
      level,
    })

    setResults((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last) {
        const updatedLast = {
          ...last,
          understandingLevel: level,
          diagConversation: conversation,
        }
        updated[updated.length - 1] = updatedLast
      }
      return updated
    })

    resetDiagState()
    setFlashResult(null)
    setCorrectChoiceIndex(null)
    setChosenIndex(null)
    processingRef.current = false
    advanceRef.current()
  }, [diagStep1Result, diagData, results])

  useEffect(() => {
    if (debugUI || previewModeRef.current || completionSentRef.current) return
    if (lessonState.status !== 'success') return
    // TODO: 別タブで同時に完了した場合の完全な冪等性は、server/user-state 側の dedupe で担保する。
    if (lessonState.completionLogged) return

    const { lesson } = lessonState
    const lessonScopeQuestions = lesson.questions
    const lessonScopeBlocks = lessonBlocks(lessonScopeQuestions, lesson.blocks)
    const mainIds = mainQuestionIds(lessonScopeQuestions, lessonScopeBlocks)
    const scoreResults = lesson.lesson_type === 'reading' ? results : filterQuestionResults(results, mainIds)
    const expectedCount = lesson.lesson_type === 'reading' ? (lesson.reading_questions?.length ?? 0) : mainIds.size
    const scoreSummary = summarizeLessonResults(scoreResults, expectedCount)
    const hasAttemptedAll = scoreSummary.firstAttemptResults.length >= expectedCount
    const hasFinalCorrectAll = scoreSummary.finalCorrectCount === expectedCount
    if (expectedCount <= 0 || !hasAttemptedAll || !hasFinalCorrectAll) return
    if (phase !== 'result' && flashResult === null) return

    completionSentRef.current = true
    void api
      .saveLessonComplete({
        lesson_id: lesson.id,
        lesson_title: lesson.title,
        subject: lesson.subject,
        question_count: expectedCount,
        correct_count: scoreSummary.firstCorrectCount,
        first_correct_count: scoreSummary.firstCorrectCount,
        final_correct_count: scoreSummary.finalCorrectCount,
        rescued_count: scoreSummary.rescuedCount,
        needs_review_count: scoreSummary.needsReviewCount,
        attempts: scoreResults.length,
      })
      .then((ok) => {
        if (!ok) {
          completionSentRef.current = false
        }
      })
  }, [phase, debugUI, lessonState, results, flashResult])

  useEffect(() => {
    if (debugUI || lessonState.status !== 'success') return
    if (!lessonState.lesson.blocks || lessonState.lesson.blocks.length === 0) return
    const blocks = lessonBlocks(lessonState.lesson.questions, lessonState.lesson.blocks)
    for (const [index, block] of blocks.entries()) {
      if (blockCompletionSentRef.current.has(block.id)) continue
      const progress = blockProgress(block, results)
      if (progress.total === 0 || progress.done < progress.total) continue
      blockCompletionSentRef.current.add(block.id)
      void api.saveBlockComplete({
        lesson_id: lessonState.lesson.id,
        block_id: block.id,
        block_title: block.title,
        block_kind: blockKind(block),
        block_type: blockType(block),
        block_position: index + 1,
        optional_extra: isOptionalBlock(block),
        question_count: progress.total,
        correct_count: progress.correct,
      })
    }
  }, [debugUI, lessonState, results])

  const handleDone = useCallback(() => {
    navigate('/')
  }, [navigate])

  if (lessonState.status === 'loading') {
    return (
      <div className="lesson-loading">
        <div className="lesson-loading__spinner" aria-hidden="true" />
        <p className="lesson-loading__text">読み込み中…</p>
      </div>
    )
  }

  if (lessonState.status === 'error') {
    return (
      <div className="lesson-error">
        <span className="lesson-error__icon" aria-hidden="true">
          😢
        </span>
        <p className="lesson-error__title">読み込みに失敗しました</p>
        <p className="lesson-error__message">{lessonState.message}</p>
        <button className="lesson-error__btn" onClick={() => window.location.reload()}>
          もう一度読み込む
        </button>
      </div>
    )
  }

  const { lesson, answeredIds } = lessonState
  const isChecker = lesson.unit_id === 'yakubun-checker'
  const lessonMainIds = mainQuestionIds(lesson.questions, lessonBlocks(lesson.questions, lesson.blocks))
  const allAnswered = !isChecker && (lessonState.completionLogged || [...lessonMainIds].every((questionId) => answeredIds.has(questionId)))
  // debug モード時のみ「つづきから」を抑止して毎回 Q1 開始（テスト時の状態汚染回避）
  const resumeFrom = debugUI ? 0 : !isChecker && answeredIds.size > 0 && !allAnswered ? lesson.questions.findIndex((q) => lessonMainIds.has(q.id) && !answeredIds.has(q.id)) + 1 : 0
  const currentQuestion = gameQuestions[qIndex]
  const totalQuestions = gameQuestions.length
  const blocks = lessonBlocks(gameQuestions.length > 0 ? gameQuestions : lesson.questions, lesson.blocks)
  const mainIds = mainQuestionIds(gameQuestions.length > 0 ? gameQuestions : lesson.questions, blocks)
  const scoreResults = wrongOnlyIndices ? results : filterQuestionResults(results, mainIds)
  const expectedCount = wrongOnlyIndices ? wrongOnlyIndices.length : mainIds.size
  const scoreSummary = summarizeLessonResults(scoreResults, expectedCount)
  const correctCount = scoreSummary.finalCorrectCount
  const isPerfect = scoreResults.length >= expectedCount && scoreSummary.finalCorrectCount === expectedCount
  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
  const currentBlock = blockForQuestion(blocks, currentQuestion)
  const currentBlockProgress = blockProgress(currentBlock, results)
  const currentBlockType = currentBlock ? blockType(currentBlock) : null
  const currentBlockOptional = currentBlock ? isOptionalBlock(currentBlock) : false
  const lessonOptionalIds = lessonState.status === 'success' ? optionalQuestionIds(lessonBlocks(lesson.questions, lesson.blocks)) : new Set<string>()
  const answeredResultIds = new Set(results.map((result) => result.question.id))
  const hasOptionalExtra =
    wrongOnlyIndices === null &&
    gameQuestions.length === lesson.questions.length &&
    [...lessonOptionalIds].some((questionId) => !answeredResultIds.has(questionId))

  return (
    <div className="lesson-page">
      {phase === 'start' && (
        <>
          <button className="lesson-page__back-btn" onClick={() => navigate('/')} aria-label="トップに戻る">
            ← もどる
          </button>
          <GameStart lesson={lesson} onStart={handleStart} resumeFrom={resumeFrom} isReplay={allAnswered} debugUI={debugUI} onPreview={debugUI ? handlePreview : undefined} />
        </>
      )}

      {phase === 'concept' && lessonState.status === 'success' && (
        <ConceptCards
          cards={lessonState.lesson.concept_cards}
          currentIndex={conceptIndex}
          onNext={() => {
            if (conceptIndex < lessonState.lesson.concept_cards.length - 1) {
              setConceptIndex((prev) => prev + 1)
            } else if (lessonState.lesson.lesson_type === 'reading') {
              markConceptSeen(id)
              setPhase('reading')
            } else if (wrongOnlyIndices !== null) {
              markConceptSeen(id)
              // リトライ中: wrongOnlyIndices を使ってリトライゲーム開始
              const firstIdx = wrongOnlyIndices[0]
              const firstQ = gameQuestionsRef.current[firstIdx]
              qIndexRef.current = firstIdx
              setQIndex(firstIdx)
              stepIndexRef.current = 0
              setStepIndex(0)
              const conceptTiers = buildTiersForQuestion(firstQ)
              setCurrentTiers(conceptTiers)
              setTotalSteps(conceptTiers.length || getTotalSteps(firstQ))
              setChoices(conceptTiers[0]?.choices ?? buildChoices(firstQ, 0))
              setPhase('playing')
              scrollToTop()
              enterQuestion(firstQ)
            } else {
              markConceptSeen(id)
              startGame()
            }
          }}
        />
      )}

      {phase === 'playing' &&
        currentQuestion &&
        (() => {
          // 新問題形式: 現在の Tier を取得 (なければ undefined → 既存 single_tier 経路)
          const activeTier = currentTiers[stepIndex]
          const isSlot = activeTier?.mode === 'slot'
          // Tier label を優先表示 (single_tier では従来の solution_steps を使う)
          const tierLabel = activeTier?.label
          const subPromptValue = tierLabel ?? getSubPrompt(currentQuestion, stepIndex)
          return (
            <div className="lesson-page__playing">
              {sketchToast && (
                <div className="sketch-toast" role="status">
                  <span aria-hidden="true">✨</span>
                  {sketchToast}
                </div>
              )}
              {currentBlock && blocks.length > 1 && (
                <div className={`lesson-block lesson-block--${currentBlockType}`} aria-label={`${currentBlock.title} ${currentBlockProgress.done}/${currentBlockProgress.total}`}>
                  <span className="lesson-block__kind">
                    {currentBlock.title}
                    {currentBlockOptional ? <span className="lesson-block__optional">任意</span> : null}
                  </span>
                  <span className="lesson-block__count">
                    {Math.min(currentBlockProgress.done + 1, currentBlockProgress.total)}/{currentBlockProgress.total}
                  </span>
                </div>
              )}
              <QuestionFlash
                key={`${currentQuestion.id}:${stepIndex}:${questionRunKey}`}
                question={currentQuestion}
                choices={choices}
                correctCount={correctCount}
                totalQuestions={totalQuestions}
                currentQuestionNumber={qIndex + 1}
                stepIndex={stepIndex}
                totalSteps={totalSteps}
                subPrompt={subPromptValue}
                inputMode={isSlot ? 'slot' : 'choice'}
                slotConfig={isSlot ? activeTier?.slotConfig : undefined}
                onSlotSubmit={isSlot ? handleSlotSubmit : undefined}
                timerProgress={timer.progress}
                timeLeft={timer.timeLeft}
                flashResult={flashResult}
                correctChoiceIndex={correctChoiceIndex}
                chosenIndex={chosenIndex}
                choicesReady={choicesReady}
                readingLockRemaining={readingLockRemaining}
                subject={lessonState.status === 'success' ? lessonState.lesson.subject : undefined}
                onChoose={handleChoose}
                onNext={handleNextAfterWrong}
                diagPhase={diagPhase}
                diagData={diagPhase === 'step1' ? diagData?.step1 : diagPhase === 'step2' ? diagData?.step2 : null}
                diagChoices={diagChoices}
                diagFlash={diagFlash}
                diagFeedback={diagFeedback}
                onDiagChoose={handleDiagChoose}
                onDiagNext={handleDiagNext}
                showYakubunCheck={showYakubunCheck}
                debugUI={debugUI}
                previewMode={previewMode}
                onSkip={debugUI ? handleSkip : undefined}
                sketchGateSlot={
                  sketchGateActive ? (
                    <SketchGate
                      key={`${currentQuestion.id}:${sketchRunIdRef.current}`}
                      kind={currentQuestion.sketch_kind ?? 'figure'}
                      onSubmit={handleSketchSubmit}
                    />
                  ) : undefined
                }
              />
            </div>
          )
        })()}

      {phase === 'reading' && lessonState.status === 'success' && (
        <ReadingMode
          lesson={lessonState.lesson}
          onComplete={(readingResults: ReadingResult[]) => {
            const converted = readingResults.map((r) => ({
              question: {
                ...r.question,
                lesson_id: lessonState.lesson.id,
              } as any,
              correct: r.correct,
              score: r.correct ? 100 : 0,
              timeTaken: 0,
              chosenText: r.chosenText,
            }))
            setResults(converted)
            setPhase('result')
          }}
        />
      )}

      {phase === 'result' && (
        <GameResult
          isPerfect={isPerfect}
          totalTime={elapsedSeconds}
          attempts={scoreResults.length}
          totalQuestions={expectedCount}
          scoreSummary={scoreSummary}
          wrongResults={scoreSummary.needsReviewResults}
          carelessMisses={detectCarelessMisses(
            scoreSummary.firstAttemptResults,
            lessonState.status === 'success' ? lessonState.lesson.subject : undefined,
            lessonState.status === 'success' ? lessonState.lesson.difficulty : undefined,
          )}
          mustRetry={roundNumber === 1}
          remediationLabel={remediationLabel}
          remediationExplanation={remediationExplanation}
          onRetry={handleRetry}
          onRetryWrong={handleRetryWrong}
          onOptionalExtra={hasOptionalExtra ? handleOptionalExtra : undefined}
          onDone={handleDone}
        />
      )}
    </div>
  )
}
