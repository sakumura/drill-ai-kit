import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  api,
  LessonSummary,
  MentorMessage,
  ReviewQueueResponse,
  isDebugMode,
} from '../lib/api'
import { daysUntilExam, getJstTodayKey } from '../lib/dates'
import { MotivatorModal } from '../components/MotivatorModal'

// ---------- helpers (既存ロジック保持) ----------

function formatDate(dateStr: string | null, isToday: boolean): string {
  if (isToday) return '本日'
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-').map(Number)
  return `${month}/${day}`
}

function todayLabel(): string {
  const today = getJstTodayKey()
  const d = new Date(`${today}T00:00:00+09:00`)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`
}

type DesignStatus = 'done' | 'progress' | 'todo'
function mapStatus(s: LessonSummary['status']): DesignStatus {
  if (s === 'completed') return 'done'
  if (s === 'in_progress') return 'progress'
  return 'todo'
}

function shouldShowLesson(lesson: LessonSummary, today: string, debug: boolean): boolean {
  if (lesson.scheduled_date === null) return debug
  return lesson.scheduled_date >= today
}

// ---------- sub-components ----------

function HomeHeader() {
  return (
    <header className="home-header">
      <div className="home-header__brand">
        <div className="home-header__eyebrow">AI家庭教師</div>
        {/* このキャラクター名は好きに変更してよい（既定は汎用の「せんせい」） */}
        <div className="home-header__title">せんせい</div>
      </div>
      <div className="home-header__date">{todayLabel()}</div>
    </header>
  )
}

interface CountdownHeroProps {
  days: number
}

function CountdownHero({ days }: CountdownHeroProps) {
  // streak / perfectCount は現状 MentorMessage に含まれないため hide
  return (
    <section className="home-countdown" aria-label="テストカウントダウン">
      <svg
        className="home-countdown__illust"
        viewBox="0 0 300 150"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* sun */}
        <circle cx="240" cy="50" r="28" fill="#f7b267" />
        <circle
          cx="240"
          cy="50"
          r="28"
          fill="none"
          stroke="#e76f51"
          strokeWidth="1.5"
          strokeDasharray="3 4"
          opacity="0.6"
        />
        {/* rays */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2
          const x1 = 240 + Math.cos(a) * 34
          const y1 = 50 + Math.sin(a) * 34
          const x2 = 240 + Math.cos(a) * 42
          const y2 = 50 + Math.sin(a) * 42
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#e76f51"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )
        })}
        {/* hills */}
        <path
          d="M0,150 Q80,110 150,120 T300,100 L300,150 Z"
          fill="#8ba888"
          opacity="0.5"
        />
        <path
          d="M0,150 Q50,130 120,138 T260,125 L300,128 L300,150 Z"
          fill="#6a8b69"
          opacity="0.5"
        />
        {/* trophy */}
        <g transform="translate(80,78)">
          <rect x="-12" y="14" width="24" height="4" fill="#8b5a2b" />
          <rect x="-8" y="8" width="16" height="7" fill="#c79349" />
          <path d="M-14,-16 L14,-16 L10,8 L-10,8 Z" fill="#e6a44c" />
          <path
            d="M-14,-16 L14,-16 L10,8 L-10,8 Z"
            fill="none"
            stroke="#8b5a2b"
            strokeWidth="1.5"
          />
          <ellipse
            cx="-16"
            cy="-10"
            rx="4"
            ry="6"
            fill="none"
            stroke="#e6a44c"
            strokeWidth="2"
          />
          <ellipse
            cx="16"
            cy="-10"
            rx="4"
            ry="6"
            fill="none"
            stroke="#e6a44c"
            strokeWidth="2"
          />
          <circle cx="0" cy="-8" r="3" fill="#8b5a2b" />
        </g>
        {/* sparkles */}
        <text x="60" y="40" fontSize="14" fill="#e76f51">✦</text>
        <text x="190" y="95" fontSize="10" fill="#c79349">✦</text>
        <text x="120" y="70" fontSize="8" fill="#e76f51">✦</text>
      </svg>

      <div className="home-countdown__text">
        <div className="home-countdown__eyebrow">COUNTDOWN</div>
        <div className="home-countdown__label">入試まで</div>
        <div className="home-countdown__number-row">
          <span className="home-countdown__number">{days}</span>
          <span className="home-countdown__suffix">日</span>
        </div>
      </div>
    </section>
  )
}

function MentorMessages({ mentor }: { mentor: MentorMessage | null }) {
  if (!mentor) return null
  const hasGreeting = !!mentor.greeting
  // DATA_SHAPE.md: praise 優先、なければ encourage
  const praiseText = mentor.praise ?? mentor.encourage
  if (!hasGreeting && !praiseText) return null

  return (
    <div className="home-mentor">
      {hasGreeting && (
        <div className="home-mentor__msg home-mentor__msg--welcome">
          <span className="home-mentor__icon" aria-hidden="true">🌱</span>
          <span>{mentor.greeting}</span>
        </div>
      )}
      {praiseText && (
        <div className="home-mentor__msg home-mentor__msg--praise">
          <span className="home-mentor__icon" aria-hidden="true">✿</span>
          <span>{praiseText}</span>
        </div>
      )}
    </div>
  )
}

interface ReviewQueueCardProps {
  queue: ReviewQueueResponse | null
  onStart: () => void
}

function ReviewQueueCard({ queue, onStart }: ReviewQueueCardProps) {
  const items = queue?.items ?? []
  const count = items.length
  const disabled = count === 0
  return (
    <section className="home-review" aria-label="今日の復習">
      <div className="home-review__body">
        <span className="home-review__eyebrow">REVIEW</span>
        <h2 className="home-review__title">今日の5問復習</h2>
        <p className="home-review__text">
          {disabled
            ? '復習候補はまだありません。まずはレッスンを進めよう。'
            : `${count}問を、フラッシュ問題の直近のまちがいと時間がかかった問題から選びました。`}
        </p>
        {!disabled && (
          <ul className="home-review__reasons" aria-label="復習理由">
            {items.slice(0, 3).map((item) => (
              <li key={item.question_id}>{item.reason_label}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="home-review__btn"
        onClick={onStart}
        disabled={disabled}
        aria-label="今日の5問復習を始める"
      >
        はじめる
      </button>
    </section>
  )
}

interface SubjectTabsProps {
  subject: 'math' | 'japanese'
  onChange: (s: 'math' | 'japanese') => void
}

function SubjectTabs({ subject, onChange }: SubjectTabsProps) {
  return (
    <div className="home-subject-tabs">
      <div className="home-subject-tabs__track">
        <button
          type="button"
          className={`home-subject-tab ${
            subject === 'math' ? 'home-subject-tab--active' : ''
          }`}
          onClick={() => onChange('math')}
        >
          算数
        </button>
        <button
          type="button"
          className={`home-subject-tab ${
            subject === 'japanese' ? 'home-subject-tab--active' : ''
          }`}
          onClick={() => onChange('japanese')}
        >
          国語
        </button>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: DesignStatus }) {
  const label =
    status === 'done' ? '完了' : status === 'progress' ? '進行中' : '未着手'
  return (
    <span className={`home-card__status home-card__status--${status}`}>
      {status === 'done' && (
        <span className="home-card__status-check" aria-hidden="true">✓</span>
      )}
      {label}
    </span>
  )
}

interface ProgressDotsProps {
  progress: number
  total: number
  isToday: boolean
}

function ProgressDots({ progress, total, isToday }: ProgressDotsProps) {
  return (
    <div
      className="home-card__dots"
      aria-label={`${progress} / ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={[
            'home-card__dot',
            i < progress
              ? isToday
                ? 'home-card__dot--today'
                : 'home-card__dot--done'
              : 'home-card__dot--empty',
          ].join(' ')}
        />
      ))}
    </div>
  )
}

