import type { Database } from "bun:sqlite"
import type { HtmlToMarkdown } from "@direction-board/contracts/docs"
import { backfillIndexDue, rebuildOwner, refreshChanged, startDocsRefresh, stopDocsRefresh } from "./index.ts"

const converters = new WeakMap<Database, HtmlToMarkdown>()
/** 손실 위험 구조에서 던지는 엄격 변환기(vault). iOS 마크다운 편집 가능 판정(markdownEditable)에만 써요 */
const strictConverters = new WeakMap<Database, HtmlToMarkdown>()
/** 커밋 후 할 일. key 가 같으면 처음 등록한 것만 남긴다(처음 등록 시점의 기준 상태를 지키려고) */
type Hooks = Map<string, () => void>
const txHooks = new WeakMap<Database, Hooks[]>()
const externalTx = new WeakSet<Database>()
const deferredHooks = new WeakMap<Database, Hooks>()
let hookSeq = 0
export { stopDocsRefresh }

export function setHtmlToMarkdown(db: Database, fn?: HtmlToMarkdown): void {
  if (fn) converters.set(db, fn)
  else converters.delete(db)
}

export function setStrictHtmlToMarkdown(db: Database, fn?: HtmlToMarkdown): void {
  if (fn) strictConverters.set(db, fn)
  else strictConverters.delete(db)
}

export function strictHtmlToMarkdown(db: Database): HtmlToMarkdown | undefined {
  return strictConverters.get(db)
}

export function noteMarkdown(db: Database, html: string, text: string): string {
  if (!html.trim()) return text
  const converter = converters.get(db)
  if (!converter) return text
  const result = converter(html)
  if (typeof result !== "string") throw new TypeError("HTML to Markdown converter must return a string")
  return result
}

export function withDocsTx<T>(db: Database, fn: () => T): T {
  const stack = txHooks.get(db) || []
  const external = stack.length === 0 && db.inTransaction
  if (external) externalTx.add(db)
  const hooks: Hooks = new Map()
  stack.push(hooks)
  txHooks.set(db, stack)
  let result:T
  try {
    result = db.transaction(fn).immediate()
  } catch (error) {
    stack.pop()
    if (!stack.length) { txHooks.delete(db); externalTx.delete(db) }
    throw error
  }
  stack.pop()
  if (stack.length) { const parent = stack[stack.length - 1]; for (const [key, hook] of hooks) if (!parent.has(key)) parent.set(key, hook) }
  else { txHooks.delete(db); externalTx.delete(db); for (const hook of hooks.values()) hook() }
  return result
}

/**
 * Runs hook after the outermost commit. Inside a caller-owned transaction (db.transaction outside withDocsTx)
 * there is no commit hook, so the hook is deferred until that transaction has ended. Hooks must re-read
 * current DB state when they run and compare it with the state captured at first registration: after a
 * caller rollback the state is unchanged and the hook sends nothing. With a key, the first registration
 * wins until the hook runs, so later writes in the same transaction never replace the baseline.
 */
export function afterDocsCommit(db: Database, hook: () => void, key = `#${++hookSeq}`): void {
  const stack = txHooks.get(db)
  if (!stack?.length) throw new Error('afterDocsCommit requires withDocsTx')
  if (!externalTx.has(db)) { const level = stack[stack.length - 1]; if (!level.has(key)) level.set(key, hook); return }
  const pending = deferredHooks.get(db)
  if (pending) { if (!pending.has(key)) pending.set(key, hook); return }
  deferredHooks.set(db, new Map([[key, hook]]))
  queueMicrotask(() => flushDeferred(db))
}

function flushDeferred(db: Database): void {
  if (db.inTransaction) { setTimeout(() => flushDeferred(db), 0); return }
  const hooks = [...(deferredHooks.get(db)?.values() || [])]
  deferredHooks.delete(db)
  for (const hook of hooks) {
    try { hook() } catch { console.error('[docs] deferred vault notification failed') }
  }
}

