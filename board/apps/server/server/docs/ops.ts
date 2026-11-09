import type { Database } from 'bun:sqlite'
import { DocsError, type CreateInput, type DocsOps, type NoteSource } from '@direction-board/contracts/docs'
import { strictHtmlToMarkdown, withDocsTx } from './storage.ts'
import { getDocRecord, ownedLiveRef, refreshChanged, reindexRef } from './index.ts'
import { normalizeTag } from './relations.ts'
import { noteAuthor, putNote, writeDocument } from './document.ts'
import { searchDocs, fetchDoc, relatedDocs, docsSchema } from './search.ts'
import { setDocProps } from './props.ts'
import { updateDocMeta, type ItemStore } from './meta.ts'
import { mdToNoteHtml } from '../notes.ts'
import { noteModel } from './note-model.ts'
import { normTitle } from '../dedup.ts'
import { appendPosition, archiveDocument, moveDocument, validateCreateParent } from './tree.ts'
import { scopeOf, searchScope } from './scope.ts'

/** 클라이언트가 정하는 문서 id: 소문자 UUID */
const CLIENT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** 같은 요청인지 가르는 해시. 태그는 저장 때처럼 정규화해 순서·중복과 상관없이 같게 본다 */
function createRequestHash(input:CreateInput):string {
  const tags=[...new Set((input.tags || []).map(normalizeTag).filter(Boolean))].sort()
  const links=[...new Set(input.links || [])].sort()
  const parts:unknown[]=[input.title.trim(),input.md,input.area ?? null,tags,links]
  if(input.parent!==undefined) parts.push(input.parent)
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(parts)).digest('hex')
}

/**
 * 문서 만들기. 같은 정규화 제목의 문서에 덧붙이는 규칙(mergeTitle)은 /api/act 의 doc 에만 쓴다.
 * 사람이 REST 로 만들 때는 같은 제목이어도 새 문서다.
 */
export function createDocument(db:Database,owner:string,input:CreateInput,by:'person'|'agent',opts:{mergeTitle:boolean}):{ref:string;version:number;existing?:boolean} {
  if(typeof input.title!=='string' || !input.title.trim() || typeof input.md!=='string') throw new DocsError(400,'Provide title and markdown')
  if(input.md.length>200000) throw new DocsError(413,'Markdown must be at most 200000 characters')
  if(input.id!==undefined && (typeof input.id!=='string' || !CLIENT_ID.test(input.id))) throw new DocsError(400,'id must be a lowercase UUID')
  return withDocsTx(db,()=>{
    // 클라이언트 id: 같은 요청이면 처음 결과, 다른 요청이면 409. write 의 idempotencyKey 와 다른 표를 쓴다
    const requestHash=input.id ? createRequestHash(input) : ''
    if(input.id) {
      const saved=db.query('SELECT payload_hash,result_json FROM doc_create_requests WHERE owner=? AND id=?').get(owner,input.id) as {payload_hash:string;result_json:string}|null
      if(saved) {
        if(saved.payload_hash!==requestHash) throw new DocsError(409,'id already used by a different create request; use a new id')
        return {...JSON.parse(saved.result_json) as {ref:string;version:number},existing:true}
      }
      if(db.query('SELECT 1 FROM docs WHERE owner=? AND id=?').get(owner,input.id)) throw new DocsError(409,'A document with this id already exists; use a new id')
    }
    const parent=input.parent===undefined ? null : validateCreateParent(db,owner,input.parent)
    const normalized=normTitle(input.title)
    const docs=opts.mergeTitle && !input.id && normalized.length>=4 ? (input.parent===undefined ? db.query('SELECT id,title FROM docs WHERE owner=? AND archived=0').all(owner) : db.query('SELECT id,title FROM docs WHERE owner=? AND archived=0 AND parent_id IS ?').all(owner,parent)) as {id:string;title:string}[] : []
    const existing=docs.find(d=>normTitle(d.title)===normalized)
    const ref=existing ? `doc:${existing.id}` : `doc:${input.id ?? crypto.randomUUID()}`
    let version=1
    if(existing) version=writeDocument(db,owner,{ref,mode:'append',md:input.md},by).version
    else {
      const now=Date.now()
      const position=appendPosition(db,owner,parent)
      db.query('INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived,parent_id,position) VALUES (?,?,?,?,?,?,0,?,?)').run(owner,ref.slice(4),input.title.trim(),input.area ?? null,now,now,parent,position)
      db.query('INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,version,created_at,person_edited) VALUES (?,?,?,?,?,?,?,1,?,?)').run(owner,ref,mdToNoteHtml(input.md),input.md,noteAuthor(by),now,input.md,now,by==='person'?1:0)
    }
    const now=Date.now()
    for(const raw of input.tags || []) {const tag=normalizeTag(raw); if(tag) db.query('INSERT OR IGNORE INTO doc_tag_sources VALUES (?,?,?,?,?)').run(owner,ref,tag,by,now)}
    for(const target of new Set(input.links || [])) {
      if(!getDocRecord(db,owner,target)) throw new DocsError(400,'Link target must be an owned document')
      if (!db.query("SELECT 1 FROM work_links WHERE owner=? AND a=? AND b=? AND label='관련' AND by=?").get(owner,ref,target,by)) db.query("INSERT INTO work_links VALUES (?,?,?,?, '관련',?,?)").run(crypto.randomUUID(),owner,ref,target,by,now)
    }
    reindexRef(db,owner,ref)
    if(input.id) db.query('INSERT INTO doc_create_requests(owner,id,payload_hash,result_json,created_at) VALUES (?,?,?,?,?)').run(owner,input.id,requestHash,JSON.stringify({ref,version}),Date.now())
    return {ref,version,...(existing?{existing:true}:{})}
  })
}

