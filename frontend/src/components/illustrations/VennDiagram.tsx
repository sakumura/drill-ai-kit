import { useEffect, useState } from 'react'

// 12と8の公約数ベン図
// 2つの円が左右からスライドインして重なる

const DIVISORS_12 = [1, 2, 3, 4, 6, 12]
const DIVISORS_8  = [1, 2, 4, 8]
const COMMON      = new Set([1, 2, 4])
const GCD         = 4

export function VennDiagram() {
  const [key, setKey] = useState(0)
  const [phase, setPhase] = useState<'init' | 'slide' | 'overlap' | 'highlight'>('init')

  useEffect(() => {
    setPhase('init')
    const t1 = setTimeout(() => setPhase('slide'),     200)
    const t2 = setTimeout(() => setPhase('overlap'),   900)
    const t3 = setTimeout(() => setPhase('highlight'), 1400)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [key])

  // 円の位置: slide前は離れた位置、slide後は重なり位置
  const leftX  = phase === 'init' ? '-100%' : '0%'
  const rightX = phase === 'init' ? '100%'  : '0%'

  const leftOnly  = DIVISORS_12.filter((n) => !COMMON.has(n))
  const rightOnly = DIVISORS_8.filter((n) => !COMMON.has(n))
  const commonArr = [1, 2, 4]

  return (
    <div className="concept-illustration" aria-label="12と8の公約数ベン図">
      <p className="illustration-label">12と8に共通する約数は？</p>

      <div style={{ position: 'relative', height: '160px', overflow: 'hidden' }}>
        {/* 左円: 12の約数 */}
        <div
          style={{
            position: 'absolute',
            left: '5%',
            top: '10px',
            width: '52%',
            height: '130px',
            borderRadius: '50%',
            backgroundColor: 'rgba(99,102,241,0.12)',
            border: '2.5px solid rgba(99,102,241,0.5)',
            transform: `translateX(${leftX})`,
            transition: 'transform 0.6s cubic-bezier(0.34,1.1,0.64,1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingLeft: '14px',
            flexDirection: 'column',
            paddingTop: '18px',
            gap: '4px',
          }}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#4338ca', marginBottom: '2px' }}>12の約数</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'flex-start', maxWidth: '60px' }}>
            {leftOnly.map((n) => (
              <span
                key={n}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#6366f1',
                  backgroundColor: 'rgba(99,102,241,0.15)',
                  borderRadius: '4px',
                  padding: '1px 5px',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {/* 右円: 8の約数 */}
        <div
          style={{
            position: 'absolute',
            right: '5%',
            top: '10px',
            width: '52%',
            height: '130px',
            borderRadius: '50%',
            backgroundColor: 'rgba(249,115,22,0.10)',
            border: '2.5px solid rgba(249,115,22,0.45)',
            transform: `translateX(${rightX})`,
            transition: 'transform 0.6s cubic-bezier(0.34,1.1,0.64,1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: '14px',
            flexDirection: 'column',
            paddingTop: '18px',
            gap: '4px',
          }}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#c2410c', marginBottom: '2px' }}>8の約数</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'flex-end', maxWidth: '60px' }}>
            {rightOnly.map((n) => (
              <span
                key={n}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#f97316',
                  backgroundColor: 'rgba(249,115,22,0.12)',
                  borderRadius: '4px',
                  padding: '1px 5px',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {/* 重なり部分: 公約数 */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            zIndex: 10,
            opacity: phase === 'overlap' || phase === 'highlight' ? 1 : 0,
            transition: 'opacity 0.4s ease',
          }}
        >
          <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#475569' }}>公約数</span>
          {commonArr.map((n) => (
            <span
              key={n}
              style={{
                fontSize: n === GCD ? '1rem' : '0.75rem',
                fontWeight: 700,
                color: n === GCD ? '#ffffff' : '#374151',
                backgroundColor: n === GCD
                  ? (phase === 'highlight' ? '#22c55e' : '#64748b')
                  : 'rgba(255,255,255,0.85)',
                borderRadius: '50%',
                width: n === GCD ? '32px' : '24px',
                height: n === GCD ? '32px' : '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: n === GCD ? '2px solid rgba(34,197,94,0.6)' : '1px solid #e2e8f0',
                animation: n === GCD && phase === 'highlight' ? 'pulseScale 1s ease infinite' : 'none',
                transition: 'background-color 0.4s ease',
              }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      {phase === 'highlight' && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            backgroundColor: 'rgba(34,197,94,0.1)',
            borderRadius: '10px',
            animation: 'fadeInUp 0.4s ease',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 700 }}>
            最大公約数 = <span style={{ fontSize: '1rem' }}>{GCD}</span>（一番大きい公約数）
          </p>
        </div>
      )}

      {/* 再生ボタン */}
      {phase === 'highlight' && (
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
