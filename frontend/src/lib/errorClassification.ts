import type { Question } from './api'

export type ErrorType = 'rushing' | 'timeout' | 'procedure' | 'concept' | 'transfer'

export interface ErrorTypeFeedback {
  type: ErrorType
  label: string
  guidance: string
}

export interface ClassifyErrorTypeInput {
  is_correct: boolean
  time_spent_sec: number
  subject?: 'math' | 'japanese'
  step_label?: string
  question_type?: string
  common_mistakes?: Question['common_mistakes']
  difficulty?: number
}

export interface ErrorClassificationResult extends ErrorTypeFeedback {
  timeTaken?: number
  guidance: string
}

export interface BuildErrorClassificationInput extends ClassifyErrorTypeInput {
  timeTaken?: number
  mistakeGuidance?: string
}

const PROCEDURE_KEYWORDS = [
  '手順',
  '順序',
  '逆数',
  '約分',
  '通分',
  '計算順',
  '符号',
  '桁',
  '単位',
  '式',
  '公式',
]

const CONCEPT_KEYWORDS = [
  '概念',
  '意味',
  '混同',
  '半径',
  '直径',
  '尊敬語',
  '謙譲語',
  '事実',
  '心情',
  '主語',
  '文脈',
]

const TRANSFER_TYPE_PATTERN = /transfer|application|evidence|reading|応用|本番|記述|読解/

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function mistakeText(commonMistakes: Question['common_mistakes'] | undefined): string {
  return (commonMistakes ?? [])
    .map((item) => `${item.mistake} ${item.guidance}`)
    .join(' ')
}

function timeoutThresholdSec(subject: 'math' | 'japanese' | undefined): number {
  if (subject === 'japanese') return 30
  if (subject === 'math') return 60
  return Number.POSITIVE_INFINITY
}

export function classifyErrorType(input: ClassifyErrorTypeInput): ErrorType | null {
  if (input.is_correct) return null

  if (input.time_spent_sec <= 3) return 'rushing'
  if (input.time_spent_sec >= timeoutThresholdSec(input.subject)) return 'timeout'

  const stepAndTypeText = `${input.step_label ?? ''} ${input.question_type ?? ''}`
  const mistakes = mistakeText(input.common_mistakes)
  const combinedText = `${stepAndTypeText} ${mistakes}`

  if (includesKeyword(combinedText, PROCEDURE_KEYWORDS)) return 'procedure'
  if (includesKeyword(combinedText, CONCEPT_KEYWORDS)) return 'concept'
  if ((input.difficulty ?? 0) >= 4 || TRANSFER_TYPE_PATTERN.test(stepAndTypeText)) return 'transfer'

  return 'concept'
}

export function buildErrorTypeFeedback(
  type: ErrorType,
  mistakeGuidance?: string,
): ErrorTypeFeedback {
  if (type === 'rushing') {
    return {
      type,
      label: 'あわてミス',
      guidance: '問題文を最後まで読んでから答えよう。',
    }
  }
  if (type === 'timeout') {
    return {
      type,
      label: '時間切れ',
      guidance: '止まったところを一つだけ確認して、短い類題でもう一回やろう。',
    }
  }
  if (type === 'procedure') {
    return {
      type,
      label: '手順ミス',
      guidance: mistakeGuidance ?? '解く順番を声に出してから進めよう。',
    }
  }
  if (type === 'transfer') {
    return {
      type,
      label: '形式変更',
      guidance: '似た考え方の別形式で練習しよう。',
    }
  }
  return {
    type,
    label: '考え方の確認',
    guidance: mistakeGuidance ?? '何を聞かれているかを先に言葉で確認しよう。',
  }
}

export function buildErrorClassification(
  input: BuildErrorClassificationInput,
): ErrorClassificationResult | null {
  const type = classifyErrorType(input)
  if (!type) return null
  return {
    ...buildErrorTypeFeedback(type, input.mistakeGuidance),
    timeTaken: input.timeTaken,
  }
}
