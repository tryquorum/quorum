import { test, expect } from "bun:test"
import { legacyDb } from "./storage.test.ts"
import { initDocs, stopDocsRefresh } from "./storage.ts"
import { getDocRecord, reindexRef, refreshChanged } from "./index.ts"

test("indexes personal items, refreshes equal timestamps, board names and deletions", () => {
  const db = legacyDb()
  db.query("INSERT INTO boards VALUES ('p','personal','a',?,0,10)").run(JSON.stringify({ areas: [{id:'x',name:'업무'}] }))
  db.query("INSERT INTO items VALUES ('p','i',?,0,10)").run(JSON.stringify({type:'goal',text:'처음',area:'x'}))
  db.query("INSERT INTO work_notes VALUES ('a','item:p:i','','계약서 본문','agent',10)").run()
  initDocs(db)
  expect(getDocRecord(db,'a','item:p:i')?.title).toBe('처음')
  expect(db.query("SELECT ref FROM doc_fts WHERE doc_fts MATCH ?").all('"계약서"')).toHaveLength(1)
  db.query("UPDATE items SET data=? WHERE id='i'").run(JSON.stringify({type:'goal',text:'변경',area:'x',done:true}))
  db.query("UPDATE boards SET meta=? WHERE id='p'").run(JSON.stringify({ areas: [{id:'x',name:'새 영역'}] }))
  refreshChanged(db,'a')
  let doc = getDocRecord(db,'a','item:p:i')!
  expect([doc.title,doc.status,doc.area]).toEqual(['변경','done','새 영역'])
  expect(doc.tags.map(t=>t.tag)).toContain('영역/새-영역')
  db.query("DELETE FROM items WHERE id='i'").run(); refreshChanged(db,'a')
  doc = getDocRecord(db,'a','item:p:i')!
  expect([doc.title,doc.kind,doc.status]).toEqual(['변경','goal','archived'])
  stopDocsRefresh(db); db.close()
})

test("owner isolation, company boards, orphan fallback, immediate indexing and run refresh", () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO boards VALUES ('c','company',NULL,'{}',0,1),('d','company',NULL,'{}',1,1)")
  const add = db.query("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES (?,?,?,?,?,?,?,?)")
  for (const ref of ['item:c:i','item:d:i','item:missing:i','run:r']) add.run('a',ref,'','노트 제목','agent',20,'노트 제목',20)
  add.run('b','item:missing:i','','다른 소유자','person',20,'다른 소유자',20)
  db.exec("INSERT INTO runs VALUES ('r','a','r','질문','running',1,20)")
  refreshChanged(db)
  expect(getDocRecord(db,'a','item:c:i')).toBeNull(); expect(getDocRecord(db,'a','item:d:i')).toBeNull()
  expect([getDocRecord(db,'a','item:missing:i')?.title,getDocRecord(db,'a','item:missing:i')?.kind,getDocRecord(db,'a','item:missing:i')?.status]).toEqual(['노트 제목','todo','archived'])
  expect(getDocRecord(db,'b','item:missing:i')?.title).toBe('다른 소유자')
  expect(getDocRecord(db,'a','run:r')?.tags.map(t=>t.tag)).toContain('ai/초안')
  db.exec("UPDATE runs SET status='done' WHERE id='r'"); refreshChanged(db,'a')
  expect(getDocRecord(db,'a','run:r')?.status).toBe('done')
  db.exec("UPDATE work_notes SET md='즉시' WHERE owner='b'"); reindexRef(db,'b','item:missing:i')
  expect(getDocRecord(db,'b','item:missing:i')?.md).toBe('즉시')
  stopDocsRefresh(db); db.close()
})

test("refresh failure rolls back watermark and projections", () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','signal:s','','n','person',5,'n',5)")
  refreshChanged(db,'a')
  const before = db.query("SELECT watermark FROM doc_scan_state WHERE owner='a'").get()
  db.exec("CREATE TRIGGER fail_index BEFORE UPDATE ON doc_index BEGIN SELECT RAISE(ABORT,'injected'); END; UPDATE work_notes SET updated_at=9")
  expect(() => refreshChanged(db,'a')).toThrow('injected')
  expect(db.query("SELECT watermark FROM doc_scan_state WHERE owner='a'").get()).toEqual(before)
  stopDocsRefresh(db); db.close()
})

