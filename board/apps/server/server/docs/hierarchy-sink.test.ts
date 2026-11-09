import { expect, test } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { rebuildVault, setVaultSink } from './sink.ts'

test('an old upsert cannot publish its path after a second move', async () => {
 const db=legacyDb();initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const a=ops.create('a',{title:'a',md:''},'person').ref
  const b=ops.create('a',{title:'b',md:''},'person').ref
  const child=ops.create('a',{title:'child',md:''},'person').ref
  let release!:()=>void, started!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}), first=new Promise<void>(resolve=>{started=resolve})
  let count=0, pathBeforeSecond:unknown
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async remove(){},async upsert(doc){
   if(doc.ref!==child) return {path:'other'}
   count++
   if(count===1) {started();await gate;return {path:'old'}}
   pathBeforeSecond=db.query('SELECT mirror_path FROM doc_index WHERE owner=? AND ref=?').get('a',child)
   return {path:'new'}
  }})
  await rebuildVault(db,'a')
  ops.move('a',{ref:child,parent:a},'person')
  await first
  ops.move('a',{ref:child,parent:b},'person')
  release();await rebuildVault(db,'a')
  expect(pathBeforeSecond).toEqual({mirror_path:null})
  expect(db.query('SELECT mirror_path FROM doc_index WHERE owner=? AND ref=?').get('a',child)).toEqual({mirror_path:'new'})
 } finally {setVaultSink(db);stopDocsRefresh(db);db.close()}
})
