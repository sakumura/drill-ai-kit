import { describe, expect, it } from 'vitest'
import { compactSlotValue, isSlotAnswerCorrect, slotCorrectValue } from '../lib/slotScoring'

describe('slotScoring', () => {
  it('compacts whitespace before exact matching', () => {
    expect(compactSlotValue('  送り　がな ')).toBe('送りがな')
    expect(isSlotAnswerCorrect(undefined, '  送り　がな ', '送りがな')).toBe(true)
  })

  it('normalizes integer slots with leading zeros and fixed units', () => {
    expect(isSlotAnswerCorrect({ type: 'number', digits: 3, unit: 'cm' }, '012cm', '12')).toBe(true)
    expect(isSlotAnswerCorrect({ type: 'number', digits: 3, unit: 'cm' }, '012', '12cm')).toBe(true)
  })

  it('normalizes decimal slots numerically', () => {
    expect(isSlotAnswerCorrect({ type: 'decimal', digit_string: '0.0', valid_positions: [0, 2] }, '1.50', '1.5')).toBe(true)
    expect(isSlotAnswerCorrect({ type: 'decimal', digit_string: '0.0', valid_positions: [0, 2] }, '1.6', '1.5')).toBe(false)
  })

  it('uses correct_value before fallback answer', () => {
    expect(slotCorrectValue({ type: 'number', digits: 2, correct_value: '24' }, 'fallback')).toBe('24')
    expect(slotCorrectValue({ type: 'number', digits: 2 }, 'fallback')).toBe('fallback')
  })
})
