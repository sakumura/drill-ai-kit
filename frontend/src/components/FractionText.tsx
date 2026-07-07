import { ReactNode } from 'react'

// テキスト中の "1/5" のような分数パターンを縦表示に変換
const FRACTION_RE = /(\d+)\/(\d+)/g

function Fraction({ num, den }: { num: string; den: string }) {
  return (
    <span className="frac">
      <span className="frac__num">{num}</span>
      <span className="frac__den">{den}</span>
    </span>
  )
}

export function FractionText({ text }: { text: string }) {
  if (!text) return null
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // 改行も処理
  const lines = text.split(/\\n|\n/)

  return (
    <>
      {lines.map((line, li) => {
        const nodes: ReactNode[] = []
        lastIndex = 0
        FRACTION_RE.lastIndex = 0

        while ((match = FRACTION_RE.exec(line)) !== null) {
          if (match.index > lastIndex) {
            nodes.push(line.slice(lastIndex, match.index))
          }
          nodes.push(
            <Fraction key={`${li}-${match.index}`} num={match[1]} den={match[2]} />
          )
          lastIndex = match.index + match[0].length
        }
        if (lastIndex < line.length) {
          nodes.push(line.slice(lastIndex))
        }

        return (
          <span key={li}>
            {nodes}
            {li < lines.length - 1 && <br />}
          </span>
        )
      })}
    </>
  )
}
