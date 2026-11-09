// 문서 화면(레인 2)의 REST 경로. 웹 apps/web/src/lib/docs-api.ts 와 같은 계약(packages/contracts/src/docs.ts)이에요.
// 서버 규칙: apps/server/server/docs/api.ts. 쓰기는 화면을 연 시점의 범위 고정 클라이언트(useWriteScope)로만 보내 409·거절·결과 불명을 나눠요.
import type { CreateInput, DocProp, DocStatus, FetchResult, MoveInput, PropType, PropValue, RelatedResult, SchemaResult, SearchResult } from '@direction-board/contracts'
import { request, type ScopedClient } from './client'

export type PropOp = 'eq' | 'neq' | 'exists' | 'missing' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
export type PropFilter = { key: string; op: PropOp; value?: PropValue }
export type DocFilters = {
  q?: string
  kinds?: string[]
  tags?: string[]
  area?: string
  status?: DocStatus | ''
  /** AI 초안(ai/초안 태그) 포함. 웹 기본 보기처럼 빼는 게 기본이에요 */
  includeAi?: boolean
  props?: PropFilter[]
  /** updated(기본) | tree | prop:<key> | -prop:<key> */
  sort?: string
  limit?: number
  cursor?: string
  sameTitle?: string
  /** 계층: 이 부모의 독립 문서만(null 은 맨 위) */
  parent?: string | null
}
/** 웹 docs-view 와 같은 한 쪽 크기 */
export const PAGE = 50

const enc = encodeURIComponent
/**
 * 웹 searchPath 와 같은 매개변수. RN 의 URLSearchParams 구현 차이를 피하려고 직접 이어 붙여요.
 * 서버는 props 의 값만 따로 풀어서(api.ts) 값은 한 번 더 인코딩해요(웹과 같음).
 */
export function searchQuery(f: DocFilters): string {
  const p: string[] = []
  const add = (k: string, v: string) => p.push(`${k}=${enc(v)}`)
  if (f.q?.trim()) add('q', f.q.trim())
  if (f.sameTitle !== undefined) add('sameTitle', f.sameTitle)
  if (f.parent !== undefined) add('parent', f.parent === null ? 'root' : f.parent)
  if (f.kinds?.length) add('kinds', f.kinds.join(','))
  if (f.tags?.length) add('tags', f.tags.join(','))
  if (f.area) add('area', f.area)
  if (f.status) add('status', f.status)
  add('drafts', f.includeAi ? 'include' : 'exclude')
  add('sort', f.sort || 'updated')
  if (f.props?.length) add('props', f.props.map(({ key, op, value }) => `${key}:${op}${value === undefined || op === 'exists' || op === 'missing' ? '' : ':' + enc(Array.isArray(value) ? value.join(',') : String(value))}`).join(','))
  add('limit', String(f.limit ?? PAGE))
  if (f.cursor) add('cursor', f.cursor)
  return `/api/docs/search?${p.join('&')}`
}

const path = (ref: string) => `/api/docs/${enc(ref)}`

export const docsApi = {
  search: (origin: string, f: DocFilters) => request<SearchResult>(origin, searchQuery(f)),
  /** 한 부모의 자식(형제 순서). 트리·폴더·이동 시트가 써요 */
  children: (origin: string, parent: string | null, cursor?: string) => request<SearchResult>(origin, searchQuery({ parent, sort: 'tree', includeAi: true, limit: 50, cursor })),
  /** 미리보기용 앞부분 */
  head: (origin: string, ref: string, maxChars = 4000) => request<FetchResult>(origin, `${path(ref)}?view=markdown&maxChars=${maxChars}`),
  /** 메타·version·조상(본문 없음) */
  meta: (origin: string, ref: string) => request<FetchResult>(origin, `${path(ref)}?view=meta`),
  related: (origin: string, ref: string, direction: 'out' | 'in' | 'both', limit = 30) => request<RelatedResult>(origin, `${path(ref)}/related?direction=${direction}&depth=1&limit=${limit}`),
  schema: (origin: string) => request<SchemaResult>(origin, '/api/docs/schema'),
  patchMeta: (s: ScopedClient, ref: string, body: { title?: string; area?: string | null; status?: 'open' | 'done'; due?: string | null; expectedVersion: number }) =>
    s.write<{ ref: string; version: number }>(`${path(ref)}/meta`, 'PATCH', body),
  patchProps: (s: ScopedClient, ref: string, body: { set?: Record<string, PropValue>; types?: Record<string, PropType>; remove?: string[]; expectedVersion: number }) =>
    s.write<{ ref: string; version: number; props: DocProp[] }>(`${path(ref)}/props`, 'POST', body),
  changeTags: (s: ScopedClient, ref: string, change: { add?: string[]; remove?: string[] }) => s.write<{ ref: string; tags: string[] }>(`${path(ref)}/tags`, 'POST', change),
  /** 옮기기(독립 문서만). 409 는 순환·깊이, 400 은 보관·잘못된 기준 */
  move: (s: ScopedClient, input: MoveInput) =>
    s.write<{ ref: string; parent: string | null }>(`${path(input.ref)}/move`, 'POST', { parent: input.parent, ...(input.before ? { before: input.before } : {}), ...(input.after ? { after: input.after } : {}) }),
  /** 만들기. 같은 id·같은 요청은 서버가 처음 결과를 돌려줘서 결과를 모를 때 다시 보내도 하나만 생겨요 */
  create: (s: ScopedClient, input: CreateInput) => s.write<{ ref: string; version: number; existing?: boolean }>('/api/docs', 'POST', input),
  /** 사진 올리기(POST /api/files, 본문 = 이미지 바이트). 받은 url 을 노트에 ![](url) 로 넣어요 */
  uploadImage: async (s: ScopedClient, uri: string, type: string) => {
    const body = await (await fetch(uri)).blob()
    return s.upload<{ url: string }>('/api/files', { method: 'POST', headers: { 'content-type': type }, body })
  },
}
/** 서버가 받는 이미지 형식(apps/server/server/files.ts EXT) */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
