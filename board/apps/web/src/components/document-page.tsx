import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, PanelRight, Share2 } from 'lucide-react'
import { DocCrumbs, DocPageMenu } from '@/components/doc-crumbs'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { DocLinks } from '@/components/doc-links'
import { DocCreateButton } from '@/components/doc-create'
import { NoteEditor, type NoteHandle } from '@/components/note-editor'
import { DocumentMetadata } from '@/components/document-metadata'
import { ArchivedWorkView, LegacyArchivedDraft } from '@/components/archived-work-view'
import { api, ApiError } from '@/lib/api'
import { fetchFullDoc, searchDocs, getDocumentNote, type NoteSource, type FetchResult, type SearchResult, type RelatedResult } from '@/lib/docs-api'
import { noteVersion, type NoteDraft } from '@/lib/note-save'
import { DocumentWriteCoordinator } from '@/lib/document-write'
import { FAVORITES_EVENT, FAVORITES_KEY, readFavorites } from '@/components/document-nav'
import { wikiLinks } from '@/lib/wiki-links'
import { kindLabel, statusLabel } from '@/lib/doc-labels'

type Work = {noteVersioning?:boolean; self:{title:string;type:string;status:string;area?:string|null;updated_at:number}; note:{html:string;text:string;version?:number;updated_at:number}|null}
type Heading = {text:string;index:number;level:number}

