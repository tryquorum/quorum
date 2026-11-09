import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { refreshChanged } from './index.ts'
import { rebuildVault, setVaultSink } from './sink.ts'
import { createVaultSink } from '../vault/index.ts'

test('a conflicting child stays put while siblings move, then retries after restoration', async () => {
 const db=legacyDb();initDocs(db); const rootDir=await mkdtemp('/tmp/hierarchy-conflict-')
 const originalError=console.error
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const destination=ops.create('a',{title:'destination',md:''},'person').ref
  const parent=ops.create('a',{title:'parent',md:''},'person').ref
  const edited=ops.create('a',{title:'edited',md:'body',parent},'person').ref
  const sibling=ops.create('a',{title:'sibling',md:'body',parent},'person').ref
  const vault=createVaultSink(rootDir)
  let editedFinished!:()=>void, siblingFinished!:()=>void, retried!:()=>void
  const editedDone=new Promise<void>(r=>{editedFinished=r}), siblingDone=new Promise<void>(r=>{siblingFinished=r}), retryDone=new Promise<void>(r=>{retried=r})
  let attempts=0
  setVaultSink(db,{...vault,async upsert(doc){
   try {return await vault.upsert(doc)} finally {
    if(doc.ref===edited) {attempts++; if(attempts===1) editedFinished(); else retried()}
    if(doc.ref===sibling) siblingFinished()
   }
  }})
  await rebuildVault(db,'a')
  const ledger=async()=>JSON.parse(await readFile(join(rootDir,'.vault-ledger.json'),'utf8')) as {entries:{ref:string;path:string}[]}
  const initial=await ledger()
  const oldEdited=initial.entries.find(e=>e.ref===edited)!.path, oldSibling=initial.entries.find(e=>e.ref===sibling)!.path
  const original=await readFile(join(rootDir,oldEdited),'utf8')
  await writeFile(join(rootDir,oldEdited),'human edit')
  console.error=()=>{}
  ops.move('a',{ref:parent,parent:destination},'person')
  await Promise.all([editedDone,siblingDone])
  expect(await readFile(join(rootDir,oldEdited),'utf8')).toBe('human edit')
  expect(await Bun.file(join(rootDir,oldSibling)).exists()).toBe(false)
  expect((await ledger()).entries.find(e=>e.ref===edited)?.path).toBe(oldEdited)
  expect((db.query('SELECT sig FROM doc_mirror_state WHERE owner=? AND ref=?').get('a',edited) as {sig:string}).sig).toBe('!retry')
  await writeFile(join(rootDir,oldEdited),original)
  refreshChanged(db,'a'); await retryDone
  expect((await ledger()).entries.find(e=>e.ref===edited)?.path).not.toBe(oldEdited)
 } finally {console.error=originalError;setVaultSink(db);stopDocsRefresh(db);db.close()}
})
