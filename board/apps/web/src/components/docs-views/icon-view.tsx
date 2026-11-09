import { memo, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { fileSrc } from '@/lib/api'
import { kindLabel, shortTime, statusLabel } from '@/lib/doc-labels'
import type { DocsGroup } from '@/lib/docs-view-state'
import { DOC_OPTION, docOptions, optionId, useDocsView, type DocLite } from './context'
import { DocTitle, DraftMark, KindGlyph, StatusChip } from './doc-bits'

const KIND_ORDER = ['todo', 'goal', 'signal', 'run', 'doc']
const STATUS_ORDER = ['open', 'done', 'archived']
type Group = { key: string; label: string; items: DocLite[] }
export function groupDocs(docs: DocLite[], by: DocsGroup): Group[] {
  if (by === 'none') return [{ key: 'all', label: '모든 문서', items: docs }]
  const keyOf = (d: DocLite) => by === 'kind' ? d.kind : by === 'status' ? d.status : d.area || ''
  const map = new Map<string, DocLite[]>()
  for (const d of docs) { const k = keyOf(d); map.set(k, [...(map.get(k) ?? []), d]) }
  const order = by === 'kind' ? KIND_ORDER : by === 'status' ? STATUS_ORDER : null
  const keys = [...map.keys()].sort((a, b) => order ? (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko'))
  return keys.map((k) => ({ key: k, label: by === 'kind' ? kindLabel(k) : by === 'status' ? statusLabel(k) : k || '영역 없음', items: map.get(k) ?? [] }))
}

/** 화살표 방향의 이웃 카드. 좌우는 화면 순서, 위아래는 바로 위·아래 줄에서 가로 중심이 가장 가까운 카드 */
function neighbor(options: HTMLElement[], index: number, key: string): number {
  if (key === 'ArrowRight') return Math.min(options.length - 1, index + 1)
  if (key === 'ArrowLeft') return Math.max(0, index - 1)
  if (key === 'Home') return 0
  if (key === 'End') return options.length - 1
  const here = options[index].getBoundingClientRect()
  const center = here.left + here.width / 2
  const down = key === 'ArrowDown'
  const rows = options.map((o, i) => ({ i, r: o.getBoundingClientRect() })).filter(({ r }) => down ? r.top > here.top + 4 : r.top < here.top - 4)
  if (!rows.length) return index
  const rowTop = down ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top))
  const row = rows.filter(({ r }) => Math.abs(r.top - rowTop) < 4)
  return row.reduce((best, cur) => Math.abs(cur.r.left + cur.r.width / 2 - center) < Math.abs(best.r.left + best.r.width / 2 - center) ? cur : best).i
}

const Card = memo(function Card({ doc, selected, focusable, onSelect, onOpen }: { doc: DocLite; selected: boolean; focusable: boolean; onSelect: (doc: DocLite) => void; onOpen: (ref: string) => void }) {
  const excerpt = doc.excerpt ?? doc.snippet ?? ''
  return <div role="option" id={optionId('icon', doc.ref)} aria-selected={selected} tabIndex={focusable ? 0 : -1} {...{ [DOC_OPTION]: doc.ref }}
    onClick={() => onSelect(doc)} onFocus={() => { if (!selected) onSelect(doc) }} onDoubleClick={() => onOpen(doc.ref)}
    className="group flex min-w-0 cursor-default flex-col rounded-lg border bg-card p-2 outline-none [contain-intrinsic-size:auto_260px] [content-visibility:auto] hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring aria-selected:border-foreground aria-selected:bg-muted/40">
    <div className="mb-2 aspect-[4/3] overflow-hidden rounded-md border bg-background">
      {doc.cover ? <img src={fileSrc(doc.cover)} alt="" loading="lazy" decoding="async" className="size-full object-cover object-top" />
        : <div className="flex size-full flex-col gap-1.5 p-2.5"><KindGlyph kind={doc.kind} className="size-5" /><p className="min-h-0 flex-1 overflow-hidden text-2xs leading-snug text-muted-foreground [mask-image:linear-gradient(to_bottom,#000_60%,transparent)]">{excerpt || '본문이 비어 있어요'}</p></div>}
    </div>
    <div className="flex min-w-0 items-start gap-1.5"><KindGlyph kind={doc.kind} className="mt-0.5 size-3.5" /><DocTitle doc={doc} className="line-clamp-2 min-w-0 text-sm leading-snug font-medium break-words" /></div>
    {doc.cover && excerpt && <p className="mt-0.5 line-clamp-1 pl-5 text-xs text-muted-foreground">{excerpt}</p>}
    <div className="mt-auto flex min-w-0 items-center gap-1.5 pt-2 text-2xs text-muted-foreground"><StatusChip status={doc.status} /><DraftMark doc={doc} /><span className="min-w-0 truncate">{doc.area || ''}</span>{doc.updatedAt ? <span className="num ml-auto shrink-0">{shortTime(doc.updatedAt)}</span> : null}</div>
  </div>
})

/** 아이콘 보기: 반응형 카드 격자. 카드 너비는 CSS 변수(--card-w)라 슬라이더를 움직여도 카드는 다시 그리지 않아요 */
export function IconView({ docs, size, group }: { docs: DocLite[]; size: number; group: DocsGroup }) {
  const v = useDocsView()
  const root = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupDocs(docs, group), [docs, group])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const focusRef = v.selected && flat.some((d) => d.ref === v.selected) ? v.selected : flat[0]?.ref
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
    const options = docOptions(root.current)
    const index = options.findIndex((o) => o.getAttribute(DOC_OPTION) === focusRef)
    if (index < 0) return
    e.preventDefault()
    const next = options[neighbor(options, index, e.key)]
    const doc = flat.find((d) => d.ref === next?.getAttribute(DOC_OPTION))
    if (!next || !doc) return
    v.select(doc); next.focus(); next.scrollIntoView({ block: 'nearest' })
  }
  const sel = v.selected
  return <div ref={root} role="listbox" aria-label="문서 아이콘" onKeyDown={onKeyDown} style={{ '--card-w': `${size}px` } as CSSProperties} className="space-y-6">
    {groups.map((g) => <div key={g.key} role="group" aria-label={g.label}>
      {group !== 'none' && <h3 className="mb-2 flex items-baseline gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">{g.label}<span className="num">{g.items.length}</span></h3>}
      {/* 좁은 화면에서도 한 줄에 둘 이상: 카드 최소 너비는 줄의 절반을 넘지 않아요 */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(var(--card-w),calc(50%-6px)),1fr))]">
        {g.items.map((d) => <Card key={d.ref} doc={d} selected={d.ref === sel} focusable={d.ref === focusRef} onSelect={v.select} onOpen={v.open} />)}
      </div>
    </div>)}
  </div>
}
