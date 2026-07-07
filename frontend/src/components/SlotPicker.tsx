import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SlotConfig } from '../lib/api'

// SlotPicker (2026-04-27 23時): ネイティブ <select> ベースの pull-down 入力 UI。
// 旧実装 (CSS scroll-snap + pointer event 手動制御) は iOS Safari/PC のスクロール挙動が破綻したため撤去。
// OS 標準 picker (iOS の大ホイール / Android のスピナー / PC dropdown) を使い、確実に動作させる。
// 6 形式対応 (number / decimal / unit / kanji / okurigana / two_tier_slot)。採点は呼び出し側で完全一致判定。

interface SlotPickerProps {
  slotConfig: SlotConfig
  onSubmit: (value: string) => void
  disabled?: boolean
  /** 「決定」ボタンの文言を上書きしたい場合 (tier1/tier2 で文言を変える等) */
  submitLabel?: string
}

// ===== 単一ホイール (<select> 化) =====
interface WheelProps {
  options: string[]
  value: string
  onChange: (next: string) => void
  ariaLabel: string
  disabled?: boolean
}

// 2026-04-27 23時改訂: スロット (CSS scroll-snap) は iOS Safari/PC のスクロール挙動が破綻したため
// ネイティブ <select> ベースの大きな pull-down に切り替え。OS 標準の picker UI を使うため確実に動作する。
function Wheel({ options, value, onChange, ariaLabel, disabled }: WheelProps) {
  const selectStyle: CSSProperties = {
    width: '100%',
    minHeight: 64,
    padding: '0.6rem 0.8rem',
    fontSize: '1.7rem',
    fontWeight: 800,
    textAlign: 'center',
    textAlignLast: 'center',
    color: 'var(--ws-coral-d)',
    background: 'var(--ws-choice-bg)',
    border: '2px solid var(--ws-coral)',
    borderRadius: 16,
    boxShadow: 'inset 0 1px 4px rgba(61,40,23,0.05)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    appearance: 'menulist',
  }
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      <option value="" disabled>
        えらんでね
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}

// ===== 内部: SlotConfig から「ホイール群 + value 合成関数」を作る =====
function digitsArray(): string[] {
  return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
}

function normalizeNumberValue(raw: string): string {
  const normalized = raw.replace(/^0+(?=\d)/, '')
  return normalized === '' ? '0' : normalized
}

interface BuiltSlot {
  wheels: { key: string; options: string[]; ariaLabel: string }[]
  values: string[]
  setValueAt: (idx: number, next: string) => void
  preview: string
  composed: string | null // onSubmit に渡す値。未選択があれば null
}

function buildSlot(
  config: Exclude<SlotConfig, { type: 'two_tier_slot' }>,
  values: string[],
  setValues: (next: string[]) => void,
): BuiltSlot {
  const setValueAt = (idx: number, next: string) => {
    const v = [...values]
    v[idx] = next
    setValues(v)
  }

  switch (config.type) {
    case 'number': {
      const wheels = Array.from({ length: config.digits }).map((_, i) => ({
        key: `n-${i}`,
        options: digitsArray(),
        ariaLabel: `${i + 1}桁目`,
      }))
      const selected = values.slice(0, config.digits)
      const isComplete = selected.length === config.digits && selected.every((v) => v !== '')
      const num = isComplete ? normalizeNumberValue(selected.join('')) : ''
      const preview = isComplete ? (config.unit ? `${num} ${config.unit}` : num) : ''
      const composed = isComplete ? (config.unit ? `${num}${config.unit}` : num) : null
      return { wheels, values, setValueAt, preview, composed }
    }
    case 'decimal': {
      // 数字列は固定。小数点位置 (1始まり = digit_string[i-1] と digit_string[i] の間) を選ぶ。
      const ds = config.digit_string
      const positionLabels = config.valid_positions.map((p) => {
        const left = ds.slice(0, p)
        const right = ds.slice(p)
        return `${left}.${right}`
      })
      const wheels = [
        {
          key: 'decimal-pos',
          options: positionLabels,
          ariaLabel: '小数点の位置',
        },
      ]
      const composed = values[0] || null
      const preview = composed ?? ''
      return { wheels, values, setValueAt, preview, composed }
    }
    case 'unit': {
      const wheels = [
        {
          key: 'unit-pick',
          options: config.unit_options,
          ariaLabel: '単位',
        },
      ]
      const unit = values[0] ?? ''
      const composed = unit ? `${config.fixed_value}${unit}` : null
      const preview = composed ?? ''
      return { wheels, values, setValueAt, preview, composed }
    }
    case 'kanji': {
      const wheels = [
        { key: 'kanji-left', options: config.left_options, ariaLabel: '左側 (へん)' },
        { key: 'kanji-right', options: config.right_options, ariaLabel: '右側 (つくり)' },
      ]
      const left = values[0] ?? ''
      const right = values[1] ?? ''
      const composed = left && right ? `${left}${right}` : null
      return { wheels, values, setValueAt, preview: composed ?? '', composed }
    }
    case 'okurigana': {
      const wheels = [
        {
          key: 'okuri-pick',
          options: config.options,
          ariaLabel: '送りがな',
        },
      ]
      const okuri = values[0] ?? ''
      const composed = okuri ? `${config.kanji}${okuri}` : null
      return { wheels, values, setValueAt, preview: composed ?? '', composed }
    }
  }
}

