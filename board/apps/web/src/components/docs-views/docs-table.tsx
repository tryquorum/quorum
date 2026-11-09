import type { KeyboardEvent } from 'react'
import { kindLabel, shortTime } from '@/lib/doc-labels'
import { DOC_OPTION, useDocsView, type DocLite } from './context'
import { DocTitle, DraftMark, StatusChip } from './doc-bits'

/** 목록 보기: 지금까지의 표(열 선택·속성 필터·정렬). 행을 누르면 고르고, 더블클릭이나 제목을 누르면 열어요 */
export function DocsTable({ docs, columns }: { docs: DocLite[]; columns: string[] }) {
  const v = useDocsView()
  const focusRef = v.selected && docs.some((d) => d.ref === v.selected) ? v.selected : docs[0]?.ref
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input,button')) return
    const index = docs.findIndex((d) => d.ref === focusRef)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? docs.length - 1 : Math.min(docs.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))
    const doc = docs[next]
    if (!doc) return
    e.preventDefault()
    v.select(doc)
    const row = e.currentTarget.querySelector<HTMLElement>(`[${DOC_OPTION}="${CSS.escape(doc.ref)}"]`)
    row?.focus(); row?.scrollIntoView({ block: 'nearest' })
  }
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
    <thead className="border-b text-xs text-muted-foreground"><tr><th className="min-w-[240px] px-3 py-2 font-medium whitespace-nowrap">제목</th><th className="w-24 px-3 py-2 font-medium whitespace-nowrap">종류</th><th className="w-32 px-3 py-2 font-medium whitespace-nowrap">영역</th><th className="w-20 px-3 py-2 font-medium whitespace-nowrap">상태</th><th className="w-36 px-3 py-2 font-medium whitespace-nowrap">수정</th>{columns.map((k) => <th key={k} className="px-3 py-2 font-medium whitespace-nowrap">{k}</th>)}</tr></thead>
    <tbody onKeyDown={onKeyDown}>{docs.map((hit) => {
      const selected = hit.ref === v.selected
      return <tr key={hit.ref} tabIndex={hit.ref === focusRef ? 0 : -1} aria-selected={selected} {...{ [DOC_OPTION]: hit.ref }} aria-label={hit.title}
        className="cursor-default border-b outline-none hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 aria-selected:bg-muted"
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a,input')) v.select(hit) }}
        onFocus={(e) => { if (e.target === e.currentTarget && !selected) v.select(hit) }}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('input')) v.open(hit.ref) }}>
        <td className="px-3 py-2">{v.rename?.ref === hit.ref ? <DocTitle doc={hit} /> : <span className="inline-flex items-center gap-1.5"><button type="button" tabIndex={-1} className="text-left font-medium underline-offset-4 hover:underline" onClick={(e) => { e.stopPropagation(); v.open(hit.ref) }}>{hit.title}</button><DraftMark doc={hit} /></span>}</td>
        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{kindLabel(hit.kind)}</td>
        <td className="max-w-[160px] truncate px-3 py-2 whitespace-nowrap" title={hit.area || undefined}>{hit.area || '—'}</td>
        <td className="px-3 py-2 whitespace-nowrap"><StatusChip status={hit.status} /></td>
        <td className="num px-3 py-2 whitespace-nowrap text-muted-foreground">{hit.updatedAt ? shortTime(hit.updatedAt) : '—'}</td>
        {columns.map((k) => <td key={k} className="max-w-[220px] truncate px-3 py-2 whitespace-nowrap">{Array.isArray(hit.props) ? String(hit.props.find((p) => p.key === k)?.value ?? '—') : '—'}</td>)}
      </tr>
    })}</tbody>
  </table></div>
}
