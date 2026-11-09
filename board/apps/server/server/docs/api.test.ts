import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi } from './api.ts'

test('docs HTTP routes, actors, filters, errors and isolation', async () => {
 const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
 const call=async (path:string, method='GET', body?:unknown, email='a', agent=false) => {
  const url=new URL('http://local/api/docs'+path); const req=new Request(url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  return (await docsApi(req,url,{email,agent},url.pathname.split('/').filter(Boolean),ops))!
 }
 try {
  const created=await call('','POST',{title:'unique title',md:'# Header\nbody',tags:['alpha']}); expect(created.status).toBe(200)
  const {ref}=await created.json() as any; const encoded=encodeURIComponent(ref)
  expect((await (await call('/search?kinds=doc,todo&tags=alpha&since=1&sort=updated&drafts=include')).json() as any).results[0].ref).toBe(ref)
  expect((await call('/schema')).status).toBe(200)
  expect((await (await call('/'+encoded+'?view=section&section=Header')).json() as any).markdown).toContain('body')
  expect((await call('/'+encoded+'/related?direction=both&depth=2&limit=3')).status).toBe(200)
  expect((await call('/'+encoded+'/tags','POST',{add:['agent-tag']},'a',true)).status).toBe(200)
  expect((await ops.fetch('a',{ref})).frontmatter.tags).toContainEqual({tag:'agent-tag',by:'agent'})
  expect((await call('/'+encoded+'/write','POST',{mode:'append',md:'more'},'a',false)).status).toBe(200)
  const conflict=await call('/'+encoded+'/write','POST',{mode:'replace',md:'x',expectedVersion:1}); expect(conflict.status).toBe(409); expect((await conflict.json() as any).current.version).toBe(2)
  expect((await call('/'+encoded,'GET',undefined,'b')).status).toBe(404)
  expect((await call('','POST',{title:'too big',md:'x'.repeat(200001)})).status).toBe(413)
  expect((await call('/'+encoded+'/archive','POST',{archived:true})).status).toBe(200)
  for(const path of ['/search?kinds=bogus','/search?since=1.5','/search?limit=NaN','/search?sort=no','/search?drafts=no','/search?cursor=bad','/'+encoded+'?view=no','/'+encoded+'?offset=-1','/'+encoded+'/related?depth=3']) expect((await call(path)).status).toBe(400)
 } finally {stopDocsRefresh(db);db.close()}
})

test('HTTP validates payloads, protects errors, and preserves actor and query values', async () => {
 const db=legacyDb();initDocs(db);const ops=createDocsOps(db,{act:()=>({results:[]})})
 const send=async (path:string, method='GET', body?:unknown, agent=false) => {const u=new URL('http://local/api/docs'+path);return (await docsApi(new Request(u,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}),u,{email:'a',agent},u.pathname.split('/').filter(Boolean),ops))!}
 try {
  const ref=(await (await send('','POST',{title:'Human writing',md:'person text'})).json() as {ref:string}).ref
  const encoded=encodeURIComponent(ref)
  await send('/'+encoded+'/tags','POST',{add:['human']})
  expect(ops.fetch('a',{ref}).frontmatter.tags).toContainEqual({tag:'human',by:'person'})
  expect((await send('/'+encoded+'/write','POST',{mode:'patch',edits:[null],expectedVersion:1})).status).toBe(400)
  expect((await send('/'+encoded+'/write','POST',{mode:'append',md:'x',expectedVersion:'1'})).status).toBe(400)
  expect((await send('/'+encoded+'/tags','POST',{add:'x'})).status).toBe(400)
  expect((await send('/'+encoded+'/archive','POST',{archived:'true'})).status).toBe(400)
  expect((await send('/%ZZ')).status).toBe(400)
  const u=new URL('http://local/api/docs/search'); const broken={...ops,search:()=>{throw Error('sensitive detail')}}
  const failure=(await docsApi(new Request(u),u,{email:'a',agent:false},['api','docs','search'],broken))!
  expect(failure.status).toBe(500);expect(await failure.json()).toEqual({error:'internal'});expect(failure.headers.get('cache-control')).toBe('no-store')
  const now=Date.now(); expect((await (await send('/search?since='+String(now+60000))).json() as {total:number}).total).toBe(0)
 } finally {stopDocsRefresh(db);db.close()}
})

test('HTTP decodes ref once and forwards comma arrays and milliseconds', async () => {
 const db=legacyDb();initDocs(db);const base=createDocsOps(db,{act:()=>({results:[]})});let seen:unknown
 const ops={...base,search:(_owner:string,input:unknown)=>{seen=input;return {results:[],total:0}},fetch:(_owner:string,input:unknown)=>{seen=input;return {} as ReturnType<typeof base.fetch>}}
 try {
  let u=new URL('http://local/api/docs/search?kinds=todo,doc&tags=one,two&since=1700000000123')
  await docsApi(new Request(u),u,{email:'a',agent:false},u.pathname.split('/').filter(Boolean),ops)
  expect(seen).toMatchObject({kinds:['todo','doc'],tags:['one','two'],since:1700000000123})
  u=new URL('http://local/api/docs/doc%253Aencoded');await docsApi(new Request(u),u,{email:'a',agent:false},u.pathname.split('/').filter(Boolean),ops)
  expect(seen).toMatchObject({ref:'doc%3Aencoded'})
 } finally {stopDocsRefresh(db);db.close()}
})
