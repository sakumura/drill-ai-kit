// =====================================================================
// frontend/src/components/SketchGate.tsx
//
// スケッチゲート: 選択肢を見る前に、問題の図を指（ポインタ）で描かせる。
// 採点には一切影響しない advisory 専用。提出で必ずゲートは開く（fail-open）。
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { exportSketchPng } from '../lib/sketchImage'
import type { SketchKind } from '../lib/api'

// 内部解像度（書き出し時に lib/sketchImage が 256px へ縮小する）
const CANVAS_WIDTH = 480
const CANVAS_HEIGHT = 360
const STROKE_COLOR = '#3d2817' // --ws-cocoa（canvas 2D は CSS 変数を解決できないため実値）
const STROKE_WIDTH = 4

export interface SketchSubmission {
  imageDataUrl: string | null
  imageBase64: string | null
  strokeCount: number
  durationSec: number
}

interface SketchGateProps {
  onSubmit: (submission: SketchSubmission) => void
  kind?: SketchKind
}

export function SketchGate({ onSubmit, kind = 'figure' }: SketchGateProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const startedAtRef = useRef<number>(Date.now())
  const [strokeCount, setStrokeCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    startedAtRef.current = Date.now()
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    }
  }, [])

  const toCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (!point || !ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    // 点打ちでも見えるよう極小線分を引く
    ctx.lineTo(point.x + 0.1, point.y + 0.1)
    ctx.stroke()
  }, [toCanvasPoint])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const point = toCanvasPoint(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (!point || !ctx) return
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }, [toCanvasPoint])

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    setStrokeCount((prev) => prev + 1)
  }, [])

  const handleClear = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    setStrokeCount(0)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000)
    const canvas = canvasRef.current
    // 書き出し失敗でもゲートは開く（fail-open）
    const exported = canvas ? await exportSketchPng(canvas) : null
    onSubmit({
      imageDataUrl: exported?.dataUrl ?? null,
      imageBase64: exported?.base64 ?? null,
      strokeCount,
      durationSec,
    })
  }, [submitting, strokeCount, onSubmit])

  const targetLabel = kind === 'kanji' ? 'かんじ' : 'ず'
  const prompt = kind === 'kanji'
    ? 'まずは こたえの かんじを ゆびで かいてみよう！'
    : 'まずは もんだいの ずを ゆびで かいてみよう！'

  return (
    <section className="sketch-gate" aria-label={`${targetLabel}をかくコーナー`}>
      <p className="sketch-gate__prompt">{prompt}</p>
      <canvas
        ref={canvasRef}
        className="sketch-gate__canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        aria-label="おえかきキャンバス"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="sketch-gate__actions">
        <button
          type="button"
          className="sketch-gate__btn sketch-gate__btn--clear"
          onClick={handleClear}
          disabled={submitting || strokeCount === 0}
        >
          ぜんぶけす
        </button>
        <button
          type="button"
          className="sketch-gate__btn sketch-gate__btn--submit"
          onClick={handleSubmit}
          disabled={submitting || strokeCount === 0}
        >
          できた！
        </button>
      </div>
    </section>
  )
}
