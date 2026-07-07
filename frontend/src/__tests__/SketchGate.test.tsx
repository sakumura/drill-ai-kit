// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SketchGate } from '../components/SketchGate'

describe('SketchGate', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'round',
      lineJoin: 'round',
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('labels kanji sketch prompts as kanji, not figures', () => {
    render(<SketchGate kind="kanji" onSubmit={vi.fn()} />)

    expect(screen.getByText('まずは こたえの かんじを ゆびで かいてみよう！')).not.toBeNull()
    expect(screen.queryByText('まずは もんだいの ずを ゆびで かいてみよう！')).toBeNull()
  })

  it('keeps figure sketch prompts for the default kind', () => {
    render(<SketchGate onSubmit={vi.fn()} />)

    expect(screen.getByText('まずは もんだいの ずを ゆびで かいてみよう！')).not.toBeNull()
  })
})
