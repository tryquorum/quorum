import { api, ApiError } from './api'
// 문서 계약은 packages/contracts 의 docs.ts 하나예요(서버·웹·모바일이 같이 읽어요).
import type { DocStatus, PropType, PropValue, DocProp, SearchResult, FetchResult, RelatedResult, SchemaResult, CreateInput, MoveInput } from '@direction-board/contracts/docs'
export type { DocStatus, PropType, PropValue, DocProp, SearchResult, FetchResult, RelatedResult, SchemaResult }
export type PropFilter = {key:string;op:'eq'|'neq'|'exists'|'missing'|'gt'|'gte'|'lt'|'lte'|'contains';value?:PropValue}
export type SearchFilters = { q?: string; kinds?: string[]; tags?: string[]; includeAi?: boolean; area?: string; status?: DocStatus | ''; cursor?: string;props?:PropFilter[];sort?:string;limit?:number;sameTitle?:string;parent?:string|null }
export function propertyFilterIssue(type:PropType|undefined, op:PropFilter['op'], value:string):string|null {
  if(op==='exists' || op==='missing') return null
  if(!value.trim()) return '속성 조건 값을 입력해 주세요.'
  if(['gt','gte','lt','lte'].includes(op) && type && !['number','date','datetime'].includes(type)) return '이 조건은 숫자·날짜 속성에 사용할 수 있어요.'
  if(op==='contains' && type && ['number','checkbox','date','datetime'].includes(type)) return '포함 조건은 텍스트·선택·목록 속성에 사용할 수 있어요.'
  if(type==='number' && !Number.isFinite(Number(value))) return '올바른 숫자를 입력해 주세요.'
  if(type==='checkbox' && value!=='true' && value!=='false') return '체크박스 값은 true 또는 false로 입력해 주세요.'
  return null
}
export const isDocumentRef = (ref: string) => ref.startsWith('doc:') || ref.startsWith('run:')
export function searchPath({ q, kinds, tags, includeAi, area, status, cursor, props, sort, limit, sameTitle, parent }: SearchFilters) {
  const p = new URLSearchParams()
  if (q?.trim()) p.set('q', q.trim())
  if (sameTitle !== undefined) p.set('sameTitle', sameTitle)
  // 계층: null 은 맨 위(REST 는 parent=root)
  if (parent !== undefined) p.set('parent', parent === null ? 'root' : parent)
  if (kinds?.length) p.set('kinds', kinds.join(','))
  if (tags?.length) p.set('tags', tags.join(','))
  if (area) p.set('area', area)
  if (status) p.set('status', status)
  p.set('drafts', includeAi ? 'include' : 'exclude')
  p.set('sort', sort || 'updated')
  if (props?.length) p.set('props',props.map(({key,op,value}) => `${encodeURIComponent(key)}:${op}:${encodeURIComponent(value == null ? '' : Array.isArray(value) ? JSON.stringify(value) : String(value))}`).join(','))
  p.set('limit', String(limit ?? 20))
  if (cursor) p.set('cursor', cursor)
  return `/api/docs/search?${p}`
}
export const searchDocs = (filters: SearchFilters) => api<SearchResult>(searchPath(filters))
// Search and current L1 frontmatter both expose tag provenance.
export async function findDocTags(ref: string, search: typeof searchDocs = searchDocs): Promise<SearchResult['results'][number]['tags'] | null> {
  for (const status of [undefined, 'archived'] as const) {
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await search(status ? {includeAi:true, cursor, status} : {includeAi:true, cursor})
      const hit = page.results.find((entry) => entry.ref === ref)
      if (hit) return hit.tags
      cursor = page.nextCursor
      if (cursor && seen.has(cursor)) return null
      if (cursor) seen.add(cursor)
    } while (cursor)
  }
  return null
}
export function mergeTagProvenance(names: string[], provenance: SearchResult['results'][number]['tags'] | null): {tag:string; by:string}[] {
  const key = (value: string) => value.normalize('NFKC').trim().toLowerCase()
  const result = names.map((tag) => {
    const matches = (provenance || []).filter((entry) => key(entry.tag) === key(tag))
    return {tag, by:matches.length === 1 ? matches[0].by : 'unknown'}
  })
  for (const entry of provenance || []) if (!names.some((tag) => key(tag) === key(entry.tag))) result.push(entry)
  return result
}
export function frontmatterTags(value: unknown): {tag:string; by:string}[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [{tag:entry, by:'unknown'}]
    if (!entry || typeof entry !== 'object' || !('tag' in entry) || typeof entry.tag !== 'string') return []
    const by = 'by' in entry && typeof entry.by === 'string' && ['person','auto','agent','body'].includes(entry.by) ? entry.by : 'unknown'
    return [{tag:entry.tag, by}]
  })
}
export const fetchDoc = (ref: string, offset?: number) => api<FetchResult>(`/api/docs/${encodeURIComponent(ref)}?view=markdown&maxChars=20000${offset === undefined ? '' : `&offset=${offset}`}`)
export async function fetchFullDoc(ref: string, read: typeof fetchDoc = fetchDoc): Promise<FetchResult> {
  let offset: number | undefined
  let first: FetchResult | undefined
  let markdown = ''
  for (let count = 0; count < 1000; count++) {
    const part = await read(ref, offset)
    if (part.ref !== ref || !Number.isSafeInteger(part.version) || (first && part.version !== first.version)) throw new Error('읽는 동안 문서가 바뀌었어요. 다시 불러와 주세요.')
    first ||= part
    markdown += part.markdown
    if (markdown.length > 200000) throw new Error('문서가 너무 길어 전체 내용을 안전하게 편집할 수 없어요.')
    if (!part.truncated) return {...first, markdown, truncated:false, nextOffset:undefined}
    if (typeof part.nextOffset !== 'number' || !Number.isSafeInteger(part.nextOffset) || part.nextOffset !== markdown.length || part.nextOffset <= (offset ?? 0)) throw new Error('문서의 나머지 내용을 안전하게 불러올 수 없어요.')
    offset = part.nextOffset
  }
  throw new Error('문서의 나머지 내용을 모두 불러오지 못했어요.')
}
export type ArchivedDocState = {status:'clean'|'dirty'|'saving'|'conflict'|'unknown'|'error'; version:number; base:string; draft:string; backups:string[]; current?:{version:number;md:string;truncated:boolean}; message?:string}
type ArchivedWrite = (body:{mode:'replace';md:string;expectedVersion:number}) => Promise<{version:number;applied:number;warnings:string[]}>
export class ArchivedDocSaver {
  state: ArchivedDocState
  private writing = false
  private write:ArchivedWrite
  private changed:(state:ArchivedDocState)=>void
  constructor(version:number, markdown:string, write:ArchivedWrite, changed:(state:ArchivedDocState)=>void, restored?:ArchivedDocState) {
    this.write = write; this.changed = changed
    this.state = restored ? {...restored, status:restored.status === 'saving' ? 'unknown' : restored.status, ...(restored.status === 'saving' ? {message:'이전 저장 결과를 확인하지 못했어요. 초안을 보관하고 자동 재전송하지 않아요.'} : {})} : {status:'clean',version,base:markdown,draft:markdown,backups:[]}
  }
  private update(patch:Partial<ArchivedDocState>) { this.state = {...this.state,...patch}; this.changed(this.state) }
  edit(draft:string) { this.update({draft, status:this.state.status === 'conflict' || this.state.status === 'unknown' || this.state.status === 'saving' ? this.state.status : draft === this.state.base ? 'clean' : 'dirty'}) }
  adoptCurrent(version:number, markdown:string) {
    if (!['conflict','unknown'].includes(this.state.status) || this.writing || !Number.isSafeInteger(version) || version < 0) return false
    this.update({status:'clean',version,base:markdown,draft:markdown,backups:[...this.state.backups,this.state.draft],current:undefined,message:undefined})
    return true
  }
  clearBackup(index:number) {this.update({backups:this.state.backups.filter((_,i) => i !== index)})}
  async save() {
    if (this.writing || this.state.status !== 'dirty') return
    if (this.state.draft.length > 200000) {this.update({status:'error',message:'문서가 200,000자를 넘어 저장하지 않았어요. 내용을 줄여 주세요.'});return}
    const snapshot = this.state.draft
    this.writing = true; this.update({status:'saving'})
    try {
      const result = await this.write({mode:'replace',md:snapshot,expectedVersion:this.state.version})
      if (!Number.isSafeInteger(result.version) || result.version < 1) {this.update({status:'unknown',message:'저장 버전을 확인하지 못했어요. 초안을 복사하고 서버를 확인해 주세요.'});return}
      const draft = this.state.draft
      this.update({status:draft === snapshot ? 'clean' : 'dirty',version:result.version,base:snapshot,draft,message:undefined})
    } catch (e) {
      const err = e as {status?:number;body?:{current?:ArchivedDocState['current']}}
      if (err.status === 409) this.update({status:'conflict',current:err.body?.current,message:'서버가 변경되어 저장하지 않았어요. 내 초안을 보관했어요.'})
      else this.update({status:'unknown',message:'저장 결과를 확인하지 못했어요. 초안을 보관하고 자동 재전송하지 않아요.'})
    } finally {this.writing = false}
  }
}
export const relatedDocs = (ref: string) => api<RelatedResult>(`/api/docs/${encodeURIComponent(ref)}/related?direction=in&depth=1&limit=30`)
/** 아직 문서가 아닌 일(노트가 없어 404, 이슈로 들어온 회사 할 일 등)과 문서를 쓸 수 없는 사람(403)은 오류가 아니라 '없음'이에요 */
const notADoc = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403)
/** 일 화면의 "여기를 가리키는 글": 문서가 아닌 일이면 빈 목록 */
export async function loadInLinks(ref: string, related: typeof relatedDocs = relatedDocs): Promise<RelatedResult> {
  try { return await related(ref) } catch (e) { if (notADoc(e)) return { edges: [], truncated: false }; throw e }
}
/** 일 화면의 태그와 출처: 검색에서 출처를 찾고, 없으면 문서 앞머리. 문서가 아닌 일이면 경고 없이 빈 목록, 그 밖의 실패는 uncertain */
export async function loadDocTags(ref: string, find: (ref: string) => Promise<{tag:string; by:string}[] | null> = findDocTags, fetch: (ref: string) => Promise<Pick<FetchResult, 'frontmatter'>> = fetchDoc): Promise<{tags: {tag:string; by:string}[] | null; uncertain: boolean}> {
  const provenance = await find(ref).catch(() => null)
  if (provenance) return { tags: provenance, uncertain: false }
  try {
    const fallback = frontmatterTags((await fetch(ref)).frontmatter.tags)
    return { tags: fallback, uncertain: !fallback || fallback.some((entry) => entry.by === 'unknown') }
  } catch (e) { return notADoc(e) ? { tags: [], uncertain: false } : { tags: null, uncertain: true } }
}
/** 링크 따라가기 열: 나가는 링크와 역링크를 한 번에 */
export const linkedDocs = (ref: string) => api<RelatedResult>(`/api/docs/${encodeURIComponent(ref)}/related?direction=both&depth=1&limit=50`)
/** 미리보기용 앞부분. 본문 전체는 전체화면 문서에서 읽어요 */
export const fetchDocHead = (ref: string, maxChars = 4000) => api<FetchResult>(`/api/docs/${encodeURIComponent(ref)}?view=markdown&maxChars=${maxChars}`)
export const fetchDocMeta = (ref: string) => api<FetchResult>(`/api/docs/${encodeURIComponent(ref)}?view=meta`)
export const docsSchema = () => api<SchemaResult>('/api/docs/schema')
export type NoteSource = {ref:string;html:string;md:string;version:number;personEdited:boolean}
export const getDocumentNote = (ref:string) => api<NoteSource>(`/api/docs/${encodeURIComponent(ref)}/note`)
export const patchDocumentMeta = (ref:string, body:{title?:string;area?:string|null;status?:'open'|'done';due?:string|null;expectedVersion:number}) => api<{ref:string;version:number}>(`/api/docs/${encodeURIComponent(ref)}/meta`,{method:'PATCH',body:JSON.stringify(body)})
export const patchDocumentProps = (ref:string, body:{set?:Record<string,PropValue>;types?:Record<string,PropType>;remove?:string[];expectedVersion:number}) => api<{ref:string;version:number;props:DocProp[]}>(`/api/docs/${encodeURIComponent(ref)}/props`,{method:'POST',body:JSON.stringify(body)})
export const createDoc = (input: CreateInput) => api<{ref: string; version: number}>('/api/docs', {method:'POST', body:JSON.stringify(input)})
/** 문서 옮기기(계층). 409 는 순환·깊이, 400 은 보관·잘못된 기준 */
export const moveDoc = (input: MoveInput) => api<{ref: string; parent: string | null}>(`/api/docs/${encodeURIComponent(input.ref)}/move`, {method:'POST', body:JSON.stringify({parent: input.parent, ...(input.before ? {before: input.before} : {}), ...(input.after ? {after: input.after} : {})})})
/** 한 부모의 자식(형제 순서). null 은 맨 위. 트리·열 보기·이동 대화상자가 써요 */
export const childDocs = (parent: string | null, cursor?: string) => searchDocs({parent, sort:'tree', includeAi:true, limit:50, ...(cursor ? {cursor} : {})})
export const changeTags = (ref: string, change: {add?: string[]; remove?: string[]}) => api<{ref: string; tags: string[]}>(`/api/docs/${encodeURIComponent(ref)}/tags`, {method:'POST', body:JSON.stringify(change)})
