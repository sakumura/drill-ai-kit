import type {
  LearningDashboardResponse,
  LearningDashboardRow,
  LearningDashboardStatus,
  LearningProfile,
  LearningProfileWeakness,
  Lesson,
  ReadingQuestion,
} from './api'
import type { LocalAnswerRecord, UnitRowLite } from './aggregate'

interface ComputeLearningDashboardInput {
  lessons: Lesson[]
  units: UnitRowLite[]
  answers: LocalAnswerRecord[]
  profile: LearningProfile
}

interface QuestionMeta {
  question_id: string
  lesson_id: string
  unit_id: string
  subject: 'math' | 'japanese'
  question_type?: string
  difficulty?: string
}

const PATTERN_ALIASES: Record<string, string[]> = {
  'kanji-kakitori': ['sk-kanji', 'kanji-yomikaki'],
  kakudo: ['kakudo'],
  'baibun-ouyou': ['baibun-ouyou', 'wariai'],
  'seikaku-kijutsu': ['seikaku-kijutsu'],
  'tier2-why-attribution': ['tier2-why-attribution'],
  keigo: ['keigo'],
  'jouhou-seiri': ['jouhou-seiri'],
  gyakuzan: ['gyakuzan', 'sk-gyakuzan'],
  hayasa: ['hayasa'],
  'baai-no-kazu': ['baai-no-kazu'],
  'keisan-junjo': ['keisan-junjo', 'sk-keisan-junjo'],
  'hitei-sentaku': ['hitei-sentaku', 'sk-hitei'],
  'naiyou-gacchi': ['naiyou-gacchi', 'sk-gacchi', 'sk-naiyou'],
  shijigo: ['shijigo', 'sk-shijigo'],
  'kuulan-houju': ['kuulan-houju', 'sk-kuulan'],
  'inga-kankei': ['inga-kankei', 'sk-inga'],
  'youshi-haaku': ['youshi-haaku', 'sk-youshi'],
  'wasazan-bunsuu': ['wasazan-bunsuu'],
  'bunsuu-warisan': ['bunsuu-warisan'],
  'yakubun-incomplete': ['yakubun-incomplete', 'yakubun-checker', 'sk-yakubun'],
  kiseki: ['kiseki'],
  'tamen-tayoukei': ['tamen-tayoukei', 'sk-zukei'],
  'bunsuu-syousuu': ['bunsuu-syousuu', 'sk-bunsuu-syousuu', 'shousu-to-bunsu'],
  kisokusei: ['kisokusei', 'sk-kisokusei'],
  'bunbo-kasan': ['bunbo-kasan', 'sk-tsubun', 'bunsu-tashizan-hikizan'],
  'baisuu-gcd-lcm': ['baisuu-gcd-lcm', 'yakusu-baisu', 'sk-gcd-lcm'],
  setsuzokugo: ['setsuzokugo', 'sk-setsuzoku'],
  'kanji-doon-iji': ['kanji-doon-iji', 'sk-kanji', 'kanji-yomikaki'],
  'gairaigo-seikaku': ['gairaigo-seikaku', 'sk-kanyouku'],
  'syousuu-warisan': ['syousuu-warisan', 'sk-syousuu-warisan', 'shousu-kakezan-warizan'],
  'tani-henkan': ['tani-henkan', 'sk-tani'],
  shigotozan: ['shigotozan'],
  wariai: ['wariai', 'sk-wariai'],
  'sk-inga': ['sk-inga', 'inga-kankei'],
  uekizan: ['uekizan', 'sk-uekizan'],
  'kanyouku-karada': ['kanyouku-karada', 'sk-kanyouku'],
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function buildQuestionMeta(lessons: Lesson[]): Map<string, QuestionMeta> {
  const map = new Map<string, QuestionMeta>()
  for (const lesson of lessons) {
    for (const question of lesson.questions ?? []) {
      map.set(question.id, {
        question_id: question.id,
        lesson_id: lesson.id,
        unit_id: question.unit_id ?? lesson.unit_id,
        subject: lesson.subject,
        question_type: question.question_type,
        difficulty: question.difficulty,
      })
    }
    for (const question of lesson.reading_questions ?? []) {
      map.set(question.id, readingQuestionMeta(lesson, question))
    }
  }
  return map
}

function readingQuestionMeta(lesson: Lesson, question: ReadingQuestion): QuestionMeta {
  return {
    question_id: question.id,
    lesson_id: lesson.id,
    unit_id: lesson.unit_id,
    subject: lesson.subject,
    question_type: question.question_type,
    difficulty: question.difficulty_tier >= 4 ? `d${question.difficulty_tier}` : undefined,
  }
}

function matchesWeakness(meta: QuestionMeta, weakness: LearningProfileWeakness): boolean {
  if (meta.subject !== weakness.subject) return false
  const ids = new Set([weakness.pattern_id, ...(PATTERN_ALIASES[weakness.pattern_id] ?? [])])
  return ids.has(meta.unit_id) || [...ids].some((id) => meta.unit_id.includes(id) || id.includes(meta.unit_id))
}

function isTransferLike(meta: QuestionMeta): boolean {
  const difficulty = meta.difficulty ?? ''
  return meta.question_type === 'evidence_first' || meta.question_type === 'two_tier' || difficulty === 'd4' || difficulty === 'd5'
}

function statusLabel(status: LearningDashboardStatus): string {
  if (status === 'maintain') return '維持'
  if (status === 'review') return '要復習'
  if (status === 'unfixed') return '未定着'
  return '本番形式不足'
}

function inferStatus(weakness: LearningProfileWeakness, practiceCount: number, finalAccuracy: number, transferAccuracy: number | null): LearningDashboardStatus {
  const testText = weakness.last_test_result ?? ''
  const failedInTest = /失点|全滅|再発|誤答|failed|recurred/.test(testText)
  if (practiceCount === 0) return 'review'
  if (finalAccuracy < 70) return 'unfixed'
  if (failedInTest || (transferAccuracy !== null && transferAccuracy < 60)) return 'needs_exam_format'
  if (weakness.score >= 65) return 'review'
  return 'maintain'
}

function defaultQuestionType(row: LearningProfileWeakness, status: LearningDashboardStatus): string {
  if (row.next_question_type) return row.next_question_type
  if (status === 'needs_exam_format') return '転移・本番形式'
  if (status === 'unfixed') return '類題リトライ'
  if (status === 'review') return '短い復習ブロック'
  return '維持確認'
}

export function computeLearningDashboard({
  lessons,
  units,
  answers,
  profile,
}: ComputeLearningDashboardInput): LearningDashboardResponse {
  const questionMeta = buildQuestionMeta(lessons)
  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]))
  const sortedAnswers = [...answers].sort((a, b) => a.answered_at.localeCompare(b.answered_at))

  const rows: LearningDashboardRow[] = profile.weaknesses.map((weakness) => {
    const weaknessAnswers = sortedAnswers.filter((answer) => {
      const meta = questionMeta.get(answer.question_id)
      return meta ? matchesWeakness(meta, weakness) : false
    })

    const byQuestion = new Map<string, LocalAnswerRecord[]>()
    for (const answer of weaknessAnswers) {
      const bucket = byQuestion.get(answer.question_id) ?? []
      bucket.push(answer)
      byQuestion.set(answer.question_id, bucket)
    }

    let firstCorrect = 0
    let finalCorrect = 0
    for (const bucket of byQuestion.values()) {
      const first = bucket[0]
      const last = bucket[bucket.length - 1]
      if (first?.is_correct) firstCorrect += 1
      if (last?.is_correct) finalCorrect += 1
    }

    const transferAnswers = weaknessAnswers.filter((answer) => {
      const meta = questionMeta.get(answer.question_id)
      return meta ? isTransferLike(meta) : false
    })
    const transferAccuracy = transferAnswers.length > 0
      ? roundPct(transferAnswers.filter((answer) => answer.is_correct).length, transferAnswers.length)
      : null

    const practiceCount = weaknessAnswers.length
    const firstAttemptAccuracy = roundPct(firstCorrect, byQuestion.size)
    const finalAccuracy = roundPct(finalCorrect, byQuestion.size)
    const status = inferStatus(weakness, practiceCount, finalAccuracy, transferAccuracy)

    return {
      weakness_id: weakness.pattern_id,
      weakness_name: weakness.name ?? unitNames.get(weakness.pattern_id) ?? weakness.pattern_id,
      subject: weakness.subject,
      app_practice_count: practiceCount,
      first_attempt_accuracy: firstAttemptAccuracy,
      final_accuracy: finalAccuracy,
      transfer_accuracy: transferAccuracy,
      latest_test_result: weakness.last_test_result ?? null,
      status,
      status_label: statusLabel(status),
      next_question_type: defaultQuestionType(weakness, status),
      score: weakness.score,
      severity: weakness.severity,
    }
  })

  return {
    rows: rows.sort((a, b) => b.score - a.score),
    summary: {
      total_weaknesses: rows.length,
      practiced_weaknesses: rows.filter((row) => row.app_practice_count > 0).length,
      exam_gap_count: rows.filter((row) => row.status === 'needs_exam_format').length,
      unfixed_count: rows.filter((row) => row.status === 'unfixed').length,
    },
  }
}
