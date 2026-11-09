import { test, expect, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initWorks, worksApi } from '../works.ts'
import { initDocs, setHtmlToMarkdown, stopDocsRefresh } from '../docs/storage.ts'
import { createDocsOps } from '../docs/ops.ts'
import { putNote } from '../docs/document.ts'
import { rebuildVault, setVaultSink } from '../docs/sink.ts'
import { createVaultSink, htmlToMarkdown, noteHtmlToMarkdown } from './index.ts'
import { backfillNoteMarkdown } from './backfill.ts'
import * as converters from './html-to-markdown.ts'

function setup() {
  const db = new Database(':memory:'); initWorks(db)
  db.exec(`CREATE TABLE boards(id TEXT PRIMARY KEY, kind TEXT, owner TEXT, meta TEXT, deleted INTEGER, updated_at INTEGER);
    CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, deleted INTEGER, updated_at INTEGER);
    CREATE TABLE signals(id TEXT, owner TEXT, title TEXT, area TEXT, source TEXT, status TEXT, updated_at INTEGER);
    CREATE TABLE runs(id TEXT, owner TEXT, thread TEXT, prompt TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`)
  initDocs(db)
  return { db, ops: createDocsOps(db,{act:()=>({results:[]})}) }
}

test('backfill preserves source fields and original markdown, reindexes and rejects stale writes', () => {
  const {db,ops}=setup()
  try {
    const source=ops.create('a',{title:'Source',md:'# Source\n\n*original*'},'person')
    const human=ops.create('a',{title:'Human',md:'legacy text'},'person')
    const agent=ops.create('a',{title:'Agent',md:'agent text'},'agent')
    const failed=ops.create('a',{title:'Failed',md:'failed text'},'person')
    const skipped=ops.create('a',{title:'Skipped',md:'unchanged'},'person')
    const html='<p><strong>legacy</strong> text</p>'
    const update=db.query('UPDATE work_notes SET html=? WHERE ref=?')
    update.run(html,human.ref); update.run('<p><strong>agent</strong> text</p>',agent.ref)
    update.run('<u>failed</u>',failed.ref); update.run('<span>unchanged</span>',skipped.ref)
    const before=db.query('SELECT * FROM work_notes WHERE ref=?').get(human.ref) as {version:number; [key:string]:unknown}
    const untouched=[source.ref,agent.ref,failed.ref].map(ref=>db.query('SELECT * FROM work_notes WHERE ref=?').get(ref))
    expect(backfillNoteMarkdown(db,htmlToMarkdown,()=>{throw Error('conversion failed')})).toEqual({changed:1,failed:1,skipped:1})
    expect(db.query('SELECT * FROM work_notes WHERE ref=?').get(human.ref)).toEqual({...before,md:'**legacy** text',version:before.version+1})
    expect([source.ref,agent.ref,failed.ref].map(ref=>db.query('SELECT * FROM work_notes WHERE ref=?').get(ref))).toEqual(untouched)
    expect(db.query('SELECT body FROM doc_fts WHERE owner=? AND ref=?').get('a',human.ref)).toEqual({body:'**legacy** text'})
    expect(ops.fetch('a',{ref:human.ref}).markdown).toBe('**legacy** text')
    try { putNote(db,'a',human.ref,{html,text:'legacy text',expectedVersion:before.version},'person'); throw Error('expected conflict') }
    catch (e:unknown) { expect((e as {status:number}).status).toBe(409) }
    expect(backfillNoteMarkdown(db)).toEqual({changed:0,failed:0,skipped:0})
  } finally { stopDocsRefresh(db); db.close() }
})

test('empty conversion is skipped on the initial pass', () => {
  const {db,ops}=setup()
  try {
    const {ref}=ops.create('a',{title:'Empty',md:'original'},'person')
    db.query('UPDATE work_notes SET html=? WHERE ref=?').run('<span>original</span>',ref)
    expect(backfillNoteMarkdown(db,()=> '')).toEqual({changed:0,failed:0,skipped:1})
    expect(ops.fetch('a',{ref}).markdown).toBe('original')
  } finally {stopDocsRefresh(db);db.close()}
})

