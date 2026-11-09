import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi, parsePropsQuery } from './api.ts'
import { setVaultSink } from './sink.ts'
import { DocsError, type DocRecord, type DocsConflict, type MetaInput, type PropsInput, type SchemaResult, type SearchInput, type SearchResult } from '@direction-board/contracts/docs'
import { runActions } from '../actions.ts'
import { document } from '../vault/model.ts'
import { putNote } from './document.ts'

type Put = { bid:string; iid:string; data:Record<string,unknown>; actor:string }
function setup() {
  const db = legacyDb()
  db.exec('ALTER TABLE signals ADD COLUMN resolved_at INTEGER')
  initDocs(db)
  const puts: Put[] = []
  const items = {
    readItem: (bid:string, iid:string) => { const row = db.query('SELECT data FROM items WHERE board_id=? AND id=? AND deleted=0').get(bid,iid) as {data:string}|null; return row ? {data:JSON.parse(row.data)} : null },
    putItem: (bid:string, iid:string, data:Record<string,unknown>, actor:string) => { puts.push({bid,iid,data,actor}); db.query('UPDATE items SET data=?,updated_at=? WHERE board_id=? AND id=?').run(JSON.stringify(data),Date.now(),bid,iid) },
  }
  const ops = createDocsOps(db,{act:(owner,actions)=>runActions(db,owner,actions,{personalBoard:()=>null,...items}),items})
  return {db,ops,puts,items}
}
const status = (fn:()=>unknown) => { try { fn(); return 0 } catch (e) { if (e instanceof DocsError) return e.status; throw e } }
function note(db:ReturnType<typeof legacyDb>, ref:string, md='본문', by='person') {
  db.query('INSERT INTO work_notes(owner,ref,html,text,by,updated_at,md,created_at) VALUES (?,?,?,?,?,?,?,?)').run('a',ref,'<p>x</p>',md,by,1,md,1)
}
function board(db:ReturnType<typeof legacyDb>) {
  db.query('INSERT INTO boards VALUES (?,?,?,?,?,?)').run('pb','personal','a',JSON.stringify({areas:[{id:'w1',name:'업무'},{id:'f1',name:'가족'}]}),0,1)
  db.query('INSERT INTO boards VALUES (?,?,?,?,?,?)').run('cb','company',null,'{}',0,1)
  const items:[string,string,Record<string,unknown>][] = [['pb','t1',{type:'todo',text:'첫 줄\n둘째 줄',done:false,area:'w1',remindAt:'2026-11-07',log:[{by:'a',at:1,text:'만듦'}],threads:[{id:'g1'}],x:5}],['pb','g1',{type:'goal',text:'목표',done:false,due:'2026-12-31'}],['cb','c1',{type:'todo',text:'회사 일',done:false}]]
  for (const [bid,iid,data] of items) db.query('INSERT INTO items VALUES (?,?,?,0,1)').run(bid,iid,JSON.stringify(data))
}

