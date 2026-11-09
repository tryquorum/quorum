import { DocsError, type DocsOps, type SearchInput, type FetchInput, type RelatedInput, type WriteInput, type MetaInput, type PropsInput } from '@direction-board/contracts/docs'
import type { DocsServerOps } from './ops.ts'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const bad = (message: string): never => { throw new DocsError(400, message) }
function choice<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value === null) return undefined
  if (!allowed.includes(value as T)) return bad('Invalid parameter')
  return value as T
}
function number(value: string | null, min: number): number | undefined {
  if (value === null) return undefined
  if (!/^\d+$/.test(value)) return bad('Invalid number')
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min) return bad('Invalid number')
  return n
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(x => typeof x === 'string') }
function decodeOnce(value: string): string { try { return decodeURIComponent(value) } catch { return bad('Invalid props encoding') } }
/**
 * props=key:op:value,... (값은 encodeURIComponent). 쿼리 원문에서 꺼내 값마다 정확히 한 번 디코딩한다.
 * 원문에 구분자(: ,)가 그대로 있으면 원문에서 나누고, URLSearchParams 처럼 %3A·%2C 로 한 번 더 감싼 쿼리면 바깥을 한 번 풀고 나눈다.
 */
export function parsePropsQuery(search: string): SearchInput['props'] {
  const raws = search.replace(/^\?/, '').split('&').filter(part => part.split('=')[0] === 'props').map(part => part.slice(part.indexOf('=') + 1))
  if (!raws.length) return undefined
  if (raws.length > 1) return bad('Send props once, separated by commas')
  const raw = raws[0].replace(/\+/g, ' ')
  if (!raw) return bad('Invalid props')
  const literal = /[:,]/.test(raw)
  const text = literal ? raw : decodeOnce(raw)
  return text.split(',').map(part => {
    const first = part.indexOf(':')
    if (first < 1) return bad('Each props condition is key:op:value')
    const rest = part.slice(first + 1), second = rest.indexOf(':')
    const op = second < 0 ? rest : rest.slice(0, second)
    const rawKey = part.slice(0, first)
    const key = literal || rawKey.includes('%') ? decodeOnce(rawKey) : rawKey
    if (!['eq','neq','exists','missing','gt','gte','lt','lte','contains'].includes(op)) return bad('Invalid props op')
    return second < 0 ? {key, op: op as 'exists'} : {key, op: op as 'eq', value: decodeOnce(rest.slice(second + 1))}
  })
}
async function bodyOf(req: Request): Promise<Record<string, any>> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Provide a JSON object')
  return body as Record<string, any>
}
export async function docsApi(req: Request, url: URL, user: {email:string; agent:boolean}, parts: string[], ops: DocsOps & Partial<Pick<DocsServerOps,'putNote'>>): Promise<Response | null> {
  if (parts[1] !== 'docs') return null
  const p=url.searchParams, owner=user.email, by=user.agent?'agent':'person'
  try {
    if (req.method === 'GET' && parts.length === 3 && parts[2] === 'search') {
      const kinds=p.has('kinds') ? p.get('kinds')!.split(',').map(v=>choice(v,['todo','goal','signal','run','doc'] as const)!) : undefined
      const tags=p.has('tags') ? p.get('tags')!.split(',') : undefined
      if (tags?.some(t=>!t.trim())) bad('Invalid tags')
      if (p.has('cursor') && !p.get('cursor')) bad('Invalid cursor')
      const sort=p.get('sort')
      if (sort!==null && !['relevance','updated','tree'].includes(sort) && !/^-?prop:./s.test(sort)) bad('Invalid parameter')
      const input:SearchInput={q:p.get('q') ?? undefined,kinds,tags,area:p.get('area') ?? undefined,status:choice(p.get('status'),['open','done','archived'] as const),since:number(p.get('since'),0),sort:(sort ?? undefined) as SearchInput['sort'],drafts:choice(p.get('drafts'),['include','exclude','only'] as const),props:parsePropsQuery(url.search),limit:number(p.get('limit'),1),cursor:p.get('cursor') ?? undefined,sameTitle:p.get('sameTitle') ?? undefined,space:p.get('space') ?? undefined}
      if(p.has('parent')) { const parent=p.get('parent'); if(parent==='root') input.parent=null; else if(parent && /^doc:[^:]+$/.test(parent)) input.parent=parent; else bad('Invalid parent') }
      return json(ops.search(owner,input))
    }
    if (req.method === 'GET' && parts.length === 3 && parts[2] === 'schema') return json(ops.schema(owner))
    if (req.method === 'POST' && parts.length === 2) {
      const b=await bodyOf(req)
      if ((b.area!==undefined && typeof b.area!=='string') || (b.tags!==undefined && !strings(b.tags)) || (b.links!==undefined && !strings(b.links)) || (b.id!==undefined && typeof b.id!=='string') || (b.parent!==undefined && typeof b.parent!=='string')) bad('Invalid document fields')
      return json(ops.create(owner,b as any,by))
    }
    if (parts.length < 3 || parts.length > 4) return null
    let ref:string
    try { ref=decodeURIComponent(parts[2]) } catch { return bad('Invalid ref') }
    if (!ref) bad('Invalid ref')
    if (req.method === 'GET' && parts.length === 3) {
      const input:FetchInput={ref,view:choice(p.get('view'),['markdown','outline','meta','section'] as const),section:p.get('section') ?? undefined,maxChars:number(p.get('maxChars'),1),offset:number(p.get('offset'),0)}
      return json(ops.fetch(owner,input))
    }
    if (req.method === 'GET' && parts.length === 4 && parts[3] === 'related') {
      const input:RelatedInput={ref,direction:choice(p.get('direction'),['out','in','both'] as const),depth:choice(p.get('depth'),['1','2'] as const) ? Number(p.get('depth')) as 1|2 : undefined,limit:number(p.get('limit'),1)}
      return json(ops.related(owner,input))
    }
    if (parts.length === 4 && parts[3] === 'note') {
      if (req.method === 'GET') return json(ops.note(owner,ref,p.get('onceKey') || undefined))
      if (req.method === 'PUT' && ops.putNote) {
        // 일 노트 PUT(/api/work/:ref/note)과 같은 입력 규칙
        const b=await bodyOf(req)
        const html=typeof b.html==='string' ? b.html.slice(0,200000) : ''
        const text=typeof b.text==='string' ? b.text.slice(0,50000) : ''
        return json(ops.putNote(owner,ref,{html,text,md:b.md,expectedVersion:b.expectedVersion},by))
      }
    }
    if (req.method === 'PATCH' && parts.length === 4 && parts[3] === 'meta') {
      const b=await bodyOf(req)
      return json(ops.meta(owner,{...b,ref} as MetaInput,by))
    }
    if (req.method === 'POST' && parts.length === 4) {
      const b=await bodyOf(req)
      if(parts[3] === 'move') {
        if((b.parent!==null && typeof b.parent!=='string') || (b.before!==undefined && typeof b.before!=='string') || (b.after!==undefined && typeof b.after!=='string')) bad('Invalid move fields')
        return json(ops.move(owner,{ref,parent:b.parent,before:b.before,after:b.after},by))
      }
      if (parts[3] === 'write') {
        if (!['append','replace','patch'].includes(b.mode) || (b.expectedVersion!==undefined && (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion<0)) || (b.idempotencyKey!==undefined && typeof b.idempotencyKey!=='string') || (b.onceKey!==undefined && (typeof b.onceKey!=='string' || !b.onceKey || b.onceKey.length>200))) bad('Invalid write fields')
        if (b.mode==='patch') {
          if (!Array.isArray(b.edits) || b.edits.some((e:unknown) => !e || typeof e!=='object' || Array.isArray(e))) bad('Invalid edits')
        } else if (typeof b.md!=='string') bad('Provide markdown')
        return json(ops.write(owner,{...b,ref} as WriteInput,by))
      }
      if (parts[3] === 'tags') {
        if ((b.add!==undefined && !strings(b.add)) || (b.remove!==undefined && !strings(b.remove))) bad('Invalid tags')
        return json(ops.tag(owner,ref,b,by))
      }
      if (parts[3] === 'archive') {
        if (typeof b.archived!=='boolean') bad('Provide archived boolean')
        return json(ops.archive(owner,ref,b.archived))
      }
      if (parts[3] === 'props') return json(ops.props(owner,{...b,ref} as PropsInput,by))
    }
    return null
  } catch (e) {
    if (e instanceof DocsError) return json({error:e.message,...(e.current ? {current:e.current} : {})},e.status)
    // 본문이 섞일 수 있어 메시지는 남기지 않고 오류 종류만 기록한다
    console.error('[docs] api error', e instanceof Error ? e.name : typeof e)
    return json({error:'internal'},500)
  }
}
