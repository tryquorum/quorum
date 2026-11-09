import { expect, test } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi } from './api.ts'
import { refreshChanged } from './index.ts'

test('hierarchy rejects cycles and excessive stored depth and rolls back creates', () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'root',md:''},'person').ref
  let leaf=root
  for(let i=0;i<7;i++) leaf=ops.create('a',{title:`child ${i}`,md:'',parent:leaf},'person').ref
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  expect(()=>ops.create('a',{id,title:'too deep',md:'',parent:leaf,tags:['test'],links:[root]},'person')).toThrow(expect.objectContaining({status:409}))
  expect(db.query("SELECT count(*) AS n FROM docs WHERE owner='a'").get()).toEqual({n:8})
  expect(db.query('SELECT 1 FROM doc_create_requests WHERE owner=? AND id=?').get('a',id)).toBeNull()
  expect(db.query('SELECT 1 FROM doc_tag_sources WHERE owner=? AND ref=?').get('a',`doc:${id}`)).toBeNull()
  expect(db.query('SELECT 1 FROM work_links WHERE owner=? AND a=?').get('a',`doc:${id}`)).toBeNull()
  expect(()=>ops.move('a',{ref:root,parent:leaf},'person')).toThrow(expect.objectContaining({status:409}))
  expect((db.query('SELECT parent_id FROM docs WHERE owner=? AND id=?').get('a',root.slice(4)) as {parent_id:string|null}).parent_id).toBeNull()
 } finally {stopDocsRefresh(db);db.close()}
})

test('archive cascades only on change and detached restored children stay at root', () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'root',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:'',parent:root},'person').ref
  ops.archive('a',root,true); ops.archive('a',child,false); ops.archive('a',root,true)
  expect(db.query('SELECT archived,parent_id,archived_with FROM docs WHERE owner=? AND id=?').get('a',child.slice(4))).toEqual({archived:0,parent_id:null,archived_with:null})
  ops.archive('a',root,false)
  expect(db.query('SELECT archived,parent_id FROM docs WHERE owner=? AND id=?').get('a',child.slice(4))).toEqual({archived:0,parent_id:null})
 } finally {stopDocsRefresh(db);db.close()}
})

test('move orders siblings without changing note versions and rejects invalid positions', () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const parent=ops.create('a',{title:'parent',md:''},'person').ref
  const a=ops.create('a',{title:'a',md:'',parent},'person').ref
  const b=ops.create('a',{title:'b',md:'',parent},'person').ref
  const c=ops.create('a',{title:'c',md:'',parent},'person').ref
  const before=ops.note('a',c)
  ops.move('a',{ref:c,parent,before:a},'person')
  const rows=db.query('SELECT id,position FROM docs WHERE owner=? AND parent_id=? ORDER BY position').all('a',parent.slice(4)) as {id:string;position:number}[]
  expect(rows.map(r=>`doc:${r.id}`)).toEqual([c,a,b])
  expect(rows.map(r=>r.position)).toEqual([0,1,2])
  expect(ops.note('a',c).version).toBe(before.version)
  expect(()=>ops.move('a',{ref:c,parent,before:a,after:b},'person')).toThrow(expect.objectContaining({status:400}))
  expect(()=>ops.move('a',{ref:c,parent,before:parent},'person')).toThrow(expect.objectContaining({status:400}))
 } finally {stopDocsRefresh(db);db.close()}
})

