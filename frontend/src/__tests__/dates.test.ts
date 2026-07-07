import { describe, expect, it } from 'vitest'
import { getJstTodayKey } from '../lib/dates'

describe('getJstTodayKey', () => {
  it('keeps the previous JST day before the UTC 15:00 boundary', () => {
    expect(getJstTodayKey(new Date('2026-05-07T14:59:59.000Z'))).toBe('2026-05-07')
  })

  it('rolls to the next JST day at the UTC 15:00 boundary', () => {
    expect(getJstTodayKey(new Date('2026-05-07T15:00:00.000Z'))).toBe('2026-05-08')
  })
})