test('restart rebuilds projections even when timestamps precede the stored watermark', () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','x','old',NULL,1,1,0); INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','doc:x','','note','person',1,'note',1)")
  refreshChanged(db,'a')
  db.exec("UPDATE docs SET title='new' WHERE id='x'; UPDATE doc_scan_state SET watermark=100 WHERE owner='a'")
  initDocs(db)
  expect(getDocRecord(db,'a','doc:x')?.title).toBe('new')
  stopDocsRefresh(db); db.close()
})

test('tag provenance precedence survives reindex without reviving removed sources', () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','x','Title',NULL,1,1,0); INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','doc:x','','#tag','agent',1,'#tag',1)")
  db.exec("INSERT INTO doc_tag_sources VALUES ('a','doc:x','tag','person',1),('a','doc:x','tag','agent',1)")
  reindexRef(db,'a','doc:x')
  expect(db.query("SELECT by FROM doc_tags WHERE tag='tag'").get()).toEqual({by:'person'})
  db.exec("DELETE FROM doc_tag_sources WHERE by='person'")
  initDocs(db)
  expect(db.query("SELECT by FROM doc_tags WHERE tag='tag'").get()).toEqual({by:'agent'})
  stopDocsRefresh(db); db.close()
})

test('reindex joins caller transaction and rolls back with it', () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','signal:s','','before','person',1,'before',1)")
  reindexRef(db,'a','signal:s')
  expect(() => db.transaction(() => {
    db.exec("UPDATE work_notes SET md='after' WHERE owner='a'")
    reindexRef(db,'a','signal:s')
    throw new Error('rollback')
  })()).toThrow('rollback')
  expect(getDocRecord(db,'a','signal:s')?.md).toBe('before')
  stopDocsRefresh(db); db.close()
})

test('excluding a company projection preserves provenance of manually assigned tags', () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','item:c:i','','note','person',1,'note',1); INSERT INTO doc_tag_sources VALUES ('a','item:c:i','manual','person',1)")
  reindexRef(db,'a','item:c:i')
  db.exec("INSERT INTO boards VALUES ('c','company',NULL,'{}',0,2)")
  refreshChanged(db,'a')
  expect(getDocRecord(db,'a','item:c:i')).toBeNull()
  expect(db.query("SELECT tag,by FROM doc_tag_sources WHERE owner='a' AND ref='item:c:i' AND by='person'").all()).toEqual([{tag:'manual',by:'person'}])
  stopDocsRefresh(db); db.close()
})

test('per-ref refresh notices older source changes after a future timestamp', () => {
  const db=legacyDb(); initDocs(db)
  db.exec(`INSERT INTO boards VALUES ('p','personal','a','{"areas":[{"id":"x","name":"old"}]}',0,1);
    INSERT INTO items VALUES ('p','i','{"type":"todo","text":"old title","area":"x"}',0,1);
    INSERT INTO runs VALUES ('r','a','r','prompt','running',1,1);
    INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES
    ('a','item:p:i','','body','person',1,'body',1),('a','run:r','','run','person',1,'run',1),('a','signal:f','','future','person',9999999999999,'future',1)`)
  refreshChanged(db,'a')
  db.exec(`UPDATE items SET data='{"type":"todo","text":"new title","area":"x"}',updated_at=2 WHERE id='i';
    UPDATE boards SET meta='{"areas":[{"id":"x","name":"new"}]}',updated_at=2 WHERE id='p'; UPDATE runs SET status='done',updated_at=2 WHERE id='r'`)
  refreshChanged(db,'a')
  expect(getDocRecord(db,'a','item:p:i')).toMatchObject({title:'new title',area:'new'})
  expect(getDocRecord(db,'a','run:r')?.status).toBe('done')
  stopDocsRefresh(db); db.close()
})
