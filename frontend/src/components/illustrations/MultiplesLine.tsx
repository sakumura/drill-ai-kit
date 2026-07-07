import { useEffect, useState } from 'react'

// 3の倍数の数直線
// 0〜15の数直線、3の倍数がポップアップアニメーション

const NUMBERS = Array.from({ length: 16 }, (_, i) => i) // 0〜15
const MULTIPLES_OF_3 = new Set([3, 6, 9, 12, 15])

export function MultiplesLine() {
  const [key, setKey] = useState(0)
  const [visibleMultiples, setVisibleMultiples] = useState<Set<number>>(new Set())
  const [allDone, setAllDone] = useState(false)

  useEffect(() => {
    setVisibleMultiples(new Set())
    setAllDone(false)

    const multiples = [3, 6, 9, 12, 15]
    const timers: ReturnType<typeof setTimeout>[] = []
    multiples.forEach((n, i) => {
      timers.push(
        setTimeout(() => {
          setVisibleMultiples((prev) => new Set([...prev, n]))
          if (i === multiples.length - 1) {
            timers.push(setTimeout(() => setAllDone(true), 300))
          }
        }, 400 + i * 500),
      )
    })
    return () => timers.forEach(clearTimeout)
  }, [key])

  return (
    <div className="concept-illustration" aria-label="3の倍数の数直線">
      <p className="illustration-label">3の倍数を数直線で見てみよう！</p>

      {/* 数直線 */}
      <div style={{ position: 'relative', padding: '12px 0 40px' }}>
        {/* 横線 */}
        <div
          style={{
            position: 'absolute',
            left: '4px',
            right: '4px',
            top: '28px',
            height: '3px',
            backgroundColor: '#cbd5e1',
            borderRadius: '2px',
          }}
        />

        {/* 数字と目盛り */}
        <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
          {NUMBERS.map((n) => {
            const isMultiple = MULTIPLES_OF_3.has(n)
            const isVisible = visibleMultiples.has(n)

            return (
              <div
                key={n}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: `${100 / 16}%`,
                }}
              >
                {/* 倍数の円 */}
                {isMultiple ? (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: isVisible ? '#6366f1' : 'transparent',
                      border: `2px solid ${isVisible ? '#6366f1' : 'transparent'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: isVisible ? 'scale(1)' : 'scale(0)',
                      transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), background-color 0.2s',
                      position: 'relative',
                      zIndex: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        color: '#ffffff',
                        lineHeight: 1,
                      }}
                    >
                      {n}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      zIndex: 2,
                    }}
                  >
                    {/* 目盛り */}
                    <div
                      style={{
                        width: '2px',
                        height: n === 0 ? '12px' : '8px',
                        backgroundColor: '#e2e8f0',
                        borderRadius: '1px',
                      }}
                    />
                  </div>
                )}

                {/* 数字ラベル */}
                <span
                  style={{
                    fontSize: '0.6rem',
                    marginTop: '4px',
                    fontWeight: isMultiple ? 700 : 400,
                    color: isMultiple && isVisible ? '#4338ca' : '#94a3b8',
                    transition: 'color 0.3s',
                  }}
                >
                  {n}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 矢印で「×3」ずつ増えることを示す */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
        {[3, 6, 9, 12, 15].map((n, i) => (
          <div
            key={n}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              opacity: visibleMultiples.has(n) ? 1 : 0,
              transform: visibleMultiples.has(n) ? 'translateY(0)' : 'translateY(6px)',
              transition: `opacity 0.3s ease ${i * 0.1}s, transform 0.3s ease ${i * 0.1}s`,
            }}
          >
            <span
              style={{
                backgroundColor: '#e0e7ff',
                color: '#4338ca',
                borderRadius: '20px',
                padding: '2px 8px',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              {n}
            </span>
            {i < 4 && (
              <span style={{ color: '#c7d2fe', fontSize: '0.7rem' }}>→</span>
            )}
          </div>
        ))}
      </div>

      {allDone && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            backgroundColor: 'rgba(99,102,241,0.08)',
            borderRadius: '10px',
            animation: 'fadeInUp 0.4s ease',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: '#4338ca', fontWeight: 700 }}>
            3ずつ増えていくね！ 3 × 1, 2, 3, 4, 5 …
          </p>
        </div>
      )}

      {/* 再生ボタン */}
      {allDone && (
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
