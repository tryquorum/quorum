import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { actionsApi, runActions, ACT_GUIDE } from '../actions.ts'

test('doc action distinguishes omitted, root and parent and supports move', () => {
 const db=legacyDb();initDocs(db)
 const deps={personalBoard:()=>null,readItem:()=>null,putItem:()=>{}}
 try {
  const ops=createDocsOps(db,{act:(owner,actions)=>runActions(db,owner,actions,deps)})
  const parent=ops.create('a',{title:'parent',md:''},'person').ref
  const child=runActions(db,'a',[{do:'doc',title:'same title',md:'first',parent}],deps).results[0]
  const root=runActions(db,'a',[{do:'doc',title:'same title',md:'root',parent:null}],deps).results[0]
  expect(child.ref).not.toBe(root.ref)
  expect(runActions(db,'a',[{do:'doc',title:'same title',md:'again',parent}],deps).results[0]).toMatchObject({ref:child.ref,existing:true})
  expect(runActions(db,'a',[{do:'doc',title:'same title',md:'again',parent:42}],deps).results[0].ok).toBe(false)
  expect(runActions(db,'a',[{do:'move',ref:child.ref,parent:null}],deps).results[0]).toMatchObject({ok:true,do:'move',ref:child.ref})
 } finally {stopDocsRefresh(db);db.close()}
})

test('actions doc and tag share executor and preserve cap and failures', async () => {
 const db=legacyDb(); initDocs(db)
 const deps={personalBoard:()=>null,readItem:()=>null,putItem:()=>{}}
 const ops=createDocsOps(db,{act:(owner,actions)=>runActions(db,owner,actions,deps)})
 const call=async (actions:unknown[]) => (await actionsApi(db,new Request('http://local/api/act',{method:'POST',body:JSON.stringify({actions})}),['api','act'],{email:'a',agent:true},true,deps))!
 try {
  let response=await call([{do:'doc',title:'Doc title',md:'first'}]); const first=(await response.json() as any).results[0]; expect(first.ok).toBe(true)
  response=await call([{do:'doc',title:'Doc title',md:'second'}]); expect((await response.json() as any).results[0]).toMatchObject({ref:first.ref,existing:true})
  response=await call([{do:'doc',title:'no md'}]); expect(response.status).toBe(400)
  expect(ops.act('a',[{do:'tag',ref:first.ref,add:['hello']}]).results[0].ok).toBe(true)
  expect(ops.act('a',[{do:'note',ref:first.ref,md:'append note'}]).results[0].ok).toBe(true)
  expect(ops.fetch('a',{ref:first.ref}).markdown).toContain('append note')
  expect(ops.act('b',[{do:'note',ref:first.ref,md:'private'}]).results[0].ok).toBe(false)
  expect(ops.fetch('a',{ref:first.ref}).frontmatter.tags).toContainEqual({tag:'hello',by:'agent'})
  response=await call(Array.from({length:31},()=>({do:'tag',ref:first.ref,add:['hello']}))); expect((await response.json() as any).results).toHaveLength(30)
  expect(ACT_GUIDE('http://local',null)).toContain('GET http://local/api/docs/search?q=핵심어')
 } finally {stopDocsRefresh(db);db.close()}
})

test('legacy task, note, update and done use the shared executor', async () => {
 const db=legacyDb();initDocs(db)
 db.exec("INSERT INTO boards VALUES ('pb','personal','a','{}',0,1)")
 const deps={personalBoard:()=>({id:'pb',areas:[]}),readItem:(bid:string,id:string)=>{const row=db.query('SELECT data FROM items WHERE board_id=? AND id=?').get(bid,id) as {data:string}|null;return row?{data:JSON.parse(row.data)}:null},putItem:(bid:string,id:string,data:Record<string,unknown>)=>{db.query('DELETE FROM items WHERE board_id=? AND id=?').run(bid,id);db.query('INSERT INTO items VALUES (?,?,?,0,?)').run(bid,id,JSON.stringify(data),Date.now())}}
 try {
  const made=runActions(db,'a',[{do:'task',title:'Legacy task',note:'Long enough note text'}],deps).results[0];expect(made.ok).toBe(true)
  const ref=made.ref!
  expect(runActions(db,'a',[{do:'note',ref,md:'added'},{do:'update',ref,title:'Renamed'},{do:'done',ref}],deps).results.every(r=>r.ok)).toBe(true)
  expect((db.query('SELECT data FROM items').get() as {data:string}).data).toContain('"done":true')
  expect((db.query('SELECT md FROM work_notes WHERE ref=?').get(ref) as {md:string}).md).toContain('added')
  const goalRes=runActions(db,'a',[{do:'task',type:'goal',title:'4분기 출시 목표',due:'2026-12-15',note:'## 상황\n4분기 핵심 목표 정리'}],deps).results[0]
  expect(goalRes.ok).toBe(true)
  const subRes=runActions(db,'a',[{do:'task',title:'배포 체크리스트 점검하기',note:'## 상황\n출시 전 점검 항목 확인',link:goalRes.ref}],deps).results[0]
  expect(subRes.ok).toBe(true)
  const subId=subRes.ref!.split(':')[2]
  const goalId=goalRes.ref!.split(':')[2]
  const subData=JSON.parse((db.query('SELECT data FROM items WHERE id=?').get(subId) as {data:string}).data) as {goalId?:string}
  expect(subData.goalId).toBe(goalId)
 } finally {stopDocsRefresh(db);db.close()}
})

test('sweep prompt includes documentation reading guidance', async () => {
 const {initOps,opsApi}=await import('../ops.ts');const db=legacyDb();db.exec('ALTER TABLE runs ADD COLUMN kind TEXT; ALTER TABLE signals ADD COLUMN ref TEXT; ALTER TABLE signals ADD COLUMN lane TEXT');initOps(db)
 let prompt='';const deps={personalBoard:()=>null,readItem:()=>null,putItem:()=>{},ingest:()=>({}),startRun:async (_owner:string,opts:{prompt:string})=>{prompt=opts.prompt;return {id:'r'}},port:1234}
 try {const url=new URL('http://local/api/ops/run');const res=await opsApi(db,new Request(url,{method:'POST'}),url,{email:'a',agent:false},['api','ops','run'],true,deps);expect(res!.status).toBe(201);expect(prompt).toContain('GET http://127.0.0.1:1234/api/docs/search?q=핵심어');expect(prompt).toContain('&view=section&section=제목')}
 finally {db.close()}
})
