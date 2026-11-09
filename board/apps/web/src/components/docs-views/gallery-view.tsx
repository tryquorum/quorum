import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { fileSrc } from '@/lib/api'
import { DOC_OPTION, optionId, useDocsView, type DocLite } from './context'
import { DraftMark, KindGlyph } from './doc-bits'
import { DocFacts, DocPreview, useDocPreview } from './doc-preview'

/** 갤러리 보기: 위에 고른 문서의 큰 미리보기, 아래 가로 썸네일 줄(←→), 넓은 화면에서는 오른쪽에 속성 요약 */
export function GalleryView({ docs }: { docs: DocLite[] }) {
  const v = useDocsView()
  const strip = useRef<HTMLDivElement>(null)
  const current = useMemo(() => docs.find((d) => d.ref === v.selected) ?? docs[0], [docs, v.selected])
  const { data } = useDocPreview(current?.ref ?? null)
  const select = v.select
  useEffect(() => { if (current && current.ref !== v.selected) select(current) }, [current, v.selected, select])
  useEffect(() => { if (current) strip.current?.querySelector<HTMLElement>(`[${DOC_OPTION}="${CSS.escape(current.ref)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [current])
  if (!current) return null
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    const index = docs.findIndex((d) => d.ref === current.ref)
    const next = docs[e.key === 'Home' ? 0 : e.key === 'End' ? docs.length - 1 : Math.min(docs.length - 1, Math.max(0, index + (e.key === 'ArrowRight' ? 1 : -1)))]
    if (!next) return
    v.select(next)
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[${DOC_OPTION}="${CSS.escape(next.ref)}"]`)?.focus({ preventScroll: true }))
  }
  // 화면 순서: 미리보기 → 썸네일 줄 → 정보. 넓은 화면에서는 정보가 미리보기 오른쪽, 썸네일 줄이 아래 전체 폭
  return <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
      <section aria-label="큰 미리보기" className="max-h-[52vh] min-h-[280px] overflow-y-auto rounded-lg border bg-card lg:col-start-1 lg:row-start-1">
        <DocPreview doc={current} variant="gallery" showFacts={false} renameHere />
      </section>
    <div ref={strip} role="listbox" aria-label="문서 썸네일" aria-orientation="horizontal" onKeyDown={onKeyDown} className="flex min-w-0 items-start gap-2 overflow-x-auto pt-1 pb-2 lg:col-span-2 lg:row-start-2">
      {docs.map((d) => {
        const selected = d.ref === current.ref
        const excerpt = d.excerpt ?? d.snippet ?? ''
        return <div key={d.ref} role="option" id={optionId('gal', d.ref)} aria-selected={selected} tabIndex={selected ? 0 : -1} {...{ [DOC_OPTION]: d.ref }} title={d.title}
          onClick={() => v.select(d)} onDoubleClick={() => v.open(d.ref)}
          className="w-28 shrink-0 cursor-default rounded-md p-1 outline-none [contain-intrinsic-size:auto_112px_auto_124px] [content-visibility:auto] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-muted">
          <div className={`mb-1 aspect-[4/3] overflow-hidden rounded border bg-background ${selected ? 'border-foreground' : ''}`}>
            {d.cover ? <img src={fileSrc(d.cover)} alt="" loading="lazy" decoding="async" className="size-full object-cover object-top" /> : <div className="flex size-full flex-col gap-1 p-1.5"><KindGlyph kind={d.kind} className="size-3.5" /><p className="min-h-0 flex-1 overflow-hidden text-2xs leading-tight text-muted-foreground [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">{excerpt}</p></div>}
          </div>
          <p className="flex items-start gap-1 text-2xs leading-tight"><span className="line-clamp-2 min-w-0 break-words">{d.title}</span><DraftMark doc={d} /></p>
        </div>
      })}
    </div>
    <aside aria-label="속성 요약" className="rounded-lg border p-3 lg:col-start-2 lg:row-start-1"><h3 className="mb-2 text-xs font-medium text-muted-foreground">정보</h3><DocFacts doc={current} data={data} /></aside>
  </div>
}
