// =====================================================================
// frontend/src/lib/sketchImage.ts
//
// スケッチゲートの画像書き出しロジック（純粋関数 + canvas I/O）。
// 縮小 → toBlob（binary bytes で上限判定）→ PNG data URL 化。
// base64 は binary の約 1.33 倍に膨張するため、サイズ判定は必ず
// data URL 化前の blob.size で行う。
// =====================================================================

export const SKETCH_EXPORT_MAX_PX = 256
export const SKETCH_IMAGE_MAX_BYTES = 200 * 1024

export interface SketchExport {
  dataUrl: string
  base64: string
  bytes: number
}

/** アスペクト比を保ったまま長辺を maxPx 以下に収めた出力サイズを返す */
export function computeExportSize(
  width: number,
  height: number,
  maxPx: number = SKETCH_EXPORT_MAX_PX,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 }
  const longest = Math.max(width, height)
  if (longest <= maxPx) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxPx / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** PNG data URL から base64 部分を取り出す。形式不一致は null */
export function dataUrlBase64(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl)
  return m ? m[1] : null
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 描画済み canvas を縮小して PNG data URL に書き出す。
 * サイズ超過・canvas 異常時は null（呼び出し側は fail-open で進行を続ける）。
 */
export async function exportSketchPng(source: HTMLCanvasElement): Promise<SketchExport | null> {
  try {
    const { width, height } = computeExportSize(source.width, source.height)
    const target = document.createElement('canvas')
    target.width = width
    target.height = height
    const ctx = target.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(source, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/png'))
    if (!blob || blob.size === 0 || blob.size > SKETCH_IMAGE_MAX_BYTES) return null

    const dataUrl = await blobToDataUrl(blob)
    const base64 = dataUrlBase64(dataUrl)
    if (!base64) return null
    return { dataUrl, base64, bytes: blob.size }
  } catch {
    return null
  }
}
