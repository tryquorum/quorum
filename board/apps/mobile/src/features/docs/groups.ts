// 아이콘(격자) 보기의 묶음과 줄 나누기. 묶음 순서는 웹 icon-view.tsx groupDocs 와 같아요.
import { kindLabel, statusLabel } from './labels'

export type DocsGroup = 'none' | 'kind' | 'area' | 'status'
export const GROUPS: { id: DocsGroup; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'kind', label: '종류' },
  { id: 'area', label: '영역' },
  { id: 'status', label: '상태' },
]
type Doc = { kind: string; status: string; area: string | null }
export type Group<T> = { key: string; label: string; items: T[] }
const KIND_ORDER = ['todo', 'goal', 'signal', 'run', 'doc']
const STATUS_ORDER = ['open', 'done', 'archived']

export function groupDocs<T extends Doc>(docs: T[], by: DocsGroup): Group<T>[] {
  if (by === 'none') return [{ key: 'all', label: '모든 문서', items: docs }]
  const keyOf = (d: T) => (by === 'kind' ? d.kind : by === 'status' ? d.status : d.area || '')
  const map = new Map<string, T[]>()
  for (const d of docs) map.set(keyOf(d), [...(map.get(keyOf(d)) ?? []), d])
  const order = by === 'kind' ? KIND_ORDER : by === 'status' ? STATUS_ORDER : null
  const keys = [...map.keys()].sort((a, b) => (order ? (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')))
  return keys.map((k) => ({ key: k, label: by === 'kind' ? kindLabel(k) : by === 'status' ? statusLabel(k) : k || '영역 없음', items: map.get(k) ?? [] }))
}

export type GridRow<T> = { type: 'head'; key: string; label: string; count: number } | { type: 'cards'; key: string; items: T[] }
/** 묶음마다 머리 줄(묶음이 있을 때만)과 columns 개씩 카드 줄 */
export function gridRows<T>(groups: Group<T>[], columns: number, heads: boolean): GridRow<T>[] {
  const rows: GridRow<T>[] = []
  for (const g of groups) {
    if (heads) rows.push({ type: 'head', key: `h:${g.key}`, label: g.label, count: g.items.length })
    for (let i = 0; i < g.items.length; i += columns) rows.push({ type: 'cards', key: `c:${g.key}:${i}`, items: g.items.slice(i, i + columns) })
  }
  return rows
}
