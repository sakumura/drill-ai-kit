import { describe, expect, it } from 'vitest'
import { buildErrorClassification, classifyErrorType } from '../lib/errorClassification'

describe('classifyErrorType', () => {
  it('returns null for correct answers', () => {
    expect(
      classifyErrorType({
        is_correct: true,
        time_spent_sec: 2,
      }),
    ).toBeNull()
  })

  it('classifies very fast wrong answers as rushing', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 3,
        subject: 'math',
        common_mistakes: [{ mistake: '半径と直径の混同', guidance: '半径を確認する' }],
      }),
    ).toBe('rushing')
  })

  it('classifies slow wrong answers as timeout with subject thresholds', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 30,
        subject: 'japanese',
      }),
    ).toBe('timeout')
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 60,
        subject: 'math',
      }),
    ).toBe('timeout')
  })

  it('does not infer timeout when subject is unknown', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 120,
      }),
    ).toBe('concept')
  })

  it('classifies step and mistake text with procedure priority', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 12,
        step_label: '逆数にする',
        common_mistakes: [{ mistake: '半径と直径の混同', guidance: '直径を確認する' }],
      }),
    ).toBe('procedure')
  })

  it('classifies concept confusion from common mistakes', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 12,
        common_mistakes: [{ mistake: '尊敬語と謙譲語の混同', guidance: '主語を確認する' }],
      }),
    ).toBe('concept')
  })

  it('classifies high difficulty or transfer-style questions as transfer', () => {
    expect(
      classifyErrorType({
        is_correct: false,
        time_spent_sec: 12,
        question_type: 'evidence_first',
        difficulty: 4,
      }),
    ).toBe('transfer')
  })

  it('builds the result-screen classification shape', () => {
    expect(
      buildErrorClassification({
        is_correct: false,
        time_spent_sec: 14,
        timeTaken: 13.8,
        step_label: '約分する',
        mistakeGuidance: '最後に約分できるか確認する',
      }),
    ).toEqual({
      type: 'procedure',
      label: '手順ミス',
      guidance: '最後に約分できるか確認する',
      timeTaken: 13.8,
    })
  })
})
