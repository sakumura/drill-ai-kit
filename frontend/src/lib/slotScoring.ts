import type { SlotConfig } from './api'

export function slotCorrectValue(config: SlotConfig, fallback: string): string {
  if ('correct_value' in config && typeof config.correct_value === 'string') {
    return config.correct_value
  }
  return fallback
}

export function compactSlotValue(value: string): string {
  return String(value ?? '').replace(/[\s　]+/g, '').trim()
}

function stripFixedUnit(value: string, unit?: string): string {
  const compact = compactSlotValue(value)
  const compactUnit = compactSlotValue(unit ?? '')
  if (compactUnit && compact.endsWith(compactUnit)) {
    return compact.slice(0, -compactUnit.length)
  }
  return compact
}

function normalizeNumberText(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, '')
  return normalized === '' ? '0' : normalized
}

function normalizeIntegerSlotValue(value: string, unit?: string): string {
  const withoutUnit = stripFixedUnit(value, unit)
  if (!/^\d+$/.test(withoutUnit)) return withoutUnit
  return normalizeNumberText(withoutUnit)
}

function normalizeDecimalSlotValue(value: string): string {
  const compact = compactSlotValue(value)
  const parsed = Number(compact)
  if (!Number.isFinite(parsed)) return compact
  return String(parsed)
}

export function isSlotAnswerCorrect(
  slotConfig: SlotConfig | undefined,
  userValue: string,
  correctValue: string,
): boolean {
  if (!slotConfig) return compactSlotValue(userValue) === compactSlotValue(correctValue)

  if (slotConfig.type === 'number') {
    return normalizeIntegerSlotValue(userValue, slotConfig.unit) === normalizeIntegerSlotValue(correctValue, slotConfig.unit)
  }

  if (slotConfig.type === 'decimal') {
    return normalizeDecimalSlotValue(userValue) === normalizeDecimalSlotValue(correctValue)
  }

  return compactSlotValue(userValue) === compactSlotValue(correctValue)
}
