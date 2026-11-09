import { test, expect } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { createVaultSink } from "./index"
import type { DocRecord } from "@direction-board/contracts/docs"

const doc: DocRecord = { owner: "alice", ref: "doc:1", kind: "doc", title: "한글", area: null, status: "open", due: null, props: [], source: null, tags: [], links: [], md: "본문\n", version: 1, personEdited: false, createdAt: 1, updatedAt: 2 }

test("upsert writes a managed markdown document", async () => {
  const root = await mkdtemp("/tmp/l2-vault-")
  const { path } = await createVaultSink(root).upsert(doc)
  expect(path).toMatch(/^문서\/한글--[a-f0-9]{16}\.md$/)
  expect(await readFile(join(root, path), "utf8")).toEndWith("본문\n")
})

import { mkdir, readdir, symlink, writeFile, unlink, lstat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

const make = (overrides: Partial<DocRecord> = {}): DocRecord => ({ ...doc, ...overrides })
const temp = () => mkdtemp("/tmp/l2-vault-")
const hash16 = (owner: string, ref: string) => createHash("sha256").update(JSON.stringify([owner, ref])).digest("hex").slice(0, 16)

test("five kinds, safe slugs, YAML and unchanged body", async () => {
  const root = await temp(), sink = createVaultSink(root)
  for (const [i, [kind, folder]] of ([['todo','할일'],['goal','목표'],['signal','사건'],['run','대화'],['doc','문서']] as const).entries()) {
    const item = make({ kind, ref: `ref:${i}`, title: '한글 /\\:*?"<>| 제목', area: 'a: "b"\nline', source: null, tags: [{tag:'태그: #\n',by:'person'}], links: [{ref:'ref:2',label:'a',direction:'in'},{ref:'ref:2',label:'b',direction:'out'}], md: '---\n본문\n끝  ' })
    const { path } = await sink.upsert(item)
    expect(path).toBe(`${folder}/한글 _________ 제목--${hash16('alice',item.ref)}.md`)
    const text = await readFile(join(root,path),'utf8')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!
    expect(Bun.YAML.parse(match[1])).toEqual({ref:item.ref,kind,title:item.title,area:item.area,status:'open',tags:['태그: #\n'],links:['ref:2'],version:1,created:1,updated:2,source:null,due:null})
    expect(match[2]).toBe(item.md)
  }
  const long = await sink.upsert(make({ref:'long', title:'가'.repeat(90)}))
  expect(long.path.split('/')[1].split('--')[0]).toBe('가'.repeat(60))
  const reserved = await sink.upsert(make({ref:'reserved', title:'CON. '}))
  expect(reserved.path).toContain('/_CON--')
  const empty = await sink.upsert(make({ref:'empty', title:'  ... '}))
  expect(empty.path).toContain('/untitled--')
  for (const dir of [root, join(root,'문서')]) expect((await readdir(dir)).filter(n => n.startsWith('.vault-tmp-'))).toEqual([])
})

test("rename, restart, owner isolation, rebuild and validation", async () => {
  const root = await temp(), sink = createVaultSink(root)
  const old = await sink.upsert(make())
  const other = await sink.upsert(make({owner:'bob', title:'Bob'}))
  const changed = await sink.upsert(make({kind:'goal',title:'새 이름'}))
  expect(await Bun.file(join(root,old.path)).exists()).toBe(false)
  expect(await Bun.file(join(root,changed.path)).exists()).toBe(true)
  const restarted = createVaultSink(root)
  const before = await readdir(root)
  await expect(restarted.rebuild('alice',[make(),make()])).rejects.toThrow()
  await expect(restarted.rebuild('alice',[make({owner:'bob'})])).rejects.toThrow()
  expect(await readdir(root)).toEqual(before)
  expect(await restarted.rebuild('alice',[])).toEqual({written:0,removed:1})
  expect(await Bun.file(join(root,changed.path)).exists()).toBe(false)
  expect(await Bun.file(join(root,other.path)).exists()).toBe(true)
  await restarted.remove('bob','doc:1')
  expect(await Bun.file(join(root,other.path)).exists()).toBe(false)
  await restarted.remove('bob','missing')
})

test("unmanaged and edited files are never overwritten", async () => {
  const root = await temp(), sink = createVaultSink(root)
  await mkdir(join(root,'문서'))
  const path = `문서/한글--${hash16('alice','doc:1')}.md`
  await writeFile(join(root,path),'human')
  await expect(sink.upsert(make())).rejects.toThrow()
  expect(await readFile(join(root,path),'utf8')).toBe('human')
  await unlink(join(root,path))
  await sink.upsert(make())
  await writeFile(join(root,path),'edited')
  await expect(sink.remove('alice','doc:1')).rejects.toThrow()
  expect(await readFile(join(root,path),'utf8')).toBe('edited')
})

test("indexes sort and rendered links point to actual files", async () => {
  const root = await temp(), sink = createVaultSink(root)
  const a = make({ref:'a',title:'괄호 (# [제목]',updatedAt:3,tags:[{tag:'공통',by:'person'}]})
  const b = make({ref:'b',title:'둘',updatedAt:9,tags:[{tag:'공통',by:'person'}]})
  const paths = (await Promise.all([sink.upsert(a),sink.upsert(b)])).map(x=>x.path)
  for (const name of ['_index.md','_tags.md']) {
    const md = await readFile(join(root,name),'utf8')
    const html = Bun.markdown.html(md)
    expect(html.indexOf('둘')).toBeLessThan(html.indexOf('괄호'))
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => decodeURIComponent(m[1]))
    expect(hrefs.sort()).toEqual(paths.slice().sort())
    for (const path of hrefs) expect(await Bun.file(join(root,path)).exists()).toBe(true)
  }
})

