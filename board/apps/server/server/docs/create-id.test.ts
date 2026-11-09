import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi } from './api.ts'

const ID='0b6f3c1e-8a3d-4f7a-9c1e-2d4b6a8c0e1f'
const setup=()=>{const db=legacyDb(); initDocs(db); return {db,ops:createDocsOps(db,{act:()=>({results:[]})})}}

test('create with client id is idempotent per request, owner and id', () => {
 const {db,ops}=setup()
 try {
  const input={id:ID,title:'회의록 템플릿',md:'첫 줄',area:'업무',tags:['B','a','a']}
  const first=ops.create('a',input,'person')
  expect(first).toEqual({ref:'doc:'+ID,version:1})
  // 같은 요청을 다시: 문서 하나, 저장해 둔 결과 + existing
  expect(ops.create('a',{...input,tags:['a','b']},'person')).toEqual({ref:'doc:'+ID,version:1,existing:true})
  expect(db.query("SELECT COUNT(*) AS n FROM docs WHERE owner='a'").get()).toEqual({n:1})
  // 만든 뒤 제목이 바뀌어도 같은 요청 재시도는 성공
  ops.meta('a',{ref:'doc:'+ID,title:'바뀐 제목'},'person')
  expect(ops.create('a',input,'person').existing).toBe(true)
  // 같은 id 다른 요청은 409
  expect(()=>ops.create('a',{...input,md:'다른 본문'},'person')).toThrow(expect.objectContaining({status:409}))
  // 다른 owner 는 따로
  expect(ops.create('b',input,'person')).toEqual({ref:'doc:'+ID,version:1})
  // 형식이 틀린 id 는 400
  expect(()=>ops.create('a',{...input,id:'not-a-uuid'},'person')).toThrow(expect.objectContaining({status:400}))
  expect(()=>ops.create('a',{...input,id:ID.toUpperCase()},'person')).toThrow(expect.objectContaining({status:400}))
  // id 없이 만들면 지금처럼 같은 제목도 새 문서
  const x=ops.create('a',{title:'회의록 템플릿',md:''},'person'), y=ops.create('a',{title:'회의록 템플릿',md:''},'person')
  expect(x.ref).not.toBe(y.ref)
 } finally {stopDocsRefresh(db); db.close()}
})

test('create id refuses a document that exists without a create record', () => {
 const {db,ops}=setup()
 try {
  db.query("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a',?,'옛 문서',NULL,1,1,0)").run(ID)
  expect(()=>ops.create('a',{id:ID,title:'옛 문서',md:''},'person')).toThrow(expect.objectContaining({status:409}))
 } finally {stopDocsRefresh(db); db.close()}
})

test('write idempotencyKey create does not collide with create requests', () => {
 const {db,ops}=setup()
 try {
  const {ref}=ops.create('a',{id:ID,title:'키 공간 확인',md:'a'},'person')
  const w=ops.write('a',{ref,mode:'append',md:'b',idempotencyKey:'create'},'agent')
  expect(ops.write('a',{ref,mode:'append',md:'b',idempotencyKey:'create'},'agent')).toEqual(w)
  expect(ops.create('a',{id:ID,title:'키 공간 확인',md:'a'},'person')).toEqual({ref,version:1,existing:true})
 } finally {stopDocsRefresh(db); db.close()}
})

test('sameTitle finds normalized title matches regardless of q and page size', () => {
 const {db,ops}=setup()
 try {
  const a=ops.create('a',{title:'주간 회의록',md:''},'person').ref
  for (let i=0;i<30;i++) ops.create('a',{title:'회의록 '+i,md:'주간 회의록 본문'},'person')
  const b=ops.create('a',{title:'주간-회의록!',md:''},'person').ref
  const archived=ops.create('a',{title:'주간 회의록.',md:''},'person').ref; ops.archive('a',archived,true)
  ops.create('b',{title:'주간 회의록',md:''},'person')
  const r=ops.search('a',{sameTitle:'  주간  회의록 ',kinds:['doc'],limit:1})
  expect(r.total).toBe(2)
  expect(new Set([r.results[0].ref, ...(r.nextCursor ? ops.search('a',{sameTitle:'  주간  회의록 ',kinds:['doc'],limit:1,cursor:r.nextCursor}).results.map(x=>x.ref) : [])])).toEqual(new Set([a,b]))
  expect(ops.search('a',{sameTitle:'회의',kinds:['doc']}).total).toBe(0)
 } finally {stopDocsRefresh(db); db.close()}
})

test('REST create accepts id and search accepts sameTitle', async () => {
 const {db,ops}=setup()
 const call=async (path:string, method='GET', body?:unknown) => {
  const url=new URL('http://local/api/docs'+path); const req=new Request(url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  return (await docsApi(req,url,{email:'a',agent:false},url.pathname.split('/').filter(Boolean),ops))!
 }
 try {
  expect((await call('','POST',{id:ID,title:'레스트 문서',md:''})).status).toBe(200)
  expect(await (await call('','POST',{id:ID,title:'레스트 문서',md:''})).json()).toEqual({ref:'doc:'+ID,version:1,existing:true})
  expect((await call('','POST',{id:7,title:'x',md:''})).status).toBe(400)
  expect((await (await call('/search?sameTitle='+encodeURIComponent('레스트-문서')+'&kinds=doc')).json() as any).total).toBe(1)
 } finally {stopDocsRefresh(db); db.close()}
})
