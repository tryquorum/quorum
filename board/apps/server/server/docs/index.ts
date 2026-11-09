import type { Database } from "bun:sqlite"
import type { DocKind, DocProp, DocRecord, DocStatus, PropType, TagBy } from "@direction-board/contracts/docs"
import { afterDocsCommit, withDocsTx } from "./storage.ts"
import { extractBodyLinks, extractBodyTags, normalizeTag, reconcileRelations } from "./relations.ts"
import { hasVaultSink, queueMirrorSync, retryVaultRebuild } from './sink.ts'
import { ancestors, subtree } from './tree.ts'
import { docPath } from '../vault/model.ts'
import { workspaceItem } from './scope.ts'
import { everyWhileOpen } from '../db-timers.ts'

type Note = { owner:string; ref:string; md:string|null; text:string; by:string|null; updated_at:number; created_at:number|null; version:number; person_edited:number }
type Indexed = { kind:DocKind; title:string; area:string|null; status:DocStatus; source:string|null; updated_at:number; mirror_path:string|null; due:string|null }
type Projection = { kind:DocKind; title:string; area:string|null; status:DocStatus; source:string|null; updated_at:number; due:string|null }
type Board = { id:string; kind:string; owner:string|null; meta:string; deleted:number; updated_at:number }
type Item = { data:string; deleted:number; updated_at:number }
type Signal = { title:string; area:string|null; source:string; status:string; updated_at:number }
type Run = { prompt:string; status:string; updated_at:number }
type Standalone = { title:string; area:string|null; archived:number; updated_at:number; due:string|null; done:number }
const DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const dueOf = (value:unknown, dateOnly:boolean):string|null => typeof value === 'string' && DUE.test(value) && (!dateOnly || value.length === 10) ? value : null

const timers = new WeakMap<Database, () => void>()
const kindLabel: Record<DocKind,string> = {todo:'할일',goal:'목표',signal:'사건',run:'대화',doc:'문서'}
const statusLabel: Record<DocStatus,string> = {open:'열림',done:'끝남',archived:'보관'}

