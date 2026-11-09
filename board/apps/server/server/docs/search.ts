import type { Database } from 'bun:sqlite'
import { DocsError, type DocProp, type FetchInput, type FetchResult, type PropType, type PropValue, type RelatedInput, type RelatedResult, type SchemaResult, type SearchInput, type SearchResult, type SearchHit } from '@direction-board/contracts/docs'
import { getDocRecord, refreshChanged } from './index.ts'
import { normalizeTag } from './relations.ts'
import { headings } from './document.ts'
import { readableKey } from './props.ts'
import { firstImage, plainExcerpt } from './preview.ts'
import { goalProgressForRef } from '../works.ts'
import { normTitle, SAME_TITLE_MIN } from '@direction-board/contracts/text'
import { ancestors } from './tree.ts'
import { listSpaces, PERSONAL, resolveSpace, spaceMap } from '../spaces.ts'

const cap=20000
function size(value:unknown):number {return JSON.stringify(value).length}
function bounded(n:number|undefined, fallback:number, max:number):number {
  if (n===undefined) return fallback
  if (!Number.isFinite(n) || n<1) throw new DocsError(400,'Provide a positive limit')
  return Math.min(Math.floor(n),max)
}
function fixed(value:unknown):void { if(size(value)>cap) throw new DocsError(400,'Narrow the request to reduce metadata') }
type PropFilter = NonNullable<SearchInput['props']>[number]
type Stored = { type:PropType; value:PropValue }
const OPS = ['eq','neq','exists','missing','gt','gte','lt','lte','contains'] as const
/** 정렬: relevance | updated | prop:<key> | -prop:<key> */
function parseSort(sort:unknown):{kind:'relevance'|'updated'|'tree'}|{kind:'prop';key:string;desc:boolean} {
  if (sort===undefined || sort==='relevance') return {kind:'relevance'}
  if (sort==='updated') return {kind:'updated'}
  if (sort==='tree') return {kind:'tree'}
  const m=typeof sort==='string' ? sort.match(/^(-?)prop:(.+)$/s) : null
  if (!m) throw new DocsError(400,'sort must be relevance, updated, prop:<key> or -prop:<key>')
  return {kind:'prop',key:readableKey(m[2]),desc:m[1]==='-'}
}
function parseFilters(filters:unknown):PropFilter[] {
  if (filters===undefined) return []
  if (!Array.isArray(filters) || filters.length>20) throw new DocsError(400,'props must be a list of up to 20 conditions')
  return filters.map(f=>{
    if (!f || typeof f!=='object' || Array.isArray(f)) throw new DocsError(400,'Each property condition needs key and op')
    const {key,op,value}=f as PropFilter
    if (!OPS.includes(op)) throw new DocsError(400,`Property op must be one of: ${OPS.join(', ')}`)
    const needsValue=op!=='exists' && op!=='missing'
    if (needsValue && (value===undefined || value===null)) throw new DocsError(400,`Property condition ${op} needs a value`)
    if (needsValue && typeof value!=='string' && typeof value!=='number' && typeof value!=='boolean') throw new DocsError(400,'Property condition value must be a string, number or boolean')
    return needsValue ? {key:readableKey(key),op,value} : {key:readableKey(key),op}
  })
}
function filterValue(f:PropFilter,type:PropType):string|number|boolean {
  const v=f.value as string|number|boolean
  if (['gt','gte','lt','lte'].includes(f.op) && !['number','date','datetime'].includes(type)) throw new DocsError(400,`"${f.key}" is ${type}; gt/gte/lt/lte work on number, date or datetime`)
  if (f.op==='contains' && ['number','checkbox','date','datetime'].includes(type)) throw new DocsError(400,`"${f.key}" is ${type}; contains works on text, url, select or list`)
  if (type==='number') { const n=typeof v==='number' ? v : typeof v==='string' && v.trim()!=='' ? Number(v) : NaN; if(!Number.isFinite(n)) throw new DocsError(400,`"${f.key}" is number: compare with a number`); return n }
  if (type==='checkbox') { if (v===true || v==='true') return true; if (v===false || v==='false') return false; throw new DocsError(400,`"${f.key}" is checkbox: compare with true or false`) }
  return String(v)
}
function matches(f:PropFilter,stored:Stored|undefined,types:Map<string,PropType>):boolean {
  const has=!!stored && stored.value!==null
  if (f.op==='exists') return has
  if (f.op==='missing') return !has
  const type=types.get(f.key)
  if (!type) return f.op==='neq'
  const want=filterValue(f,type)
  const value=has ? stored!.value : null
  const equal=():boolean => has && (Array.isArray(value) ? value.includes(String(want)) : value===want)
  if (f.op==='eq') return equal()
  if (f.op==='neq') return !equal()
  if (!has) return false
  if (f.op==='contains') {
    const needle=String(want).toLowerCase()
    return Array.isArray(value) ? value.some(v=>v.toLowerCase()===needle) : String(value).toLowerCase().includes(needle)
  }
  const a=value as number|string, b=want as number|string
  return f.op==='gt' ? a>b : f.op==='gte' ? a>=b : f.op==='lt' ? a<b : a<=b
}
function sortValue(stored:Stored|undefined):number|string|null {
  if (!stored || stored.value===null) return null
  const v=stored.value
  return typeof v==='number' ? v : typeof v==='boolean' ? (v?1:0) : Array.isArray(v) ? v.join(',') : v
}
function loadProps(db:Database,owner:string):{byRef:Map<string,Map<string,Stored>>;types:Map<string,PropType>} {
  const byRef=new Map<string,Map<string,Stored>>()
  for (const r of db.query('SELECT p.ref,p.key,t.type,p.value FROM doc_props p JOIN doc_prop_types t ON t.owner=p.owner AND t.key=p.key WHERE p.owner=? ORDER BY p.ref,p.key').all(owner) as {ref:string;key:string;type:PropType;value:string}[]) {
    const map=byRef.get(r.ref) || new Map<string,Stored>(); map.set(r.key,{type:r.type,value:JSON.parse(r.value)}); byRef.set(r.ref,map)
  }
  const types=new Map((db.query('SELECT key,type FROM doc_prop_types WHERE owner=?').all(owner) as {key:string;type:PropType}[]).map(t=>[t.key,t.type]))
  return {byRef,types}
}
const propList=(map:Map<string,Stored>|undefined):DocProp[] => [...(map || new Map<string,Stored>()).entries()].map(([key,s])=>({key,type:s.type,value:s.value}))
function queryHash(owner:string,input:SearchInput,filters:PropFilter[]):string {
  const normalized={q:input.q?.trim() || '',kinds:[...(input.kinds || [])].sort(),tags:[...(input.tags || [])].map(normalizeTag).sort(),area:input.area || '',status:input.status || '',since:input.since ?? null,sort:input.sort || 'relevance',drafts:input.drafts || 'include',limit:bounded(input.limit,20,50),props:filters,...(input.sameTitle!==undefined ? {sameTitle:normTitle(input.sameTitle)} : {}),...(input.parent!==undefined ? {parent:input.parent} : {}),...(input.space!==undefined ? {space:input.space} : {})}
  return new Bun.CryptoHasher('sha256').update(JSON.stringify([owner,normalized])).digest('hex')
}
function cursor(offset:number,hash:string):string {return Buffer.from(JSON.stringify({o:offset,h:hash})).toString('base64url')}
export function searchDocs(db:Database,owner:string,input:SearchInput={}):SearchResult {
  const sort=parseSort(input.sort), filters=parseFilters(input.props)
  if(input.parent!==undefined && input.parent!==null && (typeof input.parent!=='string' || !/^doc:[^:]+$/.test(input.parent))) throw new DocsError(400,'Invalid parent')
  if(sort.kind==='tree' && input.parent===undefined) throw new DocsError(400,'tree sort requires parent')
  refreshChanged(db,owner)
  const hash=queryHash(owner,input,filters); let offset=0
  if (input.cursor) {
    try {if(!/^[A-Za-z0-9_-]+$/.test(input.cursor) || Buffer.from(input.cursor,'base64url').toString('base64url')!==input.cursor) throw Error(); const parsed=JSON.parse(Buffer.from(input.cursor,'base64url').toString()); if(parsed.h!==hash || !Number.isSafeInteger(parsed.o) || parsed.o<0) throw Error(); offset=parsed.o}
    catch {throw new DocsError(400,'Use a cursor from the same search')}
  }
  // 같은 제목 찾기는 검색어 대신 정규화 제목 일치로 거른다
  const same=input.sameTitle!==undefined ? normTitle(input.sameTitle) : null
  const q=same!==null ? '' : (input.q || '').trim(), params:(string|number)[]=[owner], conditions=['i.owner=?']
  if (input.status) {conditions.push('i.status=?'); params.push(input.status)} else conditions.push("i.status<>'archived'")
  if (input.kinds?.length) {conditions.push(`i.kind IN (${input.kinds.map(()=>'?').join(',')})`); params.push(...input.kinds)}
  if(input.parent!==undefined) {conditions.push("i.kind='doc'"); if(input.parent===null) conditions.push('i.parent IS NULL'); else {conditions.push('i.parent=?');params.push(input.parent)}}
  if (input.area!==undefined) {conditions.push('i.area=?');params.push(input.area)}
  if (input.since!==undefined) {conditions.push('i.updated_at>=?');params.push(input.since)}
  for(const tag of input.tags || []) {conditions.push('EXISTS(SELECT 1 FROM doc_tags t WHERE t.owner=i.owner AND t.ref=i.ref AND t.tag=?)');params.push(normalizeTag(tag))}
  if(input.drafts==='only') conditions.push("EXISTS(SELECT 1 FROM doc_tags t WHERE t.owner=i.owner AND t.ref=i.ref AND t.tag='ai/초안')")
  if(input.drafts==='exclude') conditions.push("NOT EXISTS(SELECT 1 FROM doc_tags t WHERE t.owner=i.owner AND t.ref=i.ref AND t.tag='ai/초안')")
  const base=`SELECT i.*,COALESCE(n.md,n.text) AS md FROM doc_index i JOIN work_notes n ON n.owner=i.owner AND n.ref=i.ref WHERE ${conditions.join(' AND ')}`
  const order=sort.kind==='tree' ? ' ORDER BY (SELECT position FROM docs d WHERE d.owner=i.owner AND i.ref=\'doc:\'||d.id) IS NULL,(SELECT position FROM docs d WHERE d.owner=i.owner AND i.ref=\'doc:\'||d.id),i.title,i.ref' : ' ORDER BY i.updated_at DESC,i.ref ASC'
  let rows:any[]=[]
  if(q.length>=3) {
    const phrase=`"${q.replace(/"/g,'""')}"`
    // FTS 매칭은 한 번만 계산한다(문서마다 MATCH 를 다시 돌리면 수천 건에서 느려진다)
    rows=db.query(`${base} AND i.ref IN (SELECT ref FROM doc_fts WHERE doc_fts MATCH ? AND owner=?)${order}`).all(...params,phrase,owner) as typeof rows
    if (sort.kind==='relevance') {
      const ranks=db.query('SELECT ref,bm25(doc_fts) AS rank FROM doc_fts WHERE owner=? AND doc_fts MATCH ?').all(owner,phrase) as {ref:string;rank:number}[]
      const rank=new Map(ranks.map(r=>[r.ref,r.rank])); rows.sort((a,b)=>(rank.get(a.ref) ?? 0)-(rank.get(b.ref) ?? 0) || b.updated_at-a.updated_at || a.ref.localeCompare(b.ref))
    }
  }
  if(q && !rows.length) {
    const like=`%${q.replace(/[\\%_]/g,'\\$&')}%`
    rows=db.query(`${base} AND (i.title LIKE ? ESCAPE '\\' OR COALESCE(n.md,n.text) LIKE ? ESCAPE '\\')${order}`).all(...params,like,like) as any[]
  } else if(!q) rows=db.query(base+order).all(...params) as any[]
  if(same!==null) rows=same.length<SAME_TITLE_MIN ? [] : rows.filter(row=>normTitle(row.title)===same)
  // 공간: 할 일·목표·사건은 items·signals 의 지금 값, 문서·대화는 개인
  const spaces=spaceMap(db,owner)
  if(input.space!==undefined) {
    const want=resolveSpace(db,input.space)
    if(!want) throw new DocsError(400,'Unknown space: use an id from board_schema spaces')
    rows=rows.filter(row=>(spaces.get(row.ref) ?? PERSONAL)===want)
  }
  const {byRef,types}=loadProps(db,owner)
  // 속성 조건 값의 타입을 먼저 검사한다(결과가 비어도 잘못된 조건은 400)
  for (const f of filters) { const type=types.get(f.key); if (type && f.op!=='exists' && f.op!=='missing') filterValue(f,type) }
  if (filters.length) rows=rows.filter(row=>filters.every(f=>matches(f,byRef.get(row.ref)?.get(f.key),types)))
  if (sort.kind==='prop') {
    const keyed=rows.map((row,i)=>({row,i,v:sortValue(byRef.get(row.ref)?.get(sort.key))}))
    keyed.sort((a,b)=>{
      if (a.v===null || b.v===null) return a.v===null && b.v===null ? a.i-b.i : a.v===null ? 1 : -1
      const c=a.v<b.v ? -1 : a.v>b.v ? 1 : 0
      return (sort.desc ? -c : c) || a.i-b.i
    })
    rows=keyed.map(k=>k.row)
  }
  const total=rows.length, limit=bounded(input.limit,20,50), selected=rows.slice(offset,offset+limit)
  const result:SearchResult={results:[],total}
  const ids=selected.filter(row=>row.kind==='doc' && row.ref.startsWith('doc:')).map(row=>row.ref.slice(4)) as string[]
  const counts=ids.length ? db.query(`SELECT parent_id,COUNT(*) AS n FROM docs WHERE owner=? AND archived=0 AND parent_id IN (${ids.map(()=>'?').join(',')}) GROUP BY parent_id`).all(owner,...ids) as {parent_id:string;n:number}[] : []
  const children=new Map(counts.map(r=>[r.parent_id,r.n]))
  for(const row of selected) {
    const tags=db.query('SELECT tag,by FROM doc_tags WHERE owner=? AND ref=? ORDER BY tag').all(owner,row.ref) as SearchHit['tags']
    const pos=q ? Math.max(0,row.md.toLowerCase().indexOf(q.toLowerCase())-60) : 0
    const md:string=row.md || ''
    const progress=row.kind==='goal'?goalProgressForRef(db,owner,row.ref):undefined
    result.results.push({ref:row.ref,kind:row.kind,title:row.title,snippet:md.slice(pos,pos+200),tags,personEdited:!!row.person_edited,area:row.area,status:row.status,due:row.due ?? null,props:propList(byRef.get(row.ref)),updatedAt:row.updated_at,path:row.mirror_path,excerpt:plainExcerpt(md),cover:firstImage(md),...(progress?{progress}:{}),...(row.kind==='doc'?{parent:row.parent ?? null,children:children.get(row.ref.slice(4)) ?? 0}:{}),space:spaces.get(row.ref) ?? PERSONAL})
  }
  if(offset+result.results.length<total) result.nextCursor=cursor(offset+result.results.length,hash)
  while(size(result)>cap && result.results.length) {result.results.pop(); result.nextCursor=cursor(offset+result.results.length,hash); result.hint='More results are available with nextCursor'}
  if (!result.results.length && selected.length && size(result)>cap) throw new DocsError(400,'Narrow the search to reduce metadata')
  if (!result.results.length && selected.length && result.nextCursor===cursor(offset,hash)) throw new DocsError(400,'Narrow the search to reduce metadata')
  fixed(result); return result
}
function safeEnd(s:string,n:number):number {return n>0 && n<s.length && /[\uD800-\uDBFF]/.test(s[n-1]) && /[\uDC00-\uDFFF]/.test(s[n]) ? n-1 : n}
export function fetchDoc(db:Database,owner:string,input:FetchInput):FetchResult {
  refreshChanged(db,owner)
  const doc=getDocRecord(db,owner,input.ref); if(!doc) throw new DocsError(404,'Document not found')
  const view=input.view || 'markdown', all=headings(doc.md)
  if (!['markdown','outline','meta','section'].includes(view)) throw new DocsError(400,'Choose a valid view')
  let md=doc.md
  if(view==='section') {
    const matches=all.filter(h=>h.path===input.section)
    if(matches.length!==1) throw new DocsError(matches.length?400:404,'Choose a unique section path')
    md=doc.md.slice(matches[0].start,matches[0].end)
  } else if(view==='meta' || view==='outline') md=''
  const limit=bounded(input.maxChars,8000,20000)
  let start=input.offset ?? 0
  if(!Number.isInteger(start) || start<0) throw new DocsError(400,'Provide a non-negative offset')
  start=Math.min(start,md.length)
  if(start>0 && start<md.length && /[\uDC00-\uDFFF]/.test(md[start]) && /[\uD800-\uDBFF]/.test(md[start-1])) start--
  let end=safeEnd(md,Math.min(md.length,start+limit))
  const progress=doc.kind==='goal'?goalProgressForRef(db,owner,doc.ref):undefined
  const result:FetchResult={ref:doc.ref,kind:doc.kind,title:doc.title,version:doc.version,frontmatter:{ref:doc.ref,kind:doc.kind,title:doc.title,area:doc.area,status:doc.status,tags:doc.tags,links:doc.links,version:doc.version,created:doc.createdAt,updated:doc.updatedAt,source:doc.source,due:doc.due,props:doc.props,...(progress?{progress}:{})},markdown:md.slice(start,end),...(view==='outline'?{outline:all.map(({level,title,path})=>({level,title,path}))}:{}),truncated:end<md.length,links:{out:doc.links.filter(e=>e.direction==='out').length,in:doc.links.filter(e=>e.direction==='in').length}}
  if(doc.kind==='doc') {
    result.frontmatter.parent=doc.parent ?? null
    result.ancestors=doc.parent ? ancestors(db,owner,doc.parent.slice(4)).map(n=>({ref:`doc:${n.id}`,title:n.title})) : []
  }
  if(result.truncated) result.nextOffset=end
  while(size(result)>cap && end>start) {const over=size(result)-cap; end=safeEnd(md,Math.max(start,end-Math.max(1,over))); result.markdown=md.slice(start,end);result.truncated=true;result.nextOffset=end}
  if (end===start && start<md.length && result.truncated) throw new DocsError(400,'Reduce metadata or request a larger page')
  fixed(result);return result
}
export function relatedDocs(db:Database,owner:string,input:RelatedInput):RelatedResult {
  const root=getDocRecord(db,owner,input.ref); if(!root) throw new DocsError(404,'Document not found')
  const depth=input.depth ?? 1, direction=input.direction || 'both', limit=bounded(input.limit,30,1000)
  if(![1,2].includes(depth) || !['out','in','both'].includes(direction)) throw new DocsError(400,'Choose depth 1 or 2 and a valid direction')
  const seen=new Set([input.ref]), emitted=new Set<string>(); let frontier=[input.ref]
  const edges:RelatedResult['edges']=[]
  for(let d=0;d<depth;d++) {
    const next:string[]=[]
    for(const ref of frontier) {
      const links=db.query('SELECT id,a,b,label FROM work_links WHERE owner=? AND (a=? OR b=?) ORDER BY created_at,id').all(owner,ref,ref) as {id:string;a:string;b:string;label:string|null}[]
      for(const edge of links) {
        const dir=edge.a===ref?'out':'in'; if(direction!=='both' && dir!==direction || emitted.has(edge.id)) continue
        const target=dir==='out'?edge.b:edge.a, doc=getDocRecord(db,owner,target); if(!doc) continue
        emitted.add(edge.id);edges.push({label:edge.label || '',direction:dir,node:{ref:doc.ref,kind:doc.kind,title:doc.title,status:doc.status}})
        if(!seen.has(target)){seen.add(target);next.push(target)}
      }
    }
    frontier=next
  }
  const result:RelatedResult={edges:edges.slice(0,limit),truncated:edges.length>limit}
  const hadEdges=result.edges.length>0
  while(size(result)>cap && result.edges.length){result.edges.pop();result.truncated=true}
  // 관계 하나만으로 상한을 넘으면 이어 읽을 방법이 없으므로 빈 결과 대신 400 으로 알린다
  if(hadEdges && !result.edges.length) throw new DocsError(400,'A single related document exceeds the response limit')
  fixed(result);return result
}
export function docsSchema(db:Database,owner:string):SchemaResult {
  const vals=(column:string)=>(db.query(`SELECT DISTINCT ${column} AS value FROM doc_index WHERE owner=? AND ${column} IS NOT NULL ORDER BY ${column}`).all(owner) as {value:string}[]).map(x=>x.value)
  // 영역 선택에 쓰도록 개인 판에 정의된 영역 이름도 합친다
  const boardAreas=(db.query("SELECT meta FROM boards WHERE kind='personal' AND owner=? AND deleted=0").all(owner) as {meta:string|null}[]).flatMap(b=>{try {return ((JSON.parse(b.meta || '{}').areas || []) as {name?:unknown}[]).map(a=>a.name).filter((n):n is string=>typeof n==='string' && !!n)} catch {return []}})
  const areas=[...new Set([...vals('area'),...boardAreas])].sort((a,b)=>a<b?-1:a>b?1:0)
  const used=db.query('SELECT p.key,t.type,p.ref,p.value FROM doc_props p JOIN doc_prop_types t ON t.owner=p.owner AND t.key=p.key JOIN doc_index i ON i.owner=p.owner AND i.ref=p.ref WHERE p.owner=? ORDER BY p.key').all(owner) as {key:string;type:PropType;ref:string;value:string}[]
  const props=new Map<string,{key:string;type:PropType;count:number;values:Set<string>}>()
  for (const u of used) {
    const entry=props.get(u.key) || {key:u.key,type:u.type,count:0,values:new Set<string>()}
    entry.count++
    const value=JSON.parse(u.value) as PropValue
    if (u.type==='select' && typeof value==='string') entry.values.add(value)
    if (u.type==='list' && Array.isArray(value)) for (const v of value) entry.values.add(v)
    props.set(u.key,entry)
  }
  const result:SchemaResult={kinds:vals('kind') as SchemaResult['kinds'],statuses:vals('status') as SchemaResult['statuses'],areas,tags:db.query('SELECT tag,COUNT(*) AS count FROM doc_tags WHERE owner=? GROUP BY tag ORDER BY tag').all(owner) as SchemaResult['tags'],props:[...props.values()].map(({key,type,count,values})=>({key,type,count,...(type==='select' || type==='list' ? {options:[...values].sort((a,b)=>a<b?-1:a>b?1:0).slice(0,50)} : {})})),linkLabels:(db.query('SELECT DISTINCT label FROM work_links WHERE owner=? AND label IS NOT NULL ORDER BY label').all(owner) as {label:string}[]).map(x=>x.label),fields:['ref','kind','title','area','status','source','tags','links','version','created','updated','due','props'],spaces:listSpaces(db).map(({id,name})=>({id,name}))}
  fixed(result);return result
}
