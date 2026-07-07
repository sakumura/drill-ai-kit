import type { ChoiceMeta, Question, SlotConfig, TierPurpose } from './api'
import { slotCorrectValue } from './slotScoring'

export interface Choice {
  text: string
  isCorrect: boolean
}

export type Tier = {
  label: string
  purpose?: TierPurpose
  choices?: Choice[]
  slotConfig?: SlotConfig
  correctValue?: string
  mode: 'choice' | 'slot'
}

export interface StepProgress {
  currentStep: number
  totalSteps: number
  isFinalStep: boolean
  nextStep: number | null
}

export interface ResolvedChoiceMeta {
  role: ChoiceMeta['role']
  purpose?: TierPurpose
  misconception_tag?: string
}

export function resolveChoiceMeta(
  choiceMeta: ChoiceMeta[] | null | undefined,
  choiceText: string,
  step?: number,
): ResolvedChoiceMeta | null {
  if (!Array.isArray(choiceMeta) || choiceMeta.length === 0) return null
  const stepSpecific = step === undefined ? [] : choiceMeta.filter((meta) => meta.step === step)
  const generic = choiceMeta.filter((meta) => meta.step === undefined)
  const candidates = step === undefined ? choiceMeta : [...stepSpecific, ...generic]
  const exact = candidates.find((meta) => meta.choice_text === choiceText)
  const matched = exact ?? candidates.find((meta) => meta.choice_text.trim() === choiceText.trim())
  if (!matched) return null
  return {
    role: matched.role,
    purpose: matched.purpose,
    misconception_tag: matched.misconception_tag,
  }
}

export function isRenderableSlotConfig(config: SlotConfig | null | undefined): config is SlotConfig {
  if (!config || typeof config !== 'object') return false
  switch (config.type) {
    case 'number':
      return Number.isInteger(config.digits) && config.digits > 0
    case 'decimal':
      return typeof config.digit_string === 'string' && Array.isArray(config.valid_positions)
    case 'unit':
      return typeof config.fixed_value === 'string' && Array.isArray(config.unit_options)
    case 'kanji':
      return Array.isArray(config.left_options) && Array.isArray(config.right_options)
    case 'okurigana':
      return typeof config.kanji === 'string' && Array.isArray(config.options)
    case 'two_tier_slot':
      return isRenderableSlotConfig(config.tier1) && isRenderableSlotConfig(config.tier2)
    default:
      return false
  }
}

function pickHintsArray(question: Question): string[] {
  if (Array.isArray(question.hints) && Array.isArray(question.hints[0])) {
    const steps = question.hints as string[][]
    return steps[0] ?? []
  }
  return (question.hints as string[]) ?? []
}

function buildChoiceTierFromHints(hints: string[], label: string, purpose: TierPurpose): Tier {
  const correct: Choice = { text: hints[0] ?? '', isCorrect: true }
  const wrongs: Choice[] = (hints.slice(1, 3) ?? []).map((h) => ({
    text: h,
    isCorrect: false,
  }))
  const all = [...wrongs, correct]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return { label, purpose, mode: 'choice', choices: all }
}

function defaultProcessLabel(purpose?: TierPurpose): string {
  switch (purpose) {
    case 'formula':
      return '式を選ぼう'
    case 'diagram':
      return '図を選ぼう'
    case 'basis':
      return '基準量を選ぼう'
    case 'error_diagnosis':
      return 'まちがいの理由を選ぼう'
    case 'evidence':
      return '根拠を選ぼう'
    case 'elimination_reason':
      return '消去理由を選ぼう'
    case 'expression_effect':
      return '表現効果を選ぼう'
    default:
      return '解き方を選ぼう'
  }
}

