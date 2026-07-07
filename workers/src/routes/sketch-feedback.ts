// =====================================================================
// workers/src/routes/sketch-feedback.ts
//
// POST /api/sketch-feedback: スケッチゲートの指描き画像を Workers AI
// （llama-4-scout）で advisory 判定し、励ましコメントを返す。
//
// 設計原則:
// - 採点しない: 判定は is_correct に一切影響しない advisory のみ
// - fail-open: AI エラー/タイムアウト時も 200 + 汎用コメントで学習を止めない
// - X-Debug: AI を呼ばずダミー応答（R2 にも書かない — ログは /api/log 側の責務）
// =====================================================================

import { Hono } from 'hono'

type Bindings = {
  AI: Ai
  API_WRITE_TOKEN?: string
}

type Variables = {
  debug: boolean
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const SCOUT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
const AI_TIMEOUT_MS = 5000
// base64 デコード後の binary bytes 上限（フロントは 256px 縮小で数十KB を想定）
const MAX_IMAGE_BYTES = 200 * 1024

export interface SketchFeedbackResponse {
  category: 'ok' | 'retry'
  comment: string
  fallback?: boolean
  debug?: boolean
}

const FALLBACK_RESPONSE: SketchFeedbackResponse = {
  category: 'ok',
  comment: 'ずをかいてくれてありがとう！そのちょうしだよ！',
  fallback: true,
}

interface SketchFeedbackRequest {
  question_id: string
  lesson_id: string
  image: string // data:image/png;base64,...
  figure_hint: string
  kind: 'figure' | 'kanji'
  answer?: string
}

const DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/

function isAuthorized(c: { env: Bindings; req: { header: (name: string) => string | undefined } }): boolean {
  const token = c.env.API_WRITE_TOKEN
  if (!token) return true
  return c.req.header('X-Write-Token') === token
}

function parseRequest(x: unknown): SketchFeedbackRequest | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (
    typeof o.question_id !== 'string' || o.question_id.length === 0 ||
    typeof o.lesson_id !== 'string' || o.lesson_id.length === 0 ||
    typeof o.image !== 'string' ||
    typeof o.figure_hint !== 'string'
  ) {
    return null
  }
  const rawKind = o.kind
  let kind: 'figure' | 'kanji' = 'figure'
  if (rawKind === 'kanji') {
    kind = 'kanji'
  } else if (rawKind !== undefined && rawKind !== 'figure') {
    console.warn('[sketch-feedback] invalid kind, fallback to figure', rawKind)
  }

  const m = DATA_URL_RE.exec(o.image)
  if (!m) return null
  // base64 長から binary bytes を概算（厳密デコード不要、上限ガード目的）
  const approxBytes = Math.floor(m[1].length * 3 / 4)
  if (approxBytes === 0 || approxBytes > MAX_IMAGE_BYTES) return null
  return {
    question_id: o.question_id,
    lesson_id: o.lesson_id,
    image: o.image,
    figure_hint: o.figure_hint.slice(0, 200),
    kind,
    answer: typeof o.answer === 'string' ? o.answer.slice(0, 50) : undefined,
  }
}

function buildFigurePrompt(hint: string): string {
  return [
    'あなたは小学生の算数学習を見守る優しい先生です。',
    '子どもがタブレットに指で描いたスケッチ画像を見てください。',
    `お手本の図: ${hint}`,
    '',
    '次の2つを判定してください:',
    'Y = お手本のような図を描こうとしている（不完全でも、線が少なくても可）',
    'N = 図とは無関係な落書き（渦巻き、顔、意味のないギザギザなど）',
    '',
    '必ず次の形式で1行だけ答えてください:',
    'Y|（ひらがな中心の励ましコメント25文字以内）',
    'または',
    'N|（責めずに図を描くようさそうコメント25文字以内）',
    '',
    '例: Y|せんぶんずがかけてるね、すごい！',
    '例: N|つぎはもんだいのずをかいてみよう！',
  ].join('\n')
}

function buildKanjiPrompt(hint: string, answer?: string): string {
  const exemplarLine = answer ? `お手本の漢字: ${answer}` : `お手本の漢字: ${hint}`
  const hintLine = answer ? `問題の指示: ${hint}` : null
  return [
    'あなたは小学生の漢字学習を見守る優しい先生です。',
    '子どもがタブレットに指で書いた文字の画像を見てください。',
    exemplarLine,
    ...(hintLine ? [hintLine] : []),
    '',
    '次の2つを判定してください:',
    'Y = お手本の漢字を書こうとしている（とめ・はね・形が多少くずれていても可）',
    'N = 別の文字や、文字とは無関係な落書き',
    '',
    '必ず次の形式で1行だけ答えてください:',
    'Y|（ひらがな中心の励ましコメント25文字以内）',
    'または',
    'N|（責めずにもう一度書くようさそうコメント25文字以内）',
    '',
    '例: Y|よくかけているね、いいね！',
    '例: N|もういちどかいてみよう！',
  ].join('\n')
}

interface ScoutResult {
  response?: string
}

function parseScoutResponse(raw: unknown): SketchFeedbackResponse | null {
  const text = typeof (raw as ScoutResult)?.response === 'string'
    ? (raw as ScoutResult).response!.trim()
    : ''
  const m = /^([YN])\s*\|\s*(.+)$/m.exec(text)
  if (!m) return null
  const comment = m[2].trim().slice(0, 60)
  if (!comment) return null
  return {
    category: m[1] === 'Y' ? 'ok' : 'retry',
    comment,
  }
}

async function runScout(ai: Ai, req: SketchFeedbackRequest): Promise<SketchFeedbackResponse> {
  // env.AI.run は AbortController で中断できないため Promise.race で fail-open する。
  // タイムアウト後も AI 実行自体は裏で完走しうる（コストは無料枠内で許容）。
  // scout の vision 入力は OpenAI 互換 messages + content 配列（image_url は data URI のみ）
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS))
  const run = ai.run(SCOUT_MODEL as Parameters<Ai['run']>[0], {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.kind === 'kanji' ? buildKanjiPrompt(req.figure_hint, req.answer) : buildFigurePrompt(req.figure_hint) },
          { type: 'image_url', image_url: { url: req.image } },
        ],
      },
    ],
    max_tokens: 100,
  } as never) as Promise<unknown>

  const raw = await Promise.race([run, timeout])
  if (raw === null) {
    console.warn('[sketch-feedback] AI timeout')
    return FALLBACK_RESPONSE
  }
  const parsed = parseScoutResponse(raw)
  if (!parsed) {
    console.warn('[sketch-feedback] unparsable AI response', JSON.stringify(raw).slice(0, 500))
    return FALLBACK_RESPONSE
  }
  return parsed
}

app.post('/', async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }
  const req = parseRequest(body)
  if (!req) {
    return c.json({ ok: false, error: 'invalid_payload' }, 400)
  }

  if (c.get('debug')) {
    const debugRes: SketchFeedbackResponse = { category: 'ok', comment: '(debug)', debug: true }
    return c.json({ ok: true, ...debugRes })
  }

  try {
    const result = await runScout(c.env.AI, req)
    return c.json({ ok: true, ...result })
  } catch (err) {
    // fail-open: AI 障害でゲートを止めない
    console.error('[sketch-feedback] AI error', err)
    return c.json({ ok: true, ...FALLBACK_RESPONSE })
  }
})

export { app as sketchFeedbackRoutes }
