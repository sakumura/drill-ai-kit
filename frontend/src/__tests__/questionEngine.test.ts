import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildStepLabel, buildTiersForQuestion, getStepProgress, needsReadingLock, resolveChoiceMeta } from '../lib/questionEngine'
import type { Question } from '../lib/api'

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    lesson_id: 'lesson1',
    position: 1,
    question_text: '問題',
    figure_svg: null,
    answer: '正解',
    answer_unit: null,
    hints: ['正解', '誤答1', '誤答2'],
    solution_steps: [],
    common_mistakes: [],
    diag_step1: null,
    diag_step2: null,
    ...overrides,
  }
}

describe('questionEngine buildTiersForQuestion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a single choice tier for single_tier questions', () => {
    const tiers = buildTiersForQuestion(question())
    expect(tiers).toHaveLength(1)
    expect(tiers[0].mode).toBe('choice')
    expect(tiers[0].label).toBe('答えを選ぼう')
    expect(tiers[0].purpose).toBe('answer')
    expect(tiers[0].choices?.some((choice) => choice.isCorrect && choice.text === '正解')).toBe(true)
  })

  it('uses tier1_label for single_tier questions', () => {
    const tiers = buildTiersForQuestion(question({
      tier1_label: 'まちがいの理由を選ぼう',
      tier1_purpose: 'error_diagnosis',
    }))
    expect(tiers).toHaveLength(1)
    expect(tiers[0].label).toBe('まちがいの理由を選ぼう')
    expect(tiers[0].purpose).toBe('error_diagnosis')
  })

  it('builds process then answer tiers for two_tier questions', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'two_tier',
      tier1_label: '理由を選ぼう',
      tier1_purpose: 'basis',
      hints: ['理由', '誤理由A', '誤理由B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['理由を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['basis', 'answer'])
    expect(tiers[0].choices?.some((choice) => choice.isCorrect && choice.text === '理由')).toBe(true)
    expect(tiers[1].choices?.some((choice) => choice.isCorrect && choice.text === '答え')).toBe(true)
  })

  it('uses tier labels and purposes for two_tier questions', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'two_tier',
      tier1_label: '解き方を選ぼう',
      tier1_purpose: 'strategy',
      tier2_label: '答えを選ぼう',
      tier2_purpose: 'answer',
      hints: ['解き方', '誤解法A', '誤解法B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['解き方を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['strategy', 'answer'])
  })

  it('defaults unlabeled two_tier questions to process then answer labels', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'two_tier',
      hints: ['解き方', '誤解法A', '誤解法B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['解き方を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['strategy', 'answer'])
  })

  it('builds evidence then answer tiers for evidence_first questions', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'evidence_first',
      tier1_label: '根拠を選ぼう',
      tier1_purpose: 'evidence',
      tier2_label: '答えを選ぼう',
      tier2_purpose: 'answer',
      hints: ['根拠', '誤根拠A', '誤根拠B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['根拠を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['evidence', 'answer'])
    expect(tiers[0].choices?.some((choice) => choice.isCorrect && choice.text === '根拠')).toBe(true)
    expect(tiers[1].choices?.some((choice) => choice.isCorrect && choice.text === '答え')).toBe(true)
  })

  it('keeps default labels for existing evidence_first questions', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'evidence_first',
      hints: ['根拠', '誤根拠A', '誤根拠B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['根拠を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['evidence', 'answer'])
  })

  it('uses tier2_label as the answer label for evidence_first when tier1_label is present', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'evidence_first',
      tier1_label: '図を選ぼう',
      tier1_purpose: 'diagram',
      tier2_label: '答えを選ぼう',
      tier2_purpose: 'answer',
      hints: ['図', '誤図A', '誤図B', '答え', '誤答A', '誤答B'],
    }))
    expect(tiers.map((tier) => tier.label)).toEqual(['図を選ぼう', '答えを選ぼう'])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['diagram', 'answer'])
  })

  it('builds one slot tier for slot question types', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'slot_number',
      answer: '12',
      slot_config: { type: 'number', digits: 2, unit: 'cm', correct_value: '12cm' },
    }))
    expect(tiers).toEqual([
      expect.objectContaining({
        label: '答えを入力',
        purpose: 'answer',
        mode: 'slot',
        correctValue: '12cm',
      }),
    ])
  })

  it('builds two slot tiers for slot_two_tier questions', () => {
    const tiers = buildTiersForQuestion(question({
      question_type: 'slot_two_tier',
      answer: 'fallback',
      tier2_label: '2つ目',
      slot_config: {
        type: 'two_tier_slot',
        tier1: { type: 'number', digits: 2, correct_value: '12' },
        tier2: { type: 'unit', fixed_value: '12', unit_options: ['cm', 'm'], correct_value: '12cm' },
      },
    }))
    expect(tiers.map((tier) => [tier.label, tier.mode, tier.correctValue])).toEqual([
      ['1段目', 'slot', '12'],
      ['2つ目', 'slot', '12cm'],
    ])
    expect(tiers.map((tier) => tier.purpose)).toEqual(['answer', 'answer'])
  })

  it('labels single and multi-step progress consistently', () => {
    const single = buildTiersForQuestion(question())
    const twoTier = buildTiersForQuestion(question({
      question_type: 'two_tier',
      hints: ['答え', '誤答A', '誤答B', '理由', '誤理由A', '誤理由B'],
    }))
    expect(buildStepLabel(single, 0)).toBe('single')
    expect(buildStepLabel(twoTier, 0)).toBe('tier1')
    expect(buildStepLabel(twoTier, 1)).toBe('tier2')
    expect(getStepProgress(0, 2)).toEqual({ currentStep: 0, totalSteps: 2, isFinalStep: false, nextStep: 1 })
    expect(getStepProgress(1, 2)).toEqual({ currentStep: 1, totalSteps: 2, isFinalStep: true, nextStep: null })
  })
})