test("parallel calls serialize, reject symlinks and forged metadata", async () => {
  const root = await temp(), sink = createVaultSink(root)
  const paths = await Promise.all(Array.from({length:20},(_,i)=>sink.upsert(make({ref:`doc:${i}`,title:`문서 ${i}`}))))
  expect(new Set(paths.map(x=>x.path)).size).toBe(20)
  const root2 = await temp(), outside = await temp()
  await symlink(outside, join(root2,'문서'))
  await expect(createVaultSink(root2).upsert(make())).rejects.toThrow()
  expect(await readdir(outside)).toEqual([])
  const root3 = await temp()
  await writeFile(join(root3,'.vault-intent.json'),'{}')
  await expect(createVaultSink(root3).upsert(make())).rejects.toThrow()
  expect(await readFile(join(root3,'.vault-intent.json'),'utf8')).toBe('{}')
})

const childCode = `
import * as fs from 'node:fs/promises';
import { mock } from 'bun:test';
const original = { link: fs.link, rename: fs.rename, unlink: fs.unlink };
const moved = new Map();
const [root, moduleUrl, stage, mode] = process.argv.slice(2);
const gate = async (name) => {
  if (name !== stage) return;
  if (mode === 'throw') { const e = new Error('injected ENOSPC'); e.code = 'ENOSPC'; throw e; }
  process.stdout.write('READY\\n');
  await new Promise(() => setInterval(() => {}, 10000));
};
mock.module('node:fs/promises', () => ({...fs,
  link: async (a,b) => { const name = b.endsWith('/.vault-ledger.json') ? 'init' : b.endsWith('/_index.md') ? 'index' : b.endsWith('/_tags.md') ? 'tags' : b.endsWith('.md') ? 'document' : 'other'; await gate(name+'-before'); const result = await original.link(a,b); await gate(name+'-after'); return result; },
  rename: async (a,b) => { const name = b.endsWith('/.vault-ledger.json') ? 'ledger' : b.includes('/.vault-old-') ? 'displace' : 'other'; await gate(name+'-before'); const result = await original.rename(a,b); if (b.includes('/.vault-old-')) moved.set(b,a); await gate(name+'-after'); return result; },
  unlink: async (a) => { const source = moved.get(a) || ''; const name = a.endsWith('/.vault-intent.json') ? 'intent' : source.endsWith('.md') && !source.endsWith('/_index.md') && !source.endsWith('/_tags.md') ? 'delete' : 'other'; await gate(name+'-before'); const result = await original.unlink(a); await gate(name+'-after'); return result; },
}));
const { createVaultSink } = await import(moduleUrl);
try { await createVaultSink(root).upsert({owner:'alice',ref:'doc:1',kind:'goal',title:'새 이름',area:null,status:'open',source:null,tags:[{tag:'새태그',by:'person'}],links:[],md:'새 본문',version:2,personEdited:false,createdAt:1,updatedAt:3}); }
catch(e) { console.error(e.message); process.exit(7); }
`
async function startChild(root: string, stage: string, mode: 'throw'|'kill') {
  const script = join(root,'child.js')
  await writeFile(script, childCode)
  const url = pathToFileURL(join(import.meta.dir,'index.ts')).href
  return Bun.spawn([process.execPath,script,root,url,stage,mode],{stdout:'pipe',stderr:'pipe'})
}

test("recover every interrupted publication stage after ENOSPC", async () => {
  for (const stage of ['document-before','document-after','index-before','index-after','tags-before','tags-after','delete-before','delete-after','ledger-before','ledger-after','intent-before']) {
    const root = await temp(), sink = createVaultSink(root)
    const old = await sink.upsert(make())
    const child = await startChild(root,stage,'throw')
    expect(await child.exited, stage).toBe(7)
    expect(await new Response(child.stderr).text()).toContain('ENOSPC')
    await createVaultSink(root).remove('nobody','none')
    expect(await Bun.file(join(root,old.path)).exists()).toBe(false)
    const index = await readFile(join(root,'_index.md'),'utf8')
    expect(index).toContain('새 이름')
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
  }
}, 30000)

test("actual killed writers leave lock and recover after operator removal", async () => {
  for (const stage of ['init-before','init-after','ledger-before','ledger-after','intent-before']) {
    const root = await temp(), sink = createVaultSink(root)
    if (!stage.startsWith('init')) await sink.upsert(make())
    const child = await startChild(root,stage,'kill')
    const output = child.stdout.getReader()
    const next = await Promise.race([output.read(), Bun.sleep(5000).then(()=>{ throw new Error(`child did not reach ${stage}`) })])
    expect(new TextDecoder().decode(next.value)).toContain('READY')
    child.kill('SIGKILL')
    await child.exited
    expect(await Bun.file(join(root,'.vault-lock')).exists()).toBe(true)
    await expect(createVaultSink(root).remove('alice','nothing')).rejects.toThrow()
    await unlink(join(root,'.vault-lock'))
    const recovered = createVaultSink(root)
    if (stage.startsWith('init')) await recovered.upsert(make())
    else await recovered.remove('nobody','none')
    const index = await readFile(join(root,'_index.md'),'utf8')
    expect(index).toContain(stage.startsWith('init') ? '한글' : '새 이름')
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
  }
}, 30000)

