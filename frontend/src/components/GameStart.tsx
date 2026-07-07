import { useEffect, useState } from 'react'
import { Lesson, MentorMessage, api } from '../lib/api'

interface GameStartProps {
  lesson: Lesson
  onStart: () => void
  resumeFrom?: number
  isReplay?: boolean
  /** ?debug=1 のときだけ true。デバッグ補助 UI の表示制御 */
  debugUI?: boolean
  /** 全問プレビュー開始ハンドラ。debugUI=true のときのみ渡される想定 */
  onPreview?: () => void
}

export function GameStart({ lesson, onStart, resumeFrom, isReplay, debugUI, onPreview }: GameStartProps) {
  const [mentor, setMentor] = useState<MentorMessage | null>(null)

  useEffect(() => {
    api.getMentorMessage().then(setMentor).catch(() => {})
  }, [])

  const msg = mentor?.praise || mentor?.encourage || mentor?.greeting || null

  const isReading = lesson.lesson_type === 'reading'

  return (
    <div className="game-start">
      <div className="game-start__header">
        <div className="game-start__badge">
          {isReading ? '読解チャレンジ' : lesson.unit_id === 'yakubun-checker' ? '約分チェッカー' : lesson.subject === 'japanese' ? 'ことばフラッシュ' : '解法フラッシュ'}
        </div>
        <h1 className="game-start__title">{lesson.title}</h1>
      </div>

      {/* メンターメッセージ */}
      {msg && (
        <div className="home-mentor__msg home-mentor__msg--welcome">
          {msg}
        </div>
      )}

      {/* 遊び方 */}
      <div className="game-start__howto">
        <p className="game-start__howto-title">あそびかた</p>
        {isReading ? (
          <p className="game-start__howto-desc">
            文章を段落ごとに読んで、設問に答えよう！タイマーはないから、じっくり考えてね。
          </p>
        ) : (
          <div className="game-start__howto-steps">
            <div className="game-start__howto-step">
              <span className="game-start__howto-num">1</span>
              <span>
                {lesson.subject === 'japanese'
                  ? 'ことばカードを読もう'
                  : '解き方カードを読もう'}
              </span>
            </div>
            <div className="game-start__howto-arrow">▼</div>
            <div className="game-start__howto-step">
              <span className="game-start__howto-num">2</span>
              <span>問題をよく読む（3びょう）</span>
            </div>
            <div className="game-start__howto-arrow">▼</div>
            <div className="game-start__howto-step">
              <span className="game-start__howto-num">3</span>
              <span>
                {lesson.subject === 'japanese'
                  ? '正しい答えを選ぶ！'
                  : <>正しい<strong>解き方</strong>を選ぶ！</>}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="game-start__info">
        <div className="game-start__info-item">
          <span className="game-start__info-label">問題数</span>
          <span className="game-start__info-value">
            {isReading
              ? `${lesson.reading_questions?.length ?? 0}問`
              : `${lesson.questions.length}問`}
          </span>
        </div>
        {!isReading && (
          <div className="game-start__info-item">
            <span className="game-start__info-label">制限時間</span>
            <span className="game-start__info-value">
              1問{lesson.subject === 'math' ? 60 : 30}秒
            </span>
          </div>
        )}
      </div>

      {isReplay && (
        <p className="game-start__resume-hint">
          クリアずみ！もういちどチャレンジできるよ
        </p>
      )}

      {!isReplay && resumeFrom != null && resumeFrom > 0 && (
        <p className="game-start__resume-hint">
          {resumeFrom}問目からつづき
        </p>
      )}

      <button
        className="game-start__btn"
        onClick={onStart}
        aria-label={isReading ? '読解チャレンジスタート' : 'ゲームスタート'}
      >
        {isReplay ? 'もういちどチャレンジ！' : resumeFrom != null && resumeFrom > 0 ? 'つづきから！' : 'スタート！'}
      </button>

      {/* デバッグ補助 UI: ?debug=1 のときのみ表示 (2026-04-23 追加) */}
      {debugUI && onPreview && (
        <button
          type="button"
          className="game-start__debug-btn"
          onClick={onPreview}
          aria-label="デバッグ: 全問プレビュー（手動スキップで確認）"
        >
          🔍 全問プレビュー
        </button>
      )}
    </div>
  )
}
