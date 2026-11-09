import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { PageHeader } from './page-header'
import { Button } from './ui/button'
import { DocCreateBar, useDocCreate } from './doc-create'
import { useShortcut } from './shortcut-dispatch'
import { useDocMove } from './doc-move'
import { docsSchema, propertyFilterIssue, searchDocs, type SchemaResult, type SearchResult } from '../lib/docs-api'
import type { DocStatus } from '../lib/docs-api'
import { kindLabel, statusLabel } from '../lib/doc-labels'
import { readSelection, readViewState, saveViewState, type DocsViewState } from '../lib/docs-view-state'
import { DocsViewContext, focusDoc, type DocLite, type DocsViewApi } from './docs-views/context'
import { PENDING_TITLE, renamePending, useDocRename } from './docs-views/use-doc-rename'
import type { RenameState } from './docs-views/context'
import { ViewToolbar, KeyHint } from './docs-views/view-picker'
import { DocsTable } from './docs-views/docs-table'
import { IconView } from './docs-views/icon-view'
import { ColumnView } from './docs-views/column-view'
import { GalleryView } from './docs-views/gallery-view'
import { QuickLook } from './docs-views/quick-look'
let previousFilters = {q:'',area:'',kind:'',tags:[] as string[],status:'' as DocStatus | '',includeAi:false,propKey:'',propOp:'eq' as 'eq'|'neq'|'exists'|'missing'|'gt'|'gte'|'lt'|'lte'|'contains',propValue:'',sort:'updated',columns:[] as string[]}
/** 한 쪽 50개. 목록 외 보기는 다음 쪽을 이어 읽어 이만큼까지 한 화면에 둬요(더 있으면 더 보기) */
const PAGE = 50
/** 필터를 펼쳤을 때 먼저 보일 태그 수(많이 쓴 순) */
const TAG_PREVIEW = 12
const PROP_OPS = {eq:'같음',neq:'같지 않음',exists:'값 있음',missing:'값 없음',gt:'초과',gte:'이상',lt:'미만',lte:'이하',contains:'포함'} as const
const AUTO_LOAD = 1000
const storage = () => { try { return localStorage } catch { return null } }

