import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { worksApi } from '../works.ts'
import { normPage, pageBlock } from '../page-context.ts'

test('work docs and runs support versioned notes and docs page', async () => {
 const db=legacyDb(); db.exec('ALTER TABLE boards ADD COLUMN name TEXT; ALTER TABLE runs ADD COLUMN target TEXT; ALTER TABLE runs ADD COLUMN parent TEXT; ALTER TABLE runs ADD COLUMN model_name TEXT; ALTER TABLE runs ADD COLUMN model TEXT; ALTER TABLE runs ADD COLUMN finished_at INTEGER'); initDocs(db)
 const ops=createDocsOps(db,{act:()=>({results:[]})}); const {ref}=ops.create('a',{title:'My document',md:'initial'},'person')
 db.exec("INSERT INTO runs(id,owner,thread,prompt,status,created_at,updated_at) VALUES ('r','a','r','Run title','done',1,1),('r2','a','r','Later','done',2,2)")
 const call=async (ref:string,method='GET',body?:unknown,email='a')=>{const path='/api/work/'+encodeURIComponent(ref)+(method==='PUT'?'/note':'');const url=new URL('http://local'+path);return (await worksApi(db,new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),url,{email,agent:false},url.pathname.split('/').filter(Boolean)))!}
 try {
  let response=await call('run:r'); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({noteVersioning:true,note:null,self:{type:'run'}})
  expect((await call('run:r','PUT',{html:'a',text:'a',expectedVersion:0})).status).toBe(200)
  expect((await call('run:r','PUT',{html:'b',text:'b',expectedVersion:0})).status).toBe(409)
  expect((await call('run:r','PUT',{html:'b',text:'b',expectedVersion:'1'})).status).toBe(400)
  expect((await call('run:r','PUT',{html:'b',text:'b',expectedVersion:1})).status).toBe(200)
  expect((await call('run:r','PUT',{html:'c',text:'c'})).status).toBe(200)
  response=await call('run:r'); expect(await response.json()).toMatchObject({noteVersioning:true,note:{version:3,md:'c'}})
  expect((await call(ref)).status).toBe(200)
  expect((await call(ref,'GET',undefined,'b')).status).toBe(404)
  expect(normPage({view:'docs',work:ref})).toEqual({view:'docs',work:ref})
  const block=pageBlock(db,'a',{view:'docs',work:ref},null); expect(block).toContain('My document'); expect(block).toContain(ref)
 } finally {stopDocsRefresh(db);db.close()}
})

test('stale work note returns bounded current markdown without losing the note', async () => {
 const db=legacyDb();db.exec('ALTER TABLE runs ADD COLUMN target TEXT');initDocs(db)
 const ops=createDocsOps(db,{act:()=>({results:[]})});const {ref}=ops.create('a',{title:'Long note',md:'x'.repeat(8001)},'person')
 try {
  const url=new URL('http://local/api/work/'+encodeURIComponent(ref)+'/note')
  const req=new Request(url,{method:'PUT',body:JSON.stringify({html:'changed',text:'changed',expectedVersion:0})})
  const res=(await worksApi(db,req,url,{email:'a',agent:false},url.pathname.split('/').filter(Boolean)))!
  expect(res.status).toBe(409);expect((await res.json() as {current:unknown}).current).toEqual({version:1,md:'x'.repeat(8000),truncated:true})
  expect(ops.fetch('a',{ref,maxChars:10000}).markdown).toBe('x'.repeat(8001))
 } finally {stopDocsRefresh(db);db.close()}
})

test('work search includes only owned active documents and keeps sticky results', async () => {
 const db=legacyDb();db.exec('ALTER TABLE signals ADD COLUMN kind TEXT; ALTER TABLE signals ADD COLUMN lane TEXT; ALTER TABLE signals ADD COLUMN due INTEGER');initDocs(db)
 db.exec(`INSERT INTO boards(id,kind,owner,meta,deleted,updated_at) VALUES ('pb','personal','a','{}',0,1);
 INSERT INTO items(board_id,id,data,deleted,updated_at) VALUES ('pb','s','{"type":"sticky","text":"Shared search"}',0,1)`)
 const ops=createDocsOps(db,{act:()=>({results:[]})});const visible=ops.create('a',{title:'Shared document',md:'body'},'person'); const archived=ops.create('a',{title:'Shared archived',md:'body'},'person');ops.archive('a',archived.ref,true);ops.create('b',{title:'Shared secret',md:'body'},'person')
 try {
  const url=new URL('http://local/api/work/search?q=Shared');const res=(await worksApi(db,new Request(url),url,{email:'a',agent:false},['api','work','search']))!
  const data=await res.json() as {results:{ref:string;type:string}[]}
  expect(data.results).toContainEqual(expect.objectContaining({ref:visible.ref,type:'doc'}));expect(data.results).toContainEqual(expect.objectContaining({ref:'item:pb:s',type:'sticky'}));expect(data.results).toHaveLength(2)
 } finally {stopDocsRefresh(db);db.close()}
})
