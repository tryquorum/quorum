import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { initWorks } from "../works.ts"
import { initDocs, setHtmlToMarkdown, stopDocsRefresh } from "./storage.ts"

export function legacyDb() {
  const db = new Database(":memory:")
  initWorks(db)
  db.exec(`CREATE TABLE boards(id TEXT PRIMARY KEY, kind TEXT, owner TEXT, meta TEXT, deleted INTEGER, updated_at INTEGER);
    CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, deleted INTEGER, updated_at INTEGER);
    CREATE TABLE signals(id TEXT, owner TEXT, title TEXT, area TEXT, source TEXT, status TEXT, updated_at INTEGER);
    CREATE TABLE runs(id TEXT, owner TEXT, thread TEXT, prompt TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`)
  return db
}

test('hierarchy migration adds nullable columns and records itself once', () => {
  const db=legacyDb()
  try {
    initDocs(db); initDocs(db)
    const columns=(table:string)=>(db.query(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name)
    expect(columns('docs')).toContain('parent_id')
    expect(columns('docs')).toContain('position')
    expect(columns('docs')).toContain('archived_with')
    expect(columns('doc_index')).toContain('parent')
    expect(columns('doc_index')).toContain('folders')
    expect(db.query("SELECT COUNT(*) AS n FROM doc_migrations WHERE name='hierarchy-v1'").get()).toEqual({n:1})
    expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='docs_owner_parent'").get()).not.toBeNull()
  } finally { stopDocsRefresh(db); db.close() }
})

test("migration preserves original fields, converts once and initializes flags", () => {
  const db = legacyDb()
  db.query("INSERT INTO work_notes VALUES (?,?,?,?,?,?)").run("a", "signal:x", "<p>hello</p>", "hello\n", "agent", 17)
  setHtmlToMarkdown(db, html => `converted:${html}`)
  initDocs(db); initDocs(db)
  expect(db.query("SELECT html,text,by,updated_at,md,version,created_at,person_edited FROM work_notes").get()).toEqual({ html: "<p>hello</p>", text: "hello\n", by: "agent", updated_at: 17, md: "converted:<p>hello</p>", version: 1, created_at: 17, person_edited: 1 })
  db.query("INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md) VALUES ('a','signal:y','','new','agent',18,'new')").run()
  initDocs(db)
  expect(db.query("SELECT person_edited FROM work_notes WHERE ref='signal:y'").get()).toEqual({person_edited:0})
  stopDocsRefresh(db); db.close()
})

test("fallback is exact text and converter failure rolls back schema and backfill", () => {
  const db = legacyDb()
  db.query("INSERT INTO work_notes VALUES ('a','signal:x','<p>x</p>','x\n','person',3)").run()
  setHtmlToMarkdown(db, () => { throw new Error("conversion failed") })
  expect(() => initDocs(db)).toThrow("conversion failed")
  expect((db.query("PRAGMA table_info(work_notes)").all() as {name:string}[]).some(c => c.name === "md")).toBe(false)
  setHtmlToMarkdown(db)
  initDocs(db)
  expect(db.query("SELECT md FROM work_notes").get()).toEqual({md:"x\n"})
  stopDocsRefresh(db); db.close()
})

test('rejects incompatible pre-existing table and rolls back migration', () => {
  const db = legacyDb()
  db.exec('CREATE TABLE docs(owner TEXT,id TEXT)')
  expect(() => initDocs(db)).toThrow()
  expect((db.query('PRAGMA table_info(work_notes)').all() as {name:string}[]).some(c=>c.name==='md')).toBe(false)
  db.close()
})

test('rejects non-string converter output and preserves existing markdown', () => {
  const db = legacyDb()
  db.exec("INSERT INTO work_notes VALUES ('a','signal:x','<p>text</p>','text','person',1)")
  setHtmlToMarkdown(db, () => null as unknown as string)
  expect(() => initDocs(db)).toThrow('must return a string')
  setHtmlToMarkdown(db)
  initDocs(db)
  db.exec("UPDATE work_notes SET md='original'")
  setHtmlToMarkdown(db, ()=>'replacement')
  initDocs(db)
  expect(db.query('SELECT md FROM work_notes').get()).toEqual({md:'original'})
  stopDocsRefresh(db); db.close()
})

test('imports existing tag provenance once and preserves it across rebuilds', () => {
  const db = legacyDb()
  db.exec("CREATE TABLE doc_tags(owner TEXT NOT NULL,ref TEXT NOT NULL,tag TEXT NOT NULL,by TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,ref,tag)); INSERT INTO doc_tags VALUES ('a','signal:x','saved','person',1); INSERT INTO work_notes VALUES ('a','signal:x','','note','person',1)")
  initDocs(db); initDocs(db)
  expect(db.query("SELECT tag,by FROM doc_tag_sources WHERE owner='a' AND ref='signal:x' AND tag='saved'").all()).toEqual([{tag:'saved',by:'person'}])
  stopDocsRefresh(db); db.close()
})

test('one unref interval per database refreshes run changes without sleeping', () => {
  const db = legacyDb()
  const original = globalThis.setInterval
  const callbacks: (()=>void)[] = []
  const delays: number[] = []
  globalThis.setInterval = ((fn:()=>void, ms:number) => { callbacks.push(fn); delays.push(ms); return original(fn,ms) }) as typeof setInterval
  try {
    initDocs(db); initDocs(db)
    expect(delays).toEqual([60_000])
    db.exec("INSERT INTO runs VALUES ('r','a',NULL,'Question','running',1,1); INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES ('a','run:r','','note','person',1,'note',1)")
    callbacks[0]()
    db.exec("UPDATE runs SET status='done' WHERE id='r'")
    callbacks[0]()
    expect(db.query("SELECT status FROM doc_index WHERE owner='a' AND ref='run:r'").get()).toEqual({status:'done'})
  } finally {
    stopDocsRefresh(db); globalThis.setInterval = original; db.close()
  }
})

test('rejects incompatible note column and FTS tokenizer configuration', () => {
  const db = legacyDb()
  db.exec("ALTER TABLE work_notes ADD COLUMN version TEXT; CREATE VIRTUAL TABLE doc_fts USING fts5(owner,ref,title,body,tags,tokenize='trigram')")
  expect(() => initDocs(db)).toThrow('Incompatible docs schema')
  expect((db.query('PRAGMA table_info(work_notes)').all() as {name:string}[]).some(c=>c.name==='md')).toBe(false)
  db.close()
  const ftsDb = legacyDb()
  ftsDb.exec("CREATE VIRTUAL TABLE doc_fts USING fts5(owner,ref,title,body,tags,tokenize='trigram')")
  expect(() => initDocs(ftsDb)).toThrow('Incompatible docs schema: doc_fts')
  ftsDb.close()
})