test('tree search filters one sibling group, counts children and binds cursors to parent', () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'root',md:''},'person').ref
  const first=ops.create('a',{title:'first',md:'',parent:root},'person').ref
  const second=ops.create('a',{title:'second',md:'',parent:root},'person').ref
  ops.create('a',{title:'grandchild',md:'',parent:first},'person')
  const page=ops.search('a',{parent:root,sort:'tree',limit:1})
  expect(ops.fetch('a',{ref:root})).toMatchObject({ancestors:[],frontmatter:{parent:null}})
  expect(page.results[0]).toMatchObject({ref:first,parent:root,children:1})
  expect(ops.search('a',{parent:root,sort:'tree',limit:1,cursor:page.nextCursor}).results[0].ref).toBe(second)
  expect(()=>ops.search('a',{parent:null,sort:'tree',limit:1,cursor:page.nextCursor})).toThrow(expect.objectContaining({status:400}))
  expect(()=>ops.search('a',{sort:'tree'})).toThrow(expect.objectContaining({status:400}))
  expect(ops.fetch('a',{ref:first})).toMatchObject({ancestors:[{ref:root,title:'root'}],frontmatter:{parent:root}})
 } finally {stopDocsRefresh(db);db.close()}
})

test('REST accepts parent and move and rejects malformed parent filters', async () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const call=async (path:string,method='GET',body?:unknown)=>{
   const url=new URL('http://local/api/docs'+path)
   return (await docsApi(new Request(url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}),url,{email:'a',agent:false},url.pathname.split('/').filter(Boolean),ops))!
  }
  const root=ops.create('a',{title:'root',md:''},'person').ref
  const response=await call('','POST',{title:'child',md:'',parent:root})
  const {ref}=await response.json() as {ref:string}
  expect((await call('/search?parent=bad')).status).toBe(400)
  expect((await call('/search?parent=root&sort=tree')).status).toBe(200)
  expect((await call(`/${encodeURIComponent(ref)}/move`,'POST',{parent:null})).status).toBe(200)
  expect(db.query('SELECT parent_id FROM docs WHERE owner=? AND id=?').get('a',ref.slice(4))).toEqual({parent_id:null})
 } finally {stopDocsRefresh(db);db.close()}
})

test('renaming a parent reindexes descendant folders immediately', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'old parent',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:'',parent:root},'person').ref
  const folders=()=> (db.query('SELECT folders FROM doc_index WHERE owner=? AND ref=?').get('a',child) as {folders:string}).folders
  const old=folders()
  ops.meta('a',{ref:root,title:'new parent'},'person')
  expect(folders()).not.toBe(old)
  expect(folders()).toContain('new parent')
 } finally {stopDocsRefresh(db);db.close()}
})

test('archived descendants count toward move depth and nested archives survive restoration', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'root',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:'',parent:root},'person').ref
  const grandchild=ops.create('a',{title:'grandchild',md:'',parent:child},'person').ref
  ops.archive('a',child,true);ops.archive('a',root,true);ops.archive('a',root,false)
  expect(db.query('SELECT archived FROM docs WHERE owner=? AND id=?').get('a',child.slice(4))).toEqual({archived:1})
  expect(db.query('SELECT archived FROM docs WHERE owner=? AND id=?').get('a',grandchild.slice(4))).toEqual({archived:1})
  let deep=ops.create('a',{title:'deep root',md:''},'person').ref
  for(let i=0;i<5;i++) deep=ops.create('a',{title:`deep ${i}`,md:'',parent:deep},'person').ref
  expect(()=>ops.move('a',{ref:root,parent:deep},'person')).toThrow(expect.objectContaining({status:409}))
 } finally {stopDocsRefresh(db);db.close()}
})

test('legacy create request hashes retry unchanged and parent changes conflict', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const id='11111111-2222-3333-4444-555555555555', input={id,title:'legacy',md:'body'}
  const ref=ops.create('a',input,'person').ref
  const hash=new Bun.CryptoHasher('sha256').update(JSON.stringify(['legacy','body',null,[],[]])).digest('hex')
  expect(db.query('SELECT payload_hash FROM doc_create_requests WHERE owner=? AND id=?').get('a',id)).toEqual({payload_hash:hash})
  expect(ops.create('a',input,'person')).toMatchObject({ref,existing:true})
  const parent=ops.create('a',{title:'parent',md:''},'person').ref
  expect(()=>ops.create('a',{...input,parent},'person')).toThrow(expect.objectContaining({status:409}))
 } finally {stopDocsRefresh(db);db.close()}
})

