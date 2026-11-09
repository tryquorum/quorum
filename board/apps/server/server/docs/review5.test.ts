import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { putNote } from './document.ts'
import { createDocsOps } from './ops.ts'
import { setVaultSink, rebuildVault } from './sink.ts'
import { refreshChanged } from './index.ts'

// 최종 감사 4회차 회귀: 변경 없는 태그 요청과 보류 관계, 제안 기록과 idempotency 분리, 사람이 고친 제안, 구분자 라벨
const settle=()=>new Promise(r=>setTimeout(r,5))
function sinkDb() {
  const db=legacyDb(); initDocs(db); const events:string[]=[]
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){events.push(d.ref);return {path:''}},async remove(_o,ref){events.push('remove:'+ref)}})
  return {db,events,ops:createDocsOps(db,{act:()=>({results:[]})})}
}
const sha=(s:string)=>new Bun.CryptoHasher('sha256').update(s).digest('hex')

test('an unchanged tag request does not hide a pending link change', async () => {
  const {db,events,ops}=sinkDb()
  try {
    const a=ops.create('a',{title:'doc a',md:'a',tags:['keep']},'person'), b=ops.create('a',{title:'doc b',md:'b'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    db.query("INSERT INTO work_links VALUES ('ab','a',?,?,'관련','human',1)").run(a.ref,b.ref)
    ops.tag('a',a.ref,{add:['keep']},'person')
    await settle(); refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(new Set(events)).toEqual(new Set([a.ref,b.ref]))
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('a link label change with separators reaches the sink', async () => {
  const {db,events,ops}=sinkDb()
  try {
    const a=ops.create('a',{title:'doc a',md:'a'},'person'), b=ops.create('a',{title:'doc b',md:'b'},'person'), c=ops.create('a',{title:'doc c',md:'c'},'person')
    db.query("INSERT INTO work_links VALUES ('l1','a',?,?,'x,l2:y','human',1),('l2','a',?,?,'','human',2)").run(a.ref,b.ref,a.ref,c.ref)
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a'); events.length=0
    db.exec("UPDATE work_links SET label='x' WHERE id='l1'; UPDATE work_links SET label='y,l2:' WHERE id='l2'")
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(new Set(events)).toEqual(new Set([a.ref,b.ref,c.ref]))
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('suggestion records never collide with client idempotency keys', () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    const {ref}=ops.create('a',{title:'human doc',md:'human'},'person')
    const key='ai-suggestion:'+sha('proposal')
    const first=ops.write('a',{ref,mode:'append',md:'person add',idempotencyKey:key},'person')
    putNote(db,'a',ref,{html:'',text:'',md:'proposal'},'agent')
    expect(ops.write('a',{ref,mode:'append',md:'person add',idempotencyKey:key},'person')).toEqual(first)
    const other='ai-suggestion:'+sha('second')
    const receipt=ops.write('a',{ref,mode:'append',md:'another add',idempotencyKey:other},'person')
    putNote(db,'a',ref,{html:'',text:'',md:'second'},'agent')
    expect((db.query('SELECT md FROM work_notes WHERE owner=? AND ref=?').get('a',ref) as {md:string}).md.endsWith('## AI 제안\n\nsecond')).toBe(true)
    expect(ops.write('a',{ref,mode:'append',md:'another add',idempotencyKey:other},'person')).toEqual(receipt)
  } finally {stopDocsRefresh(db);db.close()}
})

test('a proposal a person edited is proposed again', () => {
  const db=legacyDb(); initDocs(db)
  const md=()=>(db.query("SELECT md FROM work_notes WHERE ref='doc:h'").get() as {md:string}).md
  try {
    putNote(db,'a','doc:h',{html:'<p>human</p>',text:'human'},'person')
    putNote(db,'a','doc:h',{html:'',text:'',md:'hello'},'agent')
    putNote(db,'a','doc:h',{html:'',text:'',md:md().replace('hello','hello world')},'person')
    const edited=md()
    putNote(db,'a','doc:h',{html:'',text:'',md:'hello'},'agent')
    expect(md()).toBe(edited+'\n\n## AI 제안\n\nhello')
  } finally {stopDocsRefresh(db);db.close()}
})

test('work link routes notify both documents right away', async () => {
  const {worksApi}=await import('../works.ts')
  const {db,events,ops}=sinkDb()
  const call=async (path:string,method:string,body?:unknown)=>{const url=new URL('http://local'+path);return (await worksApi(db,new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),url,{email:'a',agent:false},url.pathname.split('/').filter(Boolean)))!}
  try {
    const a=ops.create('a',{title:'route a',md:'a'},'person'), b=ops.create('a',{title:'route b',md:'b'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    const {id}=await (await call('/api/work/links','POST',{a:a.ref,b:b.ref,label:'관련'})).json() as {id:string}
    await settle(); await rebuildVault(db,'a'); expect(new Set(events)).toEqual(new Set([a.ref,b.ref])); events.length=0
    await call('/api/work/links/'+id,'PATCH',{label:'원인'}); await settle(); await rebuildVault(db,'a'); expect(new Set(events)).toEqual(new Set([a.ref,b.ref])); events.length=0
    await call('/api/work/links/'+id,'DELETE'); await settle(); await rebuildVault(db,'a'); expect(new Set(events)).toEqual(new Set([a.ref,b.ref])); events.length=0
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a'); expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})
