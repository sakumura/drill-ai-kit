import { useEffect, useMemo, useState } from 'react'
import { api, LearningDashboardResponse } from '../lib/api'

function subjectLabel(subject: 'math' | 'japanese'): string {
  return subject === 'math' ? '算数' : '国語'
}

export function HistoryPage() {
  const [dashboard, setDashboard] = useState<LearningDashboardResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getLearningDashboard().then((response) => {
      if (!cancelled) setDashboard(response)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const examGapRows = useMemo(
    () => (dashboard?.rows ?? []).filter((row) => row.status === 'needs_exam_format' || row.latest_test_result),
    [dashboard],
  )

  return (
    <div className="learning-page learning-page--records">
      <header className="learning-page__header">
        <p className="learning-page__eyebrow">本番得点との接続</p>
        <h1 className="learning-page__title">練習とテストの差</h1>
      </header>

      {dashboard && (
        <section className="learning-summary" aria-label="学力向上サマリー">
          <div className="learning-summary__item">
            <strong>{dashboard.summary.total_weaknesses}</strong>
            <span>追跡弱点</span>
          </div>
          <div className="learning-summary__item">
            <strong>{dashboard.summary.practiced_weaknesses}</strong>
            <span>練習済み</span>
          </div>
          <div className="learning-summary__item learning-summary__item--alert">
            <strong>{dashboard.summary.exam_gap_count}</strong>
            <span>本番形式不足</span>
          </div>
        </section>
      )}

      {!dashboard ? (
        <div className="learning-empty">読み込み中…</div>
      ) : examGapRows.length === 0 ? (
        <div className="learning-empty">本番とのズレはまだ検出されていません。</div>
      ) : (
        <div className="learning-records">
          {examGapRows.map((row) => (
            <article key={row.weakness_id} className={`learning-record learning-record--${row.status}`}>
              <div className="learning-record__head">
                <span className="learning-record__subject">{subjectLabel(row.subject)}</span>
                <mark className={`learning-status learning-status--${row.status}`}>
                  {row.status_label}
                </mark>
              </div>
              <h2>{row.weakness_name}</h2>
              <p>{row.latest_test_result ?? '本番形式での確認待ち'}</p>
              <div className="learning-record__metrics">
                <span>練習 {row.app_practice_count}問</span>
                <span>最終 {Math.round(row.final_accuracy)}%</span>
                <span>転移 {row.transfer_accuracy === null ? '-' : `${Math.round(row.transfer_accuracy)}%`}</span>
              </div>
              <div className="learning-record__next">{row.next_question_type}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