test("recovery preserves files edited after interruption and refuses corrupt intents", async () => {
  for (const stage of ['ledger-before','ledger-after']) {
    const root = await temp(), sink = createVaultSink(root)
    await sink.upsert(make())
    const child = await startChild(root,stage,'throw')
    expect(await child.exited).toBe(7)
    const indexPath = join(root,'_index.md')
    await writeFile(indexPath,'human edit')
    const ledgerBefore = await readFile(join(root,'.vault-ledger.json'),'utf8')
    const intentBefore = await readFile(join(root,'.vault-intent.json'),'utf8')
    await expect(createVaultSink(root).remove('alice','doc:1')).rejects.toThrow()
    expect(await readFile(indexPath,'utf8')).toBe('human edit')
    expect(await readFile(join(root,'.vault-ledger.json'),'utf8')).toBe(ledgerBefore)
    expect(await readFile(join(root,'.vault-intent.json'),'utf8')).toBe(intentBefore)
    await writeFile(join(root,'.vault-intent.json'),'forged')
    await expect(createVaultSink(root).remove('alice','doc:1')).rejects.toThrow()
    expect(await readFile(join(root,'.vault-intent.json'),'utf8')).toBe('forged')
  }
})

test("measure a synthetic 300 document rebuild and single upsert", async () => {
  const root = await temp(), sink = createVaultSink(root)
  const docs = Array.from({length:300},(_,i)=>make({ref:`doc:${i}`,title:`문서 ${i}`,updatedAt:i}))
  expect(await sink.rebuild('alice',docs)).toEqual({written:300,removed:0})
  const rebuildTimes: number[] = [], upsertTimes: number[] = []
  for (let i = 0; i < 5; i++) {
    docs[0] = {...docs[0], md:`upsert ${i}`, updatedAt:400+i}
    let start = performance.now()
    await sink.upsert(docs[0])
    upsertTimes.push(performance.now()-start)
    docs[1] = {...docs[1], md:`rebuild ${i}`, updatedAt:500+i}
    start = performance.now()
    expect(await sink.rebuild('alice',docs)).toEqual({written:300,removed:0})
    rebuildTimes.push(performance.now()-start)
  }
  const median = (times: number[]) => [...times].sort((a,b)=>a-b)[2]
  const rebuildMs = median(rebuildTimes), upsertMs = median(upsertTimes)
  console.log(`vault synthetic 300 median of 5: rebuild=${rebuildMs.toFixed(1)}ms upsert=${upsertMs.toFixed(1)}ms`)
  expect(upsertMs).toBeLessThan(300)
}, 30000)

test("Unicode and case collisions and managed-file symlinks fail closed", async () => {
  const root = await temp(), sink = createVaultSink(root)
  const first = await sink.upsert(make({title:'Straße'}))
  await expect(sink.upsert(make({title:'STRASSE'}))).rejects.toThrow()
  expect(await Bun.file(join(root,first.path)).exists()).toBe(true)
  const content = await readFile(join(root,first.path),'utf8')
  const outside = await temp()
  await writeFile(join(outside,'note'),content)
  await unlink(join(root,first.path))
  await symlink(join(outside,'note'), join(root,first.path))
  await expect(sink.remove('alice','doc:1')).rejects.toThrow()
  expect((await lstat(join(root,first.path))).isSymbolicLink()).toBe(true)
  expect(await readFile(join(outside,'note'),'utf8')).toBe(content)
})

import { Storage, serial } from './storage'

test('B1: recovery rechecks replacement and deletion immediately before mutation', async () => {
  for (const target of ['_index.md', 'old-document']) {
    const root = await temp(), sink = createVaultSink(root)
    const old = await sink.upsert(make())
    const child = await startChild(root,'index-before','throw')
    expect(await child.exited).toBe(7)
    const targetPath = target === 'old-document' ? old.path : target
    const originalRead = Storage.prototype.read
    let injected = false
    Storage.prototype.read = async function(path) {
      const result = await originalRead.call(this,path)
      if (path === targetPath && !injected) {
        injected = true
        await writeFile(join(root,path),'human edit after validation')
      }
      return result
    }
    try { await expect(createVaultSink(root).remove('nobody','none')).rejects.toThrow() }
    finally { Storage.prototype.read = originalRead }
    expect(injected).toBe(true)
    expect(await readFile(join(root,targetPath),'utf8')).toBe('human edit after validation')
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
  }
})

test('B2: incrementals leave unrelated edits for rebuild to discover', async () => {
  const root = await temp(), sink = createVaultSink(root)
  const a = make({ref:'a', title:'a'}), b = make({ref:'b', title:'b'}), c = make({ref:'c', title:'c'})
  const result = await sink.rebuild('alice',[a,b,c])
  expect(result.written).toBe(3)
  const path = `문서/b--${hash16('alice','b')}.md`
  await writeFile(join(root,path),'unrelated human edit')
  const originalRead = Storage.prototype.read, observed: string[] = []
  Storage.prototype.read = async function(name) { observed.push(name); return originalRead.call(this,name) }
  try {
    await sink.upsert({...a,md:'changed'})
    await sink.remove('alice','c')
  } finally { Storage.prototype.read = originalRead }
  expect(observed).not.toContain(path)
  expect(await readFile(join(root,path),'utf8')).toBe('unrelated human edit')
  await expect(sink.rebuild('alice',[a,b])).rejects.toThrow()
  expect(await readFile(join(root,path),'utf8')).toBe('unrelated human edit')
})