test('props: inference, validation, reserved keys, fixed types, null values, idempotence and version', () => {
  const {db,ops} = setup()
  try {
    const {ref} = ops.create('a',{title:'계약 문서',md:'본문'},'person')
    const first = ops.props('a',{ref,set:{회사:'리지',금액:1200000,마감:'2026-12-01',회의:'2026-11-07T10:30',확정:true,링크:'https://example.com/x',담당:['준','민','준']}},'person')
    expect(first.version).toBe(2)
    expect(Object.fromEntries(first.props.map(p=>[p.key,[p.type,p.value]]))).toEqual({회사:['text','리지'],금액:['number',1200000],마감:['date','2026-12-01'],회의:['datetime','2026-11-07T10:30'],확정:['checkbox',true],링크:['url','https://example.com/x'],담당:['list',['준','민']]})
    expect(first.props.map(p=>p.key)).toEqual(first.props.map(p=>p.key).sort((a,b)=>a<b?-1:1))
    expect(ops.props('a',{ref,set:{회사:'리지'}},'person').version).toBe(2)
    expect(ops.props('a',{ref,set:{금액:'1500'}},'agent').props.find(p=>p.key==='금액')!.value).toBe(1500)
    for (const bad of [{set:{금액:'많음'}},{set:{금액:3},types:{금액:'text'}},{set:{title:'x'}},{set:{Due:'2026-01-01'}},{set:{'a:b':1}},{set:{' ':1}},{set:{'__proto__':1}},{set:{마감:'2026-02-30'}},{set:{링크:'javascript:alert(1)'}},{types:{x:'text'}},{set:{x:1},remove:['x']},{set:{y:'z'},types:{y:'color'}},{}]) expect(status(()=>ops.props('a',{ref,...bad} as unknown as PropsInput,'person'))).toBe(400)
    expect(status(()=>ops.props('a',{ref,set:{메모:'x'},expectedVersion:1},'person'))).toBe(409)
    expect(status(()=>ops.props('b',{ref,set:{메모:'x'}},'person'))).toBe(404)
    const empty = ops.props('a',{ref,set:{단계:null},types:{단계:'select'}},'person')
    expect(empty.props.find(p=>p.key==='단계')).toEqual({key:'단계',type:'select',value:null})
    expect(ops.props('a',{ref,set:{단계:'계약'}},'person').props.find(p=>p.key==='단계')!.value).toBe('계약')
    const before = ops.fetch('a',{ref}).version
    const removed = ops.props('a',{ref,remove:['회사','없는키']},'person')
    expect(removed.version).toBe(before+1)
    expect(removed.props.some(p=>p.key==='회사')).toBe(false)
    expect(ops.props('a',{ref,set:{회사:7}},'person').props.find(p=>p.key==='회사')!.type).toBe('number')
    expect(status(()=>ops.props('a',{ref,set:{긴글:'x'.repeat(501)}},'person'))).toBe(400)
    expect(status(()=>ops.props('a',{ref,set:Object.fromEntries(Array.from({length:30},(_,i)=>['k'+i,i]))},'person'))).toBe(400)
    const fm = ops.fetch('a',{ref}).frontmatter
    expect(fm.due).toBe(null)
    expect((fm.props as {key:string}[]).map(p=>p.key)).toContain('금액')
  } finally { stopDocsRefresh(db); db.close() }
})

test('meta on standalone documents, archived documents and version conflicts', () => {
  const {db,ops} = setup()
  try {
    const {ref} = ops.create('a',{title:'독립',md:'본문'},'person')
    expect(status(()=>ops.meta('a',{ref},'person'))).toBe(400)
    const done = ops.meta('a',{ref,title:'바뀐 제목',area:'업무',status:'done',due:'2026-11-30',expectedVersion:1},'person')
    expect(done.version).toBe(2)
    const hit = ops.search('a',{q:'바뀐 제목'}).results[0]
    expect(hit).toMatchObject({ref,title:'바뀐 제목',area:'업무',status:'done',due:'2026-11-30',props:[]})
    expect(ops.meta('a',{ref,status:'done'},'person').version).toBe(2)
    expect(status(()=>ops.meta('a',{ref,title:'x',expectedVersion:1},'person'))).toBe(409)
    for (const bad of [{title:''},{title:'a\nb'},{status:'archived'},{due:'2026-13-01'},{due:'tomorrow'},{area:'x'.repeat(31)}]) expect(status(()=>ops.meta('a',{ref,...bad} as unknown as MetaInput,'person'))).toBe(400)
    expect(ops.meta('a',{ref,due:null,area:null},'person').version).toBe(3)
    expect(ops.fetch('a',{ref}).frontmatter).toMatchObject({due:null,area:null,status:'done'})
    ops.archive('a',ref,true)
    expect(status(()=>ops.meta('a',{ref,title:'보관 중'},'person'))).toBe(400)
    expect(ops.note('a',ref)).toMatchObject({ref,md:'본문',personEdited:true})
    expect(status(()=>ops.meta('b',{ref,title:'남'},'person'))).toBe(404)
  } finally { stopDocsRefresh(db); db.close() }
})