interface LessonCardProps {
  lesson: LessonSummary
  isToday: boolean
  onClick: () => void
}

function LessonCard({ lesson, isToday, onClick }: LessonCardProps) {
  const status = mapStatus(lesson.status)
  const progress = lesson.progress_count

  return (
    <li>
      <button
        type="button"
        className={[
          'home-card',
          isToday ? 'home-card--today' : '',
          status === 'done' ? 'home-card--completed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onClick}
        aria-label={`${lesson.title}を開く`}
      >
        {isToday && (
          <span className="home-card__today-label">今日の学習</span>
        )}
        {status === 'done' && (
          <span className="home-card__complete-stamp" aria-hidden="true">
            完了
          </span>
        )}

        <div className="home-card__top">
          <span className="home-card__unit-row">
            <span
              className={`home-card__accent ${
                isToday ? 'home-card__accent--today' : ''
              }`}
              aria-hidden="true"
            />
            <span className="home-card__unit">{lesson.unit_name}</span>
          </span>
          <StatusPill status={status} />
        </div>

        <h2 className="home-card__title">{lesson.title}</h2>

        <div className="home-card__meta">
          <ProgressDots
            progress={progress}
            total={lesson.question_count}
            isToday={isToday}
          />
          <span className="home-card__count">
            {progress}/{lesson.question_count}
          </span>
          <span className="home-card__date">
            {formatDate(lesson.scheduled_date, isToday)}
          </span>
        </div>
      </button>
    </li>
  )
}

// ---------- parent approve panel (debug only) ----------

// ---------- main page ----------

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; lessons: LessonSummary[] }

export function HomePage() {
  const navigate = useNavigate()
  const [subject, setSubject] = useState<'math' | 'japanese'>('math')
  const [state, setState] = useState<HomeState>({ status: 'loading' })
  const [mentor, setMentor] = useState<MentorMessage | null>(null)
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueResponse | null>(null)
  const [showMotivator, setShowMotivator] = useState(false)
  const today = getJstTodayKey()
  const motivatorKey = `meta-motivator-dismissed-${today}`
  const debugSuffix = isDebugMode() ? '?debug' : ''
  const debug = isDebugMode()

  useEffect(() => {
    setState({ status: 'loading' })
    setReviewQueue(null)
    api
      .getAllLessons(subject)
      .then((lessons) => {
        // 過去日付のレッスンは debug でも Home から隠す。
        // scheduled_date が null のデモレッスンだけ debug モードで表示する。
        const visible = lessons.filter((l) => shouldShowLesson(l, today, debug))
        const sorted = [...visible].sort((a, b) => {
          const aDate = a.scheduled_date ?? '9999-12-31'
          const bDate = b.scheduled_date ?? '9999-12-31'
          return aDate.localeCompare(bDate)
        })
        setState({ status: 'success', lessons: sorted })
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : '読み込みに失敗しました'
        setState({ status: 'error', message })
      })

    api
      .getMentorMessage()
      .then((msg) => {
        setMentor(msg)
        if (msg.motivator && !localStorage.getItem(motivatorKey)) {
          setShowMotivator(true)
        }
      })
      .catch(() => {})

    api
      .getReviewQueue(subject)
      .then(setReviewQueue)
      .catch(() => setReviewQueue({ subject, items: [] }))
  }, [subject, debug, motivatorKey, today])

  const handleMotivatorClose = () => {
    localStorage.setItem(motivatorKey, '1')
    setShowMotivator(false)
  }

  if (state.status === 'loading') {
    return (
      <div className="lesson-loading">
        <div className="lesson-loading__spinner" aria-hidden="true" />
        <p className="lesson-loading__text">読み込み中…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="lesson-error">
        <span className="lesson-error__icon" aria-hidden="true">😢</span>
        <p className="lesson-error__title">読み込みに失敗しました</p>
        <p className="lesson-error__message">{state.message}</p>
        <button
          className="lesson-error__btn"
          onClick={() => window.location.reload()}
        >
          もう一度読み込む
        </button>
      </div>
    )
  }

  const { lessons } = state

  return (
    <div className="home-page">
      {showMotivator && mentor?.motivator && (
        <MotivatorModal
          message={mentor.motivator}
          onClose={handleMotivatorClose}
        />
      )}

      <HomeHeader />

      <CountdownHero days={daysUntilExam()} />

      <MentorMessages mentor={mentor} />

      <SubjectTabs subject={subject} onChange={setSubject} />

      <ReviewQueueCard
        queue={reviewQueue}
        onStart={() => navigate(`/lesson/review-${subject}${debugSuffix}`)}
      />

      <section className="home-list" aria-label="レッスン一覧">
        <div className="home-list__head">
          <h2 className="home-list__heading">今週のレッスン</h2>
          <span className="home-list__count">{lessons.length}件</span>
        </div>

        {lessons.length === 0 ? (
          <p className="home-list__empty">レッスンがありません</p>
        ) : (
          <ul className="home-list__items">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                isToday={lesson.scheduled_date === today}
                onClick={() =>
                  navigate(`/lesson/${lesson.id}${window.location.search}`)
                }
              />
            ))}
          </ul>
        )}
      </section>

    </div>
  )
}