describe('questionEngine needsReadingLock', () => {
  it('requires a reading lock only for math d4+ questions without sketch_gate', () => {
    expect(needsReadingLock(question({ difficulty: 'd4' }), 'math')).toBe(true)
    expect(needsReadingLock(question({ difficulty: 'd5' }), 'math')).toBe(true)
    expect(needsReadingLock(question({ difficulty: 'd3' }), 'math')).toBe(false)
    expect(needsReadingLock(question({ difficulty: 'd2' }), 'math')).toBe(false)
    expect(needsReadingLock(question({ difficulty: 'd4', sketch_gate: true }), 'math')).toBe(false)
    expect(needsReadingLock(question({ difficulty: 'd5' }), 'japanese')).toBe(false)
  })

  it('also accepts numeric-string and numeric difficulty values from legacy or test fixtures', () => {
    expect(needsReadingLock(question({ difficulty: '4' }), 'math')).toBe(true)
    expect(needsReadingLock(question({ difficulty: 5 as unknown as string }), 'math')).toBe(true)
  })
})

describe('questionEngine resolveChoiceMeta', () => {
  it('resolves misconception metadata by exact choice text and step', () => {
    const resolved = resolveChoiceMeta(
      [
        { step: 1, choice_text: '外側だけ求める', role: 'distractor', purpose: 'strategy', misconception_tag: 'outer_only' },
        { step: 2, choice_text: '外側だけ求める', role: 'distractor', purpose: 'formula', misconception_tag: 'wrong_formula' },
      ],
      '外側だけ求める',
      1,
    )
    expect(resolved).toEqual({
      role: 'distractor',
      purpose: 'strategy',
      misconception_tag: 'outer_only',
    })
  })

  it('falls back to trimmed choice text matching', () => {
    const resolved = resolveChoiceMeta(
      [{ choice_text: '  2×2×3.14×1/4  ', role: 'distractor', purpose: 'formula', misconception_tag: 'radius_difference_as_radius' }],
      '2×2×3.14×1/4',
      2,
    )
    expect(resolved?.misconception_tag).toBe('radius_difference_as_radius')
  })

  it('prioritizes step-specific metadata even when generic metadata is listed first', () => {
    const resolved = resolveChoiceMeta(
      [
        { choice_text: '外側だけ求める', role: 'distractor', purpose: 'strategy', misconception_tag: 'generic_outer_only' },
        { step: 2, choice_text: '外側だけ求める', role: 'distractor', purpose: 'formula', misconception_tag: 'step2_outer_only' },
      ],
      '外側だけ求める',
      2,
    )
    expect(resolved).toEqual({
      role: 'distractor',
      purpose: 'formula',
      misconception_tag: 'step2_outer_only',
    })
  })

  it('returns null when no metadata matches the selected step', () => {
    const resolved = resolveChoiceMeta(
      [{ step: 1, choice_text: 'A', role: 'correct', purpose: 'answer' }],
      'A',
      2,
    )
    expect(resolved).toBeNull()
  })
})