test('meta on board items uses putItem with logs, preserves data and maps areas', () => {
  const {db,ops,puts} = setup()
  board(db); note(db,'item:pb:t1'); note(db,'item:pb:g1'); note(db,'item:cb:c1')
  try {
    const v = ops.fetch('a',{ref:'item:pb:t1'}).version
    const r = ops.meta('a',{ref:'item:pb:t1',title:'새 제목',area:'가족',status:'done',due:'2026-11-08T09:00',expectedVersion:v},'agent')
    expect(r.version).toBe(v+1)
    const put = puts.at(-1)!
    expect(put.actor).toBe('agent')
    expect(put.data).toMatchObject({type:'todo',text:'새 제목\n둘째 줄',done:true,area:'f1',remindAt:'2026-11-08T09:00',threads:[{id:'g1'}],x:5})
    expect((put.data.log as {by:string;text:string}[]).map(l=>l.by)).toEqual(['a','agent'])
    expect((put.data.log as {text:string}[]).at(-1)!.text).toContain('제목')
    expect(ops.search('a',{kinds:['todo']}).results[0]).toMatchObject({title:'새 제목',area:'가족',status:'done',due:'2026-11-08T09:00'})
    const count = puts.length
    expect(ops.meta('a',{ref:'item:pb:t1',status:'done'},'person').version).toBe(v+1)
    expect(puts.length).toBe(count)
    ops.meta('a',{ref:'item:pb:t1',area:null,due:null},'person')
    expect(puts.at(-1)!.actor).toBe('a')
    expect('area' in puts.at(-1)!.data || 'remindAt' in puts.at(-1)!.data).toBe(false)
    expect(status(()=>ops.meta('a',{ref:'item:pb:t1',area:'없는 영역'},'person'))).toBe(400)
    expect(status(()=>ops.meta('a',{ref:'item:pb:g1',due:'2026-12-01T10:00'},'person'))).toBe(400)
    ops.meta('a',{ref:'item:pb:g1',due:'2027-01-15'},'person')
    expect(puts.at(-1)!.data.due).toBe('2027-01-15')
    expect(status(()=>ops.meta('a',{ref:'item:cb:c1',title:'회사'},'person'))).toBe(404)
    // 보드에서 바꾼 제목도 version 을 올려 낡은 meta 는 409 가 된다
    const current = ops.fetch('a',{ref:'item:pb:g1'}).version
    db.query("UPDATE items SET data=?,updated_at=? WHERE board_id='pb' AND id='g1'").run(JSON.stringify({type:'goal',text:'보드에서 바꿈',done:false,due:'2027-01-15'}),Date.now()+5)
    expect(status(()=>ops.meta('a',{ref:'item:pb:g1',title:'오래된 화면',expectedVersion:current},'person'))).toBe(409)
    expect(ops.fetch('a',{ref:'item:pb:g1'}).title).toBe('보드에서 바꿈')
  } finally { stopDocsRefresh(db); db.close() }
})

test('events change status only; conversations keep runs untouched and follow new activity', () => {
  const {db,ops} = setup()
  db.query("INSERT INTO signals(id,owner,title,area,source,status,updated_at) VALUES ('s1','a','사건','업무','메일','open',1)").run()
  db.query("INSERT INTO runs VALUES ('r1','a',NULL,'질문','error',1,1)").run()
  note(db,'signal:s1'); note(db,'run:r1')
  try {
    expect(status(()=>ops.meta('a',{ref:'signal:s1',area:'업무'},'person'))).toBe(400)
    expect(status(()=>ops.meta('a',{ref:'run:r1',title:'x'},'person'))).toBe(400)
    ops.meta('a',{ref:'signal:s1',status:'done'},'person')
    expect(db.query("SELECT status FROM signals WHERE id='s1'").get()).toEqual({status:'resolved'})
    expect(ops.fetch('a',{ref:'signal:s1'}).frontmatter.status).toBe('done')
    expect(status(()=>ops.meta('a',{ref:'run:r1',due:'2026-01-01'},'person'))).toBe(400)
    const v = ops.meta('a',{ref:'run:r1',status:'done'},'person').version
    expect(db.query("SELECT status FROM runs WHERE id='r1'").get()).toEqual({status:'error'})
    expect(ops.fetch('a',{ref:'run:r1'})).toMatchObject({version:v,frontmatter:{status:'done'}})
    db.query("UPDATE runs SET updated_at=? WHERE id='r1'").run(Date.now()+60000)
    expect(ops.fetch('a',{ref:'run:r1'}).frontmatter.status).toBe('open')
  } finally { stopDocsRefresh(db); db.close() }
})

