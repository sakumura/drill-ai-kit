import { useEffect, useState } from 'react'

// 4と6の最小公倍数の数直線
// 4の倍数(青)と6の倍数(オレンジ)が順にドロップイン
// 重なる位置(12,24)が星型に変化

const MAX = 24
const MULTIPLES_4 = new Set([4, 8, 12, 16, 20, 24])
const MULTIPLES_6 = new Set([6, 12, 18, 24])
const COMMON_LCM  = new Set([12, 24])
const LCM         = 12

type MarkerState = 'hidden' | 'circle4' | 'circle6' | 'star'

export function NumberLineLCM() {
  const [key, setKey] = useState(0)
  const [markers, setMarkers] = useState<Map<number, MarkerState>>(new Map())
  const [spotlightDone, setSpotlightDone] = useState(false)

  useEffect(() => {
    setMarkers(new Map())
    setSpotlightDone(false)

    const multiples4 = [4, 8, 12, 16, 20, 24]
    const multiples6 = [6, 12, 18, 24]
    const timers: ReturnType<typeof setTimeout>[] = []

    // Phase1: 4の倍数をドロップイン
    multiples4.forEach((n, i) => {
      timers.push(
        setTimeout(() => {
          setMarkers((prev) => {
            const next = new Map(prev)
            next.set(n, 'circle4')
            return next
          })
        }, 300 + i * 300),
      )
    })

    // Phase2: 6の倍数をドロップイン
    const phase2Start = 300 + multiples4.length * 300 + 400
    multiples6.forEach((n, i) => {
      timers.push(
        setTimeout(() => {
          setMarkers((prev) => {
            const next = new Map(prev)
            // 既に4の倍数としてマークされている場合は star へ
            if (COMMON_LCM.has(n)) {
              next.set(n, 'star')
            } else {
              next.set(n, 'circle6')
            }
            return next
          })
        }, phase2Start + i * 350),
      )
    })

    // Phase3: spotlight
    timers.push(
      setTimeout(() => setSpotlightDone(true), phase2Start + multiples6.length * 350 + 400),
    )

    return () => timers.forEach(clearTimeout)
  }, [key])

  const numbers = Array.from({ length: MAX + 1 }, (_, i) => i)
  // 表示は0,4,8,...24の目盛りのみラベル表示、全数字は多すぎるので間引く
  const labelEvery = 4

  return (
    <div className="concept-illustration" aria-label="4と6の最小公倍数の数直線">
      <p className="illustration-label">4の倍数と6の倍数、どこで重なる？</p>

      {/* 凡例 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
          <span style={{ fontSize: '0.7rem', color: '#1d4ed8', fontWeight: 600 }}>4の倍数</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#f97316' }} />
          <span style={{ fontSize: '0.7rem', color: '#c2410c', fontWeight: 600 }}>6の倍数</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '0.75rem' }}>⭐</span>
          <span style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: 600 }}>両方！</span>
        </div>
      </div>

      {/* 数直線 */}
      <div style={{ position: 'relative', paddingBottom: '28px' }}>
        {/* 横線 */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '18px',
            height: '3px',
            backgroundColor: '#e2e8f0',
            borderRadius: '2px',
          }}
        />
        {/* 右向き矢印 */}
        <div
          style={{
            position: 'absolute',
            right: '-4px',
            top: '12px',
            width: 0,
            height: 0,
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderLeft: '10px solid #e2e8f0',
          }}
        />

        {/* マーカーと数字 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingRight: '8px' }}>
          {numbers.map((n) => {
            const state = markers.get(n) ?? 'hidden'
            const showLabel = n % labelEvery === 0

            return (
              <div
                key={n}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: `${100 / (MAX + 1)}%`,
                  position: 'relative',
                }}
              >
                {/* マーカー */}
                {state === 'star' ? (
                  <div
                    style={{
                      fontSize: '1.1rem',
                      lineHeight: 1,
                      animation: 'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                      filter: n === LCM && spotlightDone
                        ? 'drop-shadow(0 0 6px rgba(234,179,8,0.9))'
                        : 'drop-shadow(0 0 4px rgba(234,179,8,0.6))',
                    }}
                    aria-label={`${n}: 共通の倍数`}
                  >
                    ⭐
                  </div>
                ) : state === 'circle4' ? (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: '#3b82f6',
                      animation: 'dropIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                    }}
                    aria-label={`${n}: 4の倍数`}
                  />
                ) : state === 'circle6' ? (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: '#f97316',
                      animation: 'dropIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                    }}
                    aria-label={`${n}: 6の倍数`}
                  />
                ) : (
                  /* 目盛り線 */
                  <div
                    style={{
                      width: '2px',
                      height: showLabel ? '12px' : '7px',
                      backgroundColor: '#e2e8f0',
                      marginTop: showLabel ? '6px' : '10px',
                    }}
                  />
                )}

                {/* 数字ラベル */}
                {showLabel && (
                  <span
                    style={{
                      fontSize: '0.55rem',
                      marginTop: '4px',
                      color: COMMON_LCM.has(n) && state === 'star'
                        ? '#15803d'
                        : MULTIPLES_4.has(n) && state !== 'hidden'
                        ? '#1d4ed8'
                        : MULTIPLES_6.has(n) && state !== 'hidden'
                        ? '#c2410c'
                        : '#94a3b8',
                      fontWeight: COMMON_LCM.has(n) ? 700 : 400,
                    }}
                  >
                    {n}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* スポットライト: 最小公倍数12の説明 */}
      {spotlightDone && (
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(234,179,8,0.12)',
            border: '1.5px solid rgba(234,179,8,0.4)',
            borderRadius: '10px',
            animation: 'fadeInUp 0.4s ease',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 700 }}>
            最小公倍数 = <span style={{ fontSize: '1rem', color: '#15803d' }}>{LCM}</span>
            （一番小さい共通の倍数）
          </p>
        </div>
      )}

      {/* 再生ボタン */}
      {spotlightDone && (
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
