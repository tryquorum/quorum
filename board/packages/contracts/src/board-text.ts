// 판 화면의 짧은 글: 남은 날(D-day)·지난 시간·출처 이름. 웹(lib/api.ts)과 iOS 가 같은 글을 보여요.
const p2 = (n: number) => String(n).padStart(2, "0")
/** 로컬 시각 → 'YYYY-MM-DDTHH:MM' */
export const isoLocal = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
}
export function dday(due?: string | null) {
  if (!due) return { t: "", late: false }
  const d = new Date(due + "T00:00:00")
  const t0 = new Date()
  t0.setHours(0, 0, 0, 0)
  const n = Math.round((d.getTime() - t0.getTime()) / 864e5)
  if (n === 0) return { t: "D-day", late: false }
  return n > 0 ? { t: `D-${n}`, late: false } : { t: `${-n}일 지남`, late: true }
}
export function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1e3)
  if (s < 60) return "방금"
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}
export const SOURCE: Record<string, string> = {
  github: "GitHub",
  lms: "LMS",
  gmail: "Gmail",
  x: "X",
  slack: "Slack",
  kakao: "카톡",
  calendar: "캘린더",
  reminders: "미리알림",
  agent: "에이전트",
  note: "노트",
}
export const srcName = (s: string) => SOURCE[s] || s

/** 판 영역 기본 색(서버 cleanAreas 가 색이 없으면 차례로 줘요). 서버·iOS 가 같은 목록을 써요 */
export const AREA_COLORS = ["#5b7bd5", "#2f9e8f", "#c98a1b", "#8e6bd8", "#4c9a52", "#d0629b", "#8b8b94"]
/** 보드 메모 색(옛 보드 index.html 의 .c-* 와 같은 값). 메모 위 글자는 어느 모양에서나 짙은 색 */
export const STICKY_COLORS = { yellow: "#fff6c9", pink: "#fde4ec", blue: "#e2efff", green: "#e3f5e6", white: "#ffffff" } as const
export type StickyColor = keyof typeof STICKY_COLORS
export const STICKY_INK = "#27272a"
