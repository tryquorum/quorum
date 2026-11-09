import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { rebuildVault, setVaultSink } from './sink.ts'
import { createVaultSink } from '../vault/index.ts'

test('a second connection cannot move while an immediate transaction holds the lock', async () => {
 const seed=legacyDb();initDocs(seed)
 const path=join(await mkdtemp('/tmp/hierarchy-lock-'),'board.db')
 const ops=createDocsOps(seed,{act:()=>({results:[]})})
 const a=ops.create('a',{title:'a',md:''},'person').ref, b=ops.create('a',{title:'b',md:''},'person').ref
 seed.query('VACUUM INTO ?').run(path);stopDocsRefresh(seed);seed.close()
 const first=new Database(path), second=new Database(path)
 try {
  second.exec('PRAGMA busy_timeout=0')
  first.exec('BEGIN IMMEDIATE')
  const other=createDocsOps(second,{act:()=>({results:[]})})
  expect(()=>other.move('a',{ref:a,parent:b},'person')).toThrow()
  expect(second.inTransaction).toBe(false)
  first.exec('ROLLBACK')
  expect(second.query('SELECT parent_id FROM docs WHERE owner=? AND id=?').get('a',a.slice(4))).toEqual({parent_id:null})
 } finally {if(first.inTransaction) first.exec('ROLLBACK');first.close();second.close()}
})

test('restart rebuilds a move committed before any mirror notification', async () => {
 const seed=legacyDb();initDocs(seed)
 const dir=await mkdtemp('/tmp/hierarchy-restart-'), path=join(dir,'board.db'), vault=join(dir,'vault')
 const ops=createDocsOps(seed,{act:()=>({results:[]})})
 const parent=ops.create('a',{title:'parent',md:''},'person').ref
 const child=ops.create('a',{title:'child',md:'body'},'person').ref
 ops.move('a',{ref:child,parent},'person')
 seed.query('VACUUM INTO ?').run(path);stopDocsRefresh(seed);seed.close()
 const restarted=new Database(path)
 try {
  initDocs(restarted);setVaultSink(restarted,createVaultSink(vault));await rebuildVault(restarted,'a')
  const ledger=JSON.parse(await readFile(join(vault,'.vault-ledger.json'),'utf8')) as {entries:{ref:string;path:string}[]}
  const entry=ledger.entries.find(e=>e.ref===child)
  expect(entry?.path.split('/')).toHaveLength(3)
  expect(entry && await readFile(join(vault,entry.path),'utf8')).toContain(`parent: "${parent}"`)
 } finally {setVaultSink(restarted);stopDocsRefresh(restarted);restarted.close()}
})