test('N3: lock release error does not mask operation error', async () => {
  const root = await temp(), originalRead = Storage.prototype.read
  Storage.prototype.read = async function(path) {
    if (path === '.vault-lock') throw new Error('release failed')
    return originalRead.call(this,path)
  }
  let caught: unknown
  try { await serial(root, async () => { throw new Error('operation failed') }) } catch (e) { caught = e }
  finally { Storage.prototype.read = originalRead }
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).errors.map((e: Error) => e.message)).toEqual(['operation failed','release failed'])
})

test('N3: failed lock close removes the owned lock', async () => {
  const root = await temp(), script = join(root,'close.js')
  await writeFile(script, `
import * as fs from 'node:fs/promises'; import {mock} from 'bun:test';
const open = fs.open, access = fs.access;
mock.module('node:fs/promises',()=>({...fs,open:async (...args)=>{
 const f=await open(...args); if(!String(args[0]).endsWith('/.vault-lock')) return f;
 return new Proxy(f,{get(target,prop){if(prop==='close') return async()=>{await target.close(); throw new Error('close failed')}; const v=target[prop]; return typeof v==='function'?v.bind(target):v}});
}}));
const {serial}=await import(process.argv[3]);
let error; try {await serial(process.argv[2], async()=>{})} catch(e){error=e.message}
let exists=true; try {await access(process.argv[2]+'/.vault-lock')} catch {exists=false}
console.log(JSON.stringify({error,exists}));
`)
  const child = Bun.spawn([process.execPath,script,root,pathToFileURL(join(import.meta.dir,'storage.ts')).href],{stdout:'pipe',stderr:'pipe'})
  expect(await child.exited).toBe(0)
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({error:'close failed',exists:false})
})

test('N4: tag headings render as literal text without links or HTML', async () => {
  const root = await temp(), sink = createVaultSink(root)
  await sink.upsert(make({tags:[{tag:'[bad](https://example.com)',by:'person'},{tag:'<b>tag</b>',by:'person'},{tag:'*bold*',by:'person'}]}))
  const html = Bun.markdown.html(await readFile(join(root,'_tags.md'),'utf8'))
  expect(html).not.toContain('href="https://example.com"')
  expect(html).not.toContain('<b>tag</b>')
  expect(html).not.toContain('<em>bold</em>')
  expect(html).toContain('[bad](https://example.com)')
  expect(html).toContain('&lt;b&gt;tag&lt;/b&gt;')
})

for (const mode of ['edited','symlink'] as const) {
  test(`B1 same upsert rejects ${mode} target without changing disk`, async () => {
    const root = await temp(), sink = createVaultSink(root), original = make()
    const {path} = await sink.upsert(original)
    const full = join(root,path), originalText = await readFile(full,'utf8')
    const ledgerBefore = await readFile(join(root,'.vault-ledger.json'),'utf8')
    const outside = await temp(), outsideFile = join(outside,'note')
    if (mode === 'edited') await writeFile(full,'human edit')
    else {
      await unlink(full)
      if (mode === 'symlink') { await writeFile(outsideFile,originalText); await symlink(outsideFile,full) }
    }
    await expect(sink.upsert(original)).rejects.toThrow()
    expect(await readFile(join(root,'.vault-ledger.json'),'utf8')).toBe(ledgerBefore)
    if (mode === 'edited') expect(await readFile(full,'utf8')).toBe('human edit')
    else { expect((await lstat(full)).isSymbolicLink()).toBe(true); expect(await readFile(outsideFile,'utf8')).toBe(originalText) }
  })
}

test('B1 unchanged upsert validates target but writes no vault data', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const first = await sink.upsert(original), writes: string[] = []
  const write = Storage.prototype.write
  Storage.prototype.write = async function(path,...args) { writes.push(path); return write.call(this,path,...args) }
  try { expect(await sink.upsert(original)).toEqual(first) } finally { Storage.prototype.write = write }
  expect(writes).toEqual([])
})

test('B1 missing managed file can be restored from the owner rebuild snapshot', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original), full = join(root,path)
  const expected = await readFile(full,'utf8')
  await unlink(full)
  expect(await sink.rebuild('alice',[original])).toEqual({written:1,removed:0})
  expect(await readFile(full,'utf8')).toBe(expected)
})

test('N2 failed lock stat closes handle and preserves lock with manual recovery error', async () => {
  const root = await temp(), script = join(root,'stat.js')
  await writeFile(script, `
import * as fs from 'node:fs/promises'; import {mock} from 'bun:test';
const open=fs.open, access=fs.access; let closed=false;
mock.module('node:fs/promises',()=>({...fs,open:async (...args)=>{
 const f=await open(...args); if(!String(args[0]).endsWith('/.vault-lock')) return f;
 return new Proxy(f,{get(target,prop){
  if(prop==='stat') return async()=>{const e=new Error('stat EIO');e.code='EIO';throw e};
  if(prop==='close') return async()=>{closed=true;return target.close()};
  const v=target[prop]; return typeof v==='function'?v.bind(target):v;
 }});
}}));
const {serial}=await import(process.argv[3]);
let error; try {await serial(process.argv[2],async()=>{})} catch(e){error={name:e.name,message:e.message,errors:e.errors?.map(x=>x.message)}}
let exists=true; try{await access(process.argv[2]+'/.vault-lock')}catch{exists=false}
console.log(JSON.stringify({error,exists,closed}));
`)
  const child = Bun.spawn([process.execPath,script,root,pathToFileURL(join(import.meta.dir,'storage.ts')).href],{stdout:'pipe',stderr:'pipe'})
  expect(await child.exited).toBe(0)
  const result = JSON.parse(await new Response(child.stdout).text())
  expect(result.closed).toBe(true)
  expect(result.exists).toBe(true)
  expect(result.error.name).toBe('AggregateError')
  expect(result.error.errors[0]).toContain('stat EIO')
  expect(result.error.message).toMatch(/manual/i)
})

