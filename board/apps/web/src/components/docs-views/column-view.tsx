import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CircleDashed, Folder, Hash } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { childDocs, linkedDocs } from '@/lib/docs-api'
import { appendPage, createGenerations } from '@/lib/doc-tree'
import type { ColumnAxis } from '@/lib/docs-view-state'
import { cn } from '@/lib/utils'
import { buildColumns, seedPath, type Entry, type FolderState, type LinkState, type ListColumn } from './column-axes'
import { DOC_OPTION, optionId, useDocsView, type DocLite } from './context'
import { DocTitle, DraftMark, KindGlyph } from './doc-bits'
import { DocPreview } from './doc-preview'

const colDomId = (i: number) => `docs-col-${i}`
/** 좁은 화면에서 이미 고른 문서가 있으면 그 문서의 미리보기에서 시작하고, 뒤로는 한 단계씩 올라가요 */
const seedStack = (axis: ColumnAxis, seed: string[]) => !seed.length ? [] : axis === 'link' ? [2] : seed.map((_, i) => i + 1)

/**
 * 열 보기(Miller columns). 열마다 독립 role=listbox(리서치 2.2 패턴 A): ↑↓ 열 안 이동, → 다음 열, ← 이전 열.
 * 마지막 열은 고른 문서의 미리보기. 좁은 화면(768px 미만)에서는 한 열씩 드릴다운해요.
 */
