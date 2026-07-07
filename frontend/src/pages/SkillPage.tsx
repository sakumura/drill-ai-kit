import { useEffect, useMemo, useState } from 'react'
import { api, LearningDashboardResponse } from '../lib/api'

function pct(value: number | null): string {
  if (value === null) return '-'
  return `${Math.round(value)}%`
}

export function SkillPage() {
  const [dashboard, setDashboard] = useState<LearningDashboardResponse | null>(null)
  const [subject, setSubject] = useState<'all' | 'math' | 'japanese'>('all')

  useEffect(() => {
    let cancelled = false
    api.getLearningDashboard().then((response) => {
      if (!cancelled) setDashboard(response)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => {
    const all = dashboard?.rows ?? []
    return subject === 'all' ? all : all.filter((row) => row.subject === subject)
  }, [dashboard, subject])

  return (
    <div className="learning-page">
      <header className="learning-page__header">
        <p className="learning-page__eyebrow">弱点別の定着状況</p>
        <h1 className="learning-page__title">次に潰す弱点</h1>
      </header>

      <div className="learning-tabs" role="tablist" aria-label="科目">
        {(['all', 'math', 'japanese'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`learning-tabs__btn${subject === key ? ' learning-tabs__btn--active' : ''}`}
            onClick={() => setSubject(key)}
          >
            {key === 'all' ? '全体' : key === 'math' ? '算数' : '国語'}
          </button>
        ))}
      </div>

      {!dashboard ? (
        <div className="learning-empty">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="learning-empty">表示できる弱点データがまだありません。</div>
      ) : (
        <div className="learning-table" role="table" aria-label="弱点別の定着状況">
          <div className="learning-table__row learning-table__row--head" role="row">
            <span>弱点</span>
            <span>練習量</span>
            <span>初回</span>
            <span>最終</span>
            <span>転移</span>
            <span>判定</span>
          </div>
          {rows.map((row) => (
            <div key={row.weakness_id} className={`learning-table__row learning-table__row--${row.status}`} role="row">
              <span className="learning-table__weakness">
                {row.weakness_name}
                <small>{row.next_question_type}</small>
              </span>
              <span>{row.app_practice_count}問</span>
              <span>{pct(row.first_attempt_accuracy)}</span>
              <span>{pct(row.final_accuracy)}</span>
              <span>{pct(row.transfer_accuracy)}</span>
              <span>
                <mark className={`learning-status learning-status--${row.status}`}>
                  {row.status_label}
                </mark>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