/** 편집기 원문. 색인에 있는 문서면 보관(원본이 사라진 노트)이어도 준다 */
export function noteSource(db:Database,owner:string,ref:string,onceKey?:string):NoteSource {
  refreshChanged(db,owner)
  if(!db.query('SELECT 1 FROM doc_index WHERE owner=? AND ref=?').get(owner,ref)) throw new DocsError(404,'Document not found')
  const row=db.query('SELECT html,text,md,version,person_edited FROM work_notes WHERE owner=? AND ref=?').get(owner,ref) as {html:string;text:string;md:string|null;version:number;person_edited:number}|null
  if(!row) throw new DocsError(404,'Document not found')
  const md=row.md ?? row.text
  // onceKey: 이 서버가 docs write 의 onceKey 를 지킨다는 표시. 앱은 이것이 있을 때만 결과 불명 뒤 같은 키로 자동 재전송해요
  // onceApplied: 물은 키가 이 노트에 이미 적용됐는지(doc_once). 앱의 복구는 다시 쓰지 않고 이것으로 확인만 해요(PR #39 리뷰 9)
  const once=onceKey ? {onceApplied:!!db.query('SELECT 1 FROM doc_once WHERE owner=? AND ref=? AND key=?').get(owner,ref,onceKey)} : {}
  return {ref,html:row.html,md,version:row.version,personEdited:!!row.person_edited,markdownEditable:markdownEditable(db,row.html,md),onceKey:true,...once}
}

/**
 * iOS 가 이 노트를 마크다운으로 고쳐도 사람이 쓴 웹 서식을 잃지 않는지(서버가 md 로 html 을 다시 만들어요).
 * 빈 html 이거나, 엄격 변환이 성공하고(손실 위험 구조면 던짐) 그 결과가 저장된 md 와 정규형이 같고 다시 만들어도 같은 md 일 때만 true.
 * 엄격 변환기가 꽂혀 있지 않으면 닫힌 쪽(false)이에요. 설계: docs/internals/mobile-ia.md "노트 편집"
 */
function markdownEditable(db:Database,html:string,md:string):boolean {
  if(!html.trim()) return true
  const strict=strictHtmlToMarkdown(db)
  if(!strict) return false
  try {
    const fromHtml=strict(html)
    const canon=(value:string)=>strict(mdToNoteHtml(value))
    if(canon(md)!==fromHtml || canon(fromHtml)!==fromHtml) return false
    // 엄격 변환기가 조용히 버린 서식(낱말 안 굵게, span 스타일 등)이 없는지: 원래 html 과 다시 만든 html 의 서식 모델이 같아야 해요
    const model=noteModel(html)
    return model!==null && model===noteModel(mdToNoteHtml(fromHtml))
  } catch { return false }
}