export function DocsView({onOpen}: {onOpen: (ref: string) => void}) {
  const [includeAi, setIncludeAi] = useState(previousFilters.includeAi)
  const [q, setQ] = useState(previousFilters.q)
  const [area, setArea] = useState(previousFilters.area)
  const [kind, setKind] = useState(previousFilters.kind)
  const [tags, setTags] = useState<string[]>(() => {const tag = new URLSearchParams(location.hash.split('?')[1] || '').get('tag'); return tag ? [tag] : previousFilters.tags})
  const [status, setStatus] = useState<DocStatus | ''>(previousFilters.status)
  const [schema, setSchema] = useState<SchemaResult | null>(null)
  const [schemaError, setSchemaError] = useState(false)
  const [schemaRetry, setSchemaRetry] = useState(0)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [viewState, setViewState] = useState<DocsViewState>(() => readViewState(location.hash, storage()))
  const [selectedDoc, setSelectedDoc] = useState<DocLite | null>(null)
  const [selectedRef, setSelectedRef] = useState<string | null>(() => readSelection(location.hash))
  const [quick, setQuick] = useState<DocLite | null>(null)
  const [notice, setNotice] = useState('')
  const [columns,setColumns] = useState<string[]>(previousFilters.columns)
  const [propKey,setPropKey] = useState(previousFilters.propKey)
  const [propOp,setPropOp] = useState(previousFilters.propOp)
  const [propValue,setPropValue] = useState(previousFilters.propValue)
  const [sort,setSort] = useState(previousFilters.sort)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const filterIssue = propKey ? (!schema ? '속성 정보를 불러온 뒤 검색할 수 있어요.' : propertyFilterIssue(schema.props?.find(p=>p.key===propKey)?.type,propOp,propValue)) : null
  const pagingRef = useRef(false)
  const generation = useRef(0)
  const loadedCount = useRef(0)
  const [refresh, setRefresh] = useState(0)
  const filters = useRef('')
  const view = viewState.view
  useEffect(() => {previousFilters = {q,area,kind,tags,status,includeAi,propKey,propOp,propValue,sort,columns}}, [q,area,kind,tags,status,includeAi,propKey,propOp,propValue,sort,columns])
  useEffect(() => {saveViewState(viewState, selectedRef)}, [viewState, selectedRef])
  useEffect(() => {const changed = () => {setRefresh((n) => n+1); setSchemaRetry((n) => n+1)}; window.addEventListener('docs:changed',changed); return () => window.removeEventListener('docs:changed',changed)}, [])
  useEffect(() => { let live = true; setSchemaError(false); docsSchema().then((s) => {if (live) setSchema(s)}).catch(() => {if (live) setSchemaError(true)}); return () => {live = false} }, [schemaRetry])
  useEffect(() => {
    const id = ++generation.current
    const filterKey = JSON.stringify([includeAi,q,area,status,kind,tags,retry,propKey,propOp,propValue,sort])
    if (filters.current !== filterKey) {filters.current = filterKey; loadedCount.current = 0; setResult(null)}
    setError(''); setLoading(false)
    if (filterIssue) return
    setLoading(true)
    const t = setTimeout(() => { void (async () => {
      const query = {q, area, status, kinds:kind ? [kind] : [], tags, includeAi, sort, limit:PAGE, props:propKey ? [{key:propKey,op:propOp,value:propValue}] : []}
      let page = await searchDocs(query)
      const results = [...page.results]
      const cursors = new Set<string>()
      while (page.nextCursor && results.length < loadedCount.current) {
        if (cursors.has(page.nextCursor)) throw new Error('문서 검색의 다음 페이지를 확인할 수 없어요.')
        cursors.add(page.nextCursor)
        page = await searchDocs({...query,cursor:page.nextCursor})
        results.push(...page.results.filter((entry) => !results.some((old) => old.ref === entry.ref)))
      }
      if (id === generation.current) {loadedCount.current = results.length; setResult({...page,results})}
    })().catch((e: Error) => {if (id === generation.current) setError(e.message)}).finally(() => {if (id === generation.current) setLoading(false)}) }, 180)
    return () => { clearTimeout(t); generation.current++ }
  }, [includeAi, q, area, status, kind, tags, retry, refresh, propKey, propOp, propValue, sort, filterIssue])
  const more = async () => {
    const cursor = result?.nextCursor
    if (!cursor || loading || pagingRef.current || filterIssue) return
    pagingRef.current = true
    const id = generation.current
    setLoading(true); setError('')
    try { const next = await searchDocs({q, area, status, kinds:kind ? [kind] : [], tags, includeAi, cursor, sort, limit:PAGE, props:propKey ? [{key:propKey,op:propOp,value:propValue}] : []}); if (id === generation.current) setResult((old) => {if (!old) return old; const results = [...old.results, ...next.results.filter((x) => !old.results.some((y) => y.ref === x.ref))]; loadedCount.current = results.length; return {...next, results} }) }
    catch (e) {if (id === generation.current) setError((e as Error).message)}
    finally {pagingRef.current = false; if (id === generation.current) setLoading(false)}
  }
  // 아이콘·열·갤러리는 한 화면에서 훑어보는 보기라 다음 쪽을 이어 읽어요
  useEffect(() => { if (view !== 'list' && result?.nextCursor && !loading && !error && result.results.length < AUTO_LOAD) void more() })
  const docs: DocLite[] = useMemo(() => result?.results ?? [], [result])
  const current = (selectedRef && docs.find((d) => d.ref === selectedRef)) || (selectedDoc?.ref === selectedRef ? selectedDoc : null)
  // 제목 편집이 저장 중이거나 충돌·오류로 입력값을 보존하는 동안에는 다른 문서로 옮기지 않아요(입력칸이 숨거나 결과를 놓치지 않게)
  const pendingRename = useRef<RenameState | null>(null)
  const select = useCallback((doc: DocLite | null) => {
    const r = pendingRename.current
    if (renamePending(r) && doc?.ref !== r?.ref) { setNotice(PENDING_TITLE); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label$="제목 바꾸기"]')?.focus()); return }
    setSelectedDoc(doc); setSelectedRef(doc?.ref ?? null)
  }, [])
  const renamed = (ref: string, next: string) => setResult((old) => old && {...old, results: old.results.map((h) => h.ref === ref ? {...h, title: next} : h)})
  const rename = useDocRename(renamed, setNotice, (ref) => requestAnimationFrame(() => focusDoc(ref)))
  useEffect(() => { pendingRename.current = rename.state }, [rename.state])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t) }, [notice])
  const changeView = useCallback((next: Partial<DocsViewState>) => setViewState((old) => ({...old, ...next})), [])
  // 키 판정은 단축키 레지스트리(lib/shortcuts.ts)가 해요: 입력 중·메뉴·대화상자·한글 조합 중에는 먹지 않고,
  // ⌘·Ctrl+숫자는 브라우저 탭 전환이라 숫자만 써요. 고른 문서가 없으면 처리하지 않아(false) 기본 동작이 남아요
  useShortcut('docs.view.icon', () => changeView({view: 'icon'}))
  useShortcut('docs.view.list', () => changeView({view: 'list'}))
  useShortcut('docs.view.columns', () => changeView({view: 'columns'}))
  useShortcut('docs.view.gallery', () => changeView({view: 'gallery'}))
  useShortcut('docs.quickLook', () => { if (!current) return false; setQuick(current) })
  useShortcut('docs.rename', () => { if (!current) return false; rename.start(current) })
  useShortcut('docs.open', () => { if (!current) return false; onOpen(current.ref) })
  const { open: openCreate } = useDocCreate()
  useShortcut('docs.create', () => openCreate({area: area || null}))
  const { openMove } = useDocMove()
  useShortcut('docs.moveTo', () => { if (!current || current.kind !== 'doc') return false; openMove({ref: current.ref, title: current.title, parent: current.parent ?? null}) })
  const moveQuick = (step: 1 | -1) => { const i = docs.findIndex((d) => d.ref === quick?.ref); const next = i < 0 ? undefined : docs[i + step]; if (next) { setQuick(next); select(next) } }
  const api: DocsViewApi = useMemo(() => ({selected: selectedRef, select, open: onOpen, quickLook: setQuick, rename: rename.state, startRename: rename.start, setRenameValue: rename.setValue, commitRename: rename.commit, cancelRename: rename.cancel, refreshRename: rename.refresh}), [selectedRef, select, onOpen, rename.state, rename.start, rename.setValue, rename.commit, rename.cancel, rename.refresh])
  const allTags = [...(schema?.tags || []), ...tags.filter((tag) => !schema?.tags.some((entry) => entry.tag === tag)).map((tag) => ({tag,count:0}))].filter(({tag}) => !tag.includes(","))
  const shownTags = showAllTags ? allTags : [...allTags].sort((a,b) => b.count - a.count).slice(0, TAG_PREVIEW)
  const toggleTag = (tag: string) => setTags((old) => old.includes(tag) ? old.filter((t) => t !== tag) : [...old,tag])
  const active: {key: string; label: string; clear: () => void}[] = [
    ...(kind ? [{key:'kind', label:kindLabel(kind as never), clear:() => setKind('')}] : []),
    ...(area ? [{key:'area', label:area, clear:() => setArea('')}] : []),
    ...(status ? [{key:'status', label:statusLabel(status), clear:() => setStatus('')}] : []),
    ...(includeAi ? [{key:'ai', label:'AI 초안 포함', clear:() => setIncludeAi(false)}] : []),
    ...(propKey ? [{key:'prop', label:`${propKey} ${PROP_OPS[propOp]}${['exists','missing'].includes(propOp) ? '' : ' ' + propValue}`, clear:() => {setPropKey(''); setPropValue('')}}] : []),
    ...(sort !== 'updated' ? [{key:'sort', label:sort.startsWith('-') ? `${sort.slice(6)} 내림차순` : `${sort.slice(5)} 오름차순`, clear:() => setSort('updated')}] : []),
    ...tags.map((tag) => ({key:'tag:' + tag, label:'#' + tag, clear:() => toggleTag(tag)})),
  ]
  const field = "h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm"
  return <div className="mx-auto w-full max-w-[1200px] px-6 pt-5 pb-24 max-sm:px-4">
    <PageHeader title="문서" echoesHeader className="mb-4 items-start" actions={<DocCreateBar context={{area: area || null}} />} />
    <div className="mb-2 flex flex-wrap items-center gap-2 max-md:flex-nowrap">
      <label className="flex h-9 min-w-40 flex-1 items-center gap-1.5 rounded-md border px-2.5 max-md:h-11 max-md:min-w-0 focus-within:ring-2 focus-within:ring-ring"><Search aria-hidden className="size-4 shrink-0 text-muted-foreground"/><input aria-label="문서 검색" value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
      <Button variant={filtersOpen || active.length ? 'secondary' : 'outline'} size="sm" className="h-9" aria-expanded={filtersOpen} aria-controls="docs-filters" onClick={() => setFiltersOpen((v) => !v)}><SlidersHorizontal aria-hidden />필터{active.length > 0 && <span className="num">{active.length}</span>}</Button>
      <ViewToolbar state={viewState} onChange={changeView} />
      <KeyHint />
    </div>
    {active.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-1" aria-label="걸린 필터">{active.map((a) => <span key={a.key} className="inline-flex h-6 items-center gap-1 rounded-full bg-foreground pr-1 pl-2.5 text-xs text-background">{a.label}<button type="button" aria-label={`${a.label} 필터 빼기`} className="rounded-full p-0.5 opacity-70 hover:opacity-100" onClick={a.clear}><X className="size-3"/></button></span>)}<button type="button" className="ml-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => active.forEach((a) => a.clear())}>모두 풀기</button></div>}
    {filtersOpen && <div id="docs-filters" className="mb-3 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2"><select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value)} className={field}><option value="">모든 종류</option>{schema?.kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select><select aria-label="영역" value={area} onChange={(e) => setArea(e.target.value)} className={field}><option value="">모든 영역</option>{schema?.areas.map((a) => <option key={a}>{a}</option>)}</select><select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value as DocStatus | '')} className={field}><option value="">모든 상태</option>{(schema?.statuses || []).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select><label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)}/>AI 초안</label></div>
      {schema?.props && <div className="flex flex-wrap items-center gap-2" aria-label="속성 검색"><select aria-label="필터 속성" value={propKey} onChange={e=>setPropKey(e.target.value)} className={field}><option value="">속성</option>{schema.props.map(p=><option key={p.key} value={p.key}>{p.key}</option>)}</select>{propKey && <select aria-label="속성 조건" value={propOp} onChange={e=>setPropOp(e.target.value as typeof propOp)} className={field}>{Object.entries(PROP_OPS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}{propKey && !['exists','missing'].includes(propOp) && <input aria-label="속성 필터 값" placeholder="값" value={propValue} onChange={e=>setPropValue(e.target.value)} className={field + " w-32"}/>}<select aria-label="문서 정렬" value={sort} onChange={e=>setSort(e.target.value)} className={field}><option value="updated">최근 수정</option>{schema.props.flatMap(p=>[<option key={p.key} value={`prop:${p.key}`}>{p.key} 오름차순</option>,<option key={'-'+p.key} value={`-prop:${p.key}`}>{p.key} 내림차순</option>])}</select>{view === 'list' && schema.props.length > 0 && <details className="max-w-full text-sm"><summary className="flex h-8 cursor-pointer list-none items-center rounded-md border bg-background px-2.5 [&::-webkit-details-marker]:hidden">표 열 <span className="num ml-1">{columns.length}</span></summary><div className="flex max-w-full flex-wrap gap-x-3 gap-y-1 py-2">{schema.props.map(p=><label key={p.key} className="inline-flex max-w-full items-start gap-1"><input className="mt-1 shrink-0" type="checkbox" checked={columns.includes(p.key)} onChange={()=>setColumns(old=>old.includes(p.key)?old.filter(k=>k!==p.key):[...old,p.key])}/><span className="min-w-0 break-all">{p.key}</span></label>)}</div></details>}</div>}
      {allTags.length > 0 && <div role="group" aria-label="태그 필터" className="flex flex-wrap items-center gap-1">{shownTags.map(({tag,count}) => <button type="button" key={tag} aria-pressed={tags.includes(tag)} onClick={() => toggleTag(tag)} className={`rounded-full px-2 py-0.5 text-xs ${tags.includes(tag) ? "bg-foreground text-background" : "bg-background ring-1 ring-border"}`}>{tag} <span className="num opacity-60">{count}</span></button>)}{allTags.length > TAG_PREVIEW && <button type="button" aria-expanded={showAllTags} className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAllTags((v) => !v)}>{showAllTags ? '접기' : <>태그 <span className="num">{allTags.length - TAG_PREVIEW}</span>개 더</>}</button>}</div>}
    </div>}
    {filterIssue && <p role="status" className="mb-3 text-sm text-muted-foreground">{filterIssue}</p>}
    {schemaError && <p className="mb-3 text-sm" role="alert">필터를 불러오지 못했어요. <button className="underline" onClick={() => setSchemaRetry((n) => n + 1)}>다시 시도</button></p>}
    {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="mb-3 text-sm">검색 실패: {error} <button className="underline" onClick={() => setRetry((n) => n + 1)}>다시 시도</button></p>}
    {loading && !result && <p role="status" className="py-4 text-sm text-muted-foreground">문서를 불러오는 중…</p>}
    {result && <DocsViewContext.Provider value={api}>
      {/* 서버 hint(응답 상한으로 잘림)는 AI 용 영어 안내라 보이지 않고, "중 N개 표시"와 더 보기로 알려요 */}
      <div className="mb-2 text-xs text-muted-foreground" aria-label={`전체 ${result.total}개 중 ${result.results.length}개 표시`}><span className="num">{result.results.length < result.total ? `${result.results.length} / ${result.total}` : result.total}</span>개{loading && ' · 불러오는 중…'}</div>
      {!result.results.length && !loading && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">맞는 문서가 없어요</p>}
      {result.results.length > 0 && <div>
        {view === 'list' ? <DocsTable docs={docs} columns={columns} /> : view === 'icon' ? <IconView docs={docs} size={viewState.size} group={viewState.group} /> : view === 'columns' ? <ColumnView docs={docs} axis={viewState.axis} /> : <GalleryView docs={docs} />}
      </div>}
      {result.nextCursor && (view === 'list' || result.results.length >= AUTO_LOAD) && <Button className="mt-3" variant="outline" disabled={loading} onClick={more}>더 보기</Button>}
      <QuickLook doc={quick} onClose={() => setQuick(null)} onMove={moveQuick} />
    </DocsViewContext.Provider>}
  </div>
}