// 初期 values をスロット設定から生成
function initialValues(config: Exclude<SlotConfig, { type: 'two_tier_slot' }>): string[] {
  switch (config.type) {
    case 'number':
      return Array.from({ length: config.digits }).map(() => '')
    case 'decimal':
      return ['']
    case 'unit':
      return ['']
    case 'kanji':
      return ['', '']
    case 'okurigana':
      return ['']
  }
}

// ===== メインコンポーネント =====
export function SlotPicker({ slotConfig, onSubmit, disabled, submitLabel = '決定' }: SlotPickerProps) {
  // two_tier_slot は呼び出し側で 2 個並べる前提 (タスク仕様)。
  // 安全策として、もし two_tier_slot が直接来たら tier1 だけ描画する。
  const effectiveConfig: Exclude<SlotConfig, { type: 'two_tier_slot' }> = useMemo(() => {
    if (slotConfig.type === 'two_tier_slot') return slotConfig.tier1 as Exclude<SlotConfig, { type: 'two_tier_slot' }>
    return slotConfig
  }, [slotConfig])

  const [values, setValues] = useState<string[]>(() => initialValues(effectiveConfig))

  // slotConfig が切り替わったら values を初期化
  useEffect(() => {
    setValues(initialValues(effectiveConfig))
  }, [effectiveConfig])

  const built = buildSlot(effectiveConfig, values, setValues)
  const canSubmit = built.composed !== null && built.composed !== ''
  const submitValue = built.composed ?? ''

  return (
    <div
      className="slot-picker"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '0.75rem',
        background: 'var(--ws-cream)',
        border: '2px solid var(--ws-border)',
        borderRadius: 18,
      }}
    >
      <div
        aria-live="polite"
        style={{
          textAlign: 'center',
          fontSize: '1.4rem',
          fontWeight: 900,
          color: 'var(--ws-coral-d)',
          padding: '0.5rem',
          background: 'var(--ws-surface)',
          borderRadius: 12,
          border: '1px solid var(--ws-border)',
          minHeight: '2.4rem',
        }}
      >
        {built.preview || 'えらんでね'}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${built.wheels.length}, 1fr)`,
          gap: '0.5rem',
        }}
      >
        {built.wheels.map((w, i) => (
          <Wheel
            key={w.key}
            options={w.options}
            value={values[i] ?? ''}
            onChange={(next) => built.setValueAt(i, next)}
            ariaLabel={w.ariaLabel}
            disabled={disabled}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          if (canSubmit) onSubmit(submitValue)
        }}
        disabled={disabled || !canSubmit}
        style={{
          minHeight: 56,
          padding: '0.85rem 1rem',
          border: 'none',
          borderRadius: 'var(--ws-radius-pill)',
          background: 'var(--ws-coral)',
          color: '#fff',
          fontSize: '1.1rem',
          fontWeight: 900,
          cursor: disabled || !canSubmit ? 'not-allowed' : 'pointer',
          boxShadow: 'var(--ws-shadow-pill)',
          opacity: disabled || !canSubmit ? 0.5 : 1,
        }}
        aria-label={canSubmit ? `${submitLabel}: ${submitValue}` : submitLabel}
      >
        {canSubmit ? `${submitLabel} (${submitValue})` : submitLabel}
      </button>
    </div>
  )
}

export default SlotPicker
