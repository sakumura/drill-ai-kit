import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, _clearJsonCache, invalidateUserStateCache } from '../lib/api'
import { getJstTodayKey } from '../lib/dates'
import { writeQueue } from '../lib/writeQueue'

function jsonResponse(body: unknown, init: Partial<Response> = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
  } as Response
}

describe('api.getTodayLesson', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('loads today lesson from static JSON files', async () => {
    const today = getJstTodayKey()
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: 'たし算',
            concept_cards: [],
            tips: [],
            difficulty: 1,
            grade: 1,
            questions: [],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: '算数', grade: 1, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule1',
            date: today,
            lesson_id: 'lesson1',
            status: 'scheduled',
            meta_reviewed_at: '2026-04-28 00:00:00',
            parent_approved_at: '2026-04-28 00:00:00',
          },
        ]))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })

    const result = await api.getTodayLesson()
    expect(result.id).toBe('lesson1')
    expect(result.title).toBe('たし算')
    expect(result.subject).toBe('math')
  })

  it('throws when a JSON file cannot be loaded', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }),
    )

    await expect(api.getTodayLesson()).rejects.toThrow('API error: 404 Not Found')
  })
})

describe('api.saveAnswers', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('queues answer writes for R2 logging', async () => {
    const answers = [
      {
        question_id: 'q1',
        lesson_id: 'lesson1',
        user_answer: '6',
        is_correct: true,
        time_spent_sec: 3,
        hints_used: 0,
        block_id: 'core',
        block_type: 'core',
        block_position: 1,
        block_question_position: 1,
        optional_extra: false,
      },
    ]

    await api.saveAnswers(answers)

    const queuedAnswer = writeQueue.pending().find((item) => item.type === 'answer')
    expect(queuedAnswer?.payload).toEqual(
      expect.objectContaining({
        question_id: 'q1',
        lesson_id: 'lesson1',
        user_answer: '6',
        is_correct: true,
        block_id: 'core',
        block_type: 'core',
        block_position: 1,
        block_question_position: 1,
        optional_extra: false,
      }),
    )
  })

  it('does not wait for the log flush before resolving answer saves', async () => {
    vi.useFakeTimers()
    vi.mocked(global.fetch).mockImplementation(() => new Promise<Response>(() => {}))

    let settled = false
    const save = api.saveAnswers([
      {
        question_id: 'q1',
        lesson_id: 'lesson1',
        user_answer: '6',
        is_correct: true,
        time_spent_sec: 3,
        hints_used: 0,
      },
    ]).then((res) => {
      settled = true
      return res
    })

    await Promise.resolve()

    expect(settled).toBe(true)
    await expect(save).resolves.toEqual(
      expect.objectContaining({
        count: 1,
        status: 'ok',
      }),
    )
    expect(writeQueue.pending().some((item) => item.type === 'answer')).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('uses optimistic answers for immediate lesson resume', async () => {
    await api.saveAnswers([
      {
        question_id: 'q1',
        lesson_id: 'lesson1',
        user_answer: '6',
        is_correct: true,
        time_spent_sec: 3,
        hints_used: 0,
      },
    ])

    const results = await api.getLessonResults('lesson1')
    expect(results).toEqual([
      expect.objectContaining({
        question_id: 'q1',
        is_correct: 1,
        user_answer: '6',
        time_spent_sec: 3,
        answered_at: expect.any(String),
      }),
    ])
  })
})

describe('api.saveAnswers step metadata', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('includes step meta and retry marker in queued answer when provided', async () => {
    await api.saveAnswers([
      {
        question_id: 'q-multi-1',
        lesson_id: 'lesson1',
        user_answer: '正解',
        is_correct: true,
        time_spent_sec: 4,
        hints_used: 0,
        step: 1,
        step_label: 'tier1',
        is_retry: true,
      },
    ])

    const queuedAnswer = writeQueue.pending().find((item) => item.type === 'answer')
    expect(queuedAnswer?.payload).toEqual(
      expect.objectContaining({
        question_id: 'q-multi-1',
        step: 1,
        step_label: 'tier1',
        is_retry: true,
      }),
    )
  })

  it('keeps tier1 and tier2 as separate entries in answer history', async () => {
    await api.saveAnswers([
      {
        question_id: 'q-two-tier',
        lesson_id: 'lesson1',
        user_answer: '答えA',
        is_correct: true,
        time_spent_sec: 3,
        hints_used: 0,
        step: 1,
        step_label: 'tier1',
      },
    ])
    await api.saveAnswers([
      {
        question_id: 'q-two-tier',
        lesson_id: 'lesson1',
        user_answer: '根拠B',
        is_correct: true,
        time_spent_sec: 5,
        hints_used: 0,
        step: 2,
        step_label: 'tier2',
      },
    ])

    const results = await api.getLessonResults('lesson1')
    expect(results).toEqual([
      expect.objectContaining({
        question_id: 'q-two-tier',
        is_correct: 1,
        step: 1,
        step_label: 'tier1',
        user_answer: '答えA',
        time_spent_sec: 3,
        answered_at: expect.any(String),
      }),
      expect.objectContaining({
        question_id: 'q-two-tier',
        is_correct: 1,
        step: 2,
        step_label: 'tier2',
        user_answer: '根拠B',
        time_spent_sec: 5,
        answered_at: expect.any(String),
      }),
    ])
  })

  it('does not deduplicate tier1 and tier2 of the same question (different step)', async () => {
    // tier1 (step=1) and tier2 (step=2) for the same question_id must be kept as separate records
    await api.saveAnswers([
      {
        question_id: 'q-same-id',
        lesson_id: 'lesson1',
        user_answer: '答えA',
        is_correct: true,
        time_spent_sec: 3,
        hints_used: 0,
        step: 1,
        step_label: 'tier1',
      },
    ])
    await api.saveAnswers([
      {
        question_id: 'q-same-id',
        lesson_id: 'lesson1',
        user_answer: '根拠B',
        is_correct: true,
        time_spent_sec: 5,
        hints_used: 0,
        step: 2,
        step_label: 'tier2',
      },
    ])

    // Both steps are optimistically cached as separate entries
    const pendingItems = writeQueue.pending().filter(
      (item) => item.type === 'answer' &&
        (item.payload as Record<string, unknown>).question_id === 'q-same-id',
    )
    // step=1 and step=2 are distinct → 2 queue entries
    expect(pendingItems).toHaveLength(2)
    const steps = pendingItems.map((item) => (item.payload as Record<string, unknown>).step)
    expect(steps).toContain(1)
    expect(steps).toContain(2)
  })

  it('passes step meta through without step fields for single-type answers (backward compat)', async () => {
    await api.saveAnswers([
      {
        question_id: 'q-legacy',
        lesson_id: 'lesson1',
        user_answer: '42',
        is_correct: true,
        time_spent_sec: 2,
        hints_used: 0,
      },
    ])

    const queuedAnswer = writeQueue.pending().find((item) => item.type === 'answer')
    const payload = queuedAnswer?.payload as Record<string, unknown> | undefined
    // step/step_label should be undefined (not present in payload)
    expect(payload?.step).toBeUndefined()
    expect(payload?.step_label).toBeUndefined()
  })
})