test('backfill tries lenient conversion after strict rejection', () => {
  const {db,ops}=setup()
  try {
    const {ref}=ops.create('a',{title:'Lenient',md:'legacy'},'person')
    db.query('UPDATE work_notes SET html=? WHERE ref=?').run('<u><strong>legacy</strong></u>',ref)
    expect(backfillNoteMarkdown(db)).toEqual({changed:1,failed:0,skipped:0})
    expect(ops.fetch('a',{ref}).markdown).toContain('legacy')
    expect(ops.fetch('a',{ref}).version).toBe(2)
  } finally {stopDocsRefresh(db);db.close()}
})

test('lenient backfill keeps the rendered meaning of named entities', () => {
  const {db,ops}=setup()
  try {
    const {ref}=ops.create('a',{title:'Entity',md:'legacy'},'person')
    db.query('UPDATE work_notes SET html=? WHERE ref=?').run('<u>&eacute; <strong>legacy</strong></u>',ref)
    expect(backfillNoteMarkdown(db)).toEqual({changed:1,failed:0,skipped:0})
    expect(Bun.markdown.html(ops.fetch('a',{ref}).markdown)).toContain('é')
  } finally {stopDocsRefresh(db);db.close()}
})

test('one-time backfill marker protects later explicitly saved markdown', () => {
  const {db,ops}=setup()
  try {
    const {ref}=ops.create('a',{title:'Marker',md:'abc'},'person')
    db.query('UPDATE work_notes SET html=? WHERE ref=?').run('<p><strong>abc</strong></p>',ref)
    expect(backfillNoteMarkdown(db)).toEqual({changed:1,failed:0,skipped:0})
    expect(db.query("SELECT name FROM doc_migrations WHERE name='note_md_from_html'").get()).toEqual({name:'note_md_from_html'})
    putNote(db,'a',ref,{html:'<p><strong>abc</strong></p>',text:'abc',md:'abc'},'person')
    expect(backfillNoteMarkdown(db)).toEqual({changed:0,failed:0,skipped:0})
    expect(ops.fetch('a',{ref}).markdown).toBe('abc')
  } finally {stopDocsRefresh(db);db.close()}
})

test('unsupported HTML saves image and link targets and labels', async () => {
  const {db,ops}=setup(); setHtmlToMarkdown(db,noteHtmlToMarkdown)
  try {
    const {ref}=ops.create('a',{title:'Links',md:''},'agent')
    const html='<u>Look <img src="https://example.com/a.png" alt="diagram"> <a href="https://example.com/page">link label</a></u>'
    const url=new URL('http://local/api/work/'+encodeURIComponent(ref)+'/note')
    const res=(await worksApi(db,new Request(url,{method:'PUT',body:JSON.stringify({html,text:'Look diagram link label'})}),url,{email:'a',agent:false},url.pathname.split('/').filter(Boolean)))!
    expect(res.status).toBe(200)
    const md=ops.fetch('a',{ref}).markdown
    for(const value of ['diagram','https://example.com/a.png','link label','https://example.com/page']) expect(md).toContain(value)
  } finally {stopDocsRefresh(db);db.close()}
})

test('last resort preserves image and link labels and targets if lenient conversion throws', () => {
  const converter=spyOn(converters,'htmlToMarkdownLenient').mockImplementation(()=>{throw Error('failure')})
  const warning=spyOn(console,'warn').mockImplementation(()=>{})
  try {
    const html='<u>Look <img src="https://example.com/a.png" alt="diagram"> <a href="https://example.com/page">link label</a></u>'
    const md=noteHtmlToMarkdown(html)
    expect(md).toContain('![diagram](<https://example.com/a.png>)')
    expect(md).toContain('[link label](<https://example.com/page>)')
    expect(warning).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warning.mock.calls)).not.toContain('example.com')
    const suppressed=noteHtmlToMarkdown('<script>visible fallback</script>')
    expect(suppressed.length).toBeGreaterThan(0)
    expect(suppressed).not.toContain('visible fallback')
  } finally {converter.mockRestore();warning.mockRestore()}
})