function source(db:Database, owner:string, ref:string): { projection:Projection|null; excluded:boolean; changed:number } {
  const [prefix, ...parts] = ref.split(':')
  if (prefix === 'item' && parts.length === 2) {
    const board = db.query('SELECT id,kind,owner,meta,deleted,updated_at FROM boards WHERE id=?').get(parts[0]) as Board|null
    // 사람 범위는 자기 개인 판 항목만. 워크스페이스 범위(파일럿, scope.ts)는 회사 판에서 그 공간인 항목만
    const shared = workspaceItem(db,owner,parts[0],parts[1])
    if (board && !shared && (board.kind === 'company' || board.owner !== owner)) return {projection:null,excluded:true,changed:board.updated_at}
    const item = db.query('SELECT data,deleted,updated_at FROM items WHERE board_id=? AND id=?').get(parts[0],parts[1]) as Item|null
    const changed = Math.max(board?.updated_at || 0,item?.updated_at || 0)
    if (!board || board.deleted || !item || item.deleted) return {projection:null,excluded:false,changed}
    const data = JSON.parse(item.data) as {type:string;text?:string;area?:string;done?:boolean;due?:unknown;remindAt?:unknown}
    if (data.type !== 'todo' && data.type !== 'goal') return {projection:null,excluded:false,changed}
    const meta = JSON.parse(board.meta || '{}') as {areas?:{id:string;name:string}[]}
    return {projection:{kind:data.type,title:String(data.text || '').split('\n')[0] || '(제목 없음)',area:meta.areas?.find(a=>a.id===data.area)?.name || null,status:data.done?'done':'open',source:data.type === 'goal'?'목표':'미리알림',updated_at:changed,due:data.type === 'goal' ? dueOf(data.due,true) : dueOf(data.remindAt,false)},excluded:false,changed}
  }
  if (prefix === 'signal' && parts.length === 1) {
    const s = db.query('SELECT title,area,source,status,updated_at FROM signals WHERE owner=? AND id=?').get(owner,parts[0]) as Signal|null
    return {projection:s?{kind:'signal',title:s.title,area:s.area,source:s.source,status:s.status==='resolved'?'done':'open',updated_at:s.updated_at,due:null}:null,excluded:false,changed:s?.updated_at || 0}
  }
  if (prefix === 'run' && parts.length === 1) {
    const {runs,basis} = runActivity(db,owner,parts[0])
    const root = runs[0], last = runs.at(-1)
    const activity = Math.max(0,...runs.map(r=>r.updated_at))
    // 대화 상태는 실행 상태를 따르되, 문서 메타로 정한 상태(doc_status)는 그때 본 실행 기록(basis)이 그대로일 때만 쓴다.
    // 새 실행·상태 변화가 생기면(같은 밀리초여도) 다시 실행 상태를 따른다
    const chosen = db.query('SELECT status,basis,updated_at FROM doc_status WHERE owner=? AND ref=?').get(owner,ref) as {status:string;basis:string;updated_at:number}|null
    const override = chosen && chosen.basis === basis && (chosen.status === 'open' || chosen.status === 'done') ? chosen.status as DocStatus : null
    const changed = Math.max(activity,chosen?.updated_at || 0)
    return {projection:root && last?{kind:'run',title:root.prompt.split('\n')[0] || ref,area:null,source:null,status:override || (last.status==='done'?'done':'open'),updated_at:changed,due:null}:null,excluded:false,changed}
  }
  if (prefix === 'doc' && parts.length === 1) {
    const d = db.query('SELECT title,area,archived,updated_at,due,done FROM docs WHERE owner=? AND id=?').get(owner,parts[0]) as Standalone|null
    return {projection:d?{kind:'doc',title:d.title,area:d.area,source:null,status:d.archived?'archived':d.done?'done':'open',updated_at:d.updated_at,due:dueOf(d.due,false)}:null,excluded:false,changed:d?.updated_at || 0}
  }
  return {projection:null,excluded:false,changed:0}
}

/** 한 대화(thread)의 실행 기록과, 그 기록이 바뀌었는지 비교할 서명(id·상태·updated_at) */
export function runActivity(db:Database, owner:string, thread:string):{runs:(Run & {id:string})[];basis:string} {
  const runs = db.query('SELECT id,prompt,status,updated_at FROM runs WHERE owner=? AND COALESCE(thread,id)=? ORDER BY created_at,id').all(owner,thread) as (Run & {id:string})[]
  return {runs,basis:JSON.stringify(runs.map(r=>[r.id,r.status,r.updated_at]))}
}

/** 이 owner 가 문서로 가질 수 있는 살아 있는 원본인가(개인 판 할 일·목표, 내 사건·대화·독립 문서). 회사 판·남의 것은 false */
export function ownedLiveRef(db:Database, owner:string, ref:string):boolean {
  const result = source(db,owner,ref)
  return !result.excluded && !!result.projection
}

/** doc_index.due 칸을 처음 만들 때 한 번: 기존 행의 due 를 원본에서 채운다(메타데이터 변경으로 세지 않게) */
export function backfillIndexDue(db:Database):void {
  const rows = db.query('SELECT owner,ref FROM doc_index').all() as {owner:string;ref:string}[]
  const update = db.query('UPDATE doc_index SET due=? WHERE owner=? AND ref=?')
  for (const row of rows) update.run(source(db,row.owner,row.ref).projection?.due ?? null,row.owner,row.ref)
}

function removeProjection(db:Database, owner:string, ref:string) {
  db.query('DELETE FROM doc_index WHERE owner=? AND ref=?').run(owner,ref)
  db.query('DELETE FROM doc_fts WHERE owner=? AND ref=?').run(owner,ref)
  db.query('DELETE FROM doc_tags WHERE owner=? AND ref=?').run(owner,ref)
}

