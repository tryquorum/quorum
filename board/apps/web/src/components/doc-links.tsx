import { useEffect, useState } from 'react'
import { changeTags, findDocTags, loadDocTags, loadInLinks, mergeTagProvenance, type RelatedResult } from '../lib/docs-api'
import { Button } from './ui/button'
import { RecentCache } from '../lib/work-cache'

/** "여기를 가리키는 글"은 읽기만 하는 목록이라, 다시 열 때 마지막 결과를 바로 보여 주고 뒤에서 새로 받아요(태그는 빼기 조건이 있어 캐시하지 않아요) */
const relatedCache = new RecentCache<RelatedResult>(40)

export function DocLinks({docRef, onOpen, onTag}: {docRef: string; onOpen: (ref: string) => void; onTag?: (tag:string)=>void}) {
  const [related, setRelated] = useState<RelatedResult | null>(() => relatedCache.get(docRef) ?? null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tags, setTags] = useState<{tag:string; by:string}[] | null>(null)
  const [tagLoadError, setTagLoadError] = useState(false)
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [tagError, setTagError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  // 노트가 없어 아직 문서가 아닌 일은 연결·태그 없음으로 보여요(경고 아님). docs-api 의 loadInLinks·loadDocTags
  useEffect(() => {let live = true; setRelated(relatedCache.get(docRef) ?? null); setError(''); loadInLinks(docRef).then((r) => {relatedCache.set(docRef, r); if(live) setRelated(r)}).catch(() => {if(live) setError('연결을 불러오지 못했어요')}); return () => {live = false} }, [docRef, attempt])
  useEffect(() => { let live = true; setTags(null); setTagLoadError(false); void loadDocTags(docRef).then((r) => { if (live) {setTags(r.tags); setTagLoadError(r.uncertain)} }); return () => {live = false} }, [docRef])
  const change = async (change: {add?: string[]; remove?: string[]}) => {
    if (busy || uncertain) return
    setBusy(true); setTagError('')
    try {const r = await changeTags(docRef, change); const provenance = await findDocTags(docRef).catch(() => null); setTags(mergeTagProvenance(r.tags, provenance)); setTagLoadError(!provenance); setTag('')}
    catch {setUncertain(true); setTagError('태그 변경 결과를 확인하지 못했어요. 중복 요청을 막기 위해 다시 보내지 않아요.')}
    finally {setBusy(false)}
  }
  return <div className="mt-6 space-y-5 border-t pt-4 text-sm">
    <section><h2 className="mb-2 font-medium" title="직접 붙인 태그만 × 로 뺄 수 있어요">태그</h2>{tags && <div className="mb-2 flex flex-wrap gap-1">{tags.map(({tag: t, by}) => <span key={t} className={`rounded-full px-2 py-1 text-xs ${by === "person" ? "bg-foreground text-background" : "bg-muted"}`}>{onTag ? <button onClick={() => onTag(t)}>{t}</button> : t} {by === "person" && <button aria-label={`${t} 태그 빼기`} disabled={busy || uncertain} onClick={() => change({remove:[t]})}>×</button>}</span>)}</div>}{tagLoadError && <p role="alert">태그 출처를 확인하지 못했어요. 확인되지 않은 태그는 뺄 수 없어요.</p>}<div className="flex gap-2"><input aria-label="추가할 태그" value={tag} onChange={(e) => setTag(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border px-2"/><Button size="sm" variant="outline" disabled={!tag.trim() || busy || uncertain} onClick={() => change({add:[tag.trim()]})}>추가</Button></div>{tagError && <p role="alert">{tagError}</p>}</section>
    <section><h2 className="mb-2 font-medium">여기를 가리키는 글</h2>{related?.truncated && <p className="mb-2 text-xs text-muted-foreground">최근 30개만 표시</p>}{error ? <p role="alert">{error} <button className="underline" onClick={() => setAttempt((n) => n+1)}>다시 시도</button></p> : !related ? <p role="status" className="delayed-show">불러오는 중…</p> : !related.edges.length ? <p className="text-xs text-muted-foreground">없음</p> : <ul className="space-y-1">{related.edges.map((edge, i) => <li key={`${edge.node.ref}-${i}`}><button onClick={() => onOpen(edge.node.ref)} className="text-left underline underline-offset-4">{edge.node.title}</button> <span className="text-xs text-muted-foreground">{edge.label}</span></li>)}</ul>}</section>
  </div>
}
