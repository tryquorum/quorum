// 문서 종류·상태의 화면 이름과 짧은 시각(웹 apps/web/src/lib/doc-labels.ts 와 같은 말)
import type { SFSymbol } from 'expo-symbols'

const KIND: Record<string, string> = { todo: '할 일', goal: '목표', signal: '사건', run: '대화', doc: '문서' }
const STATUS: Record<string, string> = { open: '열림', done: '끝남', archived: '보관' }
export const kindLabel = (kind: string) => KIND[kind] ?? kind
export const statusLabel = (status: string) => STATUS[status] ?? status
/** 웹 KindGlyph 와 같은 뜻의 SF Symbol */
export const KIND_ICON: Record<string, SFSymbol> = { todo: 'checkmark.square', goal: 'target', signal: 'bolt', run: 'bubble.left', doc: 'doc.text' }
export const kindIcon = (kind: string): SFSymbol => KIND_ICON[kind] ?? 'doc.text'

const two = (n: number) => String(n).padStart(2, '0')
/** 목록용 짧은 시각: 올해면 11/06 22:03, 아니면 2025/11/06 22:03 */
export function shortTime(ms: number, now = new Date()): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  const day = `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
  return d.getFullYear() === now.getFullYear() ? day : `${d.getFullYear()}/${day}`
}
/** AI 초안(에이전트가 쓰고 사람이 안 고친 노트) */
export const isAiDraft = (doc: { tags?: { tag: string }[] }) => !!doc.tags?.some((t) => t.tag === 'ai/초안')
