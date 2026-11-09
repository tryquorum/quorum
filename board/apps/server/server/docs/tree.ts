import type { Database } from 'bun:sqlite'
import { DocsError, type MoveInput } from '@direction-board/contracts/docs'
import { withDocsTx } from './storage.ts'
import { reindexRef } from './index.ts'

type Node = {id:string;title:string;parent_id:string|null;archived:number;archived_with:string|null}

function idOf(ref:unknown):string {
  if(typeof ref!=='string' || !/^doc:[^:]+$/.test(ref)) throw new DocsError(400,'Provide a standalone document ref')
  return ref.slice(4)
}
function node(db:Database,owner:string,id:string):Node {
  const row=db.query('SELECT id,title,parent_id,archived,archived_with FROM docs WHERE owner=? AND id=?').get(owner,id) as Node|null
  if(!row) throw new DocsError(404,'Document not found')
  return row
}
export function ancestors(db:Database,owner:string,id:string):Node[] {
  const result:Node[]=[]; const seen=new Set<string>()
  let current:string|null=id
  while(current!==null) {
    if(seen.has(current) || seen.size>=9) throw new DocsError(409,'Invalid document hierarchy')
    seen.add(current); const row=node(db,owner,current); result.unshift(row); current=row.parent_id
  }
  return result
}
export function subtree(db:Database,owner:string,id:string):{id:string;depth:number}[] {
  return db.query(`WITH RECURSIVE tree(id,depth) AS (SELECT id,1 FROM docs WHERE owner=? AND id=? UNION ALL SELECT d.id,t.depth+1 FROM docs d JOIN tree t ON d.parent_id=t.id WHERE d.owner=? AND t.depth<9) SELECT id,depth FROM tree`).all(owner,id,owner) as {id:string;depth:number}[]
}
export function parentId(db:Database,owner:string,parent:unknown):string|null {
  if(parent===null) return null
  const id=idOf(parent), row=node(db,owner,id)
  if(row.archived) throw new DocsError(400,'Archived document cannot be a parent')
  return id
}
function siblings(db:Database,owner:string,parent:string|null):Node[] {
  return db.query('SELECT id,title,parent_id,archived,archived_with FROM docs WHERE owner=? AND parent_id IS ? ORDER BY position IS NULL,position,title,id').all(owner,parent) as Node[]
}
function order(db:Database,owner:string,rows:Node[]):void {
  const update=db.query('UPDATE docs SET position=? WHERE owner=? AND id=?')
  rows.forEach((row,i)=>update.run(i,owner,row.id))
}
export function appendPosition(db:Database,owner:string,parent:string|null):number {
  const rows=siblings(db,owner,parent); order(db,owner,rows); return rows.length
}
export function validateCreateParent(db:Database,owner:string,parent:unknown):string|null {
  const id=parentId(db,owner,parent)
  if(id && ancestors(db,owner,id).length>=8) throw new DocsError(409,'Document hierarchy cannot exceed 8 levels')
  return id
}
export function moveDocument(db:Database,owner:string,input:MoveInput):{ref:string;parent:string|null} {
  return withDocsTx(db,()=>{
    const id=idOf(input.ref), target=node(db,owner,id)
    if(target.archived) throw new DocsError(400,'Archived document cannot be moved')
    if(input.before!==undefined && input.after!==undefined) throw new DocsError(400,'Choose before or after')
    const parent=parentId(db,owner,input.parent)
    const chain=parent ? ancestors(db,owner,parent) : []
    const branch=subtree(db,owner,id)
    if(chain.some(n=>n.id===id)) throw new DocsError(409,'Document hierarchy cannot contain a cycle')
    if(chain.length+Math.max(...branch.map(n=>n.depth))>8) throw new DocsError(409,'Document hierarchy cannot exceed 8 levels')
    const anchor=input.before ?? input.after
    const anchorId=anchor===undefined ? null : idOf(anchor)
    if(anchorId===id) throw new DocsError(400,'Cannot position a document relative to itself')
    const old=siblings(db,owner,target.parent_id), dest=target.parent_id===parent ? old : siblings(db,owner,parent)
    if(anchorId && !dest.some(n=>n.id===anchorId && !n.archived)) throw new DocsError(400,'Position must reference a live sibling')
    order(db,owner,old)
    if(dest!==old) order(db,owner,dest)
    const remaining=dest.filter(n=>n.id!==id)
    const at=anchorId ? remaining.findIndex(n=>n.id===anchorId)+(input.after ? 1 : 0) : remaining.length
    remaining.splice(at,0,{...target,parent_id:parent})
    db.query('UPDATE docs SET parent_id=? WHERE owner=? AND id=?').run(parent,owner,id)
    if(dest!==old) order(db,owner,old.filter(n=>n.id!==id))
    order(db,owner,remaining)
    const allowed=new Set([...chain.map(n=>`doc:${n.id}`),`doc:${id}`])
    for(const item of branch) {
      const row=node(db,owner,item.id)
      if(row.archived_with && !allowed.has(row.archived_with) && !branch.some(n=>`doc:${n.id}`===row.archived_with)) db.query('UPDATE docs SET archived_with=NULL WHERE owner=? AND id=?').run(owner,item.id)
      reindexRef(db,owner,`doc:${item.id}`)
    }
    return {ref:input.ref,parent:parent ? `doc:${parent}` : null}
  })
}
export function archiveDocument(db:Database,owner:string,ref:string,archived:boolean):{ref:string;status:'open'|'done'|'archived'} {
  return withDocsTx(db,()=>{
    const id=idOf(ref), target=node(db,owner,id)
    if(!!target.archived!==archived) {
      const branch=subtree(db,owner,id)
      if(!archived && target.parent_id && node(db,owner,target.parent_id).archived) {
        const position=appendPosition(db,owner,null)
        db.query('UPDATE docs SET parent_id=NULL,position=? WHERE owner=? AND id=?').run(position,owner,id)
        order(db,owner,siblings(db,owner,target.parent_id))
      }
      db.query('UPDATE docs SET archived=?,archived_with=NULL,updated_at=? WHERE owner=? AND id=?').run(archived?1:0,Date.now(),owner,id)
      for(const item of branch.slice(1)) {
        if(archived) db.query('UPDATE docs SET archived=1,archived_with=?,updated_at=? WHERE owner=? AND id=? AND archived=0 AND archived_with IS NULL').run(ref,Date.now(),owner,item.id)
        else db.query('UPDATE docs SET archived=0,archived_with=NULL,updated_at=? WHERE owner=? AND id=? AND archived_with=?').run(Date.now(),owner,item.id,ref)
      }
      for(const item of branch) reindexRef(db,owner,`doc:${item.id}`)
    }
    const status=(db.query('SELECT status FROM doc_index WHERE owner=? AND ref=?').get(owner,ref) as {status:'open'|'done'|'archived'}|null)?.status ?? (archived?'archived':'open')
    return {ref,status}
  })
}