test('search props conditions, prop sorting, cursors and schema props', () => {
  const {db,ops} = setup()
  board(db)
  try {
    const a = ops.create('a',{title:'문서 가',md:'x'},'person').ref, b = ops.create('a',{title:'문서 나',md:'x'},'person').ref, c = ops.create('a',{title:'문서 다',md:'x'},'person').ref
    ops.props('a',{ref:a,set:{금액:100,단계:'계약',회사:'Lidge AI',태그목록:['빨강','파랑'],마감:'2026-11-01'},types:{단계:'select'}},'person')
    ops.props('a',{ref:b,set:{금액:300,단계:'검토',회사:'다른 회사',마감:'2026-12-01'}},'person')
    const refs = (props?:SearchInput['props'], sort?:SearchInput['sort']) => ops.search('a',{kinds:['doc'],props,sort}).results.map(r=>r.ref)
    expect(refs([{key:'금액',op:'gt',value:150}])).toEqual([b])
    expect(refs([{key:'금액',op:'gte',value:'100'}]).sort()).toEqual([a,b].sort())
    expect(refs([{key:'단계',op:'eq',value:'계약'}])).toEqual([a])
    expect(refs([{key:'단계',op:'neq',value:'계약'}]).sort()).toEqual([b,c].sort())
    expect(refs([{key:'금액',op:'exists'}]).sort()).toEqual([a,b].sort())
    expect(refs([{key:'금액',op:'missing'}])).toEqual([c])
    expect(refs([{key:'회사',op:'contains',value:'lidge'}])).toEqual([a])
    expect(refs([{key:'태그목록',op:'contains',value:'파랑'}])).toEqual([a])
    expect(refs([{key:'마감',op:'lt',value:'2026-11-15'}])).toEqual([a])
    expect(refs([{key:'모르는키',op:'eq',value:'x'}])).toEqual([])
    expect(refs(undefined,'-prop:금액')).toEqual([b,a,c])
    expect(refs(undefined,'prop:금액')).toEqual([a,b,c])
    for (const bad of [[{key:'회사',op:'gt',value:'a'}],[{key:'금액',op:'eq',value:'many'}],[{key:'금액',op:'eq'}],[{key:'title',op:'exists'}],[{key:'금액',op:'like',value:1}]]) expect(status(()=>ops.search('a',{props:bad as unknown as SearchInput['props']}))).toBe(400)
    expect(status(()=>ops.search('a',{sort:'prop:' as SearchInput['sort']}))).toBe(400)
    const page = ops.search('a',{kinds:['doc'],props:[{key:'금액',op:'exists'}],limit:1})
    expect(page.nextCursor).toBeTruthy()
    expect(status(()=>ops.search('a',{kinds:['doc'],props:[{key:'금액',op:'missing'}],limit:1,cursor:page.nextCursor}))).toBe(400)
    expect(ops.search('a',{kinds:['doc'],props:[{key:'금액',op:'exists'}],limit:1,cursor:page.nextCursor}).results).toHaveLength(1)
    const schema = ops.schema('a')
    expect(schema.props).toContainEqual({key:'금액',type:'number',count:2})
    expect(schema.props).toContainEqual({key:'단계',type:'select',count:2,options:['검토','계약']})
    expect(schema.props).toContainEqual({key:'태그목록',type:'list',count:1,options:['빨강','파랑']})
    expect(schema.areas).toEqual(expect.arrayContaining(['업무','가족']))
    expect(schema.fields).toEqual(expect.arrayContaining(['due','props']))
    expect(ops.schema('b').props).toEqual([])
  } finally { stopDocsRefresh(db); db.close() }
})

