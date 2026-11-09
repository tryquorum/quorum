import type { RelatedResult, SearchResult } from '@/lib/docs-api'
import { kindLabel } from '@/lib/doc-labels'
import type { ColumnAxis } from '@/lib/docs-view-state'
import type { DocLite } from './context'

/**
 * 폴더 없는 문서로 열 보기 계층을 만드는 세 가지 축(리서치 3.1).
 * path 는 열마다 고른 항목의 key. 열 i 의 항목은 path[0..i-1] 로 정해지고, 맞지 않는 key 부터 뒤는 버려요.
 */
export type Entry = { key: string; label: string; doc?: DocLite; count?: number; section?: string; cycle?: boolean; hasChildren: boolean; icon?: 'kind' | 'area' | 'tag' | 'none' }
/** more: 폴더 축에서 다음 쪽이 있으면 그 가지 키(맨 위는 'root') */
export type ListColumn = { type: 'list'; id: string; label: string; entries: Entry[]; state?: 'loading' | 'error'; docRef?: string; truncated?: boolean; more?: string }
export type PreviewColumn = { type: 'preview'; id: string; label: string; doc: DocLite; linksAt?: number }
export type Column = ListColumn | PreviewColumn
export type LinkState = Record<string, RelatedResult | 'loading' | 'error'>
/** 폴더 축: 부모 ref(맨 위는 'root') → 자식 목록 */
export type FolderState = Record<string, SearchResult | 'loading' | 'error'>

const KIND_ORDER = ['todo', 'goal', 'signal', 'run', 'doc']
const byKo = (a: string, b: string) => a.localeCompare(b, 'ko')
const docEntry = (doc: DocLite, extra: Partial<Entry> = {}): Entry => ({ key: `doc:${doc.ref}`, label: doc.title || '제목 없음', doc, hasChildren: false, ...extra })

function kindColumns(docs: DocLite[], path: string[]): Column[] {
  const kinds: string[] = [...new Set(docs.map((d) => d.kind))].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99))
  const cols: Column[] = [{ type: 'list', id: 'kind', label: '종류', entries: kinds.map((k) => ({ key: `kind:${k}`, label: kindLabel(k), count: docs.filter((d) => d.kind === k).length, hasChildren: true, icon: 'kind' })) }]
  const kind = path[0]?.startsWith('kind:') ? path[0].slice(5) : null
  if (!kind || !kinds.includes(kind)) return cols
  const ofKind = docs.filter((d) => d.kind === kind)
  const areas = [...new Set(ofKind.map((d) => d.area || ''))].sort((a, b) => a === '' ? 1 : b === '' ? -1 : byKo(a, b))
  cols.push({ type: 'list', id: `area:${kind}`, label: `${kindLabel(kind)}의 영역`, entries: areas.map((a) => ({ key: `area:${a}`, label: a || '영역 없음', count: ofKind.filter((d) => (d.area || '') === a).length, hasChildren: true, icon: 'area' })) })
  const area = path[1]?.startsWith('area:') ? path[1].slice(5) : null
  if (area === null || !areas.includes(area)) return cols
  cols.push({ type: 'list', id: `docs:${kind}:${area}`, label: `${area || '영역 없음'}의 문서`, entries: ofKind.filter((d) => (d.area || '') === area).map((d) => docEntry(d)) })
  return cols
}

function tagColumns(docs: DocLite[], path: string[]): Column[] {
  const cols: Column[] = []
  let prefix: string | null = ''
  for (let depth = 0; prefix !== null; depth++) {
    const p: string = prefix
    const children = new Map<string, Set<string>>()
    const direct: DocLite[] = []
    for (const d of docs) {
      const tags = (d.tags ?? []).map((t) => t.tag)
      if (prefix === '__none__') { if (!tags.length) direct.push(d); continue }
      for (const tag of tags) {
        if (p && tag === p && !direct.includes(d)) direct.push(d)
        const rest = p ? (tag.startsWith(p + '/') ? tag.slice(p.length + 1) : null) : tag
        if (rest) { const seg = rest.split('/')[0]; children.set(seg, (children.get(seg) ?? new Set()).add(d.ref)) }
      }
    }
    const entries: Entry[] = [...children.keys()].sort(byKo).map((seg) => ({ key: `tag:${p ? p + '/' : ''}${seg}`, label: seg, count: children.get(seg)?.size ?? 0, hasChildren: true, icon: 'tag' }))
    if (depth === 0) { const none = docs.filter((d) => !d.tags?.length).length; if (none) entries.push({ key: 'notag', label: '태그 없음', count: none, hasChildren: true, icon: 'none' }) }
    entries.push(...direct.map((d) => docEntry(d)))
    cols.push({ type: 'list', id: `tag:${p}`, label: depth === 0 ? '태그' : prefix === '__none__' ? '태그 없음' : `#${p}`, entries })
    const chosen = path[depth]
    prefix = chosen === 'notag' && depth === 0 ? '__none__' : chosen?.startsWith('tag:') && entries.some((e) => e.key === chosen) ? chosen.slice(4) : null
  }
  return cols
}