function hierarchy(db:Database,owner:string,ref:string):{parent:string|null;position:number|null;folders:string[]} {
  if(!ref.startsWith('doc:')) return {parent:null,position:null,folders:[]}
  const row=db.query('SELECT parent_id,position FROM docs WHERE owner=? AND id=?').get(owner,ref.slice(4)) as {parent_id:string|null;position:number|null}|null
  if(!row?.parent_id) return {parent:null,position:row?.position ?? null,folders:[]}
  const chain=ancestors(db,owner,row.parent_id)
  return {parent:`doc:${row.parent_id}`,position:row.position,folders:chain.map(n=>docPath({owner,ref:`doc:${n.id}`,kind:'doc',title:n.title}).slice('문서/'.length,-3))}
}
function signature(db:Database, note:Note, result:ReturnType<typeof source>):string {
  const data:unknown[]=[note.updated_at,note.version,note.md,note.text,note.by,note.person_edited,note.created_at,result]
  const h=hierarchy(db,note.owner,note.ref)
  if(h.parent) data.push(h.parent,h.position,h.folders)
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(data)).digest('hex')
}

function neighbors(db:Database, owner:string, refs:Iterable<string>):Set<string> {
  const result = new Set(refs)
  for (const ref of [...result]) for (const row of db.query('SELECT a,b FROM work_links WHERE owner=? AND (a=? OR b=?)').all(owner,ref,ref) as {a:string;b:string}[]) { result.add(row.a); result.add(row.b) } // oxlint-disable-line unicorn/no-useless-spread -- 루프 본문에서 result Set 에 이웃을 추가하므로 1단계 대상 스냅샷이 필요하다
  return result
}
/** 본문 관계를 정리하고, 정리 전후로 관계가 닿는 문서를 거울 확인 대상으로 돌려준다 */
function reconcileTouched(db:Database, owner:string, affected:string[]):Set<string> {
  const touched = neighbors(db,owner,affected)
  reconcileRelations(db,owner,affected)
  for (const ref of neighbors(db,owner,affected)) touched.add(ref)
  return touched
}

