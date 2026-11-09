import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { putNote } from './document.ts'
import { createDocsOps } from './ops.ts'
import { setVaultSink, rebuildVault } from './sink.ts'
import { refreshChanged } from './index.ts'
import { worksApi } from '../works.ts'
import { runActions } from '../actions.ts'

// 최종 감사 회귀: 사람 글 보호, 롤백 거울 무동작, 수동 관계 거울 반영, related 400, 일반 create 중복 허용
const settle=()=>new Promise(r=>setTimeout(r,5))
async function workCall(db:ReturnType<typeof legacyDb>,path:string,method:string,body:unknown,agent:boolean) {
  const url=new URL('http://local'+path)
  return (await worksApi(db,new Request(url,{method,body:JSON.stringify(body)}),url,{email:'a',agent},url.pathname.split('/').filter(Boolean)))!
}

test('agent note PUT keeps a person-edited note and adds an AI suggestion', async () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  const {ref}=ops.create('a',{title:'사람 문서',md:'human'},'person')
  try {
    const path='/api/work/'+encodeURIComponent(ref)+'/note'
    const res=await workCall(db,path,'PUT',{html:'<p>overwrite</p>',text:'overwrite'},true)
    expect(res.status).toBe(200)
    const row=db.query('SELECT html,md,person_edited,version FROM work_notes WHERE owner=? AND ref=?').get('a',ref) as {html:string;md:string;person_edited:number;version:number}
    expect(row.html.startsWith('<p>human</p>')).toBe(true)
    expect(row.md).toBe('human\n\n## AI 제안\n\noverwrite')
    expect(row.person_edited).toBe(1)
    const again=await workCall(db,path,'PUT',{html:'<p>overwrite</p>',text:'overwrite'},true)
    expect(again.status).toBe(200)
    expect((db.query('SELECT version FROM work_notes WHERE owner=? AND ref=?').get('a',ref) as {version:number}).version).toBe(row.version)
    const person=await workCall(db,path,'PUT',{html:'<p>replaced</p>',text:'replaced'},false)
    expect(person.status).toBe(200)
    expect((db.query('SELECT md FROM work_notes WHERE owner=? AND ref=?').get('a',ref) as {md:string}).md).toBe('replaced')
  } finally {stopDocsRefresh(db);db.close()}
})

test('agent note PUT replaces an agent-only note', () => {
  const db=legacyDb(); initDocs(db)
  try {
    putNote(db,'a','doc:x',{html:'<p>first</p>',text:'first'},'agent')
    putNote(db,'a','doc:x',{html:'<p>second</p>',text:'second'},'agent')
    expect(db.query("SELECT md FROM work_notes WHERE ref='doc:x'").get()).toEqual({md:'second'})
  } finally {stopDocsRefresh(db);db.close()}
})

test('caller rollback after several writes sends no sink operation', async () => {
  const db=legacyDb(); initDocs(db); const events:string[]=[]
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){events.push('upsert:'+d.ref);return {path:''}},async remove(_o,ref){events.push('remove:'+ref)}})
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    const existing=ops.create('a',{title:'existing doc',md:'base'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    expect(()=>db.transaction(()=>{const {ref}=ops.create('a',{title:'temporary doc',md:'x'},'person');ops.write('a',{ref,mode:'append',md:'y'},'person');throw Error('rollback')})()).toThrow('rollback')
    expect(()=>db.transaction(()=>{ops.write('a',{ref:existing.ref,mode:'append',md:'one'},'person');ops.write('a',{ref:existing.ref,mode:'append',md:'two'},'person');throw Error('rollback')})()).toThrow('rollback')
    await settle(); await rebuildVault(db,'a')
    expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('manual work link changes reach the sink after refresh', async () => {
  const db=legacyDb(); initDocs(db); const events:string[]=[]
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){events.push(d.ref);return {path:''}},async remove(){}})
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    const one=ops.create('a',{title:'first linked',md:'a'},'person'), two=ops.create('a',{title:'second linked',md:'b'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    const res=await workCall(db,'/api/work/links','POST',{a:one.ref,b:two.ref,label:'관련'},false)
    expect(res.status).toBe(201)
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(events.sort()).toEqual([one.ref,two.ref].sort())
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('related returns 400 when one edge alone exceeds the read limit', () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    const big=ops.create('a',{title:'t'.repeat(21000),md:'big'},'person'), small=ops.create('a',{title:'small doc',md:'s'},'person')
    db.query("INSERT INTO work_links VALUES ('l1','a',?,?,'관련','human',1)").run(small.ref,big.ref)
    expect(()=>ops.related('a',{ref:small.ref})).toThrow(expect.objectContaining({status:400}))
  } finally {stopDocsRefresh(db);db.close()}
})

test('plain create keeps duplicate titles separate while act doc merges', () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    const a=ops.create('a',{title:'same title here',md:'first'},'person')
    const b=ops.create('a',{title:'same title here',md:'second'},'person')
    expect(b.ref).not.toBe(a.ref); expect(b.existing).toBeUndefined()
    const deps={broadcast(){},notify(){}} as unknown as Parameters<typeof runActions>[3]
    const merged=runActions(db,'a',[{do:'doc',title:'same title here',md:'third'}],deps).results[0]
    expect(merged).toMatchObject({ok:true,existing:true})
    expect<(string | undefined)[]>([a.ref,b.ref]).toContain(merged.ref)
  } finally {stopDocsRefresh(db);db.close()}
})