test('B1 same upsert rejects a nonregular managed destination', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original)
  await unlink(join(root,path))
  await mkdir(join(root,path))
  await expect(sink.upsert(original)).rejects.toThrow()
  expect((await lstat(join(root,path))).isDirectory()).toBe(true)
})

test('B1 interrupted missing-file rebuild recovers without overwriting edits', async () => {
  for (const stage of ['before-restore','after-restore','edited-after-restore'] as const) {
    const root = await temp(), sink = createVaultSink(root), original = make()
    const {path} = await sink.upsert(original), full = join(root,path)
    const expected = await readFile(full,'utf8')
    await unlink(full)
    const write = Storage.prototype.write
    Storage.prototype.write = async function(name,...args) {
      if ((stage === 'before-restore' && name === path) || (stage !== 'before-restore' && name === '.vault-ledger.json')) throw new Error('injected failure')
      return write.call(this,name,...args)
    }
    try { await expect(sink.rebuild('alice',[original])).rejects.toThrow('injected failure') }
    finally { Storage.prototype.write = write }
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
    if (stage === 'edited-after-restore') {
      await writeFile(full,'human changed restore')
      await expect(createVaultSink(root).upsert(original)).rejects.toThrow()
      expect(await readFile(full,'utf8')).toBe('human changed restore')
      expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
    } else {
      expect(await createVaultSink(root).upsert(original)).toEqual({path})
      expect(await readFile(full,'utf8')).toBe(expected)
      expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
    }
  }
})

test('R rebuild leaves another owner missing document alone', async () => {
  const root = await temp(), sink = createVaultSink(root)
  const bob = make({owner:'bob',ref:'same'}), alice = make({ref:'same'})
  await sink.upsert(alice)
  const other = await sink.upsert(bob)
  await unlink(join(root,other.path))
  expect(await sink.rebuild('alice',[alice])).toEqual({written:1,removed:0})
  expect(await Bun.file(join(root,other.path)).exists()).toBe(false)
})

test('R same upsert restores missing managed document and indexes', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original), expected = await readFile(join(root,path),'utf8')
  await unlink(join(root,path)); await unlink(join(root,'_index.md')); await unlink(join(root,'_tags.md'))
  expect(await sink.upsert(original)).toEqual({path})
  expect(await readFile(join(root,path),'utf8')).toBe(expected)
  expect(await Bun.file(join(root,'_index.md')).exists()).toBe(true)
  expect(await Bun.file(join(root,'_tags.md')).exists()).toBe(true)
})

test('R remove accepts missing managed document', async () => {
  const root = await temp(), sink = createVaultSink(root)
  const {path} = await sink.upsert(make())
  await unlink(join(root,path))
  await sink.remove('alice','doc:1')
  expect(await readFile(join(root,'_index.md'),'utf8')).not.toContain('한글')
})

for (const scenario of ['title','kind','empty','owners'] as const) {
  for (const interruption of ['before-ledger','after-ledger'] as const) {
    test(`R ${scenario} rebuild recovers ${interruption} with missing documents`, async () => {
      const root = await temp(), sink = createVaultSink(root)
      const alice = make(), bob = make({owner:'bob',title:'Bob'})
      const a = await sink.upsert(alice), b = await sink.upsert(bob)
      await unlink(join(root,a.path))
      if (scenario === 'owners') await unlink(join(root,b.path))
      else await writeFile(join(root,b.path),'Bob personal edit')
      const snapshot = scenario === 'empty' ? [] : [scenario === 'title' ? {...alice,title:'바뀐 제목'} : scenario === 'kind' ? {...alice,kind:'goal' as const} : alice]
      const write = Storage.prototype.write
      Storage.prototype.write = async function(path,...args) {
        if (path === '.vault-ledger.json') {
          if (interruption === 'after-ledger') await write.call(this,path,...args)
          throw new Error('ledger interruption')
        }
        return write.call(this,path,...args)
      }
      try { await expect(sink.rebuild('alice',snapshot)).rejects.toThrow('ledger interruption') }
      finally { Storage.prototype.write = write }
      expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
      const restarted = createVaultSink(root)
      await restarted.rebuild('alice',snapshot)
      expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
      if (scenario === 'empty') expect(await Bun.file(join(root,a.path)).exists()).toBe(false)
      else {
        const next = await restarted.upsert(snapshot[0])
        expect(await Bun.file(join(root,next.path)).exists()).toBe(true)
        if (scenario === 'title' || scenario === 'kind') expect(await Bun.file(join(root,a.path)).exists()).toBe(false)
      }
      if (scenario === 'owners') {
        expect(await Bun.file(join(root,b.path)).exists()).toBe(false)
        expect(await restarted.rebuild('bob',[bob])).toEqual({written:1,removed:0})
        expect(await Bun.file(join(root,b.path)).exists()).toBe(true)
      } else expect(await readFile(join(root,b.path),'utf8')).toBe('Bob personal edit')
    })
  }
}