test('PUT conversion handles blank HTML, unsupported tags and explicit markdown', async () => {
  const {db,ops}=setup(); setHtmlToMarkdown(db,noteHtmlToMarkdown)
  try {
    const call=async (ref:string,body:unknown,agent=false)=>{const url=new URL('http://local/api/work/'+encodeURIComponent(ref)+'/note'); return (await worksApi(db,new Request(url,{method:'PUT',body:JSON.stringify(body)}),url,{email:'a',agent},url.pathname.split('/').filter(Boolean)))!}
    for (const agent of [false,true]) for (const explicit of [false,true]) {
      const {ref}=ops.create('a',{title:`Case ${agent} ${explicit}`,md:''},agent?'agent':'person')
      const res=await call(ref,{html:'  ',text:'plain',...(explicit?{md:'explicit'}:{})},agent)
      expect(res.status).toBe(200); expect(ops.fetch('a',{ref}).markdown).toBe(explicit?'explicit':'plain')
    }
    const {ref}=ops.create('a',{title:'Rich',md:''},'agent')
    expect((await call(ref,{html:'<p><strong>rich</strong> text</p>',text:'rich text'})).status).toBe(200)
    expect(ops.fetch('a',{ref}).markdown).toBe('**rich** text')
    for (const html of ['<p><u>A &amp; B</u></p><p>next</p>','<table><tr><td>A</td><td>B</td></tr></table>']) {
      expect((await call(ref,{html,text:'fallback'})).status).toBe(200)
      const md=ops.fetch('a',{ref}).markdown; expect(md).toContain('A'); expect(md).toContain('B'); expect(md).not.toContain('<')
    }
    const converted=noteHtmlToMarkdown('<p><u>A &amp; B</u></p><p>next</p>')
    expect(Bun.markdown.html(converted)).toContain('A &amp; B'); expect(converted).toContain('next')
    expect(noteHtmlToMarkdown('<u>&eacute; &#x1F600;</u>')).toContain('é 😀')
    expect(typeof noteHtmlToMarkdown('<p>broken')).toBe('string')
  } finally { stopDocsRefresh(db); db.close() }
})

test('an indexing failure rolls back all backfilled rows and projections', () => {
  const {db,ops}=setup()
  try {
    const first=ops.create('a',{title:'First',md:'one'},'person')
    const second=ops.create('a',{title:'Second',md:'two'},'person')
    const update=db.query('UPDATE work_notes SET html=? WHERE ref=?')
    update.run('<p><strong>one</strong></p>',first.ref)
    update.run('<p><strong>two</strong></p>',second.ref)
    const before=db.query('SELECT ref,md,version FROM work_notes ORDER BY ref').all()
    const fts=db.query('SELECT ref,body FROM doc_fts ORDER BY ref').all()
    db.exec("CREATE TRIGGER fail_projection BEFORE UPDATE ON doc_index BEGIN SELECT RAISE(ABORT,'projection failed'); END")
    expect(()=>backfillNoteMarkdown(db)).toThrow('projection failed')
    expect(db.query('SELECT ref,md,version FROM work_notes ORDER BY ref').all()).toEqual(before)
    expect(db.query('SELECT ref,body FROM doc_fts ORDER BY ref').all()).toEqual(fts)
    expect(db.query("SELECT name FROM doc_migrations WHERE name='note_md_from_html'").get()).toBeNull()
  } finally {stopDocsRefresh(db);db.close()}
})

test('vault rebuild makes files but mirror_path is populated by a later update', async () => {
  const {db,ops}=setup(); const root=await mkdtemp('/tmp/l2-backfill-test-')
  try {
    const {ref}=ops.create('a',{title:'Mirror',md:'first'},'person')
    setVaultSink(db,createVaultSink(root)); await rebuildVault(db,'a')
    expect((await readdir(join(root,'문서'))).filter(x=>x.endsWith('.md'))).toHaveLength(1)
    expect(await readFile(join(root,'_index.md'),'utf8')).toContain('Mirror')
    expect(db.query('SELECT mirror_path FROM doc_index WHERE ref=?').get(ref)).toEqual({mirror_path:null})
    putNote(db,'a',ref,{html:'',text:'second'},'person')
    await rebuildVault(db,'a')
    expect((db.query('SELECT mirror_path FROM doc_index WHERE ref=?').get(ref) as {mirror_path:string}).mirror_path).toMatch(/^문서\/.+\.md$/)
  } finally { setVaultSink(db); stopDocsRefresh(db); db.close() }
})