function linkEntries(state: LinkState[string] | undefined, seen: Set<string>): Pick<ListColumn, 'entries' | 'state' | 'truncated'> {
  if (!state || state === 'loading') return { entries: [], state: 'loading' }
  if (state === 'error') return { entries: [], state: 'error' }
  const entries: Entry[] = []
  for (const dir of ['out', 'in'] as const) {
    const done = new Set<string>()
    for (const e of state.edges) {
      if (e.direction !== dir || done.has(e.node.ref)) continue
      done.add(e.node.ref)
      entries.push({ key: `${dir}:${e.node.ref}`, label: e.node.title || '제목 없음', doc: { ref: e.node.ref, kind: e.node.kind, title: e.node.title, status: e.node.status }, section: dir === 'out' ? '나가는 링크' : '역링크', cycle: seen.has(e.node.ref), hasChildren: true })
    }
  }
  return { entries, truncated: state.truncated }
}

function linkColumns(docs: DocLite[], path: string[], links: LinkState): Column[] {
  const cols: Column[] = [{ type: 'list', id: 'link:root', label: '문서', entries: docs.map((d) => docEntry(d, { hasChildren: true })) }]
  const seen = new Set<string>()
  for (let i = 0; i < path.length; i++) {
    const col = cols[i]
    const entry = col?.type === 'list' ? col.entries.find((e) => e.key === path[i]) : undefined
    if (!entry?.doc) break
    seen.add(entry.doc.ref)
    cols.push({ type: 'list', id: `link:${i}:${entry.doc.ref}`, label: `${entry.doc.title}의 링크`, docRef: entry.doc.ref, ...linkEntries(links[entry.doc.ref], new Set(seen)) })
  }
  return cols
}

/** 폴더 축(문서 계층): 첫 열은 맨 위 문서, 자식이 있는 문서를 고르면 오른쪽에 그 자식 열(Finder 열 보기) */
function folderColumns(path: string[], folders: FolderState): Column[] {
  const column = (key: string, id: string, label: string): ListColumn => {
    const s = folders[key]
    if (!s || s === 'loading') return { type: 'list', id, label, entries: [], state: 'loading' }
    if (s === 'error') return { type: 'list', id, label, entries: [], state: 'error' }
    return { type: 'list', id, label, entries: s.results.map((d) => docEntry(d, { hasChildren: (d.children ?? 0) > 0 })), ...(s.nextCursor ? { more: key } : {}) }
  }
  const cols: Column[] = [column('root', 'folder:root', '맨 위')]
  for (let i = 0; i < path.length; i++) {
    const col = cols[i]
    const entry = col?.type === 'list' ? col.entries.find((e) => e.key === path[i]) : undefined
    if (!entry?.doc || !entry.hasChildren) break
    cols.push(column(entry.doc.ref, `folder:${entry.doc.ref}`, entry.doc.title || '제목 없음'))
  }
  return cols
}

/** 고른 경로에 맞는 열들. 경로 끝이 문서면 마지막에 미리보기 열을 붙여요(링크 축은 그 문서의 링크 열 뒤에) */
export function buildColumns(axis: ColumnAxis, docs: DocLite[], path: string[], links: LinkState, folders: FolderState = {}): { columns: Column[]; path: string[]; trail: Entry[] } {
  const columns = axis === 'kind' ? kindColumns(docs, path) : axis === 'tag' ? tagColumns(docs, path) : axis === 'folder' ? folderColumns(path, folders) : linkColumns(docs, path, links)
  const trail: Entry[] = []
  for (let i = 0; i < path.length; i++) {
    const col = columns[i]
    const entry = col?.type === 'list' ? col.entries.find((e) => e.key === path[i]) : undefined
    if (!entry) break
    trail.push(entry)
  }
  const last = trail[trail.length - 1]
  // 폴더 축에서 자식이 있는 문서를 고르면 미리보기 대신 자식 열을 보여요
  if (last?.doc && !(axis === 'folder' && last.hasChildren)) {
    const at = trail.length - 1
    const keep = axis === 'link' ? at + 2 : at + 1
    columns.length = Math.min(columns.length, keep)
    columns.push({ type: 'preview', id: `preview:${last.doc.ref}`, label: `${last.doc.title} 미리보기`, doc: last.doc, linksAt: axis === 'link' ? at + 1 : undefined })
  }
  return { columns, path: trail.map((e) => e.key), trail }
}

/** 지금 고른 문서가 열 보기에서 보이도록 처음 경로를 만들어요 */
export function seedPath(axis: ColumnAxis, docs: DocLite[], selected: string | null): string[] {
  const doc = docs.find((d) => d.ref === selected)
  if (!doc) return []
  if (axis === 'kind') return [`kind:${doc.kind}`, `area:${doc.area || ''}`, `doc:${doc.ref}`]
  if (axis === 'link') return [`doc:${doc.ref}`]
  return []
}
