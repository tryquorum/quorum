import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'

test('plain create keeps duplicate titles apart and act clips to 30', () => {
 const db=legacyDb(); initDocs(db); let count=0
 const ops=createDocsOps(db,{act:(_owner,actions)=>{count=actions.length; return {results:[]}}})
 const a=ops.create('a',{title:'unique title',md:'first'},'person')
 expect(ops.create('a',{title:'unique title',md:'second'},'person').ref).not.toBe(a.ref)
 ops.act('a',Array.from({length:31},()=>({do:'x'}))); expect(count).toBe(30)
 stopDocsRefresh(db); db.close()
})

test('tag provenance and archive ownership', () => {
 const db=legacyDb(); initDocs(db);const ops=createDocsOps(db,{act:()=>({results:[]})})
 const {ref}=ops.create('a',{title:'another title',md:'body'},'person')
 ops.tag('a',ref,{add:[' Shared ']},'person'); ops.tag('a',ref,{add:['shared']},'agent'); ops.tag('a',ref,{remove:['shared']},'agent')
 expect(ops.fetch('a',{ref}).frontmatter.tags).toContainEqual({tag:'shared',by:'person'})
 expect(()=>ops.archive('b',ref,true)).toThrow(); expect(()=>ops.archive('a','run:x',true)).toThrow()
 expect(ops.archive('a',ref,true).status).toBe('archived')
 stopDocsRefresh(db); db.close()
})

test('legacy parent properties remain searchable, sortable and removable but cannot be written', () => {
 const db=legacyDb(); initDocs(db)
 try {
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const {ref}=ops.create('a',{title:'legacy parent',md:'body'},'person')
  expect(()=>ops.search('a',{sort:'prop:title'})).toThrow(expect.objectContaining({status:400}))
  expect(()=>ops.props('a',{ref,remove:['title']},'person')).toThrow(expect.objectContaining({status:400}))
  for (const key of ['parent','Parent']) {
   db.query('INSERT INTO doc_prop_types VALUES (?,?,?)').run('a',key,'text')
   db.query('INSERT INTO doc_props VALUES (?,?,?,?,?,?)').run('a',ref,key,JSON.stringify('old'),'person',1)
   expect(ops.search('a',{props:[{key,op:'eq',value:'old'}],sort:`prop:${key}`}).results.map(r=>r.ref)).toContain(ref)
   expect(()=>ops.props('a',{ref,set:{[key]:'new'}},'person')).toThrow()
   ops.props('a',{ref,remove:[key]},'person')
   expect(db.query('SELECT 1 FROM doc_props WHERE owner=? AND ref=? AND key=?').get('a',ref,key)).toBeNull()
  }
 } finally { stopDocsRefresh(db); db.close() }
})