describe('api.getReviewQueue', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  function mockReviewData(answerHistory: unknown[]) {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: '復習元',
            concept_cards: [],
            tips: [],
            difficulty: 1,
            grade: 5,
            subject: 'math',
            questions: [
              {
                id: 'q-recent-wrong',
                lesson_id: 'lesson1',
                position: 1,
                question_text: 'recent wrong',
                figure_svg: null,
                answer: '1',
                answer_unit: null,
                hints: [],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
              {
                id: 'q-slow',
                lesson_id: 'lesson1',
                position: 2,
                question_text: 'slow',
                figure_svg: null,
                answer: '2',
                answer_unit: null,
                hints: [],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
            ],
            passages: [
              {
                id: 'p1',
                lesson_id: 'lesson1',
                position: 1,
                paragraph_text: '本文',
              },
            ],
            reading_questions: [
              {
                id: 'rq-recent-wrong',
                passage_id: 'p1',
                lesson_id: 'lesson1',
                position: 1,
                question_type: 'choice4',
                question_text: 'reading recent wrong',
                choices: [
                  { text: 'A', isCorrect: true },
                  { text: 'B', isCorrect: false },
                  { text: 'C', isCorrect: false },
                  { text: 'D', isCorrect: false },
                ],
                correct_answer: 'A',
                explanation: null,
                difficulty_tier: 2,
              },
            ],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: '復習単元', grade: 5, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([]))
      }
      if (url === '/api/user-state') {
        return Promise.resolve(jsonResponse({
          session_id: 'test-session',
          answer_history: answerHistory,
          updated_at: '2026-05-08T00:00:00.000Z',
        }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })
  }

  it('selects review questions from wrong and slow answer history', async () => {
    mockReviewData([
      {
        question_id: 'q-slow',
        lesson_id: 'lesson1',
        user_answer: '2',
        is_correct: true,
        time_spent_sec: 46,
        hints_used: 0,
        answered_at: '2026-05-07T00:00:01.000Z',
      },
      {
        question_id: 'q-recent-wrong',
        lesson_id: 'lesson1',
        user_answer: '0',
        is_correct: false,
        time_spent_sec: 8,
        hints_used: 0,
        answered_at: '2026-05-08T00:00:01.000Z',
      },
    ])

    const queue = await api.getReviewQueue('math')

    expect(queue.items.map((item) => item.question_id)).toEqual([
      'q-recent-wrong',
      'q-slow',
    ])
    expect(queue.items[0]).toEqual(expect.objectContaining({
      reason: 'recent_wrong',
      unit_name: '復習単元',
    }))
    expect(queue.items[1].reason).toBe('slow_correct')
  })

  it('returns an empty queue when answer history has no review candidates', async () => {
    mockReviewData([])

    await expect(api.getReviewQueue('math')).resolves.toEqual({
      subject: 'math',
      items: [],
    })
  })

  it('scopes the MVP review queue to flash questions and ignores reading questions', async () => {
    mockReviewData([
      {
        question_id: 'rq-recent-wrong',
        lesson_id: 'lesson1',
        user_answer: 'B',
        is_correct: false,
        time_spent_sec: 12,
        hints_used: 0,
        answered_at: '2026-05-08T00:00:01.000Z',
      },
    ])

    await expect(api.getReviewQueue('math')).resolves.toEqual({
      subject: 'math',
      items: [],
    })
  })

  it('builds a synthetic review lesson from the selected queue', async () => {
    mockReviewData([
      {
        question_id: 'q-recent-wrong',
        lesson_id: 'lesson1',
        user_answer: '0',
        is_correct: false,
        time_spent_sec: 8,
        hints_used: 0,
        answered_at: '2026-05-08T00:00:01.000Z',
      },
    ])

    const lesson = await api.getLesson('review-math')

    expect(lesson).toEqual(expect.objectContaining({
      id: 'review-math',
      title: '今日の5問復習（算数）',
      subject: 'math',
    }))
    expect(lesson.questions).toHaveLength(1)
    expect(lesson.questions[0].id).toBe('q-recent-wrong')
    expect(lesson.questions[0].lesson_id).toBe('review-math')
  })
})

