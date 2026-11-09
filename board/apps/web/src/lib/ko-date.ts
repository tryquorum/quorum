// 날짜 값 문자열을 한국어로 읽어요. 입력 칸이 이미 로컬 벽시계 값이라 시간대 변환 없이 문자열에서 바로 읽어요.
const WEEK = "일월화수목금토"

/** "2026-11-08" → "11월 8일 (일)", "2026-11-08T15:05" → "11월 8일 (일) 오후 3:05", 빈 값 → "", 읽을 수 없으면 원문 */
export function koDateLabel(v: string | null | undefined): string {
  if (!v) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(v)
  if (!m) return v
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return v
  const day = `${mo}월 ${d}일 (${WEEK[date.getDay()]})`
  if (m[4] === undefined) return day
  const h = Number(m[4])
  if (h > 23 || Number(m[5]) > 59) return v
  return `${day} ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${m[5]}`
}
