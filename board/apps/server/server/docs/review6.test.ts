import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh, withDocsTx } from './storage.ts'
import { putNote } from './document.ts'
import { createDocsOps } from './ops.ts'
import { setVaultSink, rebuildVault } from './sink.ts'
import { refreshChanged } from './index.ts'
import type { VaultSink } from '@direction-board/contracts/docs'

// 최종 감사 5회차 회귀: remove 실패 재시도, rebuild 경쟁과 upsert 실패, 재연결 rebuild 실패, rebuild 중 롤백
const settle=(ms=5)=>new Promise(r=>setTimeout(r,ms))
const quiet=async (fn:()=>Promise<void>)=>{const original=console.error;console.error=()=>{};try{await fn()}finally{console.error=original}}

test('a failed remove is retried by the next refresh', () => quiet(async () => {
  const db=legacyDb(); initDocs(db); const events:string[]=[]; let failRemove=true
  try {
    db.exec(`INSERT INTO boards(id,kind,owner,meta,deleted,updated_at) VALUES ('pb','personal','a','{}',0,1);
      INSERT INTO items(board_id,id,data,deleted,updated_at) VALUES ('pb','t','{"type":"todo","text":"Todo"}',0,1)`)
    putNote(db,'a','item:pb:t',{html:'<p>n</p>',text:'n'},'person')
    setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){events.push('upsert:'+d.ref);return {path:''}},async remove(_o,ref){events.push('remove:'+ref);if(failRemove){failRemove=false;throw Error('fail')}}})
    await settle(); await rebuildVault(db,'a'); events.length=0
    db.exec("UPDATE boards SET kind='company',updated_at=2 WHERE id='pb'")
    refreshChanged(db,'a'); await settle(20)
    refreshChanged(db,'a'); await settle(20)
    expect(events).toEqual(['remove:item:pb:t','remove:item:pb:t'])
    events.length=0; refreshChanged(db,'a'); await settle(20); expect(events).toEqual([])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
}))

test('a write during rebuild whose upsert fails is retried with the newest body', () => quiet(async () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})}); const sent:string[]=[]
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r}); let gated=true, failUpsert=true
  try {
    const {ref}=ops.create('a',{title:'raced doc',md:'old'},'person')
    setVaultSink(db,{async rebuild(_o,docs){if(gated){gated=false;await gate};sent.push('rebuild:'+docs.map(d=>d.md).join('|'));return {written:0,removed:0}},async upsert(d){if(failUpsert){failUpsert=false;throw Error('fail')}sent.push('upsert:'+d.md);return {path:''}},async remove(){}})
    await settle(1); ops.write('a',{ref,mode:'append',md:'new'},'person')
    release(); await settle(20)
    refreshChanged(db,'a'); await settle(20)
    expect(sent).toEqual(['rebuild:old','upsert:old\n\nnew'])
    refreshChanged(db,'a'); await settle(20); expect(sent).toHaveLength(2)
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
}))

test('a reattached sink whose first rebuild fails is rebuilt by refresh', () => quiet(async () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
  try {
    ops.create('a',{title:'kept doc',md:'body'},'person')
    setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(){return {path:''}},async remove(){}})
    await settle(); await rebuildVault(db,'a'); setVaultSink(db)
    let rebuilds=0, ok=0
    const second:VaultSink={async rebuild(){rebuilds++;if(rebuilds===1)throw Error('fail');ok++;return {written:0,removed:0}},async upsert(){return {path:''}},async remove(){}}
    setVaultSink(db,second); await settle()
    refreshChanged(db,'a'); await settle()
    expect(rebuilds).toBe(2); expect(ok).toBe(1)
    refreshChanged(db,'a'); await settle(); expect(rebuilds).toBe(2)
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
}))

test('a rollback while the first rebuild runs sends nothing', async () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})}); const events:string[]=[]
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r})
  try {
    const {ref}=ops.create('a',{title:'base doc',md:'base'},'person')
    setVaultSink(db,{async rebuild(){events.push('rebuild-start');await gate;return {written:0,removed:0}},async upsert(d){events.push('upsert:'+d.md);return {path:''}},async remove(){}})
    expect(()=>db.transaction(()=>{ops.write('a',{ref,mode:'append',md:'never'},'person');throw Error('rollback')})()).toThrow('rollback')
    await settle(); release(); await settle()
    expect(events).toEqual(['rebuild-start'])
    expect(()=>withDocsTx(db,()=>{ops.write('a',{ref,mode:'append',md:'committed'},'person')})).not.toThrow()
    await settle(); expect(events).toEqual(['rebuild-start','upsert:base\n\ncommitted'])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('the mirror queue never reads an open caller transaction', async () => {
  const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})}); const sent:string[]=[]
  try {
    const {ref}=ops.create('a',{title:'tx doc',md:'base'},'person')
    setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){sent.push(d.md);return {path:''}},async remove(){}})
    await settle(20)
    ops.write('a',{ref,mode:'append',md:'committed'},'person')
    db.exec('BEGIN'); db.query("UPDATE work_notes SET md='UNCOMMITTED' WHERE owner='a' AND ref=?").run(ref)
    await settle(20); expect(sent.some(s=>s.includes('UNCOMMITTED'))).toBe(false)
    db.exec('ROLLBACK'); await settle(20)
    expect(sent).toEqual(['base\n\ncommitted'])
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('refresh retries a failed rebuild for an owner that only has mirror state', () => quiet(async () => {
  const db=legacyDb(); initDocs(db); let rebuilds=0
  try {
    db.query("INSERT INTO doc_mirror_state VALUES ('gone','doc:x','sig','[]')").run()
    setVaultSink(db,{async rebuild(){rebuilds++;if(rebuilds===1)throw Error('fail');return {written:0,removed:0}},async upsert(){return {path:''}},async remove(){}})
    await settle(20); refreshChanged(db); await settle(20)
    expect(rebuilds).toBe(2)
  } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
}))