describe('api.getAllLessons progress', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('computes home progress and completed status from answer history', async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: '図形',
            concept_cards: [],
            tips: [],
            difficulty: 1,
            grade: 5,
            subject: 'math',
            questions: [
              {
                id: 'q1',
                lesson_id: 'lesson1',
                position: 1,
                question_text: 'q1',
                figure_svg: null,
                answer: '1',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
              {
                id: 'q2',
                lesson_id: 'lesson1',
                position: 2,
                question_text: 'q2',
                figure_svg: null,
                answer: '2',
                answer_unit: null,
                hints: ['2', '1', '3', '根拠', '誤り1', '誤り2'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
                question_type: 'two_tier',
              },
            ],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: 'math', grade: 5, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule1',
            date: '2026-05-06',
            lesson_id: 'lesson1',
            status: 'pending',
            meta_reviewed_at: '2026-05-06 00:00:00',
            parent_approved_at: '2026-05-06 00:00:00',
          },
        ]))
      }
      if (url === '/api/user-state') {
        return Promise.resolve(jsonResponse({
          session_id: 'test-session',
          answer_history: [
            {
              question_id: 'q1',
              lesson_id: 'lesson1',
              user_answer: '1',
              is_correct: true,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-05-06T00:00:01.000Z',
            },
            {
              question_id: 'q2',
              lesson_id: 'lesson1',
              user_answer: '2',
              is_correct: true,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-05-06T00:00:02.000Z',
              step: 1,
              step_label: 'tier1',
            },
            {
              question_id: 'q2',
              lesson_id: 'lesson1',
              user_answer: '根拠',
              is_correct: true,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-05-06T00:00:03.000Z',
              step: 2,
              step_label: 'tier2',
            },
          ],
          updated_at: '2026-05-06T00:00:03.000Z',
        }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })

    const lessons = await api.getAllLessons('math')

    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toEqual(
      expect.objectContaining({
        id: 'lesson1',
        question_count: 2,
        progress_count: 2,
        status: 'completed',
      }),
    )
  })

  it('does not mark a lesson completed when every question only has wrong answer history', async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: '図形',
            concept_cards: [],
            tips: [],
            difficulty: 1,
            grade: 5,
            subject: 'math',
            questions: [
              {
                id: 'q1',
                lesson_id: 'lesson1',
                position: 1,
                question_text: 'q1',
                figure_svg: null,
                answer: '1',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
              {
                id: 'q2',
                lesson_id: 'lesson1',
                position: 2,
                question_text: 'q2',
                figure_svg: null,
                answer: '2',
                answer_unit: null,
                hints: ['2', '1', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
            ],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: 'math', grade: 5, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule1',
            date: '2026-06-14',
            lesson_id: 'lesson1',
            status: 'pending',
            meta_reviewed_at: '2026-06-14 00:00:00',
            parent_approved_at: '2026-06-14 00:00:00',
          },
        ]))
      }
      if (url === '/api/user-state') {
        return Promise.resolve(jsonResponse({
          session_id: 'test-session',
          answer_history: [
            {
              question_id: 'q1',
              lesson_id: 'lesson1',
              user_answer: '2',
              is_correct: false,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-06-14T00:00:01.000Z',
            },
            {
              question_id: 'q2',
              lesson_id: 'lesson1',
              user_answer: '1',
              is_correct: false,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-06-14T00:00:02.000Z',
            },
          ],
          lesson_completions: [],
          updated_at: '2026-06-14T00:00:02.000Z',
        }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })

    const lessons = await api.getAllLessons('math')

    expect(lessons[0]).toEqual(
      expect.objectContaining({
        id: 'lesson1',
        question_count: 2,
        progress_count: 2,
        status: 'in_progress',
      }),
    )
  })

  it('marks a lesson completed when all non-optional questions are finally correct', async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: '割合',
            concept_cards: [],
            tips: [],
            difficulty: 2,
            grade: 5,
            subject: 'math',
            questions: [
              {
                id: 'q-main-1',
                lesson_id: 'lesson1',
                position: 1,
                question_text: 'main1',
                figure_svg: null,
                answer: '1',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
              {
                id: 'q-main-2',
                lesson_id: 'lesson1',
                position: 2,
                question_text: 'main2',
                figure_svg: null,
                answer: '2',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
              {
                id: 'q-extra-1',
                lesson_id: 'lesson1',
                position: 3,
                question_text: 'extra1',
                figure_svg: null,
                answer: '3',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
            ],
            blocks: [
              {
                id: 'core',
                title: '本編',
                block_type: 'core',
                question_ids: ['q-main-1', 'q-main-2'],
              },
              {
                id: 'maintenance',
                title: '追加メンテナンス',
                block_type: 'optional_extra',
                optional_extra: true,
                question_ids: ['q-extra-1'],
              },
            ],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: 'math', grade: 5, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule1',
            date: '2026-06-13',
            lesson_id: 'lesson1',
            status: 'pending',
            meta_reviewed_at: '2026-06-13 00:00:00',
            parent_approved_at: '2026-06-13 00:00:00',
          },
        ]))
      }
      if (url === '/api/user-state') {
        return Promise.resolve(jsonResponse({
          session_id: 'test-session',
          answer_history: [
            {
              question_id: 'q-main-1',
              lesson_id: 'lesson1',
              user_answer: '1',
              is_correct: true,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-06-13T00:00:01.000Z',
            },
            {
              question_id: 'q-main-2',
              lesson_id: 'lesson1',
              user_answer: '2',
              is_correct: true,
              time_spent_sec: 3,
              hints_used: 0,
              answered_at: '2026-06-13T00:00:02.000Z',
            },
          ],
          lesson_completions: [],
          updated_at: '2026-06-13T00:00:02.000Z',
        }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })

    const lessons = await api.getAllLessons('math')

    expect(lessons[0]).toEqual(
      expect.objectContaining({
        id: 'lesson1',
        question_count: 2,
        progress_count: 2,
        status: 'completed',
      }),
    )
  })

  it('marks a lesson completed from lesson completion history even when answers are missing', async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input)
      if (url === '/data/lessons.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'lesson1',
            unit_id: 'unit1',
            title: '図形',
            concept_cards: [],
            tips: [],
            difficulty: 1,
            grade: 5,
            subject: 'math',
            questions: [
              {
                id: 'q1',
                lesson_id: 'lesson1',
                position: 1,
                question_text: 'q1',
                figure_svg: null,
                answer: '1',
                answer_unit: null,
                hints: ['1', '2', '3'],
                solution_steps: [],
                common_mistakes: [],
                diag_step1: null,
                diag_step2: null,
              },
            ],
          },
        ]))
      }
      if (url === '/data/units.json') {
        return Promise.resolve(jsonResponse([
          { id: 'unit1', name: 'math', grade: 5, subject: 'math' },
        ]))
      }
      if (url === '/data/schedule.json') {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule1',
            date: '2026-05-06',
            lesson_id: 'lesson1',
            status: 'pending',
            meta_reviewed_at: '2026-05-06 00:00:00',
            parent_approved_at: '2026-05-06 00:00:00',
          },
        ]))
      }
      if (url === '/api/user-state') {
        return Promise.resolve(jsonResponse({
          session_id: 'test-session',
          answer_history: [],
          lesson_completions: [
            {
              lesson_id: 'lesson1',
              lesson_title: '図形',
              subject: 'math',
              question_count: 1,
              correct_count: 1,
              attempts: 1,
              completed_at: '2026-05-06T00:00:03.000Z',
            },
          ],
          updated_at: '2026-05-06T00:00:03.000Z',
        }))
      }
      return Promise.resolve(jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }))
    })

    const lessons = await api.getAllLessons('math')

    expect(lessons[0]).toEqual(
      expect.objectContaining({
        id: 'lesson1',
        question_count: 1,
        progress_count: 1,
        status: 'completed',
      }),
    )
  })
})

