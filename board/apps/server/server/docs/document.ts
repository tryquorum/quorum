import type { Database } from 'bun:sqlite'
import { DocsError, type DocsConflict, type WriteInput, type WriteResult } from '@direction-board/contracts/docs'
import { noteMarkdown, withDocsTx } from './storage.ts'
import { reindexRef } from './index.ts'
import { mdToNoteHtml } from '../notes.ts'
import { appendComposes } from './append-safe.ts'

type Actor = 'person'|'agent'
/** work_notes.by 는 예전부터 사람 저장을 'human' 으로 남겨 왔다. 칸 값을 섞지 않게 그대로 쓴다 */
export const noteAuthor = (by:Actor):'human'|'agent' => by==='person' ? 'human' : 'agent'
type Note = {html:string;text:string;md:string|null;version:number;person_edited:number;by:string|null;updated_at:number}
export function conflictOf(version:number,md:string):DocsConflict { return {version,md:md.slice(0,8000),truncated:md.length>8000} }
/** 본문에 제안이 한 단위로 남아 있는가: 앞은 본문 시작이나 빈 줄, 뒤는 본문 끝이나 다음 'AI 제안' */
function hasProposalUnit(original:string,proposal:string):boolean {
  for (let at=original.indexOf(proposal); at>=0; at=original.indexOf(proposal,at+1)) {
    const rest=original.slice(at+proposal.length)
    if ((at===0 || original.slice(0,at).endsWith('\n\n')) && (rest==='' || rest.startsWith('\n\n## AI 제안\n\n'))) return true
  }
  return false
}
/**
 * 쓰기 전에 이 문서의 색인을 원본과 맞춘다. 보드에서 제목·상태 등이 바뀌었으면 여기서 version 이 오르므로
 * 그 전에 읽은 expectedVersion 은 409 가 된다(메타데이터 변경을 덮지 않음). 노트가 없으면 할 일 없음
 */
function syncIndex(db:Database,owner:string,ref:string):void {
  if (db.query('SELECT 1 FROM work_notes WHERE owner=? AND ref=?').get(owner,ref)) reindexRef(db,owner,ref)
}
function note(db:Database,owner:string,ref:string):Note|null {
  return db.query('SELECT html,text,md,version,person_edited,by,updated_at FROM work_notes WHERE owner=? AND ref=?').get(owner,ref) as Note|null
}
function checkedVersion(row:Note|null,expected:number|undefined):void {
  if (expected!==undefined && (!Number.isInteger(expected) || expected<0)) throw new DocsError(400,'expectedVersion must be a non-negative integer')
  if (expected!==undefined && expected!==(row?.version ?? 0)) throw new DocsError(409,'Document changed; fetch the current version',conflictOf(row?.version ?? 0,row?.md ?? row?.text ?? ''))
}
/**
 * 노트 전체 저장. agent 가 사람이 고친 노트를 통째로 바꾸려 하면 원본을 그대로 두고 '## AI 제안' 으로 덧붙인다
 * (docs write 와 같은 보호). writeDocument 는 제안을 스스로 만들어 넘기므로 composed 로 이 변환을 건너뛴다.
 */
export function putNote(db:Database,owner:string,ref:string,input:{html:string;text:string;md?:string;expectedVersion?:number},by:Actor,opts:{composed?:boolean}={}):{version:number;updatedAt:number;suggested?:boolean} {
  if (typeof input.html!=='string' || typeof input.text!=='string' || (input.md!==undefined && typeof input.md!=='string')) throw new DocsError(400,'Provide html, text and optional markdown strings')
  return withDocsTx(db,()=>{
    syncIndex(db,owner,ref)
    const row=note(db,owner,ref); checkedVersion(row,input.expectedVersion)
    let md=input.md ?? noteMarkdown(db,input.html,input.text), html=input.html, text=input.text, suggested=false
    if (by==='agent' && row?.person_edited && !opts.composed) {
      const original=row.md ?? row.text
      if (md===original) return {version:row.version,updatedAt:row.updated_at}
      const proposal=`## AI 제안\n\n${md}`
      // 제안 경계를 본문 제목으로 추론하지 않는다. 덧붙인 제안의 해시를 따로 기록해 두고(doc_suggestions),
      // 기록이 있고 그 제안이 본문에 한 단위로 그대로 남아 있을 때만 재전송으로 본다.
      // 사람이 고쳤거나 지운 제안, 접두·부분·제목을 품은 다른 제안은 새 제안으로 덧붙인다(잃는 것보다 겹치는 쪽)
      const hash=new Bun.CryptoHasher('sha256').update(md).digest('hex')
      if (db.query('SELECT 1 FROM doc_suggestions WHERE owner=? AND ref=? AND hash=?').get(owner,ref,hash) && hasProposalUnit(original,proposal)) return {version:row.version,updatedAt:row.updated_at,suggested:true}
      db.query('INSERT OR IGNORE INTO doc_suggestions VALUES (?,?,?)').run(owner,ref,hash)
      md=`${original}${original?'\n\n':''}${proposal}`; text=md; html=`${row.html}${row.html?'<hr>':''}${mdToNoteHtml(proposal)}`; suggested=true
    }
    if (md.length>200000) throw new DocsError(413,'Markdown must be at most 200000 characters')
    if (row && row.html===html && row.text===text && (row.md ?? row.text)===md && (by!=='person' || row.person_edited)) return {version:row.version,updatedAt:row.updated_at}
    const now=Date.now(), version=(row?.version ?? 0)+1
    db.query(`INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,version,created_at,person_edited) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner,ref) DO UPDATE SET html=excluded.html,text=excluded.text,by=excluded.by,updated_at=excluded.updated_at,md=excluded.md,version=excluded.version,person_edited=MAX(work_notes.person_edited,excluded.person_edited)`)
      .run(owner,ref,html,text,noteAuthor(by),now,md,version,now,by==='person'?1:0)
    reindexRef(db,owner,ref)
    const saved=(db.query('SELECT version FROM work_notes WHERE owner=? AND ref=?').get(owner,ref) as {version:number}).version
    return {version:saved,updatedAt:now,...(suggested?{suggested:true}:{})}
  })
}