test('R upsert changes title when old file is missing and preserves a collision', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original)
  await unlink(join(root,path))
  const changed = await sink.upsert({...original,title:'다른 제목'})
  expect(await Bun.file(join(root,path)).exists()).toBe(false)
  expect(await Bun.file(join(root,changed.path)).exists()).toBe(true)
  await unlink(join(root,changed.path))
  const write = Storage.prototype.write
  Storage.prototype.write = async function(name,...args) {
    if (name === changed.path) await writeFile(join(root,name),'human arrived')
    return write.call(this,name,...args)
  }
  try { await expect(sink.upsert({...original,title:'다른 제목'})).rejects.toThrow() }
  finally { Storage.prototype.write = write }
  expect(await readFile(join(root,changed.path),'utf8')).toBe('human arrived')
  expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
})

test('R missing indexes regenerate on remove and rebuild while edited indexes are preserved', async () => {
  for (const action of ['remove','rebuild'] as const) {
    const root = await temp(), sink = createVaultSink(root), original = make()
    await sink.upsert(original)
    await unlink(join(root,'_index.md')); await unlink(join(root,'_tags.md'))
    if (action === 'remove') await sink.remove('alice',original.ref)
    else await sink.rebuild('alice',[original])
    expect(await Bun.file(join(root,'_index.md')).exists()).toBe(true)
    expect(await Bun.file(join(root,'_tags.md')).exists()).toBe(true)
    await writeFile(join(root,'_tags.md'),'human index')
    await expect(sink.rebuild('alice',action === 'remove' ? [] : [original])).rejects.toThrow()
    expect(await readFile(join(root,'_tags.md'),'utf8')).toBe('human index')
  }
})

for (const action of ['replace','remove'] as const) for (const mutation of ['edit','symlink'] as const) {
  test(`F1 ${action} preserves ${mutation} injected immediately before filesystem mutation`, async () => {
    const root = await temp(), outside = await temp(), sink = createVaultSink(root), original = make()
    const {path} = await sink.upsert(original), full = join(root,path), external = join(outside,'note')
    await writeFile(external,'outside content')
    const originalWrite = Storage.prototype.write, originalRemove = Storage.prototype.remove
    const inject = async () => {
      if (mutation === 'edit') await writeFile(full,'late human edit')
      else { await unlink(full); await symlink(external,full) }
    }
    Storage.prototype.write = async function(name,...args) {
      if (action === 'replace' && name === path) await inject()
      return originalWrite.call(this,name,...args)
    }
    Storage.prototype.remove = async function(name,...args) {
      if (action === 'remove' && name === path) await inject()
      return originalRemove.call(this,name,...args)
    }
    try {
      const operation = action === 'replace' ? sink.upsert({...original,md:'new body'}) : sink.remove('alice',original.ref)
      await expect(operation).rejects.toThrow()
    } finally { Storage.prototype.write = originalWrite; Storage.prototype.remove = originalRemove }
    if (mutation === 'edit') expect(await readFile(full,'utf8')).toBe('late human edit')
    else { expect((await lstat(full)).isSymbolicLink()).toBe(true); expect(await readFile(external,'utf8')).toBe('outside content') }
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
  })
}

test('F3 document titles are literal text in Bun and remark index rendering', async () => {
  const root = await temp(), sink = createVaultSink(root)
  const titles = ['<img src=x onerror=alert(1)>','A *secret*','[x](https://evil)','# heading','1. & _x_ ~y~ `z` \\','- item','+ plus','> quoted']
  await sink.rebuild('alice',titles.map((title,i)=>make({title,ref:`doc:${i}`,tags:[{tag:'shared',by:'person'}]})))
  const remarkRoot = '/tmp/l2-remark'
  for (const name of ['_index.md','_tags.md']) {
    const md = await readFile(join(root,name),'utf8')
    const outputs = [Bun.markdown.html(md)]
    if (await Bun.file(join(remarkRoot,'node_modules/unified/index.js')).exists()) {
      const code = `import {unified} from 'unified';import parse from 'remark-parse';import gfm from 'remark-gfm';import rehype from 'remark-rehype';import stringify from 'rehype-stringify';console.log(String(unified().use(parse).use(gfm).use(rehype).use(stringify).processSync(Buffer.from(process.argv[1],'base64').toString())))`
      const child = Bun.spawn([process.execPath,'-e',code,Buffer.from(md).toString('base64')],{cwd:remarkRoot,stdout:'pipe',stderr:'pipe'})
      const output = await new Response(child.stdout).text(), errors = await new Response(child.stderr).text()
      expect(await child.exited, errors).toBe(0)
      outputs.push(output)
    }
    for (const html of outputs) {
      const text = html.replace(/<[^>]*>/g,'').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
      for (const title of titles) expect(text).toContain(title)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<em>')
      expect(html).not.toContain('href="https://evil"')
      expect(html).not.toContain('<code>')
      expect(html).not.toContain('<del>')
      expect([...html.matchAll(/<a /g)].length).toBe(titles.length)
    }
  }
})

test('F1 destination occupied after move-aside preserves both files', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original), oldText = await readFile(join(root,path),'utf8')
  const storage = Storage.prototype as unknown as { moveAside: (path: string, hash: string) => Promise<string | null> }
  const originalMove = storage.moveAside
  storage.moveAside = async function(name, digest) {
    const displaced = await originalMove.call(this,name,digest)
    if (name === path) await writeFile(join(root,name),'new occupant')
    return displaced
  }
  try { await expect(sink.upsert({...original,md:'new body'})).rejects.toThrow() }
  finally { storage.moveAside = originalMove }
  expect(await readFile(join(root,path),'utf8')).toBe('new occupant')
  const leftovers = (await readdir(join(root,'문서'))).filter(name=>name.startsWith('.vault-old-'))
  expect(leftovers).toHaveLength(1)
  expect(await readFile(join(root,'문서',leftovers[0]),'utf8')).toBe(oldText)
  expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
})