test('moving a restored subtree clears stale archive markers', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const root=ops.create('a',{title:'root',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:'',parent:root},'person').ref
  const grandchild=ops.create('a',{title:'grandchild',md:'',parent:child},'person').ref
  const destination=ops.create('a',{title:'destination',md:''},'person').ref
  ops.archive('a',root,true);ops.archive('a',child,false)
  ops.move('a',{ref:child,parent:destination},'person')
  expect(db.query('SELECT archived,archived_with FROM docs WHERE owner=? AND id=?').get('a',grandchild.slice(4))).toEqual({archived:1,archived_with:null})
  ops.archive('a',root,false)
  expect(db.query('SELECT archived FROM docs WHERE owner=? AND id=?').get('a',grandchild.slice(4))).toEqual({archived:1})
 } finally {stopDocsRefresh(db);db.close()}
})

test('a saved parent chain through archived documents still detects a cycle', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const a=ops.create('a',{title:'a',md:''},'person').ref
  const b=ops.create('a',{title:'b',md:'',parent:a},'person').ref
  const c=ops.create('a',{title:'c',md:'',parent:b},'person').ref
  db.query('UPDATE docs SET archived=1 WHERE owner=? AND id=?').run('a',b.slice(4))
  expect(()=>ops.move('a',{ref:a,parent:c},'person')).toThrow(expect.objectContaining({status:409}))
 } finally {stopDocsRefresh(db);db.close()}
})

test('refresh detects a hierarchy change made outside the document operations', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const a=ops.create('a',{title:'parent a',md:''},'person').ref
  const b=ops.create('a',{title:'parent b',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:'',parent:a},'person').ref
  db.query('UPDATE docs SET parent_id=? WHERE owner=? AND id=?').run(b.slice(4),'a',child.slice(4))
  refreshChanged(db,'a')
  expect(db.query('SELECT parent FROM doc_index WHERE owner=? AND ref=?').get('a',child)).toEqual({parent:b})
 } finally {stopDocsRefresh(db);db.close()}
})

test('a cursor made by the old parentless search hash remains valid', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  ops.create('a',{title:'one',md:''},'person');ops.create('a',{title:'two',md:''},'person')
  const normalized={q:'',kinds:[],tags:[],area:'',status:'',since:null,sort:'relevance',drafts:'include',limit:1,props:[]}
  const hash=new Bun.CryptoHasher('sha256').update(JSON.stringify(['a',normalized])).digest('hex')
  const cursor=Buffer.from(JSON.stringify({o:1,h:hash})).toString('base64url')
  expect(ops.search('a',{limit:1,cursor}).results).toHaveLength(1)
 } finally {stopDocsRefresh(db);db.close()}
})

test('writes normalize duplicate and null sibling positions in visible order', () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const parent=ops.create('a',{title:'parent',md:''},'person').ref
  const b=ops.create('a',{title:'b',md:'',parent},'person').ref
  const a=ops.create('a',{title:'a',md:'',parent},'person').ref
  const c=ops.create('a',{title:'c',md:'',parent},'person').ref
  db.query('UPDATE docs SET position=? WHERE owner=? AND id=?').run(5,'a',a.slice(4))
  db.query('UPDATE docs SET position=? WHERE owner=? AND id=?').run(5,'a',b.slice(4))
  db.query('UPDATE docs SET position=NULL WHERE owner=? AND id=?').run('a',c.slice(4))
  const d=ops.create('a',{title:'d',md:'',parent},'person').ref
  const rows=db.query('SELECT id,position FROM docs WHERE owner=? AND parent_id=? ORDER BY position').all('a',parent.slice(4)) as {id:string;position:number}[]
  expect(rows.map(row=>`doc:${row.id}`)).toEqual([a,b,c,d])
  expect(rows.map(row=>row.position)).toEqual([0,1,2,3])
 } finally {stopDocsRefresh(db);db.close()}
})
