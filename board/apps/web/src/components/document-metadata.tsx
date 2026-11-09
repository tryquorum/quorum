import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { docsSchema, fetchFullDoc, patchDocumentMeta, patchDocumentProps, type DocProp, type FetchResult, type PropType, type PropValue, type SchemaResult } from '@/lib/docs-api'
import { classifyMetaSaveError, META_SAVE_MESSAGE } from '@/lib/meta-save'
import { Button } from '@/components/ui/button'
import { DocumentWriteCoordinator } from '@/lib/document-write'
import { archivedDrafts } from '@/lib/archived-safety'
import { kindLabel } from '@/lib/doc-labels'
import { composing, matches } from '@/lib/shortcuts'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lastInputWasPointer } from '@/lib/input-modality'
import { metaAtRisk, metaSummary } from '@/lib/doc-meta-fold'
import { koDateLabel } from '@/lib/ko-date'

type Props = {doc:FetchResult; coordinator:DocumentWriteCoordinator; knownVersion:{from:number;to:number}|null; onRefresh:()=>void; onTag:(tag:string)=>void}
const types:PropType[]=['text','number','date','datetime','checkbox','url','select','list']
const typeLabel:Record<PropType,string>={text:'텍스트',number:'숫자',date:'날짜',datetime:'날짜와 시간',checkbox:'체크박스',url:'URL',select:'선택',list:'목록'}
const reserved = new Set(['ref','kind','title','area','status','tags','links','version','created','updated','source','due','remindat'])
const valueText=(v:PropValue)=>Array.isArray(v)?v.join('\n'):v==null?'':String(v)
function parseValue(type:PropType,value:string):PropValue {
  if(type==='checkbox') return value==='' ? null : value==='true'
  if(type==='number') {if(!value.trim())return null;const n=Number(value);if(!Number.isFinite(n))throw new Error('올바른 숫자를 입력해 주세요.');return n}
  if(type==='list') return value.split('\n').map(x=>x.trim()).filter(Boolean)
  if(type!=='text' && value==='') return null
  return value
}
/** 노션처럼 긴 제목도 여러 줄로 감싸 보이는 제목 칸. 줄바꿈은 넣지 않는다 */
function TitleField({value,disabled,readOnlyHint,onChange,onCommit,onFocusChange}:{value:string;disabled:boolean;readOnlyHint?:string;onChange:(value:string)=>void;onCommit:()=>void;onFocusChange:(focused:boolean)=>void}) {
  const ref=useRef<HTMLTextAreaElement>(null)
  // 앱이 화면을 옮기며 준 포커스를 포인터로 연 사람에겐 링 없이(GAP-25). 키를 누르거나 다시 누르면 링이 돌아와요
  const [quiet,setQuiet]=useState(false)
  const fit=()=>{const el=ref.current;if(!el)return;el.style.height='auto';el.style.height=el.scrollHeight+'px'}
  useLayoutEffect(fit,[value])
  useEffect(()=>{const el=ref.current;if(!el||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(fit);observer.observe(el);return()=>observer.disconnect()},[])
  // 노션처럼 제목을 눌러 바로 고치고, Enter 나 다른 곳을 누르면 저장한다. Esc 는 고치기 전으로
  return <textarea ref={ref} rows={1} aria-label="문서 제목" title={disabled ? readOnlyHint : undefined} data-page-title className="block resize-none overflow-hidden break-words -mx-2 w-[calc(100%+1rem)] rounded-md border-0 bg-transparent px-2 py-1 text-2xl leading-tight font-semibold tracking-tight [text-wrap:balance] outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring data-quiet:focus-visible:ring-0 disabled:opacity-100 disabled:hover:bg-transparent md:text-3xl" data-quiet={quiet||undefined} onFocus={()=>{onFocusChange(true);setQuiet(document.body.dataset.focusIntent==='title'&&lastInputWasPointer())}} onPointerDown={()=>setQuiet(false)} onKeyDownCapture={()=>setQuiet(false)} value={value} readOnly={disabled} aria-readonly={disabled} onChange={e=>{if(!disabled)onChange(e.target.value.replace(/\r?\n/g,' '))}} onBlur={()=>{setQuiet(false);onFocusChange(false);if(!disabled)onCommit()}} onKeyDown={e=>{if(matches(e,'field.commit')&&!composing(e.nativeEvent)){e.preventDefault();if(!disabled)e.currentTarget.blur()}}}/>
}
function PropertyRow({prop,value,options,disabled,onChange,onSave,onRemove}:{prop:DocProp;value:string;options:string[];disabled:boolean;onChange:(value:string)=>void;onSave:()=>void;onRemove:()=>void}) {
  const [editing,setEditing]=useState(false)
  const [custom,setCustom]=useState(false)
  return <div className="group flex flex-wrap items-start gap-2 rounded-md py-0.5 hover:bg-muted/30"><span className="w-28 shrink-0 truncate py-1 text-muted-foreground" title={prop.key}>{prop.key}</span><div className="min-w-0 flex-1">{!editing ? <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-muted" onClick={()=>setEditing(true)}>{prop.type==='checkbox' ? (value===''?'비어 있음':value==='true'?'예':'아니요') : value || <span className="text-muted-foreground">비어 있음</span>}</button> : <div className="flex flex-wrap gap-2">{prop.type==='checkbox' ? <label><input aria-label={`${prop.key} 값`} type="checkbox" checked={value==='true'} onChange={e=>onChange(String(e.target.checked))}/> {value===''?'값 없음':'선택'} <button type="button" className="text-xs underline" onClick={()=>onChange('')}>값 비우기</button></label> : prop.type==='list' ? <div className="min-w-0 flex-1"><textarea aria-label={`${prop.key} 값`} className="w-full rounded border px-2 py-1" value={value} onChange={e=>onChange(e.target.value)} placeholder="한 줄에 하나씩"/>{options.length>0 && <div className="text-xs text-muted-foreground">기존 값: {options.join(', ')}</div>}</div> : prop.type==='select' ? <div className="min-w-0 flex-1"><select aria-label={`${prop.key} 값`} value={custom?'__custom__':value} onChange={e=>{if(e.target.value==='__custom__')setCustom(true);else {setCustom(false);onChange(e.target.value)}}} className="w-full rounded border px-2 py-1"><option value="">비어 있음</option>{value && !options.includes(value) && <option value={value}>{value}</option>}{options.map(x=><option key={x} value={x}>{x}</option>)}<option value="__custom__">새 선택값 입력</option></select>{custom && <input aria-label={`${prop.key} 새 선택값`} className="mt-1 w-full rounded border px-2 py-1" value={value} onChange={e=>onChange(e.target.value)}/>}</div> : <input aria-label={`${prop.key} 값`} type={prop.type==='datetime'?'datetime-local':['number','date','url'].includes(prop.type)?prop.type:'text'} className="min-w-0 flex-1 rounded border px-2 py-1" value={value} onChange={e=>onChange(e.target.value)}/>}<Button size="sm" variant="outline" disabled={disabled} onClick={onSave}>저장</Button><button className="text-xs underline" onClick={()=>setEditing(false)}>접기</button></div>}</div><details className="relative"><summary aria-label={`${prop.key} 속성 메뉴`} className="cursor-pointer list-none rounded px-2 py-1 text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">···</summary><div className="absolute right-0 z-20 w-40 rounded border bg-background p-3 shadow-sm"><p className="mb-2 text-xs">타입: {typeLabel[prop.type]}</p><button className="text-sm underline disabled:opacity-50" disabled={disabled} onClick={onRemove}>속성 삭제</button></div></details></div>
}
export function DocumentMetadata({doc,coordinator,knownVersion,onRefresh,onTag}:Props) {
  const props = Array.isArray(doc.frontmatter.props) ? doc.frontmatter.props as DocProp[] : []
  const unreadableDraft = useRef<string|null>(null)
  const recovered = useRef<null|{title:string;area:string;status:string;due:string;key:string;type:PropType;draft:Record<string,string>;blocked:boolean;conflict?:{version?:number;md?:string;truncated?:boolean}|null}>(null)
  /** 복원한 초안은 그 초안을 쓸 때 본 version 을 기준으로 저장한다. 그 사이 바뀌었으면 409 로 막힌다 */
  const recoveredVersion = useRef<number|null>(null)
  if (!recovered.current && unreadableDraft.current===null) {const saved=archivedDrafts.restore(`meta:${doc.ref}`);if(saved && saved.status!=='clean') {try {recovered.current=JSON.parse(saved.draft);recoveredVersion.current=Number.isSafeInteger(saved.version)&&saved.version>0?saved.version:null}catch{unreadableDraft.current=saved.draft}}}
  const [schema,setSchema]=useState<SchemaResult|null>(null)
  const [schemaError,setSchemaError]=useState(false)
  const [version,setVersion]=useState(recoveredVersion.current ?? doc.version)
  const [title,setTitle]=useState(recovered.current?.title ?? doc.title)
  const [area,setArea]=useState(recovered.current?.area ?? String(doc.frontmatter.area||''))
  const [status,setStatus]=useState(recovered.current?.status ?? String(doc.frontmatter.status||'open'))
  const [due,setDue]=useState(recovered.current?.due ?? String(doc.frontmatter.due||''))
  const [key,setKey]=useState(recovered.current?.key ?? '')
  const [type,setType]=useState<PropType>(recovered.current?.type ?? 'text')
  const [draft,setDraft]=useState<Record<string,string>>(recovered.current?.draft ?? {})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState(recovered.current?.blocked ? '이전에 저장을 확인하지 못해 입력값을 보관했어요. 서버 상태를 확인해 주세요.' : '')
  const [conflict,setConflict]=useState<{version?:number;md?:string;truncated?:boolean}|null>(recovered.current?.conflict ?? null)
  const [blocked,setBlocked]=useState(recovered.current?.blocked ?? false)
  const [storageError,setStorageError]=useState(false)
  // 속성 표 접기(GAP-13): 저장 안 된 값·오류·저장 중이면 늘 펼치고 접을 수 없어요. 위험이 풀려도 저절로 접지 않아요
  const lastTitle=useRef(doc.title)
  useEffect(()=>{lastTitle.current=doc.title},[doc.title])
  const [folded,setFolded]=useState(true)
  const [titleFocused,setTitleFocused]=useState(false)
  // 제목만 바로 저장하는 동안은 표를 펼치지 않아요(실패하면 error 로 펼쳐져요)
  const [titleSaving,setTitleSaving]=useState(false)
  const atRisk=metaAtRisk({unreadable:unreadableDraft.current!==null,error,conflict,blocked,busy:busy&&!titleSaving,storageError,draftKeys:Object.keys(draft).length,newKey:key,basicChanged:(!titleSaving&&title.trim()!==lastTitle.current&&(!titleFocused||(!!recovered.current&&recovered.current.title!==doc.title)))||area!==String(doc.frontmatter.area||'')||status!==String(doc.frontmatter.status||'open')||due!==String(doc.frontmatter.due||'')})
  useEffect(()=>{if(atRisk)setFolded(false)},[atRisk])
  const open=!folded||atRisk
  const riskText=busy?'저장하는 중이에요':error||conflict||blocked||storageError||unreadableDraft.current!==null?'속성 저장을 확인해 주세요':'저장 안 된 변경이 있어요'
  useEffect(()=>{if(unreadableDraft.current!==null)return;const changed=title!==doc.title||area!==String(doc.frontmatter.area||'')||status!==String(doc.frontmatter.status||'open')||due!==String(doc.frontmatter.due||'')||!!key||!!Object.keys(draft).length||blocked||busy;const value=JSON.stringify({title,area,status,due,key,type,draft,blocked:blocked||busy,conflict});const stored=archivedDrafts.persist(`meta:${doc.ref}`,{status:changed?'dirty':'clean',version,base:'',draft:value,backups:[]});setStorageError(!stored)},[title,area,status,due,key,type,draft,blocked,busy,conflict,doc,version])
  useEffect(()=>{let live=true;let sequence=0;const refresh=()=>{const current=++sequence;docsSchema().then(s=>{if(live && current===sequence){setSchema(s);setSchemaError(false)}}).catch(()=>{if(live && current===sequence)setSchemaError(true)})};refresh();window.addEventListener('docs:changed',refresh);return()=>{live=false;window.removeEventListener('docs:changed',refresh)}},[doc.ref])
  // Only adopt a newer version automatically when this form has no outstanding changes.
  useEffect(()=>{if(!busy && !blocked && title===doc.title && area===String(doc.frontmatter.area||'') && status===String(doc.frontmatter.status||'open') && due===String(doc.frontmatter.due||'') && !Object.keys(draft).length)setVersion(doc.version)},[doc.version])
  useEffect(()=>{if(knownVersion !== null)setVersion(current=>current===knownVersion.from?knownVersion.to:current)},[knownVersion])
  const editable=doc.frontmatter.status!=='archived'
  const basic=editable && ['doc','todo','goal'].includes(doc.kind)
  const titleEditable=editable && ['doc','todo','goal','signal'].includes(doc.kind)
  const supported=Array.isArray(schema?.props) && unreadableDraft.current===null
  const send=async(fn:(version:number)=>Promise<{version:number}>,done:()=>void)=>{if(busy||blocked)return;setBusy(true);setError('');try{const result=await coordinator.run(version,fn);if(!Number.isSafeInteger(result.version) || result.version<1)throw new Error('서버 버전을 확인할 수 없어요.');setVersion(result.version);done();onRefresh()}catch(e){const failure=classifyMetaSaveError(e);if(failure.kind==='conflict'){setConflict(failure.current);setError(META_SAVE_MESSAGE.conflict);setBlocked(true)}else if(failure.kind==='rejected'){setError(META_SAVE_MESSAGE.rejected(failure.message))}else {setError(META_SAVE_MESSAGE.unknown);setBlocked(true)}}finally{setBusy(false)}}
  const saveMeta=()=>void send((expectedVersion)=>patchDocumentMeta(doc.ref,{...(basic?{title,area:area||null,due:due||null}:titleEditable?{title}:{}),status:status as 'open'|'done',expectedVersion}),()=>{})
  // 제목만 바로 저장(Enter·포커스 이동). 빈 제목이나 바뀌지 않은 제목은 보내지 않는다
  const saveTitle=()=>{const next=title.trim();if(!next){setTitle(lastTitle.current);return}if(next===lastTitle.current)return;setTitleSaving(true);void send((expectedVersion)=>patchDocumentMeta(doc.ref,{title:next,expectedVersion}),()=>{lastTitle.current=next;setTitle(next)}).finally(()=>setTitleSaving(false))}
  const adoptLatest=async()=>{if(!window.confirm('입력값을 복사했나요? 현재 속성 입력을 버리고 서버의 최신 값을 불러와요.'))return;setBusy(true);try{const latest=await fetchFullDoc(doc.ref);setTitle(latest.title);setArea(String(latest.frontmatter.area||''));setStatus(String(latest.frontmatter.status||'open'));setDue(String(latest.frontmatter.due||''));setDraft({});setKey('');setVersion(latest.version);setBlocked(false);setError('');setConflict(null);coordinator.reset();onRefresh()}catch{setError('최신 속성을 불러오지 못했어요. 기존 입력값을 보존했어요.')}finally{setBusy(false)}}
  const saveProp=(p:DocProp)=>{try{const sent=draft[p.key];const value=parseValue(p.type,sent??valueText(p.value));void send((expectedVersion)=>patchDocumentProps(doc.ref,{set:{[p.key]:value},types:{[p.key]:p.type},expectedVersion}),()=>setDraft(old=>{if(old[p.key]!==sent)return old;const n={...old};delete n[p.key];return n}))}catch(e){setError((e as Error).message)}}
  const add=()=>{const k=key.normalize('NFC').trim();if(!/^[\p{L}\p{N}][\p{L}\p{N} _\-./]{0,39}$/u.test(k)||reserved.has(k.toLowerCase())){setError('속성 이름은 1~40자의 문자·숫자·공백·_-./만 사용할 수 있으며 기본 속성 이름은 쓸 수 없어요.');return}if(props.length>=30){setError('사용자 속성은 문서당 30개까지 추가할 수 있어요.');return}if(props.some(p=>p.key===k)){setError('이미 있는 속성이에요.');return}const typed=schema?.props?.find(p=>p.key===k);if(typed && typed.type!==type){setError(`이 속성의 기존 타입은 ${typeLabel[typed.type]}이에요.`);return}const initial:PropValue=type==='checkbox'?false:type==='list'?[]:type==='text'?'':null;const typedKey=key;void send((expectedVersion)=>patchDocumentProps(doc.ref,{set:{[k]:initial},types:{[k]:type},expectedVersion}),()=>setKey(old=>old===typedKey?'':old))}
  return <section aria-label="문서 속성" className="mt-3 mb-6 space-y-1 text-sm">
    <label className="block"><span className="sr-only">제목</span><TitleField value={title} disabled={!titleEditable||!supported||blocked||busy} readOnlyHint={doc.kind==='run'?'대화 제목은 첫 질문이라 바꿀 수 없어요':!editable?'보관된 문서는 복원한 뒤 제목을 바꿀 수 있어요':undefined} onChange={setTitle} onCommit={saveTitle} onFocusChange={setTitleFocused}/></label>
    <button type="button" aria-expanded={open} aria-controls="doc-meta-fold" aria-disabled={atRisk||undefined} title={atRisk?riskText:undefined} onClick={()=>{if(!atRisk)setFolded(f=>!f)}} className="-mx-2 flex min-h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:bg-muted/40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent max-md:min-h-11"><span className="min-w-0 flex-1 truncate">{metaSummary({area,status,due,props}).join(' · ') || '속성'}{atRisk && <span className="text-foreground"> · {riskText}</span>}</span><ChevronRight aria-hidden className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')}/></button>
    {supported && !editable && <p className="text-xs text-muted-foreground">보관된 문서의 기본 속성은 복원 후 편집할 수 있어요. 사용자 속성과 본문은 편집할 수 있어요.</p>}
    {!supported && <p className="text-xs text-muted-foreground">{schemaError?'속성 정보를 불러오지 못했어요.':'이 서버는 메타데이터 편집을 지원하지 않아요.'}</p>}
    <div id="doc-meta-fold" hidden={!open} className="space-y-1 pt-1">
    <label className="grid grid-cols-[7rem_1fr] items-center"><span className="text-muted-foreground">영역</span>{basic ? <select aria-label="문서 영역" className="rounded-md border border-transparent bg-transparent px-2 py-1 hover:bg-muted focus-visible:border-input disabled:opacity-100 disabled:hover:bg-transparent" value={area} disabled={!basic||!supported||blocked||busy} onChange={e=>setArea(e.target.value)}><option value="">없음</option>{area && !schema?.areas.includes(area) && <option value={area}>{area}</option>}{schema?.areas.map(a=><option key={a}>{a}</option>)}</select> : <span className="px-2 py-1">{area || '—'}</span>}</label>
    <label className="grid grid-cols-[7rem_1fr] items-center"><span className="text-muted-foreground">상태</span><select aria-label="문서 상태" className="rounded-md border border-transparent bg-transparent px-2 py-1 hover:bg-muted focus-visible:border-input disabled:opacity-100 disabled:hover:bg-transparent" value={status} disabled={!editable||!supported||blocked||busy} onChange={e=>setStatus(e.target.value)}><option value="open">열림</option><option value="done">끝남</option>{status==='archived' && <option value="archived">보관</option>}</select></label>
    <label className="grid grid-cols-[7rem_1fr] items-center"><span className="text-muted-foreground">날짜</span>{basic ? <span className="flex flex-wrap items-center"><input aria-label="문서 날짜" aria-describedby={due?"doc-due-ko":undefined} type={doc.kind==='todo'?'datetime-local':'date'} className="num rounded-md border border-transparent bg-transparent px-2 py-1 hover:bg-muted focus-visible:border-input disabled:opacity-100 disabled:hover:bg-transparent" value={due} disabled={!basic||!supported||blocked||busy} onChange={e=>setDue(e.target.value)}/>{due && <span id="doc-due-ko" className="num ml-2 text-xs text-muted-foreground">{koDateLabel(due)}</span>}</span> : <span className="num px-2 py-1">{due ? due.replace('T', ' ') : '—'}</span>}</label>
    <div className="grid grid-cols-[7rem_1fr] items-center py-1"><span className="text-muted-foreground">종류</span><span className="px-2">{kindLabel(doc.kind)}</span></div><div className="grid grid-cols-[7rem_1fr] items-center py-1"><span className="text-muted-foreground">만든 시각</span><span className="tnum px-2">{typeof doc.frontmatter.created==='number'?new Date(doc.frontmatter.created).toLocaleString('ko-KR'):'알 수 없음'}</span></div><div className="grid grid-cols-[7rem_1fr] items-center py-1"><span className="text-muted-foreground">고친 시각</span><span className="tnum px-2">{typeof doc.frontmatter.updated==='number'?new Date(doc.frontmatter.updated).toLocaleString('ko-KR'):'알 수 없음'}</span></div><div className="grid grid-cols-[7rem_1fr] items-center py-1"><span className="text-muted-foreground">태그</span><span className="flex flex-wrap gap-1 px-2">{Array.isArray(doc.frontmatter.tags) && doc.frontmatter.tags.map((v:unknown,i:number)=>{const name=typeof v==='string'?v:v&&typeof v==='object'&&'tag' in v&&typeof v.tag==='string'?v.tag:'';return name?<button key={`${name}-${i}`} onClick={()=>onTag(name)} className="rounded bg-muted px-2 py-0.5 text-xs">{name}</button>:null})}</span></div>
    {supported && editable && <div className="pt-1"><Button variant="outline" size="sm" disabled={busy||blocked} onClick={saveMeta}>기본 속성 저장</Button></div>}
    {supported && <div className="space-y-0.5 pt-1"><h2 className="sr-only">사용자 속성</h2>{props.map(p=><PropertyRow key={p.key} prop={p} value={draft[p.key]??valueText(p.value)} options={schema?.props?.find(x=>x.key===p.key)?.options || []} disabled={busy||blocked} onChange={value=>setDraft(x=>({...x,[p.key]:value}))} onSave={()=>saveProp(p)} onRemove={()=>{if(window.confirm(`${p.key} (${typeLabel[p.type]}) 속성을 삭제할까요?`))void send((expectedVersion)=>patchDocumentProps(doc.ref,{remove:[p.key],expectedVersion}),()=>{})}}/>)}<div className="flex flex-wrap gap-2 pt-1"><input aria-label="새 속성 이름" value={key} onChange={e=>setKey(e.target.value)} className="h-8 min-w-32 flex-1 rounded-md border px-2" placeholder="새 속성 이름"/><select aria-label="새 속성 타입" value={type} onChange={e=>setType(e.target.value as PropType)} className="h-8 rounded-md border bg-background px-2">{types.map(t=><option key={t} value={t}>{typeLabel[t]}</option>)}</select><Button size="sm" variant="ghost" disabled={!supported||busy||blocked} onClick={add}>+ 속성 추가</Button></div></div>}
    </div>
    {unreadableDraft.current!==null && <div role="alert"><p>이전에 보관한 속성 초안을 읽을 수 없어 편집을 잠갔어요. 아래 원문을 복사해 보관해 주세요.</p><textarea readOnly aria-label="읽을 수 없는 속성 초안" className="w-full border" value={unreadableDraft.current}/></div>}{storageError && <p role="alert">속성 초안을 브라우저에 보관하지 못했어요. 페이지를 닫기 전에 복사해 주세요.</p>}{error && <div role="alert" className="rounded border p-3"><p>{error}</p>{conflict && <><p>서버 버전 {conflict.version ?? '확인 불가'}{conflict.truncated?' · 일부만 표시':''}</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{conflict.md}</pre></>}{blocked && <><p>현재 입력값을 복사한 뒤 최신 서버 상태를 확인해 주세요.</p><textarea readOnly aria-label="보존된 속성 입력값" className="mt-2 h-24 w-full border p-2 font-mono text-xs" value={JSON.stringify({title,area,status,due,props:draft,newProperty:{key,type}},null,2)}/><button className="underline" disabled={busy} onClick={()=>void adoptLatest()}>복사 후 최신 속성으로 전환</button></>}</div>}
  </section>
}