export type Heading = {level:number;title:string;path:string;start:number;body:number;end:number}
export function headings(md:string):Heading[] {
  const result:Heading[]=[], stack:Heading[]=[]; let pos=0; let fence:{char:string;size:number}|null=null
  for (const line of md.match(/[^\n]*(?:\n|$)/g) || []) {
    if (!line) continue
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) { if (!fence) fence={char:marker[1][0],size:marker[1].length}; else if (fence.char===marker[1][0] && marker[1].length>=fence.size) fence=null }
    else if (!fence) {
      const m=line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/)
      if (m) {
        const level=m[1].length
        while (stack.length && stack[stack.length-1].level>=level) stack.pop()!.end=pos
        const h={level,title:m[2].trim(),path:[...stack.map(x=>x.title),m[2].trim()].join('/'),start:pos,body:pos+line.length,end:md.length}
        stack.push(h); result.push(h)
      }
    }
    pos+=line.length
  }
  return result
}
function replaceUnique(value:string,oldStr:string,newStr:string):{value:string;warning?:string;changed:boolean} {
  if (!oldStr) return {value,warning:'no_match',changed:false}
  const at=value.indexOf(oldStr)
  if (at<0) return {value,warning:'no_match',changed:false}
  if (value.indexOf(oldStr,at+oldStr.length)>=0) return {value,warning:'ambiguous',changed:false}
  const next=value.slice(0,at)+newStr+value.slice(at+oldStr.length)
  return {value:next,changed:next!==value}
}
export function writeDocument(db:Database,owner:string,input:WriteInput,by:Actor):WriteResult {
  if (!input || typeof input.ref!=='string' || !['append','replace','patch'].includes(input.mode)) throw new DocsError(400,'Provide ref and a valid write mode')
  if (input.mode!=='append' && input.expectedVersion===undefined) throw new DocsError(400,'expectedVersion is required for replace and patch')
  if (input.mode==='patch' ? !Array.isArray(input.edits) : typeof input.md!=='string') throw new DocsError(400,'Provide markdown or patch edits')
  if (input.onceKey!==undefined && (typeof input.onceKey!=='string' || !input.onceKey || input.onceKey.length>200)) throw new DocsError(400,'onceKey must be a string of 1-200 characters')
  // onceKey: 같은 (owner, ref, 키) 는 한 번만 적용해요. 기록은 노트 쓰기와 같은 트랜잭션, 다시 오면 버전 검사보다 먼저 duplicate.
  // idempotencyKey(같은 요청 영수증, doc_idempotency)와 섞이지 않게 따로 doc_once 표에 둬요
  const once=input.onceKey || null
  const hash=new Bun.CryptoHasher('sha256').update(JSON.stringify([by,input])).digest('hex')
  return withDocsTx(db,()=>{
    if (input.idempotencyKey) {
      const saved=db.query('SELECT payload_hash,result_json FROM doc_idempotency WHERE owner=? AND ref=? AND key=?').get(owner,input.ref,input.idempotencyKey) as {payload_hash:string;result_json:string}|null
      if (saved) { if (saved.payload_hash!==hash) throw new DocsError(400,'Use a new idempotency key for a different payload'); return JSON.parse(saved.result_json) as WriteResult }
    }
    syncIndex(db,owner,input.ref)
    const row=note(db,owner,input.ref)
    if (!row || !db.query('SELECT 1 FROM doc_index WHERE owner=? AND ref=?').get(owner,input.ref)) throw new DocsError(404,'Document not found')
    if (once && db.query('SELECT 1 FROM doc_once WHERE owner=? AND ref=? AND key=?').get(owner,input.ref,once)) return {ref:input.ref,version:row.version,applied:0,warnings:['duplicate'],duplicate:true}
    checkedVersion(row,input.expectedVersion)
    const original=row.md ?? row.text; let md=original, applied=0; const warnings:string[]=[]
    // append 는 HTML 에 <hr> 로 나눠 붙여요. onceKey 를 보낸 호출(iOS 노트에 넣기·초안 넣기)만 md 에도 같은 가로줄(---)을 둬서
    // 두 표현이 같은 구조로 남게 해요(markdownEditable 유지). 그때 저장 md 는 원본 md 전체로 시작해요(끝 개행이 2개보다 적을 때만 모자란 만큼 더함, 리뷰 11).
    // 키가 없는 기존 호출(REST·MCP·운영 순회·같은 제목 문서)은 예전 그대로(A\n\nB)
    const hr=!!once
    const sep=hr ? !!original.trim() || !!row.html : !!row.html
    const tail=(original.match(/(?:\r?\n)*$/)?.[0] ?? '').split('\n').length-1
    if (input.mode==='append') {
      const add=input.md!
      // 키가 없을 때만 본문 포함으로 같은 글을 막아요(키가 있으면 키가 판정)
      if (add && !once && original.includes(add)) warnings.push('duplicate')
      else if (add) {md=hr ? (sep ? `${original}${'\n'.repeat(Math.max(0,2-tail))}---\n\n${add}` : original+add) : (original ? `${original}\n\n${add}` : add); applied=1}
    } else if (input.mode==='replace') { md=input.md!; if(md!==original) applied=1 }
    else for (const edit of input.edits!) {
      if ('oldStr' in edit) {
        if (typeof edit.oldStr!=='string' || typeof edit.newStr!=='string') throw new DocsError(400,'Provide patch strings')
        const r=replaceUnique(md,edit.oldStr,edit.newStr); md=r.value; if(r.warning) warnings.push(r.warning); if(r.changed) applied++
      } else {
        if (typeof edit.md!=='string' || !['append','replace'].includes(edit.op)) throw new DocsError(400,'Provide a valid heading edit')
        if (!edit.heading) {const next=edit.op==='append' ? `${md}${md?'\n\n':''}${edit.md}` : edit.md; if(next!==md){md=next; applied++}; continue}
        const matches=headings(md).filter(h=>h.path===edit.heading)
        if (matches.length!==1) {warnings.push(matches.length?'ambiguous':'no_match'); continue}
        const h=matches[0]; const body=md.slice(h.body,h.end)
        const replacement=edit.op==='append' ? `${body.replace(/\n*$/,'')}\n\n${edit.md}\n` : `${edit.md}\n`
        const next=md.slice(0,h.body)+replacement+md.slice(h.end)
        if (next!==md){md=next;applied++}
      }
    }
    let suggested=false; let html=row.html; let text=md
    if (applied && by==='agent' && row.person_edited && input.mode!=='append') {
      const proposal=`## AI 제안\n\n${md}`
      md=`${original}${original?'\n\n':''}${proposal}`; text=md; html=`${row.html}<hr>${mdToNoteHtml(proposal)}`; suggested=true
    } else if (applied && input.mode==='append') html=`${row.html}${sep?'<hr>':''}${mdToNoteHtml(input.md!)}`
    else if (applied) html=mdToNoteHtml(md)
    if (md.length>200000) throw new DocsError(413,'Markdown must be at most 200000 characters')
    // onceKey append 는 쓰기 직전 최종 판정(리뷰 13 합성성, append-safe.ts): 기존 md 문맥이 경계에서 닫혀 있고 기존 HTML·md 렌더가 엄격 노트 모델 안일 때만(빈 노트 분기도 — 공백뿐인 md 가 새 글을 코드 블록으로 만들 수 있어요, 리뷰 14)
    if (applied && hr && input.mode==='append' && !suggested && !appendComposes({mdBefore:original,mdAfter:md,htmlBefore:row.html,base:(s)=>Bun.markdown.html(s),render:mdToNoteHtml})) throw new DocsError(422,'unsafe-append: 노트 끝이 닫히지 않은 블록이라 붙이지 않았어요. 웹에서 닫은 뒤 다시 넣어 주세요')
    const result:WriteResult={ref:input.ref,version:row.version,applied,warnings,...(suggested?{suggested:true}:{})}
    if (applied) result.version=putNote(db,owner,input.ref,{html,text,md,expectedVersion:row.version},by,{composed:true}).version
    if (input.idempotencyKey) db.query('INSERT INTO doc_idempotency VALUES (?,?,?,?,?)').run(owner,input.ref,input.idempotencyKey,hash,JSON.stringify(result))
    if (once) db.query('INSERT INTO doc_once(owner,ref,key,result_json,created_at) VALUES (?,?,?,?,?)').run(owner,input.ref,once,JSON.stringify(result),Date.now())
    return result
  })
}