export function DocumentPage({docRef,onOpen,onBack,onTag}:{docRef:string;onOpen:(ref:string)=>void;onBack:()=>void;onTag:(tag:string)=>void}) {
  const [work,setWork]=useState<Work|null>(null)
  const [missing,setMissing]=useState(false)
  const [docNote,setDocNote]=useState<NoteSource|null>(null)
  const [sourceError,setSourceError]=useState('')
  const noteRef=useRef<NoteHandle>(null)
  const [knownVersion,setKnownVersion]=useState<{from:number;to:number}|null>(null)
  const coordinator=useRef<DocumentWriteCoordinator|null>(null)
  if(!coordinator.current) coordinator.current=new DocumentWriteCoordinator((from,to)=>{setKnownVersion({from,to});noteRef.current?.acceptExternalVersion(from,to)})
  const [error,setError]=useState('')
  const [meta,setMeta]=useState<FetchResult|null>(null)
  const [metaError,setMetaError]=useState(false)
  const [favorites,setFavorites]=useState(readFavorites)
  const [favoriteError,setFavoriteError]=useState(false)
  const [right,setRight]=useState(true)
  const [sheet,setSheet]=useState(false)
  const [headings,setHeadings]=useState<Heading[]>([])
  const [outgoing,setOutgoing]=useState<RelatedResult|null>(null)
  const [relatedError,setRelatedError]=useState(false)
  const [wiki,setWiki]=useState<string[]>([])
  const [linkMatches,setLinkMatches]=useState<SearchResult['results']>([])
  const [linkError,setLinkError]=useState('')
  const [loading,setLoading]=useState(true)
  const root=useRef<HTMLDivElement>(null)
  /** 링크 검색은 마지막 것만, 이 페이지가 떠 있을 때만 이동한다 (늦게 끝난 검색이 다른 탐색을 가로채지 않게) */
  const wikiSearch=useRef(0)
  const mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;wikiSearch.current++}},[])
  const load = useCallback(async()=>{
    try {const value=await api<Work>(`/api/work/${encodeURIComponent(docRef)}`,{signal:AbortSignal.timeout(15000)});setWork(value);setMissing(false);setError('')}
    catch(e){if(e instanceof ApiError && e.status===404){setMissing(true);setError('')}else setError('문서를 불러오지 못했어요. 다시 시도해 주세요.')}
    finally {setLoading(false)}
  },[docRef])
  useEffect(()=>{let active=true;setLoading(true);void (async()=>{try{const value=await api<Work>(`/api/work/${encodeURIComponent(docRef)}`,{signal:AbortSignal.timeout(15000)});if(active){setWork(value);setMissing(false)}}catch(e){if(active){if(e instanceof ApiError && e.status===404){setMissing(true);try{const source=await getDocumentNote(docRef);if(active)setDocNote(source)}catch(noteError){if(active && !(noteError instanceof ApiError && noteError.status===404))setSourceError('원본 노트를 불러오지 못했어요.')}}else setError('문서를 불러오지 못했어요.')}}finally{if(active)setLoading(false)}})();return()=>{active=false}},[docRef])
  useEffect(()=>{let active=true;let sequence=0;const update=()=>{const current=++sequence;fetchFullDoc(docRef).then(v=>{if(active && current===sequence){setMeta(v);setMetaError(false);setWiki(wikiLinks(v.markdown))}}).catch(()=>{if(active && current===sequence)setMetaError(true)});api<RelatedResult>(`/api/docs/${encodeURIComponent(docRef)}/related?direction=out&depth=1&limit=30`).then(v=>{if(active && current===sequence){setOutgoing(v);setRelatedError(false)}}).catch(()=>{if(active && current===sequence)setRelatedError(true)})};update();window.addEventListener('docs:changed',update);return()=>{active=false;window.removeEventListener('docs:changed',update)}},[docRef])
  useEffect(()=>{const target=root.current;if(!target)return;const update=()=>{const nodes=Array.from(target.querySelectorAll<HTMLElement>('.note-body h1,.note-body h2,.note-body h3'));setHeadings(nodes.map((n,index)=>({text:n.textContent||'제목 없음',index,level:Number(n.tagName[1])}))) };const observer=new MutationObserver(update);observer.observe(target,{childList:true,subtree:true,characterData:true});update();return()=>observer.disconnect()},[loading,work])
  const toggleFavorite=()=>{const next=favorites.includes(docRef)?favorites.filter(x=>x!==docRef):[...favorites,docRef];try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(next));setFavorites(next);setFavoriteError(false);window.dispatchEvent(new Event(FAVORITES_EVENT))}catch{setFavoriteError(true)}}
  const navigateWiki=async(term:string)=>{const id=++wikiSearch.current;const current=()=>id===wikiSearch.current&&mounted.current;setLinkError('');setLinkMatches([]);if(/^(doc|item|signal|run):\S+$/.test(term)){onOpen(term);return}try{const exact:SearchResult['results']=[];let partial=false;for(const status of ['','archived'] as const){let cursor:string|undefined;for(let page=0;page<5;page++){const result=await searchDocs({q:term,includeAi:true,status,cursor});if(!current())return;for(const hit of result.results)if((hit.ref===term||hit.title===term)&&!exact.some(x=>x.ref===hit.ref))exact.push(hit);cursor=result.nextCursor;if(!cursor)break}if(cursor)partial=true}
    // 서버 관계 해석처럼 보관 문서까지 모두 본 뒤 제목이 하나뿐이고 검색이 끝까지 됐을 때만 바로 연다
    if(!current())return
    if(exact.length===1&&!partial)onOpen(exact[0].ref);else if(exact.length){setLinkMatches(exact);setLinkError(partial?'검색 결과가 많아 일부만 확인했어요. 같은 제목의 문서가 더 있을 수 있으니 맞는 문서를 골라 주세요.':'같은 제목의 문서가 여러 개예요. 열 문서를 골라 주세요.')}else setLinkError(partial?'검색 결과가 많아 일부만 확인했고 일치하는 문서를 찾지 못했어요. 문서 목록에서 검색해 주세요.':'일치하는 문서를 찾지 못했어요.')}catch{if(current())setLinkError('링크 검색에 실패했어요.')}}
  const panel=<div className="space-y-6 p-5 text-sm"><section><h2 className="mb-2 font-medium">개요</h2>{headings.length ? headings.map(h=><button key={h.index} className="block w-full truncate py-1 text-left text-muted-foreground hover:text-foreground" style={{paddingLeft:(h.level-1)*12}} onClick={()=>{root.current?.querySelectorAll<HTMLElement>('.note-body h1,.note-body h2,.note-body h3')[h.index]?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});setSheet(false)}}>{h.text}</button>) : <p className="text-xs text-muted-foreground">없음</p>}</section><section><h2 className="mb-2 font-medium">나가는 링크</h2>{relatedError ? <p role="alert">링크를 불러오지 못했어요</p> : !outgoing ? <p>불러오는 중…</p> : outgoing.edges.length ? outgoing.edges.map((e,i)=><button key={i} className="block py-1 text-left underline" onClick={()=>onOpen(e.node.ref)}>{e.node.title}</button>) : <p className="text-xs text-muted-foreground">없음</p>}{outgoing?.truncated && <p className="text-xs">일부만 표시</p>}</section><section><h2 className="mb-2 font-medium">[[링크]]</h2>{wiki.length ? wiki.map(term=><button key={term} className="block py-1 text-left underline" onClick={()=>void navigateWiki(term)}>{term}</button>) : <p className="text-xs text-muted-foreground">없음</p>}{linkError && <p role="alert">{linkError}</p>}{linkMatches.map(hit=><button className="block underline" key={hit.ref} onClick={()=>onOpen(hit.ref)}>{hit.title} · {hit.ref}</button>)}</section><DocLinks docRef={docRef} onOpen={onOpen} onTag={onTag}/></div>
  return <div className="flex min-h-[calc(100svh-3rem)]" ref={root}><div className="min-w-0 flex-1"><div className="sticky top-12 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2 text-sm"><DocCrumbs ancestors={meta?.ancestors ?? []} title={meta?.title || work?.self.title || '문서'} onBack={onBack} onOpen={onOpen}/><DocCreateButton keyHint label={docRef.startsWith('doc:')?'하위 문서 만들기':'새 문서 (이 문서와 연결)'} context={docRef.startsWith('doc:')?{parent:{ref:docRef,title:meta?.title || work?.self.title || '이 문서'},area:typeof meta?.frontmatter.area==='string'?meta.frontmatter.area:null,links:[{ref:docRef,title:meta?.title || work?.self.title || '이 문서'}],linksOn:false}:{area:typeof meta?.frontmatter.area==='string'?meta.frontmatter.area:null,links:[{ref:docRef,title:meta?.title || work?.self.title || '이 문서'}]}}/><Button variant="ghost" size="icon-sm" aria-label={favorites.includes(docRef)?'즐겨찾기 해제':'즐겨찾기'} onClick={toggleFavorite}><Bookmark className={favorites.includes(docRef)?'fill-current':''}/></Button><Button variant="ghost" size="icon-sm" aria-label="공유 지원하지 않음" title="공유는 아직 지원하지 않아요" disabled><Share2/></Button><DocPageMenu docRef={docRef} title={meta?.title || work?.self.title || '문서'} parent={typeof meta?.frontmatter.parent==='string'?meta.frontmatter.parent:null} area={typeof meta?.frontmatter.area==='string'?meta.frontmatter.area:null}/><Button variant="ghost" size="icon-sm" aria-label="문서 정보 패널" className="hidden md:inline-flex" onClick={()=>setRight(!right)}><PanelRight/></Button><Button variant="ghost" size="icon-sm" aria-label="문서 정보 열기" className="md:hidden" onClick={()=>setSheet(true)}><PanelRight/></Button></div>
    {metaError && <p role="alert" className="px-6 text-sm">문서 속성을 불러오지 못했어요.</p>}{favoriteError && <p role="alert" className="px-6 text-sm">즐겨찾기를 저장하지 못했어요.</p>}{loading ? <p className="p-8" role="status">문서를 불러오는 중…</p> : missing && !docNote ? <>{sourceError && <p role="alert" className="p-4">{sourceError}</p>}<ArchivedWorkView workRef={docRef} mode="page" onClose={onBack} onOpen={onOpen}/></> : error && !work ? <div className="p-8" role="alert">{error} <button className="underline" onClick={()=>void load()}>다시 시도</button></div> : (work || docNote) && <article className="mx-auto w-full max-w-[860px] px-6 pt-6 pb-28 md:px-12 md:pt-8">{meta ? <DocumentMetadata key={docRef} doc={meta} coordinator={coordinator.current} knownVersion={knownVersion} onTag={onTag} onRefresh={()=>{window.dispatchEvent(new Event('docs:changed'))}}/> : <><h1 data-page-title={metaError?'':'loading'} tabIndex={-1} className="text-3xl font-semibold">{work?.self.title || docRef}</h1><p className="my-6 text-sm text-muted-foreground">문서 속성을 불러오는 중이거나 사용할 수 없어요.</p></>}{(linkError || linkMatches.length>0) && <div role="status" className="mb-3 rounded-md border p-3 text-sm">{linkError || '같은 이름의 문서가 여러 개예요. 열 문서를 골라 주세요.'}{linkMatches.map(hit=><button className="block py-1 text-left underline" key={hit.ref} onClick={()=>onOpen(hit.ref)}>{hit.title} · {kindLabel(hit.kind)} · {statusLabel(hit.status)}</button>)}</div>}<LegacyArchivedDraft key={'legacy:'+docRef} docRef={docRef}/><NoteEditor key={docRef} ref={noteRef} workRef={docRef} noteSource={missing?'docs':'work'} onAdopt={()=>coordinator.current?.reset()} coordinateWrite={(body:NoteDraft & {expectedVersion?:number})=>{const path=`/api/${missing?'docs':'work'}/${encodeURIComponent(docRef)}/note`;const send=(value:typeof body)=>api<{version?:number;updated_at:number}>(path,{method:'PUT',body:JSON.stringify(value)});return typeof body.expectedVersion==='number' ? coordinator.current!.run(body.expectedVersion,(version)=>send({...body,expectedVersion:version})) : send(body)}} onWikiLink={(term)=>void navigateWiki(term)} initialHtml={docNote?.html ?? work?.note?.html ?? ''} initialVersion={missing ? docNote?.version : work ? noteVersion(work.noteVersioning,work.note) : null} updatedAt={work?.note?.updated_at || null} onSaved={()=>void load()} onDraftSaved={async(id)=>{await api(`/api/runs/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({applied:true})})}}/></article>}
  </div>{right && <aside className="hidden w-72 shrink-0 border-l md:block">{panel}</aside>}<Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="right" className="overflow-y-auto"><SheetTitle className="px-5 pt-5">문서 정보</SheetTitle>{panel}</SheetContent></Sheet></div>
}