export type NotePut = {html:string;text:string;md?:string;expectedVersion?:number}
/** REST 의 PUT /api/docs/:ref/note. 일 노트 PUT 과 같은 규칙(expectedVersion·0·409·사람 글 보호). 색인에 있거나 내가 가진 살아 있는 원본만 */
export function putDocNote(db:Database,owner:string,ref:string,input:NotePut,by:'person'|'agent'):{ok:true;updated_at:number;version:number;suggested?:true} {
  refreshChanged(db,owner)
  if(!db.query('SELECT 1 FROM doc_index WHERE owner=? AND ref=?').get(owner,ref) && !ownedLiveRef(db,owner,ref)) throw new DocsError(404,'Document not found')
  const saved=putNote(db,owner,ref,input,by)
  return {ok:true,updated_at:saved.updatedAt,version:saved.version,...(saved.suggested?{suggested:true as const}:{})}
}

export type DocsServerOps = DocsOps & { putNote(owner:string,ref:string,input:NotePut,by:'person'|'agent'):ReturnType<typeof putDocNote> }

export function createDocsOps(db:Database,deps:{act:(owner:string,actions:Record<string,unknown>[])=>{results:{ok:boolean;do:string;ref?:string;error?:string;existing?:boolean}[]};items?:ItemStore}):DocsServerOps {
  // 일 하나를 다루는 길은 그 ref 의 문서 범위로(파일럿 회사 공간 일은 워크스페이스 범위), 검색은 space 로 고른 범위로 가요(scope.ts)
  const at=(owner:string,ref:unknown)=>scopeOf(db,owner,ref)
  return {
    search:(owner,input)=>searchDocs(db,searchScope(db,owner,input?.space),input), fetch:(owner,input)=>fetchDoc(db,at(owner,input?.ref),input),
    related:(owner,input)=>relatedDocs(db,at(owner,input?.ref),input), schema:owner=>docsSchema(db,owner),
    create:(owner,input,by)=>createDocument(db,owner,input,by,{mergeTitle:false}),
    write:(owner,input,by)=>writeDocument(db,at(owner,input?.ref),input,by),
    meta:(owner,input,by)=>updateDocMeta(db,at(owner,input?.ref),input,by,deps.items),
    props:(owner,input,by)=>setDocProps(db,at(owner,input?.ref),input,by),
    move:(owner,input)=>moveDocument(db,owner,input),
    note:(owner,ref,onceKey)=>noteSource(db,at(owner,ref),ref,onceKey),
    putNote:(owner,ref,input,by)=>putDocNote(db,at(owner,ref),ref,input,by),
    tag(person,ref,change,by) {
      const owner=at(person,ref)
      return withDocsTx(db,()=>{
        if(!getDocRecord(db,owner,ref)) throw new DocsError(404,'Document not found')
        for(const raw of change.remove || []) {const tag=normalizeTag(raw); if(tag) db.query('DELETE FROM doc_tag_sources WHERE owner=? AND ref=? AND tag=? AND by=?').run(owner,ref,tag,by)}
        for(const raw of change.add || []) {const tag=normalizeTag(raw); if(tag) db.query('INSERT OR IGNORE INTO doc_tag_sources VALUES (?,?,?,?,?)').run(owner,ref,tag,by,Date.now())}
        reindexRef(db,owner,ref)
        const tags=(db.query('SELECT tag FROM doc_tags WHERE owner=? AND ref=? ORDER BY tag').all(owner,ref) as {tag:string}[]).map(t=>t.tag)
        return {ref,tags}
      })
    },
    archive:(owner,ref,archived)=>archiveDocument(db,at(owner,ref),ref,archived),
    act(owner,actions) {if(!Array.isArray(actions)) throw new DocsError(400,'Provide an actions array'); return deps.act(owner,actions.slice(0,30))}
  }
}
