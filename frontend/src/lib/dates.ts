// カウントダウン用の日付定数
// 画面別の用途を固定する（Home は入試本番、Skill は次の定例テスト）

export const EXAM_DATE = new Date('2028-02-01T00:00:00+09:00')
export const NEXT_REGULAR_TEST_DATE = new Date('2026-05-09T00:00:00+09:00')

function daysUntil(target: Date, now: Date = new Date()): number {
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(0, diff)
}

export function daysUntilExam(now?: Date): number {
  return daysUntil(EXAM_DATE, now)
}

export function daysUntilNextRegularTest(now?: Date): number {
  return daysUntil(NEXT_REGULAR_TEST_DATE, now)
}

/**
 * JST 今日の YYYY-MM-DD を返す。
 * - UTC 時刻に +9h オフセットを足し、ISO 文字列の先頭 10 文字（YYYY-MM-DD）を切り出す方式
 * - 日付集計（answers / motivator / streak）の境界判定で広く使う共通キー生成器
 */
export function getJstTodayKey(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