function project(db:Database, owner:string, ref:string): void {
  const note = db.query('SELECT owner,ref,md,text,by,updated_at,created_at,version,person_edited FROM work_notes WHERE owner=? AND ref=?').get(owner,ref) as Note|null
  if (!note) { removeProjection(db,owner,ref); return }
  const prev = db.query('SELECT kind,title,area,status,source,updated_at,mirror_path,due FROM doc_index WHERE owner=? AND ref=?').get(owner,ref) as Indexed|null
  const result = source(db,owner,ref)
  if (result.excluded) { removeProjection(db,owner,ref); return }
  const md = note.md ?? note.text
  const fallbackKind:DocKind = ref.startsWith('signal:')?'signal':ref.startsWith('run:')?'run':ref.startsWith('doc:')?'doc':'todo'
  const p:Projection = result.projection || {kind:prev?.kind || fallbackKind,title:prev?.title || md.split('\n').map(s=>s.trim()).find(Boolean) || ref,area:prev?.area || null,status:'archived',source:prev?.source || null,updated_at:prev?.updated_at || note.updated_at,due:prev?.due ?? null}
  // 기본 메타데이터(제목·영역·상태·날짜)가 바뀌면 문서 version 을 올린다. 보드에서 바꾼 제목도 포함되어
  // 낡은 version 으로 보낸 meta·노트 저장은 409 가 된다(덮어쓰지 않음)
  if (prev && (prev.title !== p.title || (prev.area ?? null) !== (p.area ?? null) || prev.status !== p.status || (prev.due ?? null) !== (p.due ?? null))) {
    db.query('UPDATE work_notes SET version=version+1 WHERE owner=? AND ref=?').run(owner,ref)
    note.version += 1
  }
  const updated = Math.max(note.updated_at,p.updated_at)
  db.query(`INSERT INTO doc_index(owner,ref,kind,title,area,status,source,updated_at,created_at,version,chars,person_edited,mirror_path,due)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,ref) DO UPDATE SET kind=excluded.kind,title=excluded.title,area=excluded.area,status=excluded.status,source=excluded.source,updated_at=excluded.updated_at,created_at=excluded.created_at,version=excluded.version,chars=excluded.chars,person_edited=excluded.person_edited,due=excluded.due`)
    .run(owner,ref,p.kind,p.title,p.area,p.status,p.source,updated,note.created_at ?? note.updated_at,note.version,md.length,note.person_edited,prev?.mirror_path || null,p.due ?? null)
  db.query('UPDATE doc_index SET src_sig=? WHERE owner=? AND ref=?').run(signature(db,note,result),owner,ref)
  const h=hierarchy(db,owner,ref)
  db.query('UPDATE doc_index SET parent=?,folders=? WHERE owner=? AND ref=?').run(h.parent,JSON.stringify(h.folders),owner,ref)
  db.query("DELETE FROM doc_tag_sources WHERE owner=? AND ref=? AND by IN ('auto','body')").run(owner,ref)
  const tags = [`종류/${kindLabel[p.kind]}`,`상태/${statusLabel[p.status]}`]
  if (p.area) tags.push(`영역/${p.area}`)
  if (p.source) tags.push(`출처/${p.source}`)
  if (note.by === 'agent' && !note.person_edited) tags.push('ai/초안')
  const insert = db.query('INSERT OR IGNORE INTO doc_tag_sources(owner,ref,tag,by,created_at) VALUES (?,?,?,?,?)')
  for (const tag of tags.map(normalizeTag)) insert.run(owner,ref,tag,'auto',updated)
  for (const tag of extractBodyTags(md)) insert.run(owner,ref,tag,'body',updated)
  db.query('DELETE FROM doc_tags WHERE owner=? AND ref=?').run(owner,ref)
  db.query(`INSERT INTO doc_tags(owner,ref,tag,by,created_at)
    SELECT owner,ref,tag,by,created_at FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY tag ORDER BY CASE by WHEN 'person' THEN 0 WHEN 'agent' THEN 1 WHEN 'body' THEN 2 ELSE 3 END) AS rank FROM doc_tag_sources WHERE owner=? AND ref=?) WHERE rank=1`).run(owner,ref)
  const projectedTags = db.query('SELECT tag FROM doc_tags WHERE owner=? AND ref=? ORDER BY tag').all(owner,ref) as {tag:string}[]
  db.query('DELETE FROM doc_fts WHERE owner=? AND ref=?').run(owner,ref)
  db.query('INSERT INTO doc_fts(owner,ref,title,body,tags) VALUES (?,?,?,?,?)').run(owner,ref,p.title,md,projectedTags.map(t=>t.tag).join(' '))
}

export function reindexRef(db:Database, owner:string, ref:string):void {
  withDocsTx(db,()=>{
    const old = db.query('SELECT title FROM doc_index WHERE owner=? AND ref=?').get(owner,ref) as {title:string}|null
    project(db,owner,ref)
    const next = db.query('SELECT title FROM doc_index WHERE owner=? AND ref=?').get(owner,ref) as {title:string}|null
    const descendants=ref.startsWith('doc:') && old && next && old.title!==next.title ? subtree(db,owner,ref.slice(4)).slice(1).map(n=>`doc:${n.id}`) : []
    for(const descendant of descendants) project(db,owner,descendant)
    const touched = reconcileTouched(db,owner,affectedRefs(db,owner,[ref,...descendants],old?.title === next?.title ? [] : [old?.title,next?.title].filter((v):v is string=>!!v)))
    markDocsChanged(db,owner,touched)
  })
}

function affectedRefs(db:Database, owner:string, refs:string[], titles:string[]):string[] {
  const targets = new Set([...refs,...titles])
  const affected = new Set(refs)
  if (targets.size) {
    const rows = db.query('SELECT ref,COALESCE(md,text) AS md FROM work_notes WHERE owner=?').all(owner) as {ref:string;md:string}[]
    for (const row of rows) if (extractBodyLinks(row.md).some(link=>targets.has(link))) affected.add(row.ref)
  }
  return [...affected]
}

