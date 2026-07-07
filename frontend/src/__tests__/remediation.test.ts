import { describe, expect, it } from 'vitest'
import { buildRemediationPlan } from '../lib/remediation'
import type { Question } from '../lib/api'
import type { QuestionResult } from '../components/GameResult'

function question(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    lesson_id: 'lesson-m',
    position: 1,
    question_text: id,
    figure_svg: null,
    answer: '1',
    answer_unit: null,
    hints: ['1', '2', '3'],
    solution_steps: [],
    common_mistakes: [],
    diag_step1: null,
    diag_step2: null,
    unit_id: 'kakudo',
    ...overrides,
  }
}

function wrong(q: Question): QuestionResult {
  return {
    question: q,
    correct: false,
    score: 0,
    timeTaken: 8,
    chosenText: '2',
  }
}

describe('buildRemediationPlan', () => {
  it('uses explicit same-skill targets when available', () => {
    const source = question('q1', {
      remediation: {
        same_skill_question_id: 'q2',
        micro_explanation: '半径と直径を先に確認する',
      },
    })
    const target = question('q2')
    const plan = buildRemediationPlan([source, target], [wrong(source)])

    expect(plan.questions.map((q) => q.id)).toEqual(['q2'])
    expect(plan.stage).toBe('same_skill')
    expect(plan.micro_explanation).toBe('半径と直径を先に確認する')
    expect(plan.fallback).toBe(false)
  })

  it('falls back to the original wrong question when targets are missing', () => {
    const source = question('q1', {
      remediation: {
        same_skill_question_id: 'missing',
      },
    })
    const plan = buildRemediationPlan([source], [wrong(source)])

    expect(plan.questions.map((q) => q.id)).toEqual(['q1'])
    expect(plan.fallback).toBe(true)
  })
})