export function ColumnView({ docs, axis }: { docs: DocLite[]; axis: ColumnAxis }) {
  const v = useDocsView()
  const mobile = useIsMobile()
  const [path, setPath] = useState<string[]>(() => seedPath(axis, docs, v.selected))
  const [active, setActive] = useState(() => Math.max(0, seedPath(axis, docs, v.selected).length - 1))
  const [links, setLinks] = useState<LinkState>({})
  const [folders, setFolders] = useState<FolderState>({})
  const [moreBusy, setMoreBusy] = useState<string | null>(null)
  const gens = useRef(createGenerations())
  const [stack, setStack] = useState<number[]>(() => seedStack(axis, path))
  const scroller = useRef<HTMLDivElement>(null)
  const lastAxis = useRef(axis)
  // 고른 문서가 뒤쪽 쪽에 있으면 처음 그릴 때는 아직 없어요. 나타나면 한 번만 그 문서까지 펼쳐요
  const seeded = useRef(path.length > 0)
  useEffect(() => {
    const axisChanged = lastAxis.current !== axis
    if (!axisChanged && seeded.current) return
    lastAxis.current = axis
    const seed = seedPath(axis, docs, v.selected)
    seeded.current = seed.length > 0
    if (!axisChanged && !seed.length) return
    setPath(seed); setActive(Math.max(0, seed.length - 1)); setStack(seedStack(axis, seed))
  }, [axis, docs, v.selected])
  const built = useMemo(() => buildColumns(axis, docs, path, links, folders), [axis, docs, path, links, folders])
  const { columns, trail } = built
  // 링크 축: 경로의 문서마다 나가는 링크·역링크를 한 번씩 읽어요
  useEffect(() => {
    if (axis !== 'link') return
    for (const e of trail) {
      const ref = e.doc?.ref
      if (!ref || links[ref]) continue
      setLinks((old) => ({ ...old, [ref]: 'loading' }))
      linkedDocs(ref).then((r) => setLinks((old) => ({ ...old, [ref]: r })), () => setLinks((old) => ({ ...old, [ref]: 'error' })))
    }
  }, [axis, trail, links])
  // 폴더 축: 맨 위와 경로에서 고른(자식 있는) 문서의 자식을 한 번씩 읽고, 문서가 바뀌면 다시 읽어요.
  // 가지마다 요청 세대를 두어, 바뀌기 전에 보낸 늦은 응답이 새 열을 덮지 않게 해요
  useEffect(() => {
    if (axis !== 'folder') return
    const need = ['root', ...trail.flatMap((e) => (e.doc && e.hasChildren ? [e.doc.ref] : []))]
    for (const key of need) {
      if (folders[key]) continue
      const g = gens.current.fresh(key)
      setFolders((old) => ({ ...old, [key]: 'loading' }))
      childDocs(key === 'root' ? null : key).then(
        (r) => { if (gens.current.isCurrent(key, g)) setFolders((old) => ({ ...old, [key]: r })) },
        () => { if (gens.current.isCurrent(key, g)) setFolders((old) => ({ ...old, [key]: 'error' })) })
    }
  }, [axis, trail, folders])
  useEffect(() => { const clear = () => { gens.current.reset(); setMoreBusy(null); setFolders({}) }; window.addEventListener('docs:changed', clear); return () => window.removeEventListener('docs:changed', clear) }, [])
  /** 폴더 열 다음 쪽(50개씩). 같은 세대이고 커서가 그대로일 때만 붙여요 */
  const loadMore = (key: string) => {
    const s = folders[key]
    if (typeof s !== 'object' || !s.nextCursor || moreBusy) return
    const cursor = s.nextCursor, g = gens.current.current(key)
    setMoreBusy(key)
    childDocs(key === 'root' ? null : key, cursor).then((r) => {
      if (!gens.current.isCurrent(key, g)) return
      setFolders((old) => { const o = old[key]; return typeof o === 'object' && o.nextCursor === cursor ? { ...old, [key]: { ...o, results: appendPage(o.results, r.results), nextCursor: r.nextCursor } } : old })
    }, () => { if (gens.current.isCurrent(key, g)) toast('더 불러오지 못했어요') }).finally(() => setMoreBusy((k) => (k === key ? null : k)))
  }
  useEffect(() => { const el = scroller.current; if (el && !mobile) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }) }, [columns.length, mobile])
  const focusColumn = (i: number) => requestAnimationFrame(() => document.getElementById(colDomId(i))?.focus({ preventScroll: mobile }))
  const current = Math.min(stack[stack.length - 1] ?? 0, columns.length - 1)
  const choose = (i: number, entry: Entry, navigate: boolean) => {
    seeded.current = true
    setPath([...built.path.slice(0, i), entry.key]); setActive(i)
    v.select(entry.doc ?? null)
    if (!navigate) return
    const target = entry.doc ? (axis === 'link' ? i + 2 : i + 1) : i + 1
    setStack((s) => [...s.filter((x) => x <= i), target])
  }
  /** 좁은 화면의 뒤로: 보이는 열·키보드 열·선택을 함께 한 단계 위로 맞춰요 */
  const back = () => {
    const target = Math.min(stack[stack.length - 2] ?? 0, columns.length - 1)
    setStack((s) => s.slice(0, -1))
    if (columns[target]?.type !== 'list') return
    setPath(built.path.slice(0, target + 1)); setActive(target)
    v.select(trail[target]?.doc ?? null)
    focusColumn(target)
  }
  const onKeyDown = (i: number, col: ListColumn) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input'))) return
    const index = col.entries.findIndex((x) => x.key === built.path[i])
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? col.entries.length - 1 : index < 0 ? 0 : Math.min(col.entries.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))
      const entry = col.entries[next]
      if (entry) { choose(i, entry, false); requestAnimationFrame(() => document.getElementById(optionId(`c${i}`, entry.key))?.scrollIntoView({ block: 'nearest' })) }
    } else if (e.key === 'ArrowRight') {
      const entry = col.entries[index]
      const next = columns[i + 1]
      if (!entry?.hasChildren || next?.type !== 'list') return
      e.preventDefault()
      if (!built.path[i + 1] && next.entries[0]) choose(i + 1, next.entries[0], false)
      setActive(i + 1); if (mobile) setStack((s) => [...s, i + 1]); focusColumn(i + 1)
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      setPath(built.path.slice(0, i)); setActive(i - 1)
      v.select(trail[i - 1]?.doc ?? null)
      if (mobile) back()
      focusColumn(i - 1)
    }
  }
  const renderList = (col: ListColumn, i: number) => {
    const selectedKey = built.path[i]
    const sections = col.entries.reduce<{ name?: string; items: Entry[] }[]>((acc, e) => { const last = acc[acc.length - 1]; if (last && last.name === e.section) last.items.push(e); else acc.push({ name: e.section, items: [e] }); return acc }, [])
    const option = (e: Entry) => {
      const selected = e.key === selectedKey
      const editing = !!e.doc && selected && i === active && v.rename?.ref === e.doc.ref
      const dark = selected && i === active && !editing
      return <div key={e.key} id={optionId(`c${i}`, e.key)} role="option" aria-selected={selected} {...(e.doc ? { [DOC_OPTION]: e.doc.ref } : {})}
        onClick={() => { choose(i, e, mobile); focusColumn(i) }} onDoubleClick={() => { if (e.doc) v.open(e.doc.ref) }}
        className={cn('flex min-w-0 cursor-default gap-1.5 rounded px-2 py-1 text-xs [contain-intrinsic-size:auto_28px] [content-visibility:auto]', editing ? 'items-start bg-muted' : 'items-center', !editing && (selected ? (i === active ? 'bg-foreground text-background' : 'bg-muted') : 'hover:bg-muted/50'))}>
        {(() => { const tone = cn('size-3.5 shrink-0 text-muted-foreground', dark && 'text-background/80', editing && 'mt-1'); const kind = e.doc?.kind ?? (e.icon === 'kind' ? e.key.slice(5) : null); return kind ? <KindGlyph kind={kind} className={tone} /> : e.icon === 'tag' ? <Hash aria-hidden className={tone} /> : e.icon === 'none' ? <CircleDashed aria-hidden className={tone} /> : <Folder aria-hidden className={tone} /> })()}
        <span className={cn('min-w-0 flex-1', !editing && 'truncate')}>{editing && e.doc ? <DocTitle doc={e.doc} /> : e.label}</span>
        {e.doc && <DraftMark doc={e.doc} />}
        {e.cycle && <span title="이미 경로에 있는 문서예요" className="shrink-0 rounded border px-1 text-2xs leading-4">↻ 경로 안</span>}
        {e.count !== undefined && <span className={cn('num shrink-0 text-2xs', dark ? 'text-background/70' : 'text-muted-foreground')}>{e.count}</span>}
        {e.hasChildren && !editing && <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" />}
      </div>
    }
    return <div id={colDomId(i)} role="listbox" aria-label={col.label} tabIndex={i === active || (active >= columns.length && i === 0) ? 0 : -1}
      aria-activedescendant={selectedKey && col.entries.some((e) => e.key === selectedKey) ? optionId(`c${i}`, selectedKey) : undefined}
      aria-busy={col.state === 'loading'} onKeyDown={onKeyDown(i, col)} onFocus={(e) => { if (e.target === e.currentTarget) setActive(i) }}
      className={cn('min-h-0 overflow-y-auto p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', mobile ? 'max-h-[60vh] w-full' : 'h-full w-[220px] shrink-0 border-r')}>
      {col.state === 'loading' ? <p role="status" className="p-2 text-xs text-muted-foreground">링크를 불러오는 중…</p>
        : col.state === 'error' ? <p role="alert" className="p-2 text-xs">링크를 불러오지 못했어요.</p>
        : !col.entries.length ? <p className="p-2 text-xs text-muted-foreground">{col.docRef ? '연결된 문서가 없어요' : '비어 있어요'}</p>
        : sections.map((s, n) => s.name ? <div key={s.name + n} role="group" aria-label={s.name}><div className="px-2 pt-2 pb-1 text-2xs font-medium text-muted-foreground" aria-hidden>{s.name}</div>{s.items.map(option)}</div> : s.items.map(option))}
      {col.truncated && <p className="px-2 pt-2 text-2xs text-muted-foreground">연결이 많아 앞의 50개만 보여요.</p>}
      {col.more && <button type="button" disabled={moreBusy === col.more} onClick={() => col.more && loadMore(col.more)} className="mx-2 mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60">{moreBusy === col.more ? '불러오는 중…' : '더 보기'}</button>}
    </div>
  }
  const renderColumn = (i: number) => {
    const col = columns[i]
    if (!col) return null
    if (col.type === 'list') return <div key={col.id} className={cn(mobile ? 'w-full' : 'contents')}>{renderList(col, i)}</div>
    return <div key={col.id} className={cn('min-w-0 overflow-y-auto', mobile ? 'w-full' : 'h-full min-w-[320px] flex-1')}>
      <DocPreview doc={col.doc} variant="column" renameHere={mobile} onShowLinks={mobile && col.linksAt !== undefined ? () => { const at = col.linksAt ?? i; setStack((s) => [...s, at]); setActive(at); focusColumn(at) } : undefined} />
    </div>
  }
  const crumbs = <nav aria-label="경로" className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
    <span>{axis === 'kind' ? '종류' : axis === 'tag' ? '태그' : '문서'}</span>
    {trail.map((e, n) => <span key={e.key + n} className="flex min-w-0 items-center gap-1"><ChevronRight aria-hidden className="size-3" /><span className={cn('max-w-[14rem] truncate', n === trail.length - 1 && 'text-foreground')}>{e.label}</span>{e.cycle && <span title="이미 경로에 있는 문서예요">↻</span>}</span>)}
  </nav>
  if (mobile) {
    const col = columns[current]
    return <div>
      {crumbs}
      <div className="mb-2 flex items-center gap-2">
        {stack.length > 0 && <button type="button" onClick={back} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-sm whitespace-nowrap"><ChevronLeft aria-hidden className="size-4" />뒤로</button>}
        <span className="min-w-0 truncate text-sm font-medium">{col?.label}</span>
      </div>
      <div className="rounded-lg border">{renderColumn(current)}</div>
    </div>
  }
  return <div>
    {crumbs}
    <div ref={scroller} className="flex h-[min(68vh,640px)] overflow-x-auto overflow-y-hidden rounded-lg border">{columns.map((_, i) => renderColumn(i))}{columns[columns.length - 1]?.type === 'list' && <p className="grid min-w-[240px] flex-1 place-items-center p-6 text-center text-xs text-muted-foreground">왼쪽에서 고르면 여기에 보여요</p>}</div>
  </div>
}
