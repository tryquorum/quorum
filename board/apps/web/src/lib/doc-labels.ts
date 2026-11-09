/** 문서 종류·상태의 화면 이름. 서버 값(todo, open …)은 그대로 쓰고 보여 줄 때만 바꾼다 */
const KIND: Record<string, string> = { todo: '할 일', goal: '목표', signal: '사건', run: '대화', doc: '문서' }
const STATUS: Record<string, string> = { open: '열림', done: '끝남', archived: '보관' }
export const kindLabel = (kind: string) => KIND[kind] ?? kind
export const statusLabel = (status: string) => STATUS[status] ?? status

const two = (n: number) => String(n).padStart(2, '0')
/** 목록용 짧은 시각: 올해면 11/06 22:03, 아니면 2025/11/06 22:03 */
export function shortTime(ms: number, now = new Date()) {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  const day = `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
  return d.getFullYear() === now.getFullYear() ? day : `${d.getFullYear()}/${day}`
}
