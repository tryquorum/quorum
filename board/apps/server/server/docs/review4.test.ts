import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { putNote } from './document.ts'
import { createDocsOps } from './ops.ts'
import { setVaultSink, rebuildVault } from './sink.ts'
import { refreshChanged } from './index.ts'
import { writeAgentNote } from '../notes.ts'

// 최종 감사 2회차 회귀: agent append·refresh 롤백 무알림, 제안 중복 판정, 본문 링크 뒤 중복 갱신
const settle=()=>new Promise(r=>setTimeout(r,5))
function sinkDb() {
  const db=legacyDb(); initDocs(db); const events:string[]=[]
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){events.push(d.ref);return {path:''}},async remove(_o,ref){events.push('remove:'+ref)}})
  return {db,events,ops:createDocsOps(db,{act:()=>({results:[]})})}
}

test('rolled back agent append and refresh send nothing', async () => {
  const {db,events,ops}=sinkDb()
  try {
    const one=ops.create('a',{title:'first doc',md:'a'},'person'), two=ops.create('a',{title:'second doc',md:'b'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    expect(()=>db.transaction(()=>{writeAgentNote(db,'a',one.ref,'agent text','append');throw Error('rollback')})()).toThrow('rollback')
    expect(()=>db.transaction(()=>{db.query("INSERT INTO work_links VALUES ('lx','a',?,?,'관련','human',1)").run(one.ref,two.ref);refreshChanged(db,'a');throw Error('rollback')})()).toThrow('rollback')
    await settle(); await rebuildVault(db,'a')
    expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('a different proposal that is a prefix of an earlier one is still saved', () => {
  const db=legacyDb(); initDocs(db)
  try {
    putNote(db,'a','doc:p',{html:'<p>human</p>',text:'human'},'person')
    putNote(db,'a','doc:p',{html:'<p>long proposal</p>',text:'long proposal'},'agent')
    const again=putNote(db,'a','doc:p',{html:'<p>long proposal</p>',text:'long proposal'},'agent')
    const short=putNote(db,'a','doc:p',{html:'<p>long</p>',text:'long'},'agent')
    expect(short.version).toBe(again.version+1)
    expect((db.query("SELECT md FROM work_notes WHERE ref='doc:p'").get() as {md:string}).md).toBe('human\n\n## AI 제안\n\nlong proposal\n\n## AI 제안\n\nlong')
  } finally {stopDocsRefresh(db);db.close()}
})

test('a body link is not sent again by the next unchanged refresh', async () => {
  const {db,events,ops}=sinkDb()
  try {
    ops.create('a',{title:'target doc',md:'t'},'person'); ops.create('a',{title:'source doc',md:'see [[target doc]]'},'person')
    await settle(); await rebuildVault(db,'a'); events.length=0
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('saving a neighbor keeps a pending source change detectable', () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    db.exec(`INSERT INTO boards(id,kind,owner,meta,deleted,updated_at) VALUES ('pb','personal','a','{}',0,1);
      INSERT INTO items(board_id,id,data,deleted,updated_at) VALUES ('pb','t','{"type":"todo","text":"Old title"}',0,1)`)
    putNote(db,'a','item:pb:t',{html:'<p>todo note</p>',text:'todo note'},'person')
    const a=ops.create('a',{title:'neighbor doc',md:'n'},'person')
    db.query("INSERT INTO work_links VALUES ('l1','a',?,'item:pb:t','관련','human',1)").run(a.ref)
    refreshChanged(db,'a')
    db.query("UPDATE items SET data=?,updated_at=2 WHERE id='t'").run('{"type":"todo","text":"New title","done":true}')
    ops.write('a',{ref:a.ref,mode:'append',md:'more'},'person')
    refreshChanged(db,'a')
    expect(db.query("SELECT title,status FROM doc_index WHERE ref='item:pb:t'").get()).toEqual({title:'New title',status:'done'})
  } finally {stopDocsRefresh(db);db.close()}
})

test('saving a neighbor keeps a pending manual link notification', async () => {
  const {db,events,ops}=sinkDb()
  try {
    const a=ops.create('a',{title:'doc a',md:'a'},'person'), b=ops.create('a',{title:'doc b',md:'b'},'person'), c=ops.create('a',{title:'doc c',md:'c'},'person')
    db.query("INSERT INTO work_links VALUES ('ab','a',?,?,'관련','human',1)").run(a.ref,b.ref)
    refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a'); events.length=0
    db.query("INSERT INTO work_links VALUES ('bc','a',?,?,'관련','human',2)").run(b.ref,c.ref)
    ops.write('a',{ref:a.ref,mode:'append',md:'more'},'person')
    await settle(); refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(new Set(events)).toEqual(new Set([a.ref,b.ref,c.ref]))
    events.length=0; refreshChanged(db,'a'); await settle(); await rebuildVault(db,'a')
    expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('proposal identity does not depend on headings inside a proposal', () => {
  const db=legacyDb(); initDocs(db)
  const md=()=>(db.query("SELECT md FROM work_notes WHERE ref='doc:q'").get() as {md:string}).md
  try {
    putNote(db,'a','doc:q',{html:'<p>human</p>',text:'human'},'person')
    putNote(db,'a','doc:q',{html:'',text:'',md:'one\n\n## AI 제안\n\ntwo'},'agent')
    const after=md()
    putNote(db,'a','doc:q',{html:'',text:'',md:'one\n\n## AI 제안\n\ntwo'},'agent')
    expect(md()).toBe(after)
    putNote(db,'a','doc:q',{html:'',text:'',md:'two'},'agent')
    expect(md()).toBe(after+'\n\n## AI 제안\n\ntwo')
  } finally {stopDocsRefresh(db);db.close()}
})