test('F1 move-aside conflict preserves edited displaced file and new occupant', async () => {
  const root = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original), script = join(root,'race.js')
  await writeFile(script, `
import * as fs from 'node:fs/promises'; import {mock} from 'bun:test';
const read=fs.readFile, write=fs.writeFile;
let injected=false; const dest=process.argv[3]+'/'+process.argv[4];
mock.module('node:fs/promises',()=>({...fs,readFile:async (p,...args)=>{
 if(!injected && String(p).includes('/문서/.vault-old-')) {injected=true; await write(p,'late displaced edit'); await write(dest,'new occupant')}
 return read(p,...args);
}}));
const {createVaultSink}=await import(process.argv[2]);
try {await createVaultSink(process.argv[3]).upsert({owner:'alice',ref:'doc:1',kind:'doc',title:'한글',area:null,status:'open',source:null,tags:[],links:[],md:'changed',version:1,personEdited:false,createdAt:1,updatedAt:2});process.exit(5)}
catch(e){console.log(e.message)}
`)
  const child = Bun.spawn([process.execPath,script,pathToFileURL(join(import.meta.dir,'index.ts')).href,root,path],{stdout:'pipe',stderr:'pipe'})
  expect(await child.exited).toBe(0)
  expect(await readFile(join(root,path),'utf8')).toBe('new occupant')
  const leftovers = (await readdir(join(root,'문서'))).filter(name=>name.startsWith('.vault-old-'))
  expect(leftovers).toHaveLength(1)
  expect(await readFile(join(root,'문서',leftovers[0]),'utf8')).toBe('late displaced edit')
})

test('F1 killed process preserves displaced file through intent recovery', async () => {
  const root = await temp(), sink = createVaultSink(root)
  await sink.upsert(make())
  const child = await startChild(root,'displace-after','kill')
  const reader = child.stdout.getReader()
  const next = await Promise.race([reader.read(), Bun.sleep(5000).then(()=>{ throw new Error('child did not displace') })])
  expect(new TextDecoder().decode(next.value)).toContain('READY')
  child.kill('SIGKILL'); await child.exited
  const before = (await readdir(root)).filter(name=>name.startsWith('.vault-old-'))
  expect(before).toHaveLength(1)
  const saved = await readFile(join(root,before[0]),'utf8')
  await unlink(join(root,'.vault-lock'))
  await createVaultSink(root).remove('nobody','none')
  expect(await readFile(join(root,before[0]),'utf8')).toBe(saved)
  expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
})

test('F1 symlink inserted after path check is moved back without following it', async () => {
  const root = await temp(), outside = await temp(), sink = createVaultSink(root), original = make()
  const {path} = await sink.upsert(original), external = join(outside,'note'), script = join(root,'symlink-race.js')
  await writeFile(external,'outside content')
  await writeFile(script, `
import * as fs from 'node:fs/promises'; import {mock} from 'bun:test';
const rename=fs.rename, unlink=fs.unlink, symlink=fs.symlink; let injected=false;
const relative=process.argv[4], external=process.argv[5];
mock.module('node:fs/promises',()=>({...fs,rename:async(a,b)=>{
 if(!injected && String(a).endsWith('/'+relative) && String(b).includes('/.vault-old-')) {injected=true;await unlink(a);await symlink(external,a)}
 return rename(a,b);
}}));
const {createVaultSink}=await import(process.argv[2]);
try {await createVaultSink(process.argv[3]).upsert({owner:'alice',ref:'doc:1',kind:'doc',title:'한글',area:null,status:'open',source:null,tags:[],links:[],md:'changed',version:1,personEdited:false,createdAt:1,updatedAt:2});process.exit(5)} catch(e){}
`)
  const child = Bun.spawn([process.execPath,script,pathToFileURL(join(import.meta.dir,'index.ts')).href,root,path,external],{stdout:'pipe',stderr:'pipe'})
  expect(await child.exited).toBe(0)
  expect((await lstat(join(root,path))).isSymbolicLink()).toBe(true)
  expect(await readFile(external,'utf8')).toBe('outside content')
  expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
})

test('F1 edited index at mutation boundary is not overwritten', async () => {
  const root = await temp(), sink = createVaultSink(root)
  await sink.upsert(make())
  const write = Storage.prototype.write
  Storage.prototype.write = async function(name,...args) {
    if (name === '_index.md') await writeFile(join(root,name),'late edited index')
    return write.call(this,name,...args)
  }
  try { await expect(sink.upsert(make({title:'renamed'}))).rejects.toThrow() }
  finally { Storage.prototype.write = write }
  expect(await readFile(join(root,'_index.md'),'utf8')).toBe('late edited index')
})

