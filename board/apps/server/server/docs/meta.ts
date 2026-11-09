import type { Database } from 'bun:sqlite'
import { DocsError, type MetaInput } from '@direction-board/contracts/docs'
import { withDocsTx } from './storage.ts'
import { getDocRecord, refreshChanged, reindexRef, runActivity } from './index.ts'
import { conflictOf } from './document.ts'
import { isDate, isDateTime } from './props.ts'
import { isPilotDb, workspaceItem } from './scope.ts'
import { appendLog } from '../item-log.ts'

/** 보드 항목 읽기·쓰기. server.ts 의 OPS_DEPS(readItem·putItem: events·seq·/api/changes 에 남는 기존 경로)를 넘긴다 */
export type ItemStore = {
  readItem: (bid:string, iid:string) => { data: Record<string, unknown> } | null
  putItem: (bid:string, iid:string, data:Record<string, unknown>, actor:string) => void
}
type LogLine = { by:string; at:number; text:string }

const fieldNames: Record<string,string> = { title:'제목', area:'영역', status:'상태', due:'날짜' }

function title(value:unknown):string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value) || value.trim().length > 200) throw new DocsError(400,'title must be one line of 1-200 characters')
  return value.trim()
}

/** 기본 메타데이터 고치기. 원본(보드 항목·사건·독립 문서·대화 상태)을 바꾸고, 색인이 바뀐 메타데이터를 보고 version 을 올린다 */
export function updateDocMeta(db:Database, owner:string, input:MetaInput, by:'person'|'agent', items?:ItemStore):{ref:string;version:number} {
  if (!input || typeof input.ref !== 'string' || !input.ref) throw new DocsError(400,'Provide ref')
  const fields = (['title','area','status','due'] as const).filter(k => input[k] !== undefined)
  if (!fields.length) throw new DocsError(400,'Provide title, area, status or due')
  if (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)) throw new DocsError(400,'expectedVersion must be a non-negative integer')
  if (input.status !== undefined && input.status !== 'open' && input.status !== 'done') throw new DocsError(400,'status must be open or done')
  if (input.area !== undefined && input.area !== null && (typeof input.area !== 'string' || /[\r\n]/.test(input.area) || input.area.trim().length > 30)) throw new DocsError(400,'area must be a name up to 30 characters or null')
  if (input.due !== undefined && input.due !== null && (typeof input.due !== 'string' || !(isDate(input.due) || isDateTime(input.due)))) throw new DocsError(400,'due must be YYYY-MM-DD, YYYY-MM-DDTHH:MM or null')
  refreshChanged(db,owner)
  return withDocsTx(db,()=>{
    const doc = getDocRecord(db,owner,input.ref)
    if (!doc) throw new DocsError(404,'Document not found')
    if (doc.status === 'archived') throw new DocsError(400,'Archived documents cannot change metadata; restore the document first')
    if (input.expectedVersion !== undefined && input.expectedVersion !== doc.version) throw new DocsError(409,'Document changed; fetch the current version',conflictOf(doc.version,doc.md))
    const [prefix, ...parts] = input.ref.split(':')
    const now = Date.now()
    if (prefix === 'signal' || prefix === 'run') {
      // 사건은 제목과 상태, 대화는 상태만 고친다(대화 제목은 첫 질문이라 바꾸지 않는다)
      const allowed = prefix === 'signal' ? ['status','title'] : ['status']
      if (fields.some(f => !allowed.includes(f))) throw new DocsError(400, prefix === 'signal' ? 'Events can only change title and status' : 'Conversations can only change status')
      if (prefix === 'signal' && input.title !== undefined) {
        const next = title(input.title)
        // 사람이 고친 제목은 수집기·운영 순회가 같은 사건을 다시 보내도 덮지 않는다(signals.ts ingest)
        db.query("UPDATE signals SET title=?, meta=json_set(coalesce(meta,'{}'),'$.titleBy','person'), updated_at=? WHERE owner=? AND id=? AND title IS NOT ?").run(next, now, owner, parts[0], next)
      }
      if (input.status === undefined || doc.status === input.status) { /* 상태는 그대로: 원본을 건드리지 않는다 */ }
      else if (prefix === 'signal') {
        // 화면의 PATCH /api/signals/:id 와 같은 규칙
        db.query("UPDATE signals SET status=?, updated_at=?, resolved_at=? WHERE owner=? AND id=?").run(input.status === 'done' ? 'resolved' : 'open', now, input.status === 'done' ? now : null, owner, parts[0])
      } else {
        // 실행 기록(runs)은 건드리지 않는다. 문서 상태만 따로 남긴다
        // 지금 본 실행 기록(basis)과 함께 남긴다. 실행 기록이 바뀌면 다시 실행 상태를 따른다
        const {basis}=runActivity(db,owner,parts[0])
        db.query('INSERT INTO doc_status(owner,ref,status,basis,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner,ref) DO UPDATE SET status=excluded.status,basis=excluded.basis,updated_at=excluded.updated_at').run(owner,input.ref,input.status!,basis,now)
      }
    } else if (prefix === 'doc') {
      const sets:string[] = [], values:(string|number|null)[] = []
      if (input.title !== undefined) { sets.push('title=?'); values.push(title(input.title)) }
      if (input.area !== undefined) { sets.push('area=?'); values.push(input.area === null || !input.area.trim() ? null : input.area.trim()) }
      if (input.status !== undefined) { sets.push('done=?'); values.push(input.status === 'done' ? 1 : 0) }
      if (input.due !== undefined) { sets.push('due=?'); values.push(input.due) }
      const before = db.query('SELECT title,area,done,due FROM docs WHERE owner=? AND id=?').get(owner,parts[0]) as Record<string,unknown>|null
      if (!before) throw new DocsError(404,'Document not found')
      db.query(`UPDATE docs SET ${sets.join(',')} WHERE owner=? AND id=?`).run(...values,owner,parts[0])
      const after = db.query('SELECT title,area,done,due FROM docs WHERE owner=? AND id=?').get(owner,parts[0])
      if (JSON.stringify(before) !== JSON.stringify(after)) db.query('UPDATE docs SET updated_at=? WHERE owner=? AND id=?').run(now,owner,parts[0])
    } else if (prefix === 'item') {
      if (!items) throw new DocsError(500,'Board item writer unavailable')
      const [bid, iid] = parts
      const board = db.query('SELECT kind,owner,meta,deleted FROM boards WHERE id=?').get(bid) as {kind:string;owner:string|null;meta:string;deleted:number}|null
      // 사람 범위는 자기 개인 판 항목, 워크스페이스 범위(파일럿, scope.ts)는 회사 판의 그 공간 항목
      if (!board || board.deleted || (board.kind === 'company' ? !workspaceItem(db,owner,bid,iid) : board.owner !== owner)) throw new DocsError(404,'Document not found')
      const prev = items.readItem(bid,iid)?.data
      if (!prev) throw new DocsError(404,'Document not found')
      const data: Record<string, unknown> = {...prev}
      const goal = data.type === 'goal'
      if (input.title !== undefined) {
        const rest = String(prev.text ?? '').split('\n').slice(1)
        data.text = [title(input.title), ...rest].join('\n')
      }
      if (input.area !== undefined) {
        if (input.area === null || !input.area.trim()) delete data.area
        else {
          const areas = (JSON.parse(board.meta || '{}').areas || []) as {id:string;name:string}[]
          const found = areas.find(a => a.name.toLowerCase() === input.area!.trim().toLowerCase())
          if (!found) throw new DocsError(400,`Unknown area; choose one of: ${areas.map(a=>a.name).join(', ') || '(none)'}`)
          data.area = found.id
        }
      }
      if (input.status !== undefined) data.done = input.status === 'done'
      if (input.due !== undefined) {
        if (goal) {
          if (input.due !== null && !isDate(input.due)) throw new DocsError(400,'Goal due must be YYYY-MM-DD')
          data.due = input.due
        } else if (input.due === null) delete data.remindAt
        else data.remindAt = input.due
      }
      const changed = fields.filter(f => {
        if (f === 'title') return data.text !== prev.text
        if (f === 'area') return data.area !== prev.area
        if (f === 'status') return !!data.done !== !!prev.done
        return goal ? (data.due ?? null) !== (prev.due ?? null) : (data.remindAt ?? null) !== (prev.remindAt ?? null)
      })
      if (changed.length) {
        const actor = by === 'agent' ? 'agent' : owner
        const log = Array.isArray(prev.log) ? prev.log as LogLine[] : []
        // 공통 기록 정책(item-log.ts): 파일럿에서 사람 기록이 한도면 메타 변경 전체를 받지 않아요(409). 개인 방향판은 상한 없음. AI 기록은 언제나 남아요
        const next = appendLog(log, {by:actor, at:now, text:`${by === 'agent' ? 'AI가 ' : ''}${changed.map(f=>fieldNames[f]).join('·')} 고침`}, isPilotDb(db) ? { humanLimit: true } : undefined)
        if (!Array.isArray(next)) throw new DocsError(next.status,next.error)
        data.log = next
        items.putItem(bid,iid,data,actor)
      }
    } else throw new DocsError(400,'This document has no editable metadata')
    reindexRef(db,owner,input.ref)
    const version = (db.query('SELECT version FROM work_notes WHERE owner=? AND ref=?').get(owner,input.ref) as {version:number}).version
    return {ref:input.ref,version}
  })
}