/** 커밋 뒤 거울 확인 대상으로 등록한다. 트랜잭션 밖에서 불러도 된다(관계를 바로 고친 뒤 등). 롤백되면 큐 작업이 같은 문서를 보고 아무것도 보내지 않는다 */
export function markDocsChanged(db:Database, owner:string, refs:Iterable<string>):void {
  if (!hasVaultSink(db)) return
  withDocsTx(db,()=>{ for (const ref of refs) afterDocsCommit(db,()=>queueMirrorSync(db,owner,[ref]),`vault:${owner}:${ref}`) })
}
/** 거울 기록이 없거나, 다시 보내야 하거나('!' 로 시작), 관계가 달라진 문서. 바깥에서 바뀐 관계와 실패한 보내기를 refresh 가 찾는 길 */
function mirrorDrift(db:Database, owner:string):string[] {
  if (!hasVaultSink(db)) return []
  const links = new Map<string,{ref:string;label:string;direction:'out'|'in'}[]>()
  const push = (ref:string, link:{ref:string;label:string;direction:'out'|'in'}) => { const list = links.get(ref) || []; list.push(link); links.set(ref,list) }
  for (const e of db.query('SELECT a,b,label FROM work_links WHERE owner=? ORDER BY created_at,id').all(owner) as {a:string;b:string;label:string|null}[]) {
    push(e.a,{ref:e.b,label:e.label || '',direction:'out'}); push(e.b,{ref:e.a,label:e.label || '',direction:'in'})
  }
  const states = new Map((db.query('SELECT ref,sig,links FROM doc_mirror_state WHERE owner=?').all(owner) as {ref:string;sig:string;links:string}[]).map(s=>[s.ref,s]))
  const indexed = new Set((db.query('SELECT ref FROM doc_index WHERE owner=?').all(owner) as {ref:string}[]).map(r=>r.ref))
  const drift = [...indexed].filter(ref=>{const s=states.get(ref); return !s || s.sig.startsWith('!') || s.links !== JSON.stringify(links.get(ref) || [])})
  for (const ref of states.keys()) if (!indexed.has(ref)) drift.push(ref)
  return drift
}

export function rebuildOwner(db:Database, owner:string):void {
  withDocsTx(db,()=>{
    const refs = db.query('SELECT ref FROM work_notes WHERE owner=? UNION SELECT ref FROM doc_index WHERE owner=?').all(owner,owner) as {ref:string}[]
    for (const {ref} of refs) project(db,owner,ref)
    reconcileRelations(db,owner)
    markDocsChanged(db,owner,refs.map(r=>r.ref))
  })
}