const digestText = (s: string) => createHash('sha256').update(s).digest('hex')
async function legacyVault() {
  const root = await temp(), sink = createVaultSink(root), original = make({tags:[{tag:'legacy',by:'person'}]})
  await sink.upsert(original)
  const legacyIndex = '# old index renderer\n', legacyTags = '# old tags renderer\n'
  await writeFile(join(root,'_index.md'),legacyIndex)
  await writeFile(join(root,'_tags.md'),legacyTags)
  const ledgerPath = join(root,'.vault-ledger.json')
  const ledger = JSON.parse(await readFile(ledgerPath,'utf8'))
  ledger.indexes = {index:digestText(legacyIndex),tags:digestText(legacyTags)}
  const raw = JSON.stringify(ledger)
  await writeFile(ledgerPath,raw)
  return {root,sink,original,raw,ledger,legacyIndex,legacyTags}
}
for (const operation of ['same-upsert','changed-upsert','remove','rebuild'] as const) {
  test(`U1 ${operation} upgrades older index renderer output`, async () => {
    const {root,sink,original,legacyIndex,legacyTags} = await legacyVault()
    if (operation === 'same-upsert') await sink.upsert(original)
    else if (operation === 'changed-upsert') await sink.upsert({...original,md:'new body'})
    else if (operation === 'remove') await sink.remove('alice',original.ref)
    else await sink.rebuild('alice',[original])
    const index = await readFile(join(root,'_index.md'),'utf8'), tags = await readFile(join(root,'_tags.md'),'utf8')
    expect(index).not.toBe(legacyIndex); expect(tags).not.toBe(legacyTags)
    expect(index).toStartWith('# 문서 색인\n'); expect(tags).toStartWith('# 태그\n')
    const ledger = JSON.parse(await readFile(join(root,'.vault-ledger.json'),'utf8'))
    expect(ledger.indexes).toEqual({index:digestText(index),tags:digestText(tags)})
  })
}

test('U1 edited legacy index remains untouched and causes failure', async () => {
  const {root,sink,original,raw} = await legacyVault()
  await writeFile(join(root,'_index.md'),'human index edit')
  await expect(sink.upsert({...original,md:'new body'})).rejects.toThrow('vault file changed')
  expect(await readFile(join(root,'_index.md'),'utf8')).toBe('human index edit')
  expect(await readFile(join(root,'.vault-ledger.json'),'utf8')).toBe(raw)
})

for (const stage of ['old-ledger','new-ledger'] as const) {
  test(`U1 pending intent with legacy index hashes recovers at ${stage}`, async () => {
    const {root,original,raw,ledger} = await legacyVault()
    const next = JSON.stringify({...ledger,generation:ledger.generation+1})
    const intent = {version:1,owner:'alice',old:raw,oldHash:digestText(raw),next,nextHash:digestText(next),contents:{}}
    await writeFile(join(root,'.vault-intent.json'),JSON.stringify(intent))
    if (stage === 'new-ledger') await writeFile(join(root,'.vault-ledger.json'),next)
    await createVaultSink(root).upsert(original)
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
    expect(await readFile(join(root,'_index.md'),'utf8')).toStartWith('# 문서 색인\n')
    expect(await readFile(join(root,'_tags.md'),'utf8')).toStartWith('# 태그\n')
  })
}

test('U1 new intent index contents must match current rendering', async () => {
  const {root,sink,original} = await legacyVault()
  const write = Storage.prototype.write
  Storage.prototype.write = async function(path,...args) {
    if (path === '.vault-ledger.json') throw new Error('before ledger')
    return write.call(this,path,...args)
  }
  try { await expect(sink.upsert({...original,md:'changed'})).rejects.toThrow('before ledger') }
  finally { Storage.prototype.write = write }
  const path = join(root,'.vault-intent.json'), intent = JSON.parse(await readFile(path,'utf8'))
  const next = JSON.parse(intent.next), forged = '# forged new index\n'
  intent.contents['_index.md'] = forged
  next.indexes.index = digestText(forged)
  intent.next = JSON.stringify(next); intent.nextHash = digestText(intent.next)
  await writeFile(path,JSON.stringify(intent))
  await expect(createVaultSink(root).remove('alice','nothing')).rejects.toThrow('invalid intent index')
  expect(await readFile(path,'utf8')).toBe(JSON.stringify(intent))
})

for (const stage of ['before','after'] as const) {
  test(`U1 upgrades legacy indexes after ${stage} ledger interruption`, async () => {
    const {root,sink,original} = await legacyVault()
    const changed = {...original,md:'new content'}
    const write = Storage.prototype.write
    Storage.prototype.write = async function(path,...args) {
      if (path === '.vault-ledger.json') {
        if (stage === 'after') await write.call(this,path,...args)
        throw new Error('interrupted ledger')
      }
      return write.call(this,path,...args)
    }
    try { await expect(sink.upsert(changed)).rejects.toThrow('interrupted ledger') }
    finally { Storage.prototype.write = write }
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(true)
    await createVaultSink(root).upsert(changed)
    const index = await readFile(join(root,'_index.md'),'utf8')
    const tags = await readFile(join(root,'_tags.md'),'utf8')
    const ledger = JSON.parse(await readFile(join(root,'.vault-ledger.json'),'utf8'))
    expect(ledger.indexes).toEqual({index:digestText(index),tags:digestText(tags)})
    expect(await Bun.file(join(root,'.vault-intent.json')).exists()).toBe(false)
  })
}

test('U1 recovery never publishes current index bytes under a legacy hash', async () => {
  const {root,original,raw,ledger} = await legacyVault()
  const next = JSON.stringify({...ledger,generation:ledger.generation+1})
  await writeFile(join(root,'.vault-ledger.json'),next)
  await writeFile(join(root,'.vault-intent.json'),JSON.stringify({version:1,owner:'alice',old:raw,oldHash:digestText(raw),next,nextHash:digestText(next),contents:{}}))
  await unlink(join(root,'_index.md'))
  await createVaultSink(root).upsert(original)
  const content = await readFile(join(root,'_index.md'),'utf8')
  const finalLedger = JSON.parse(await readFile(join(root,'.vault-ledger.json'),'utf8'))
  expect(content).toStartWith('# 문서 색인\n')
  expect(finalLedger.indexes.index).toBe(digestText(content))
})