export function buildTiersForQuestion(q: Question): Tier[] {
  const qType = q.question_type ?? 'single_tier'

  if (qType === 'single_tier') {
    const hints = pickHintsArray(q)
    return [buildChoiceTierFromHints(hints.slice(0, 3), q.tier1_label ?? '答えを選ぼう', q.tier1_purpose ?? 'answer')]
  }

  if (qType === 'two_tier' || qType === 'evidence_first') {
    const hints = pickHintsArray(q)
    const first3 = hints.slice(0, 3)
    const last3 = hints.slice(3, 6)
    if (qType === 'two_tier') {
      const processPurpose = q.tier1_purpose ?? 'strategy'
      return [
        buildChoiceTierFromHints(first3, q.tier1_label ?? defaultProcessLabel(processPurpose), processPurpose),
        buildChoiceTierFromHints(last3, q.tier2_label ?? '答えを選ぼう', q.tier2_purpose ?? 'answer'),
      ]
    }
    const evidencePurpose = q.tier1_purpose ?? 'evidence'
    return [
      buildChoiceTierFromHints(first3, q.tier1_label ?? defaultProcessLabel(evidencePurpose), evidencePurpose),
      buildChoiceTierFromHints(last3, q.tier2_label ?? '答えを選ぼう', q.tier2_purpose ?? 'answer'),
    ]
  }

  if (qType === 'slot_two_tier' && q.slot_config && q.slot_config.type === 'two_tier_slot' && isRenderableSlotConfig(q.slot_config)) {
    return [
      {
        label: q.tier1_label ?? '1段目',
        purpose: q.tier1_purpose ?? 'answer',
        mode: 'slot',
        slotConfig: q.slot_config.tier1,
        correctValue: slotCorrectValue(q.slot_config.tier1, q.answer),
      },
      {
        label: q.tier2_label ?? '2段目',
        purpose: q.tier2_purpose ?? 'answer',
        mode: 'slot',
        slotConfig: q.slot_config.tier2,
        correctValue: slotCorrectValue(q.slot_config.tier2, q.answer),
      },
    ]
  }

  if (qType.startsWith('slot_') && isRenderableSlotConfig(q.slot_config)) {
    return [
      {
        label: q.tier1_label ?? '答えを入力',
        purpose: q.tier1_purpose ?? 'answer',
        mode: 'slot',
        slotConfig: q.slot_config,
        correctValue: slotCorrectValue(q.slot_config, q.answer),
      },
    ]
  }

  const hints = pickHintsArray(q)
  return [buildChoiceTierFromHints(hints.slice(0, 3), q.tier1_label ?? '答えを選ぼう', q.tier1_purpose ?? 'answer')]
}

export function buildStepLabel(tiers: Tier[], stepIdx: number): string {
  const tier = tiers[stepIdx]
  if (!tier) return 'single'
  const totalTiers = tiers.length
  if (totalTiers <= 1) return 'single'
  if (tier.mode === 'slot') return `slot${stepIdx + 1}`
  return `tier${stepIdx + 1}`
}

export function getTotalSteps(question: Question): number {
  const qType = question.question_type
  if (qType === 'two_tier' || qType === 'evidence_first' || qType === 'slot_two_tier') {
    return 2
  }
  if (Array.isArray(question.hints) && Array.isArray(question.hints[0])) {
    return (question.hints as string[][]).length
  }
  return 1
}

export function getStepProgress(currentStep: number, totalSteps: number): StepProgress {
  const safeTotal = Math.max(1, totalSteps)
  const safeCurrent = Math.min(Math.max(0, currentStep), safeTotal - 1)
  const isFinalStep = safeCurrent >= safeTotal - 1
  return {
    currentStep: safeCurrent,
    totalSteps: safeTotal,
    isFinalStep,
    nextStep: isFinalStep ? null : safeCurrent + 1,
  }
}

export function needsReadingLock(question: Question, subject?: 'math' | 'japanese'): boolean {
  if (subject !== 'math') return false
  if (question.sketch_gate === true) return false
  const difficulty = Number.parseInt(String(question.difficulty ?? '').replace(/^d/i, ''), 10)
  return Number.isFinite(difficulty) && difficulty >= 4
}