test('REST meta, props, note and search props routes keep the contract shapes', async () => {
  const {db,ops} = setup()
  board(db); note(db,'item:cb:c1')
  const call = async (path:string, method='GET', body?:unknown, email='a') => {
    const url = new URL('http://local/api/docs'+path)
    return (await docsApi(new Request(url,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}),url,{email,agent:false},url.pathname.split('/').filter(Boolean),ops))!
  }
  const found = async (path:string) => (await (await call(path)).json() as SearchResult).results
  try {
    const {ref} = ops.create('a',{title:'REST 문서',md:'원문'},'person'); const e = encodeURIComponent(ref)
    let res = await call('/'+e+'/meta','PATCH',{title:'REST 바뀜',expectedVersion:1})
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ref,version:2})
    res = await call('/'+e+'/meta','PATCH',{title:'다시',expectedVersion:1})
    expect(res.status).toBe(409); expect((await res.json() as {current:DocsConflict}).current).toMatchObject({version:2,md:'원문',truncated:false})
    res = await call('/'+e+'/props','POST',{set:{메모:'a,b:c%d',금액:5}})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ref,version:3,props:[{key:'금액',type:'number',value:5},{key:'메모',type:'text',value:'a,b:c%d'}]})
    expect((await call('/'+e+'/props','POST',{set:'x'})).status).toBe(400)
    res = await call('/'+e+'/note')
    // markdownEditable: 엄격 변환기를 꽂지 않은 db 라 닫힌 쪽(false)
    expect(await res.json()).toEqual({ref,html:expect.any(String),md:'원문',version:3,personEdited:true,markdownEditable:false,onceKey:true})
    res = await call('/'+e+'/note','PUT',{html:'<p>새</p>',text:'새',md:'새',expectedVersion:2})
    expect(res.status).toBe(409)
    res = await call('/'+e+'/note','PUT',{html:'<p>새</p>',text:'새',md:'새',expectedVersion:3})
    expect(await res.json()).toEqual({ok:true,updated_at:expect.any(Number),version:4})
    expect((await call('/'+e+'/note','PUT',{html:'<p>x</p>',text:'x',expectedVersion:0})).status).toBe(409)
    expect((await call('/'+encodeURIComponent('item:cb:c1')+'/note')).status).toBe(404)
    expect((await call('/'+encodeURIComponent('item:cb:c1')+'/note','PUT',{html:'<p>x</p>',text:'x'})).status).toBe(404)
    expect((await call('/'+e+'/note','GET',undefined,'b')).status).toBe(404)
    // 살아 있는 내 목표는 노트가 없어도 expectedVersion 0 으로 처음 만들 수 있다
    res = await call('/'+encodeURIComponent('item:pb:g1')+'/note','PUT',{html:'<p>목표 노트</p>',text:'목표 노트',md:'목표 노트',expectedVersion:0})
    expect(await res.json()).toMatchObject({ok:true,version:1})
    expect((await found('/search?kinds=doc&props=%EB%A9%94%EB%AA%A8:eq:'+encodeURIComponent('a,b:c%d'))).map(r=>r.ref)).toEqual([ref])
    const params = new URLSearchParams({kinds:'doc',props:'메모:eq:'+encodeURIComponent('a,b:c%d')+',금액:gte:5',sort:'-prop:금액'})
    const hits = await found('/search?'+params)
    expect(hits.map(r=>r.ref)).toEqual([ref])
    expect(hits[0]).toMatchObject({due:null,props:[{key:'금액',type:'number',value:5},{key:'메모',type:'text',value:'a,b:c%d'}]})
    expect((await call('/search?props=금액:like:1')).status).toBe(400)
    expect((await call('/search?props=%E0%A4%A')).status).toBe(400)
    expect((await call('/search?sort=prop:')).status).toBe(400)
    expect((await (await call('/schema')).json() as SchemaResult).props).toContainEqual({key:'메모',type:'text',count:1})
    expect(parsePropsQuery('?props=a:exists,b:missing')).toEqual([{key:'a',op:'exists'},{key:'b',op:'missing'}])
  } finally { stopDocsRefresh(db); db.close() }
})

test('act meta and props, and the mirror receives props and due as frontmatter', async () => {
  const {db,ops} = setup()
  board(db); note(db,'item:pb:t1')
  const sent:DocRecord[] = []
  setVaultSink(db,{async rebuild(){return {written:0,removed:0}},async upsert(doc){sent.push(doc);return {path:''}},async remove(){}})
  try {
    const results = ops.act('a',[{do:'meta',ref:'item:pb:t1',status:'done',title:'AI 제목'},{do:'props',ref:'item:pb:t1',set:{단계:'진행'},types:{단계:'select'}},{do:'props',ref:'item:pb:t1',set:{title:'x'}},{do:'meta',ref:'item:pb:t1',title:''},{do:'meta'}]).results
    expect(results.map(r=>r.ok)).toEqual([true,true,false,false,false])
    expect(results[2].error).toContain('meta')
    for (let i=0;i<40 && !sent.some(d=>d.props.length);i++) await Bun.sleep(5)
    const last = sent.filter(d=>d.ref==='item:pb:t1').at(-1)!
    expect(last).toMatchObject({title:'AI 제목',status:'done',due:'2026-11-07',props:[{key:'단계',type:'select',value:'진행'}]})
    const text = document({...last,props:[...last.props,{key:'true',type:'text',value:'따옴표 키'},{key:'1번',type:'number',value:1},{key:'담당 자',type:'list',value:['준']}]})
    const yaml = Bun.YAML.parse(text.split('---\n')[1]) as Record<string,unknown>
    expect(yaml).toMatchObject({due:'2026-11-07',단계:'진행','true':'따옴표 키','1번':1,'담당 자':['준'],title:'AI 제목'})
    expect(text).toContain('\n단계: "진행"\n')
  } finally { setVaultSink(db); stopDocsRefresh(db); db.close() }
})


