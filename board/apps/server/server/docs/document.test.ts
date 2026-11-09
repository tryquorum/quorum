import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { putNote, writeDocument } from './document.ts'
import { writeAgentNote } from '../notes.ts'

test('version zero is create-only; legacy saves and stale conflicts preserve the row', () => {
  const db = legacyDb(); initDocs(db)
  const input = {html:'<p>x</p>',text:'x',md:'x'.repeat(8001)}
  expect(putNote(db,'a','doc:x',{...input,expectedVersion:0},'person').version).toBe(1)
  const before = db.query('SELECT * FROM work_notes').get()
  try { putNote(db,'a','doc:x',{...input,expectedVersion:0},'person'); throw Error('expected conflict') } catch (e: any) {
    expect(e.status).toBe(409); expect(e.current).toEqual({version:1,md:'x'.repeat(8000),truncated:true})
  }
  expect(db.query('SELECT * FROM work_notes').get()).toEqual(before)
  expect(putNote(db,'a','doc:x',{html:'b',text:'b'},'person').version).toBe(2)
  expect(putNote(db,'a','doc:x',{html:'c',text:'c',expectedVersion:2},'person').version).toBe(3)
  expect(() => putNote(db,'a','doc:x',{html:'',text:'',md:'x'.repeat(200001)},'person')).toThrow()
  stopDocsRefresh(db); db.close()
})

test('draft replacement, human protection, html prefix and idempotent writes', () => {
  const db=legacyDb(); initDocs(db)
  expect(writeAgentNote(db,'a','doc:x','first','draft')).toBe(true)
  expect(writeAgentNote(db,'a','doc:x','second','draft')).toBe(true)
  expect((db.query('SELECT md FROM work_notes').get() as any).md).toBe('second')
  putNote(db,'a','doc:x',{html:'<p>human</p>',text:'human',md:'human'},'person')
  expect(writeAgentNote(db,'a','doc:x','draft','draft')).toBe(false)
  const result=writeDocument(db,'a',{ref:'doc:x',mode:'replace',md:'suggestion',expectedVersion:3,idempotencyKey:'k'},'agent')
  expect(result.suggested).toBe(true)
  expect((db.query('SELECT html FROM work_notes').get() as any).html.startsWith('<p>human</p><hr>')).toBe(true)
  expect(writeDocument(db,'a',{ref:'doc:x',mode:'replace',md:'suggestion',expectedVersion:3,idempotencyKey:'k'},'agent')).toEqual(result)
  stopDocsRefresh(db); db.close()
})

test('patch reports misses and ambiguity, counts edits, and duplicate append is unchanged', () => {
 const db=legacyDb(); initDocs(db)
 db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','x','X',NULL,1,1,0)")
 putNote(db,'a','doc:x',{html:'<p>one one</p>',text:'one one',md:'one one'},'agent')
 const patched=writeDocument(db,'a',{ref:'doc:x',mode:'patch',expectedVersion:1,edits:[{oldStr:'missing',newStr:'x'},{oldStr:'one',newStr:'x'},{oldStr:'one one',newStr:'two'}]},'agent')
 expect(patched).toMatchObject({version:2,applied:1,warnings:['no_match','ambiguous']})
 expect(writeDocument(db,'a',{ref:'doc:x',mode:'append',md:'two'},'agent')).toMatchObject({version:2,applied:0,warnings:['duplicate']})
 writeDocument(db,'a',{ref:'doc:x',mode:'append',md:'add',idempotencyKey:'same'},'agent')
 expect(()=>writeDocument(db,'a',{ref:'doc:x',mode:'append',md:'different',idempotencyKey:'same'},'agent')).toThrow()
 stopDocsRefresh(db); db.close()
})

test('oversized write returns 413 and append preserves original HTML bytes', () => {
 const db=legacyDb();initDocs(db);db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','z','Z',NULL,1,1,0)")
 putNote(db,'a','doc:z',{html:'<p data-x="1">first</p>',text:'first',md:'first'},'person')
 const before=db.query("SELECT * FROM work_notes WHERE ref='doc:z'").get()
 try {putNote(db,'a','doc:z',{html:'',text:'',md:'x'.repeat(200001)},'person');throw Error('missing error')} catch(e:any){expect(e.status).toBe(413)}
 expect(db.query("SELECT * FROM work_notes WHERE ref='doc:z'").get()).toEqual(before)
 expect(writeAgentNote(db,'a','doc:z','second','append')).toBe(true)
 expect((db.query("SELECT html FROM work_notes WHERE ref='doc:z'").get() as any).html.startsWith('<p data-x="1">first</p><hr>')).toBe(true)
 stopDocsRefresh(db);db.close()
})
