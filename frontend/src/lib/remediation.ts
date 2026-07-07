import type { Question } from './api'

export type RemediationStage = 'same' | 'same_skill' | 'transfer'

interface WrongQuestionResult {
  question: Question
  correct: boolean
}

export interface RemediationPlan {
  questions: Question[]
  stage: RemediationStage
  micro_explanation?: string
  fallback: boolean
}

function questionKey(question: Question): string {
  return question.id
}

function findQuestionById(questions: Question[], id: string | undefined): Question | null {
  if (!id) return null
  return questions.find((question) => question.id === id) ?? null
}

function findSameSkillQuestion(questions: Question[], source: Question): Question | null {
  const patternId = source.remediation?.pattern_id ?? source.unit_id
  if (!patternId) return null
  return questions.find((question) => {
    if (question.id === source.id) return false
    return question.remediation?.pattern_id === patternId || question.unit_id === patternId || question.unit_id === source.unit_id
  }) ?? null
}

function uniqueQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>()
  const unique: Question[] = []
  for (const question of questions) {
    const key = questionKey(question)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(question)
  }
  return unique
}

export function buildRemediationPlan(allQuestions: Question[], wrongResults: WrongQuestionResult[]): RemediationPlan {
  const targets: Question[] = []
  let stage: RemediationStage = 'same'
  let microExplanation: string | undefined

  for (const result of wrongResults) {
    const source = result.question
    const remediation = source.remediation
    const transfer = findQuestionById(allQuestions, remediation?.transfer_question_id)
    const sameSkill = findQuestionById(allQuestions, remediation?.same_skill_question_id) ?? findSameSkillQuestion(allQuestions, source)
    const target = sameSkill ?? transfer ?? source
    if (transfer && target.id === transfer.id) stage = 'transfer'
    if (sameSkill && target.id === sameSkill.id && stage !== 'transfer') stage = 'same_skill'
    if (!microExplanation && remediation?.micro_explanation) {
      microExplanation = remediation.micro_explanation
    }
    targets.push(target)
  }

  const questions = uniqueQuestions(targets)
  return {
    questions,
    stage,
    micro_explanation: microExplanation,
    fallback: questions.every((question) => wrongResults.some((result) => result.question.id === question.id)),
  }
}

export function remediationStageLabel(stage: RemediationStage, fallback: boolean): string {
  if (fallback) return 'まちがえた問題'
  if (stage === 'transfer') return '転移リトライ'
  if (stage === 'same_skill') return '類題リトライ'
  return '同じ問題'
}
