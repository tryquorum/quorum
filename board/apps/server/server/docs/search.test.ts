import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { refreshChanged } from './index.ts'

test('searches Korean trigrams and short strings; fetch respects surrogate boundaries', () => {
 const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
 const {ref}=ops.create('a',{title:'Title',md:'계약서 회신 😀 done'},'person')
 expect(ops.search('a',{q:'계약서'}).results.map(x=>x.ref)).toContain(ref)
 expect(ops.search('a',{q:'회신'}).results.map(x=>x.ref)).toContain(ref)
 const page=ops.fetch('a',{ref,maxChars:8})
 expect(page.markdown.endsWith('\ud83d')).toBe(false)
 expect(JSON.stringify(page).length).toBeLessThanOrEqual(20000)
 stopDocsRefresh(db); db.close()
})

test('pagination, filters, literal LIKE and cursor isolation', () => {
 const db=legacyDb(); initDocs(db); const ops=createDocsOps(db,{act:()=>({results:[]})})
 for(let i=0;i<51;i++) ops.create('a',{title:`row ${i}`,md:i===0?'100% _x':'plain',tags:i===0?['one','two']:[]},i===1?'agent':'person')
 let cursor:string|undefined, refs:string[]=[]
 do {const page=ops.search('a',{limit:20,cursor}); refs.push(...page.results.map(x=>x.ref)); cursor=page.nextCursor} while(cursor)
 expect(refs.length).toBe(51);expect(new Set(refs).size).toBe(51)
 expect(ops.search('a',{q:'%'}).total).toBe(1);expect(ops.search('a',{q:'_'}).total).toBe(1)
 expect(ops.search('a',{tags:['one','two']}).total).toBe(1)
 expect(ops.search('a',{drafts:'only'}).total).toBe(1);expect(ops.search('a',{drafts:'exclude'}).total).toBe(50)
 const page=ops.search('a',{limit:1}); expect(()=>ops.search('b',{limit:1,cursor:page.nextCursor})).toThrow()
 stopDocsRefresh(db); db.close()
})

test('outline, section, capped fetch, schema cap, and related cycle', () => {
 const db=legacyDb();initDocs(db);const ops=createDocsOps(db,{act:()=>({results:[]})})
 const a=ops.create('a',{title:'first document',md:'# One\nbody\n## Child\nvalue\n```\n# ignored\n```\n# Last\nend'},'person')
 const b=ops.create('a',{title:'second document',md:'text'},'person')
 const c=ops.create('a',{title:'third document',md:'text'},'person')
 db.query("INSERT INTO work_links VALUES (?,?,?,?, '관련','person',1)").run('1','a',a.ref,b.ref)
 db.query("INSERT INTO work_links VALUES (?,?,?,?, '관련','person',1)").run('2','a',b.ref,c.ref)
 db.query("INSERT INTO work_links VALUES (?,?,?,?, '관련','person',1)").run('3','a',c.ref,a.ref)
 expect(ops.fetch('a',{ref:a.ref,view:'outline'}).outline?.map(h=>h.path)).toEqual(['One','One/Child','Last'])
 expect(ops.fetch('a',{ref:a.ref,view:'section',section:'One/Child'}).markdown).toContain('value')
 expect(ops.related('a',{ref:a.ref,depth:2,limit:1}).truncated).toBe(true)
 const big=ops.create('a',{title:'big content',md:'"\\'.repeat(9000)},'person')
 const page=ops.fetch('a',{ref:big.ref,maxChars:20000});expect(JSON.stringify(page).length).toBeLessThanOrEqual(20000);expect(page.truncated).toBe(true)
 db.query('UPDATE docs SET area=? WHERE owner=? AND id=?').run('x'.repeat(21000),'a',big.ref.slice(4));refreshChanged(db,'a')
 expect(()=>ops.schema('a')).toThrow()
 stopDocsRefresh(db);db.close()
})

test('archive selection, cursor validation, and escaped search cap', () => {
 const db=legacyDb();initDocs(db);const ops=createDocsOps(db,{act:()=>({results:[]})})
 const {ref}=ops.create('a',{title:'archived title',md:'body'},'person');ops.archive('a',ref,true)
 expect(ops.search('a',{}).results).toEqual([]);expect(ops.search('a',{status:'archived'}).results.map(x=>x.ref)).toEqual([ref])
 expect(()=>ops.search('a',{cursor:'garbage!'})).toThrow()
 for(let i=0;i<25;i++) ops.create('a',{title:`quote ${i} ${'"'.repeat(600)}`,md:'"'.repeat(200)},'person')
 const page=ops.search('a',{limit:50});expect(JSON.stringify(page).length).toBeLessThanOrEqual(20000);expect(page.nextCursor).toBeDefined();expect(page.hint).toBeDefined()
 stopDocsRefresh(db);db.close()
})

test('goal search hit and fetch frontmatter include progress from linked board todos', () => {
 const db=legacyDb();initDocs(db);const ops=createDocsOps(db,{act:()=>({results:[]})})
 db.exec("INSERT INTO boards VALUES ('pb','personal','a','{}',0,1)")
 db.query("INSERT INTO items VALUES ('pb','g1',?,0,1)").run(JSON.stringify({type:'goal',text:'출시 목표',due:'2026-12-01',done:false}))
 db.query("INSERT INTO items VALUES ('pb','t1',?,0,1)").run(JSON.stringify({type:'todo',text:'노트 없는 할 일',goalId:'g1',done:true}))
 db.query("INSERT INTO items VALUES ('pb','t2',?,0,1)").run(JSON.stringify({type:'todo',text:'링크로 연결된 할 일',done:false}))
 db.query("INSERT INTO work_links VALUES ('l1','a','item:pb:t2','item:pb:g1','위해서','human',1)").run()
 ops.putNote('a','item:pb:g1',{html:'<p>왜 하는가</p>',text:'왜 하는가',md:'왜 하는가'},'person')
 const hits=ops.search('a',{kinds:['goal']})
 expect(hits.results).toHaveLength(1)
 expect(hits.results[0].progress).toEqual({done:1,total:2})
 const fetched=ops.fetch('a',{ref:'item:pb:g1',view:'meta'})
 expect(fetched.frontmatter.progress).toEqual({done:1,total:2})
 stopDocsRefresh(db);db.close()
})