export function refreshChanged(db:Database, requestedOwner?:string):void {
  const owners = requestedOwner ? [requestedOwner] : (db.query('SELECT owner FROM work_notes UNION SELECT owner FROM doc_index UNION SELECT owner FROM doc_scan_state UNION SELECT owner FROM doc_mirror_state').all() as {owner:string}[]).map(r=>r.owner)
  for (const owner of owners) {
    const notes = db.query('SELECT owner,ref,md,text,by,updated_at,created_at,version,person_edited FROM work_notes WHERE owner=?').all(owner) as Note[]
    const indexed = db.query('SELECT ref,title,src_sig FROM doc_index WHERE owner=?').all(owner) as {ref:string;title:string;src_sig:string|null}[]
    const previous = new Map(indexed.map(row=>[row.ref,row]))
    const present = new Set(notes.map(note=>note.ref))
    const changed = notes.filter(note=>{const result=source(db,owner,note.ref); const old=previous.get(note.ref); return result.excluded ? !!old : !old || old.src_sig!==signature(db,note,result)})
    const stale = indexed.filter(row=>!present.has(row.ref))
    // 실패한 rebuild 가 남은 owner 는 개별 확인 대신 rebuild 를 다시 시도한다(그 전까지 거울 기록을 믿지 않는다)
    const drift = retryVaultRebuild(db,owner) ? [] : mirrorDrift(db,owner)
    if (!changed.length && !stale.length) { if (drift.length) markDocsChanged(db,owner,drift); continue }
    withDocsTx(db,()=>{
      const refs=[...changed.map(n=>n.ref),...stale.map(n=>n.ref)]
      const titles:string[]=[]
      for (const note of changed) {
        const old=previous.get(note.ref)?.title
        project(db,owner,note.ref)
        const next=(db.query('SELECT title FROM doc_index WHERE owner=? AND ref=?').get(owner,note.ref) as {title:string}|null)?.title
        if (old!==next) { if(old) titles.push(old); if(next) titles.push(next) }
      }
      for (const row of stale) { titles.push(row.title); removeProjection(db,owner,row.ref) }
      const touched = reconcileTouched(db,owner,affectedRefs(db,owner,refs,titles))
      markDocsChanged(db,owner,new Set([...refs,...touched,...drift]))
      const high = Math.max(0,...notes.map(n=>n.updated_at))
      db.query('INSERT INTO doc_scan_state(owner,watermark) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET watermark=excluded.watermark').run(owner,high)
    })
  }
}

export function startDocsRefresh(db:Database):()=>void {
  if (!timers.has(db)) {
    // 이 DB 가 열려 있는 동안만(닫으면 멈춰요, db-timers.ts). 실패는 기록하고 다음 틱에 다시
    timers.set(db,everyWhileOpen(db,60_000,()=>refreshChanged(db),'docs'))
  }
  return ()=>stopDocsRefresh(db)
}
export function stopDocsRefresh(db:Database):void {
  const stop = timers.get(db)
  if (stop) { stop(); timers.delete(db) }
}

export function getDocRecord(db:Database, owner:string, ref:string):DocRecord|null {
  const row = db.query(`SELECT i.*,n.md,n.text FROM doc_index i JOIN work_notes n ON n.owner=i.owner AND n.ref=i.ref WHERE i.owner=? AND i.ref=?`).get(owner,ref) as (Indexed & {owner:string;ref:string;md:string|null;text:string;version:number;person_edited:number;created_at:number})|null
  if (!row) return null
  const tags = db.query('SELECT tag,by FROM doc_tags WHERE owner=? AND ref=? ORDER BY tag').all(owner,ref) as {tag:string;by:TagBy}[]
  const edges = db.query('SELECT a,b,label FROM work_links WHERE owner=? AND (a=? OR b=?) ORDER BY created_at,id').all(owner,ref,ref) as {a:string;b:string;label:string|null}[]
  const h=hierarchy(db,owner,ref)
  return {owner,ref,kind:row.kind,title:row.title,area:row.area,status:row.status,source:row.source,tags,links:edges.map(e=>({ref:e.a===ref?e.b:e.a,label:e.label || '',direction:e.a===ref?'out':'in'})),md:row.md ?? row.text,version:row.version,personEdited:!!row.person_edited,props:docProps(db,owner,ref),due:row.due ?? null,createdAt:row.created_at,updatedAt:row.updated_at,...(h.parent ? {parent:h.parent,folders:h.folders} : {})}
}

/** 문서의 사용자 속성(키 순). 값은 JSON 으로 저장되어 있다 */
export function docProps(db:Database, owner:string, ref:string):DocProp[] {
  const rows = db.query('SELECT p.key,t.type,p.value FROM doc_props p JOIN doc_prop_types t ON t.owner=p.owner AND t.key=p.key WHERE p.owner=? AND p.ref=? ORDER BY p.key').all(owner,ref) as {key:string;type:PropType;value:string}[]
  return rows.map(r=>({key:r.key,type:r.type,value:JSON.parse(r.value)}))
}