function validateSchema(db: Database): void {
  const tables: Record<string, {columns:string; key:string}> = {
    docs: {columns:'owner id title area created_at updated_at archived parent_id position archived_with', key:'owner id'},
    doc_tags: {columns:'owner ref tag by created_at', key:'owner ref tag'},
    doc_tag_sources: {columns:'owner ref tag by created_at', key:'owner ref tag by'},
    doc_index: {columns:'owner ref kind title area status source updated_at created_at version chars person_edited mirror_path src_sig parent folders', key:'owner ref'},
    doc_idempotency: {columns:'owner ref key payload_hash result_json', key:'owner ref key'},
    doc_once: {columns:'owner ref key result_json created_at', key:'owner ref key'},
    doc_create_requests: {columns:'owner id payload_hash result_json created_at', key:'owner id'},
    doc_scan_state: {columns:'owner watermark', key:'owner'},
    doc_migrations: {columns:'name applied_at', key:'name'},
    doc_mirror_state: {columns:'owner ref sig links', key:'owner ref'},
    doc_suggestions: {columns:'owner ref hash', key:'owner ref hash'},
    doc_props: {columns:'owner ref key value by updated_at', key:'owner ref key'},
    doc_prop_types: {columns:'owner key type', key:'owner key'},
    doc_status: {columns:'owner ref status basis updated_at', key:'owner ref'},
  }
  for (const [name, spec] of Object.entries(tables)) {
    const columns = db.query(`PRAGMA table_info(${name})`).all() as {name:string;type:string;notnull:number;pk:number}[]
    const present = new Set(columns.map(c=>c.name))
    const key = columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name).join(' ')
    if (spec.columns.split(' ').some(c=>!present.has(c)) || key !== spec.key) throw new Error(`Incompatible docs schema: ${name}`)
    const integers = new Set(['created_at','updated_at','archived','version','chars','person_edited','watermark','applied_at','done','position'])
    const nullable = new Set(['area','source','mirror_path','src_sig','due','parent_id','position','archived_with','parent','folders'])
    for (const column of columns.filter(c=>spec.columns.split(' ').includes(c.name) || ((name==='docs' || name==='doc_index') && ['due','done'].includes(c.name)))) {
      const type = integers.has(column.name) ? 'INTEGER' : 'TEXT'
      const singlePrimary = spec.key === column.name
      if (column.type.toUpperCase() !== type || (!nullable.has(column.name) && !column.notnull && !singlePrimary)) throw new Error(`Incompatible docs schema: ${name}.${column.name}`)
    }
  }
  const noteColumns = db.query('PRAGMA table_info(work_notes)').all() as {name:string;type:string;notnull:number;dflt_value:string|null}[]
  for (const [name,type,required,defaultValue] of [['md','TEXT',false,null],['version','INTEGER',true,'1'],['created_at','INTEGER',false,null],['person_edited','INTEGER',true,'0']] as const) {
    const column = noteColumns.find(c=>c.name===name)
    if (!column || column.type.toUpperCase() !== type || (required && (!column.notnull || column.dflt_value !== defaultValue))) throw new Error(`Incompatible docs schema: work_notes.${name}`)
  }
  const fts = db.query("SELECT sql FROM sqlite_master WHERE name='doc_fts'").get() as {sql:string}|null
  if (!fts || !/USING\s+fts5\s*\(/i.test(fts.sql) || !/tokenize\s*=\s*['"]trigram['"]/i.test(fts.sql) || !/\bowner\s+UNINDEXED\b/i.test(fts.sql) || !/\bref\s+UNINDEXED\b/i.test(fts.sql)) throw new Error('Incompatible docs schema: doc_fts')
  const ftsColumns = db.query('PRAGMA table_info(doc_fts)').all() as {name:string}[]
  if (ftsColumns.map(c=>c.name).join(' ') !== 'owner ref title body tags') throw new Error('Incompatible docs schema: doc_fts columns')
}

export function initDocs(db: Database): void {
  withDocsTx(db, () => {
    const columns = new Set((db.query("PRAGMA table_info(work_notes)").all() as {name: string}[]).map(c => c.name))
    for (const [name, definition] of [["md", "TEXT"], ["version", "INTEGER NOT NULL DEFAULT 1"], ["created_at", "INTEGER"], ["person_edited", "INTEGER NOT NULL DEFAULT 0"]]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE work_notes ADD COLUMN ${name} ${definition}`)
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs(owner TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,area TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS doc_tags(owner TEXT NOT NULL,ref TEXT NOT NULL,tag TEXT NOT NULL,by TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,ref,tag));
      CREATE TABLE IF NOT EXISTS doc_tag_sources(owner TEXT NOT NULL,ref TEXT NOT NULL,tag TEXT NOT NULL,by TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,ref,tag,by));
      CREATE TABLE IF NOT EXISTS doc_index(owner TEXT NOT NULL,ref TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,area TEXT,status TEXT NOT NULL,source TEXT,updated_at INTEGER NOT NULL,created_at INTEGER NOT NULL,version INTEGER NOT NULL,chars INTEGER NOT NULL,person_edited INTEGER NOT NULL,mirror_path TEXT,PRIMARY KEY(owner,ref));
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(owner UNINDEXED,ref UNINDEXED,title,body,tags,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS doc_idempotency(owner TEXT NOT NULL,ref TEXT NOT NULL,key TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(owner,ref,key));
      CREATE TABLE IF NOT EXISTS doc_once(owner TEXT NOT NULL,ref TEXT NOT NULL,key TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,ref,key));
      CREATE TABLE IF NOT EXISTS doc_create_requests(owner TEXT NOT NULL,id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS doc_scan_state(owner TEXT PRIMARY KEY,watermark INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS doc_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS doc_mirror_state(owner TEXT NOT NULL,ref TEXT NOT NULL,sig TEXT NOT NULL,links TEXT NOT NULL,PRIMARY KEY(owner,ref));
      CREATE TABLE IF NOT EXISTS doc_suggestions(owner TEXT NOT NULL,ref TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,ref,hash));
    `)
    const indexColumns = new Set((db.query('PRAGMA table_info(doc_index)').all() as {name:string}[]).map(c=>c.name))
    if (!indexColumns.has('src_sig')) db.exec('ALTER TABLE doc_index ADD COLUMN src_sig TEXT')
    if (!indexColumns.has('parent')) db.exec('ALTER TABLE doc_index ADD COLUMN parent TEXT')
    if (!indexColumns.has('folders')) db.exec('ALTER TABLE doc_index ADD COLUMN folders TEXT')
    // 메타데이터(L5): 칸·표 추가만. due 칸을 처음 만들 때는 기존 색인 행의 due 를 먼저 채워 둔다
    // (그러지 않으면 아래 rebuild 가 due 를 '바뀐 메타데이터'로 보고 모든 문서 version 을 올린다)
    const addedIndexDue = !indexColumns.has('due')
    if (addedIndexDue) db.exec('ALTER TABLE doc_index ADD COLUMN due TEXT')
    const docColumns = new Set((db.query('PRAGMA table_info(docs)').all() as {name:string}[]).map(c=>c.name))
    if (!docColumns.has('due')) db.exec('ALTER TABLE docs ADD COLUMN due TEXT')
    if (!docColumns.has('done')) db.exec('ALTER TABLE docs ADD COLUMN done INTEGER NOT NULL DEFAULT 0')
    if (!docColumns.has('parent_id')) db.exec('ALTER TABLE docs ADD COLUMN parent_id TEXT')
    if (!docColumns.has('position')) db.exec('ALTER TABLE docs ADD COLUMN position INTEGER')
    if (!docColumns.has('archived_with')) db.exec('ALTER TABLE docs ADD COLUMN archived_with TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS docs_owner_parent ON docs(owner,parent_id)')
    db.exec(`
      CREATE TABLE IF NOT EXISTS doc_props(owner TEXT NOT NULL,ref TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,by TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,ref,key));
      CREATE TABLE IF NOT EXISTS doc_prop_types(owner TEXT NOT NULL,key TEXT NOT NULL,type TEXT NOT NULL,PRIMARY KEY(owner,key));
      CREATE TABLE IF NOT EXISTS doc_status(owner TEXT NOT NULL,ref TEXT NOT NULL,status TEXT NOT NULL,basis TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,ref));
    `)
    db.exec('CREATE INDEX IF NOT EXISTS runs_owner_thread ON runs(owner, COALESCE(thread,id))')
    validateSchema(db)
    if (!db.query("SELECT 1 FROM doc_migrations WHERE name='hierarchy-v1'").get()) {
      const collisions=db.query("SELECT owner,COUNT(DISTINCT ref) AS count FROM doc_props WHERE lower(key)='parent' GROUP BY owner").all() as {owner:string;count:number}[]
      for (const row of collisions) console.info('[docs] hierarchy legacy parent properties',row.owner,row.count)
      db.query('INSERT INTO doc_migrations VALUES (?,?)').run('hierarchy-v1',Date.now())
    }
    if (addedIndexDue) backfillIndexDue(db)
    const rows = db.query("SELECT owner,ref,html,text FROM work_notes WHERE md IS NULL").all() as {owner:string;ref:string;html:string;text:string}[]
    const update = db.query("UPDATE work_notes SET md=? WHERE owner=? AND ref=?")
    for (const row of rows) update.run(noteMarkdown(db, row.html, row.text), row.owner, row.ref)
    db.exec("UPDATE work_notes SET created_at=updated_at WHERE created_at IS NULL")
    if (!db.query("SELECT 1 FROM doc_migrations WHERE name=?").get("initial_person_edited")) {
      db.exec("UPDATE work_notes SET person_edited=1")
      db.query("INSERT INTO doc_migrations VALUES (?,?)").run("initial_person_edited", Date.now())
    }
    if (!db.query("SELECT 1 FROM doc_migrations WHERE name=?").get("tag_sources_backfill")) {
      db.exec("INSERT OR IGNORE INTO doc_tag_sources(owner,ref,tag,by,created_at) SELECT owner,ref,tag,by,created_at FROM doc_tags")
      db.query("INSERT INTO doc_migrations VALUES (?,?)").run("tag_sources_backfill", Date.now())
    }
    const owners = db.query("SELECT owner FROM work_notes UNION SELECT owner FROM doc_index").all() as {owner:string}[]
    for (const {owner} of owners) rebuildOwner(db, owner)
    refreshChanged(db)
  })
  startDocsRefresh(db)
}
