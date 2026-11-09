import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { putNote } from './document.ts'
import { writeAgentNote } from '../notes.ts'
import { createDocsOps } from './ops.ts'
import { setVaultSink, rebuildVault } from './sink.ts'

// 020 리뷰 2회차 회귀: 사람 글 보존, 롤백 시 거울 무동작, 거울 경로 기록
test('agent append keeps person html and markdown when text is empty', () => {
  const db=legacyDb(); initDocs(db)
  putNote(db,'a','doc:p',{html:'<p>사람 글</p>',text:'',md:'사람 글'},'person')
  expect(writeAgentNote(db,'a','doc:p','AI 메모','append')).toBe(true)
  const row=db.query("SELECT html,text,md,person_edited FROM work_notes WHERE ref='doc:p'").get() as any
  expect(row.html.startsWith('<p>사람 글</p><hr>')).toBe(true)
  expect(row.md).toBe('사람 글\n\nAI 메모')
  expect(row.text).toBe('AI 메모')
  expect(row.person_edited).toBe(1)
  stopDocsRefresh(db); db.close()
})

test('a caller rollback of a created document sends no sink operation', async () => {
  const db=legacyDb(); initDocs(db); const events:string[]=[]
  setVaultSink(db,{async rebuild(){events.push('rebuild');return {written:0,removed:0}},async upsert(d){events.push('upsert:'+d.ref);return {path:''}},async remove(_o,ref){events.push('remove:'+ref)}})
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  await rebuildVault(db,'a'); events.length=0
  expect(()=>db.transaction(()=>{ops.create('a',{title:'never committed',md:'x'},'person');throw Error('rollback')})()).toThrow('rollback')
  await new Promise(r=>setTimeout(r,5)); await rebuildVault(db,'a')
  expect(events).toEqual(['rebuild'])
  setVaultSink(db); stopDocsRefresh(db); db.close()
})

test('sink upsert path is recorded and returned as the search hit path', async () => {
  const db=legacyDb(); initDocs(db)
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(d){return {path:'문서/'+d.title+'.md'}},async remove(){}})
  const ops=createDocsOps(db,{act:()=>({results:[]})})
  const {ref}=ops.create('a',{title:'거울 경로',md:'본문 내용입니다'},'person')
  await rebuildVault(db,'a')
  expect(ops.search('a',{q:'본문 내용'}).results.find(h=>h.ref===ref)?.path).toBe('문서/거울 경로.md')
  setVaultSink(db); stopDocsRefresh(db); db.close()
})
