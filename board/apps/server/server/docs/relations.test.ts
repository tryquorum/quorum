import { test, expect } from "bun:test"
import { legacyDb } from "./storage.test.ts"
import { initDocs, stopDocsRefresh } from "./storage.ts"
import { refreshChanged } from "./index.ts"
import { extractBodyTags, extractBodyLinks, reconcileRelations } from "./relations.ts"

test("body parsing ignores headings and fenced and inline code", () => {
  const md = '# Heading\n#태그 `#skip [[skip]]`\n```js\n#no [[no]]\n```\n[[signal:x]] [[제목]]'
  expect(extractBodyTags(md)).toEqual(['태그'])
  expect(extractBodyLinks(md)).toEqual(['signal:x','제목'])
})

test("numbers after # are not tags", () => {
  expect(extractBodyTags('PR #2561 실패, #10은 #10번째 과제, #opencodex/ui #2026년')).toEqual(['opencodex/ui'])
})

test("Korean particles after an English tag are dropped", () => {
  expect(extractBodyTags('#ax_align에서 #ax_align으로 #announcement #방향판')).toEqual(['ax_align', 'announcement', '방향판'])
})

test("body links resolve within owner, skip ambiguity, and preserve manual links on reconciliation", () => {
  const db = legacyDb(); initDocs(db)
  const add = db.query("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a',?,'',?,'person',1,?,1)")
  for (const [ref,md] of [['doc:a','[[doc:b]] [[Unique]] [[Duplicate]]'],['doc:b','B'],['doc:c','C'],['doc:d','D'],['doc:e','E']]) add.run(ref,md,md)
  const insert = db.query("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a',?,?,NULL,1,1,0)")
  for (const [id,title] of [['a','A'],['b','B'],['c','Unique'],['d','Duplicate'],['e','Duplicate']]) insert.run(id,title)
  db.exec("INSERT INTO work_links VALUES ('manual','a','doc:a','doc:d','manual','person',1)")
  refreshChanged(db,'a'); reconcileRelations(db,'a')
  expect(db.query("SELECT b,by FROM work_links WHERE owner='a' AND a='doc:a' ORDER BY b").all()).toEqual([{b:'doc:b',by:'body'},{b:'doc:c',by:'body'},{b:'doc:d',by:'person'}])
  db.exec("UPDATE work_notes SET md='[[doc:e]]' WHERE ref='doc:a'"); reconcileRelations(db,'a')
  expect(db.query("SELECT b,by FROM work_links WHERE owner='a' AND a='doc:a' ORDER BY b").all()).toEqual([{b:'doc:d',by:'person'},{b:'doc:e',by:'body'}])
  stopDocsRefresh(db); db.close()
})

test('body tags project with automatic tags and respect source precedence', () => {
  const db = legacyDb(); initDocs(db)
  db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','x','Title','일 영역',1,1,0); INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','doc:x','','#TOPIC `#hidden`','agent',1,'#TOPIC `#hidden`',1); INSERT INTO doc_tag_sources VALUES ('a','doc:x','topic','person',1)")
  refreshChanged(db,'a')
  expect(db.query("SELECT tag,by FROM doc_tags WHERE owner='a' AND ref='doc:x' ORDER BY tag").all()).toEqual([
    {tag:'ai/초안',by:'auto'}, {tag:'topic',by:'person'}, {tag:'상태/열림',by:'auto'}, {tag:'영역/일-영역',by:'auto'}, {tag:'종류/문서',by:'auto'}
  ])
  stopDocsRefresh(db); db.close()
})

test('unchanged body link retains identity and null markdown falls back to text', () => {
  const db=legacyDb(); initDocs(db)
  db.exec("INSERT INTO docs(owner,id,title,area,created_at,updated_at,archived) VALUES ('a','x','X',NULL,1,1,0),('a','y','Y',NULL,1,1,0); INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','doc:x','','[[doc:y]]','person',1,NULL,1),('a','doc:y','','Y','person',1,'Y',1)")
  refreshChanged(db,'a'); reconcileRelations(db,'a')
  const before=db.query("SELECT id,created_at FROM work_links WHERE by='body'").get()
  expect(before).toBeTruthy(); reconcileRelations(db,'a')
  expect(db.query("SELECT id,created_at FROM work_links WHERE by='body'").get()).toEqual(before)
  stopDocsRefresh(db); db.close()
})
