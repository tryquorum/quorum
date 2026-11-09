import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LazyMd } from '@/components/lazy-md'
import { fetchDocHead, relatedDocs, type DocProp, type FetchResult, type RelatedResult } from '@/lib/docs-api'
import { kindLabel, shortTime, statusLabel } from '@/lib/doc-labels'
import { cn } from '@/lib/utils'
import { useDocsView, type DocLite } from './context'
import { DocTitle, DraftMark, KindGlyph, StatusChip } from './doc-bits'

type PreviewData = { doc: FetchResult; backlinks: RelatedResult | 'error' }
const PREVIEW_CHARS = 4000
/**
 * 선택한 문서만 읽어요. 같은 문서를 여러 패널이 보면 요청 하나를 나눠 써요.
 * 전에 본 문서는 마지막 내용을 바로 보이고 언제나 다시 읽어 바꿔요(다른 기기에서 바뀐 것은 이 창에 알림이 오지 않아요)
 */
const shown = new Map<string, PreviewData>()
const inflight = new Map<string, Promise<PreviewData>>()
/** 문서가 바뀔 때마다 오르는 세대. 바뀌기 전에 시작한 요청은 재검증으로 치지 않고 새로 읽어요 */
let generation = 0
function load(ref: string): Promise<PreviewData> {
  const key = `${generation}:${ref}`
  const started = generation
  const running = inflight.get(key)
  if (running) return running
  const next = Promise.all([fetchDocHead(ref, PREVIEW_CHARS), relatedDocs(ref).catch(() => 'error' as const)])
    .then(([doc, backlinks]) => {
      const data = { doc, backlinks }
      if (started === generation) { shown.delete(ref); shown.set(ref, data) }
      if (shown.size > 120) { const first = shown.keys().next().value; if (first !== undefined) shown.delete(first) }
      return data
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, next)
  return next
}

export function useDocPreview(ref: string | null) {
  const [state, setState] = useState<{ ref: string; data?: PreviewData; error?: boolean } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { const changed = () => { generation++; inflight.clear(); setTick((n) => n + 1) }; window.addEventListener('docs:changed', changed); return () => window.removeEventListener('docs:changed', changed) }, [])
  useEffect(() => {
    if (!ref) return
    let live = true
    const cached = shown.get(ref)
    if (cached) setState({ ref, data: cached })
    // 화살표로 빠르게 지나갈 때는 멈춘 문서만 읽어요
    const timer = setTimeout(() => {
      const started = generation
      load(ref).then((data) => { if (live) setState(started === generation ? { ref, data } : { ref, data: shown.get(ref) ?? data }) }, () => { if (live) setState({ ref, data: shown.get(ref), error: true }) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [ref, tick])
  const retry = () => setTick((n) => n + 1)
  return state && state.ref === ref ? { ...state, retry } : { ref, data: ref ? shown.get(ref) : undefined, error: false, retry }
}

const text = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null || v === '' ? '' : String(v)
/** 속성 요약: 종류·영역·상태·수정·날짜·태그·사용자 속성·링크 수 */
export function DocFacts({ doc, data, className }: { doc: DocLite; data?: PreviewData; className?: string }) {
  const fm = data?.doc.frontmatter ?? {}
  const props: DocProp[] = doc.props ?? (Array.isArray(fm.props) ? fm.props as DocProp[] : [])
  const tags = doc.tags ?? (Array.isArray(fm.tags) ? fm.tags.flatMap((t: unknown) => typeof t === 'string' ? [{ tag: t, by: 'auto' as const }] : t && typeof t === 'object' && 'tag' in t && typeof t.tag === 'string' ? [{ tag: t.tag, by: 'by' in t && t.by === 'person' ? 'person' as const : 'auto' as const }] : []) : [])
  const area = doc.area !== undefined ? doc.area : text(fm.area) || null
  const due = doc.due !== undefined ? doc.due : text(fm.due) || null
  const rows: [string, React.ReactNode][] = [
    ['종류', kindLabel(doc.kind)], ['영역', area || '—'], ['상태', statusLabel(doc.status)],
    ...(doc.updatedAt ? [['수정', <span className="num">{shortTime(doc.updatedAt)}</span>] as [string, React.ReactNode]] : []),
    ...(due ? [['날짜', <span className="num">{due}</span>] as [string, React.ReactNode]] : []),
    ...(data ? [['링크', <span><span className="num">{data.doc.links.out}</span> 나감 · <span className="num">{data.doc.links.in}</span> 들어옴</span>] as [string, React.ReactNode]] : []),
    ...props.slice(0, 8).map((p) => [p.key, text(p.value) || '—'] as [string, React.ReactNode]),
  ]
  return <div className={cn('space-y-3 text-xs', className)}>
    <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="truncate text-muted-foreground" title={k}>{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl>
    {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.slice(0, 10).map(({ tag, by }) => <span key={tag} className={cn('max-w-full break-all rounded-full px-2 py-0.5 text-2xs', by === 'auto' ? 'bg-muted text-muted-foreground' : 'bg-foreground text-background')}>{tag}</span>)}{tags.length > 10 && <span className="num text-muted-foreground">+{tags.length - 10}</span>}</div>}
  </div>
}

/** 열 보기 마지막 열·갤러리 위쪽·빠른 미리보기가 함께 쓰는 미리보기. 본문은 앞 4,000자만 */
export function DocPreview({ doc, variant, showFacts = true, renameHere = false, onShowLinks }: { doc: DocLite; variant: 'column' | 'gallery' | 'quicklook'; showFacts?: boolean; renameHere?: boolean; onShowLinks?: () => void }) {
  const v = useDocsView()
  const { data, error, retry } = useDocPreview(doc.ref)
  const backlinkError = data?.backlinks === 'error'
  const backlinks = data && data.backlinks !== 'error' ? data.backlinks.edges.filter((e) => e.direction === 'in') : []
  return <article aria-label={`${doc.title} 미리보기`} className={cn('flex min-w-0 flex-col gap-4', variant === 'quicklook' ? 'p-1' : 'p-4')}>
    <header className={cn('flex items-start gap-2', variant === 'quicklook' && 'pr-8')}>
      <KindGlyph kind={doc.kind} className={variant === 'column' ? 'mt-1' : 'mt-1.5 size-5'} />
      <div className="min-w-0 flex-1">
        <h2 className={cn('font-semibold leading-snug break-words', variant === 'column' ? 'text-base' : 'text-xl')}>{renameHere ? <DocTitle doc={doc} /> : doc.title || '제목 없음'}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><StatusChip status={doc.status} />{kindLabel(doc.kind)}<DraftMark doc={doc} /></p>
      </div>
      <Button size="sm" onClick={() => v.open(doc.ref)}>열기</Button>
    </header>
    {onShowLinks && <Button variant="outline" size="sm" className="self-start" onClick={onShowLinks}>연결 문서 보기</Button>}
    {showFacts && <DocFacts doc={doc} data={data} className="rounded-md bg-muted/30 p-3" />}
    <section aria-label="본문 앞부분" className="min-w-0">
      {error && !data ? <p role="alert" className="text-sm">미리보기를 불러오지 못했어요. <button type="button" className="underline" onClick={retry}>다시 시도</button></p>
        : !data ? <p role="status" className="text-sm text-muted-foreground">미리보기를 불러오는 중…</p>
        : <>{error && <p role="status" className="mb-2 text-xs text-muted-foreground">최신 내용을 확인하지 못해 전에 본 내용을 보여요. <button type="button" className="underline" onClick={retry}>다시 시도</button></p>}
          {data.doc.markdown.trim() ? <><LazyMd text={data.doc.markdown} className={cn('text-sm leading-relaxed break-words', variant === 'column' && 'text-xs')} />{data.doc.truncated && <p className="mt-2 text-xs text-muted-foreground">앞부분만 보여요. 전체는 열기로 보세요.</p>}</>
          : <p className="text-sm text-muted-foreground">본문이 비어 있어요.</p>}</>}
    </section>
    {data && <section aria-label="역링크" className="text-sm">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">여기를 가리키는 글 {!backlinkError && <span className="num">{backlinks.length}</span>}</h3>
      {backlinkError ? <p role="alert" className="text-xs">역링크를 불러오지 못했어요. <button type="button" className="underline" onClick={retry}>다시 시도</button></p>
        : backlinks.length ? <ul className="space-y-0.5">{backlinks.slice(0, 12).map((e) => <li key={e.node.ref + e.label}><button type="button" className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted" onClick={() => v.open(e.node.ref)}><KindGlyph kind={e.node.kind} className="size-3.5" /><span className="truncate">{e.node.title}</span><span className="ml-auto shrink-0 text-2xs text-muted-foreground">{e.label}</span></button></li>)}</ul>
        : <p className="text-xs text-muted-foreground">없어요</p>}
      {data.backlinks !== 'error' && (backlinks.length > 12 || data.backlinks.truncated) && <p className="mt-1 text-2xs text-muted-foreground">일부만 보여요(최대 12개).</p>}
    </section>}
  </article>
}