test('board changes before a note write make stale versions conflict and responses report the stored version', () => {
  const {db,ops} = setup()
  board(db); note(db,'item:pb:t1')
  try {
    const v = ops.note('a','item:pb:t1').version
    db.query("UPDATE items SET data=?,updated_at=? WHERE board_id='pb' AND id='t1'").run(JSON.stringify({type:'todo',text:'보드 제목',done:true}),Date.now()+5)
    expect(status(()=>putNote(db,'a','item:pb:t1',{html:'<p>낡음</p>',text:'낡음',md:'낡음',expectedVersion:v},'person'))).toBe(409)
    expect(status(()=>ops.write('a',{ref:'item:pb:t1',mode:'replace',md:'낡음',expectedVersion:v},'person'))).toBe(409)
    const fresh = ops.note('a','item:pb:t1').version
    expect(fresh).toBe(v+1)
    const saved = putNote(db,'a','item:pb:t1',{html:'<p>새</p>',text:'새',md:'새',expectedVersion:fresh},'person')
    expect(saved.version).toBe(ops.note('a','item:pb:t1').version)
    db.query("UPDATE items SET data=?,updated_at=? WHERE board_id='pb' AND id='t1'").run(JSON.stringify({type:'todo',text:'또 바뀜',done:true}),Date.now()+10)
    const written = ops.write('a',{ref:'item:pb:t1',mode:'append',md:'덧붙임'},'agent')
    expect(written.version).toBe(ops.note('a','item:pb:t1').version)
  } finally { stopDocsRefresh(db); db.close() }
})

test('conversation status yields to run activity at the same millisecond and restore reports the real status', () => {
  const {db,ops} = setup()
  db.query("INSERT INTO runs VALUES ('r2','a',NULL,'질문','error',1,1)").run()
  note(db,'run:r2')
  try {
    ops.meta('a',{ref:'run:r2',status:'done'},'person')
    expect(ops.fetch('a',{ref:'run:r2'}).frontmatter.status).toBe('done')
    // 같은 밀리초에 새 실행(이어 묻기)이 붙어도 실행 상태를 따른다
    const at = (db.query("SELECT updated_at FROM runs WHERE id='r2'").get() as {updated_at:number}).updated_at
    db.query("INSERT INTO runs VALUES ('r3','a','r2','이어서','running',?,?)").run(at,at)
    expect(ops.fetch('a',{ref:'run:r2'}).frontmatter.status).toBe('open')
    ops.meta('a',{ref:'run:r2',status:'done'},'person')
    expect(ops.fetch('a',{ref:'run:r2'}).frontmatter.status).toBe('done')
    db.query("UPDATE runs SET status='done' WHERE id='r3'").run()
    expect(ops.fetch('a',{ref:'run:r2'}).frontmatter.status).toBe('done')
    db.query("UPDATE runs SET status='error' WHERE id='r3'").run()
    expect(ops.fetch('a',{ref:'run:r2'}).frontmatter.status).toBe('open')
    const {ref} = ops.create('a',{title:'복원',md:'x'},'person')
    ops.meta('a',{ref,status:'done'},'person')
    expect(ops.archive('a',ref,true).status).toBe('archived')
    expect(ops.archive('a',ref,false).status).toBe('done')
  } finally { stopDocsRefresh(db); db.close() }
})

test('a person can rename an event from the document page and it reindexes', () => {
  const {db,ops} = setup()
  db.exec('ALTER TABLE signals ADD COLUMN meta TEXT')
  db.query("INSERT INTO signals(id,owner,title,area,source,status,updated_at) VALUES ('s9','a','옛 제목','업무','메일','open',1)").run()
  note(db,'signal:s9')
  try {
    const before = ops.fetch('a',{ref:'signal:s9'}).version
    const v = ops.meta('a',{ref:'signal:s9',title:'새 제목',expectedVersion:before},'person').version
    expect(v).toBeGreaterThan(before)
    expect(ops.fetch('a',{ref:'signal:s9'}).title).toBe('새 제목')
    expect(JSON.parse((db.query("SELECT meta FROM signals WHERE id='s9'").get() as {meta:string}).meta).titleBy).toBe('person')
  } finally { stopDocsRefresh(db); db.close() }
})

