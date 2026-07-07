import { describe, expect, it } from 'vitest'
import {
  computeExportSize,
  dataUrlBase64,
  SKETCH_EXPORT_MAX_PX,
} from '../lib/sketchImage'

describe('computeExportSize', () => {
  it('keeps small canvases as-is', () => {
    expect(computeExportSize(200, 150)).toEqual({ width: 200, height: 150 })
  })

  it('scales the longest edge down to the max while keeping aspect ratio', () => {
    expect(computeExportSize(480, 360)).toEqual({ width: 256, height: 192 })
    expect(computeExportSize(360, 480)).toEqual({ width: 192, height: 256 })
  })

  it('respects an explicit max', () => {
    expect(computeExportSize(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })

  it('never returns zero dimensions', () => {
    expect(computeExportSize(0, 0)).toEqual({ width: 1, height: 1 })
    expect(computeExportSize(SKETCH_EXPORT_MAX_PX * 1000, 1)).toEqual({
      width: SKETCH_EXPORT_MAX_PX,
      height: 1,
    })
  })
})

describe('dataUrlBase64', () => {
  it('extracts the base64 body from a png data url', () => {
    expect(dataUrlBase64('data:image/png;base64,aGVsbG8=')).toBe('aGVsbG8=')
  })

  it('rejects non-png and non-data-url inputs', () => {
    expect(dataUrlBase64('data:image/jpeg;base64,aGVsbG8=')).toBeNull()
    expect(dataUrlBase64('https://example.com/a.png')).toBeNull()
    expect(dataUrlBase64('')).toBeNull()
  })
})
