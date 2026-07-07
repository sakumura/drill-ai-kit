import { useEffect, useState } from 'react'

// 12の約数を見つける割り算表
// わりきれる行を緑ハイライト、ペアを線で結ぶ

interface Row {
  divisor: number
  quotient: number | null
  isDivisor: boolean
}

const ROWS: Row[] = [
  { divisor: 1,  quotient: 12, isDivisor: true  },
  { divisor: 2,  quotient: 6,  isDivisor: true  },
  { divisor: 3,  quotient: 4,  isDivisor: true  },
  { divisor: 4,  quotient: 3,  isDivisor: true  },
  { divisor: 5,  quotient: null, isDivisor: false },
  { divisor: 6,  quotient: 2,  isDivisor: true  },
  { divisor: 7,  quotient: null, isDivisor: false },
  { divisor: 8,  quotient: null, isDivisor: false },
  { divisor: 9,  quotient: null, isDivisor: false },
  { divisor: 10, quotient: null, isDivisor: false },
  { divisor: 11, quotient: null, isDivisor: false },
  { divisor: 12, quotient: 1,  isDivisor: true  },
]

// divisor pairs: 1↔12, 2↔6, 3↔4
const PAIRS = [
  { from: 0, to: 11 },
  { from: 1, to: 5  },
  { from: 2, to: 3  },
]

export function DivisorTable() {
  const [key, setKey] = useState(0)
  const [visibleRows, setVisibleRows] = useState(0)
  const [showLines, setShowLines] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setVisibleRows(0)
    setShowLines(false)
    setDone(false)

    let i = 0
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let doneTimer: ReturnType<typeof setTimeout> | null = null
    const timer = setInterval(() => {
      i += 1
      setVisibleRows(i)
      if (i >= ROWS.length) {
        clearInterval(timer)
        showTimer = setTimeout(() => {
          setShowLines(true)
          doneTimer = setTimeout(() => setDone(true), 800)
        }, 200)
      }
    }, 220)
    return () => {
      clearInterval(timer)
      if (showTimer !== null) clearTimeout(showTimer)
      if (doneTimer !== null) clearTimeout(doneTimer)
    }
  }, [key])

  const ROW_HEIGHT = 32
  const PADDING_TOP = 8
  const SVG_WIDTH = 48

  return (
    <div className="concept-illustration" aria-label="12の約数を見つける割り算表">
      <p className="illustration-label">12 ÷ □ で割り切れるかな？</p>
      <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
        {/* 左側: 割り算表 */}
        <div style={{ flex: 1 }}>
          {ROWS.map((row, i) => (
            <div
              key={row.divisor}
              className="divisor-row"
              style={{
                opacity: i < visibleRows ? 1 : 0,
                transform: i < visibleRows ? 'translateX(0)' : 'translateX(-12px)',
                transition: 'opacity 0.25s ease, transform 0.25s ease',
                backgroundColor: row.isDivisor ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.08)',
                border: `1.5px solid ${row.isDivisor ? 'rgba(34,197,94,0.4)' : 'rgba(148,163,184,0.2)'}`,
                borderRadius: '8px',
                marginBottom: '2px',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                height: `${ROW_HEIGHT}px`,
              }}
            >
              <span style={{ color: '#334155', fontSize: '0.85rem', minWidth: '80px' }}>
                12 ÷ <strong style={{ color: row.isDivisor ? '#15803d' : '#94a3b8' }}>{row.divisor}</strong>
              </span>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem', marginRight: '4px' }}>=</span>
              {row.isDivisor ? (
                <strong style={{ color: '#15803d', fontSize: '0.9rem' }}>
                  {row.quotient}
                  <span style={{ fontSize: '0.7rem', marginLeft: '4px', color: '#22c55e' }}>✓</span>
                </strong>
              ) : (
                <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>わりきれない</span>
              )}
            </div>
          ))}
        </div>

        {/* 右側: ペアを結ぶ線 (SVG) */}
        <div style={{ width: `${SVG_WIDTH}px`, position: 'relative' }}>
          <svg
            width={SVG_WIDTH}
            height={ROWS.length * (ROW_HEIGHT + 2)}
            viewBox={`0 0 ${SVG_WIDTH} ${ROWS.length * (ROW_HEIGHT + 2)}`}
            style={{ overflow: 'visible' }}
            aria-hidden="true"
          >
            {PAIRS.map((pair, pi) => {
              const y1 = PADDING_TOP + pair.from * (ROW_HEIGHT + 2) + ROW_HEIGHT / 2
              const y2 = PADDING_TOP + pair.to   * (ROW_HEIGHT + 2) + ROW_HEIGHT / 2
              const colors = ['#6366f1', '#f59e0b', '#ec4899']
              const color = colors[pi]
              return (
                <g key={pi}>
                  <path
                    d={`M 2 ${y1} C 40 ${y1}, 40 ${y2}, 2 ${y2}`}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="500"
                    strokeDashoffset={showLines ? '0' : '500'}
                    style={{
                      transition: `stroke-dashoffset 0.6s ease ${pi * 0.2}s`,
                    }}
                  />
                  <circle cx="2" cy={y1} r="3" fill={color} opacity={showLines ? 1 : 0}
                    style={{ transition: `opacity 0.3s ease ${pi * 0.2}s` }} />
                  <circle cx="2" cy={y2} r="3" fill={color} opacity={showLines ? 1 : 0}
                    style={{ transition: `opacity 0.3s ease ${pi * 0.2 + 0.3}s` }} />
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* 約数まとめ */}
      {visibleRows >= ROWS.length && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            backgroundColor: 'rgba(99,102,241,0.08)',
            borderRadius: '10px',
            animation: 'fadeInUp 0.4s ease',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: '#4338ca', textAlign: 'center', fontWeight: 700 }}>
            12の約数 → 1, 2, 3, 4, 6, 12
          </p>
        </div>
      )}

      {/* 再生ボタン */}
      {done && (
        <button
          onClick={() => setKey(k => k + 1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            margin: '8px auto 0',
            padding: '6px 16px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#6366f1',
            backgroundColor: '#e0e7ff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          🔄 もういっかい見る
        </button>
      )}
    </div>
  )
}