describe('api.saveLessonComplete', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('posts a lesson_complete log event', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true, key: 'lesson_complete/1.jsonl' }))

    const ok = await api.saveLessonComplete({
      lesson_id: 'lesson1',
      lesson_title: '図形',
      subject: 'math',
      question_count: 30,
      correct_count: 28,
      first_correct_count: 28,
      final_correct_count: 30,
      rescued_count: 2,
      needs_review_count: 0,
      attempts: 30,
    })

    expect(ok).toBe(true)
    const [, init] = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.type).toBe('lesson_complete')
    expect(body.payload).toEqual(
      expect.objectContaining({
        lesson_id: 'lesson1',
        lesson_title: '図形',
        correct_count: 28,
        first_correct_count: 28,
        final_correct_count: 30,
        rescued_count: 2,
        needs_review_count: 0,
      }),
    )
  })
})

describe('api.saveBlockComplete', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch')
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _clearJsonCache()
    invalidateUserStateCache()
    writeQueue.clear()
    localStorage.clear()
  })

  it('posts block completion with block_type and position metadata', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ ok: true, key: 'block_complete/1.jsonl' }))

    const ok = await api.saveBlockComplete({
      lesson_id: 'lesson1',
      block_id: 'core',
      block_title: '本編',
      block_type: 'core',
      block_position: 1,
      optional_extra: false,
      question_count: 10,
      correct_count: 8,
    })

    expect(ok).toBe(true)
    const [, init] = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.type).toBe('block_complete')
    expect(body.payload).toEqual(
      expect.objectContaining({
        lesson_id: 'lesson1',
        block_id: 'core',
        block_type: 'core',
        block_position: 1,
        optional_extra: false,
        question_count: 10,
        correct_count: 8,
      }),
    )
  })
})
