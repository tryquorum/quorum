import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh, withDocsTx } from './storage.ts'
import { setVaultSink, rebuildVault } from './sink.ts'

test('rebuilds attached sink for an owner', async () => {
 const db=legacyDb(); initDocs(db); const calls:string[]=[]
 setVaultSink(db,{async rebuild(owner){calls.push(owner); return {written:0,removed:0}},async upsert(){return {path:''}},async remove(){}})
 await rebuildVault(db,'a'); expect(calls).toEqual(['a'])
 setVaultSink(db); stopDocsRefresh(db); db.close()
})

test('queues two ops, refresh and rollback without dispatch before commit', async () => {
 const {createDocsOps}=await import('./ops.ts'); const {refreshChanged}=await import('./index.ts')
 const db=legacyDb();initDocs(db);const events:string[]=[];let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve});let first=true
 setVaultSink(db,{async rebuild(){events.push('rebuild');return {written:0,removed:0}},async upsert(doc){events.push(doc.md);if(first){first=false;await gate}return {path:''}},async remove(){events.push('remove')}})
 const a=createDocsOps(db,{act:()=>({results:[]})}),b=createDocsOps(db,{act:()=>({results:[]})})
 const {ref}=a.create('a',{title:'queued document',md:'one'},'person')
 b.write('a',{ref,mode:'append',md:'two'},'person')
 await Promise.resolve(); await Promise.resolve();expect(events).toEqual(['one\n\ntwo'])
 release();await rebuildVault(db,'a');expect(events).toEqual(['one\n\ntwo','rebuild'])
 db.query('UPDATE docs SET title=?,updated_at=updated_at+1 WHERE owner=? AND id=?').run('renamed','a',ref.slice(4));refreshChanged(db,'a')
 await rebuildVault(db,'a');expect(events.slice(-2)).toEqual(['one\n\ntwo','rebuild'])
 const count=events.length
 expect(()=>withDocsTx(db,()=>{a.write('a',{ref,mode:'append',md:'rollback'},'person');throw Error('rollback')})).toThrow('rollback')
 await rebuildVault(db,'a');expect(events.length).toBe(count+1)
 setVaultSink(db);stopDocsRefresh(db);db.close()
})

test('an externally committed transaction emits its committed write', async () => {
 const {createDocsOps}=await import('./ops.ts')
 const db=legacyDb();initDocs(db);const events:string[]=[]
 setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(doc){events.push(doc.md);return {path:''}},async remove(){}})
 const ops=createDocsOps(db,{act:()=>({results:[]})})
 db.transaction(()=>{ops.create('a',{title:'external transaction',md:'committed'},'person')})()
 await Promise.resolve();await rebuildVault(db,'a')
 expect(events).toEqual(['committed'])
 setVaultSink(db);stopDocsRefresh(db);db.close()
})

test('failed sink operation permits a later successful rebuild', async () => {
 const {createDocsOps}=await import('./ops.ts');const db=legacyDb();initDocs(db);let failed=true;let rebuilt=0
 const original=console.error;console.error=()=>{}
 try {
  setVaultSink(db,{async rebuild(){rebuilt++;if(failed){failed=false;throw Error('secret content')}return {written:0,removed:0}},async upsert(){return {path:''}},async remove(){}})
  const ops=createDocsOps(db,{act:()=>({results:[]})});ops.create('a',{title:'test failure',md:'data'},'person')
  await expect(rebuildVault(db,'a')).rejects.toThrow();await rebuildVault(db,'a');expect(rebuilt).toBe(2)
 } finally {console.error=original;setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('timer refresh reports source changes and removed projections', async () => {
 const {createDocsOps}=await import('./ops.ts');const db=legacyDb();const callbacks:(()=>void)[]=[];const original=globalThis.setInterval
 globalThis.setInterval=((fn:()=>void,ms:number)=>{callbacks.push(fn);return original(fn,ms)}) as typeof setInterval
 try {
  initDocs(db);const events:string[]=[]
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(doc){events.push(doc.title);return {path:''}},async remove(_owner,ref){events.push(`removed:${ref}`)}})
  const ops=createDocsOps(db,{act:()=>({results:[]})});const {ref}=ops.create('a',{title:'original',md:'body'},'person')
  await rebuildVault(db,'a');events.length=0
  db.query('UPDATE docs SET title=?,updated_at=updated_at+1 WHERE owner=? AND id=?').run('changed','a',ref.slice(4));callbacks[0]()
  await rebuildVault(db,'a');expect(events).toEqual(['changed']);events.length=0
  db.query('DELETE FROM work_notes WHERE owner=? AND ref=?').run('a',ref);callbacks[0]()
  await rebuildVault(db,'a');expect(events).toEqual([`removed:${ref}`])
 } finally {globalThis.setInterval=original;setVaultSink(db);stopDocsRefresh(db);db.close()}
})

test('an externally rolled back transaction never emits uncommitted content', async () => {
 const {createDocsOps}=await import('./ops.ts')
 const db=legacyDb();initDocs(db);const events:string[]=[]
 setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(doc){events.push('upsert:'+doc.md);return {path:''}},async remove(_o,ref){events.push('remove:'+ref)}})
 const ops=createDocsOps(db,{act:()=>({results:[]})})
 const {ref}=ops.create('a',{title:'kept document',md:'kept'},'person')
 await rebuildVault(db,'a');events.length=0
 expect(()=>db.transaction(()=>{ops.write('a',{ref,mode:'append',md:'uncommitted'},'person');throw Error('caller rollback')})()).toThrow('caller rollback')
 await new Promise(r=>setTimeout(r,5));await rebuildVault(db,'a')
 expect(events.some(e=>e.includes('uncommitted'))).toBe(false)
 expect(db.query('SELECT md FROM work_notes WHERE owner=? AND ref=?').get('a',ref)).toEqual({md:'kept'})
 setVaultSink(db);stopDocsRefresh(db);db.close()
})
