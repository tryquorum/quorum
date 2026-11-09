// 레인 1(일 화면) 쓰기·읽기 경로. 웹과 같은 REST 계약(apps/server/server/works.ts·signals.ts·runs.ts·capture.ts·docs/api.ts).
// 쓰기는 client.write 로만 보내요(409 ConflictError / 거절 ApiError / 결과 불명 UnknownWriteError, 다시 보내지 않음).
import type { Board, CaptureHints, CaptureResponse, DocProp, FetchResult, NoteSource, PropType, PropValue, Run, SchemaResult, WriteResult } from '@direction-board/contracts'
import type { Call } from '@direction-board/contracts/quick-add'
import { byOrigin, type Client } from './client'

/** 일 상세 한 줄 요약(works.ts Brief) */
export type Brief = { ref: string; type: string; title: string; source: string; lane?: string; status: string; area?: string | null; due?: number | null; when?: string | null; updated_at: number }
export type WorkLink = { id: string; label: string | null; dir: 'in' | 'out'; by: string; other: Brief }
export type WorkSignal = {
  id: string; source: string; kind: string; title: string; body: string | null; url: string | null; area: string | null; task: string | null; agent: string | null
  lane: string; reason: string | null; status: string; private: boolean; sample: boolean; needs_ai: boolean; due: number | null; created_at: number; updated_at: number; meta: Record<string, unknown> | null
}
/** GET /api/work/:ref 전체 */
export type WorkFull = {
  ref: string
  self: Brief
  signal: WorkSignal | null
  noteVersioning?: boolean
  note: { html: string; text: string; md?: string | null; version?: number; by: string; updated_at: number } | null
  links: WorkLink[]
  flow: { why: string; item: Brief }[]
  timeline: { at: number; kind: string; text: string }[]
}
const enc = encodeURIComponent

export const workOps = (c: Client) => ({
  work: (ref: string) => c.request<WorkFull>(`/api/work/${enc(ref)}`),
  /** 노트 원문 + 그 onceKey 가 이미 적용됐는지(onceApplied, 옛 서버는 없음) — 복구의 읽기 확인 */
  noteOnce: (ref: string, onceKey: string) => c.request<NoteSource>(`/api/docs/${enc(ref)}/note?onceKey=${enc(onceKey)}`),
  /** 그 ref 의 사건(옛 서버는 ref 를 무시하고 최근 목록을 줘서 부르는 쪽이 ref 로 걸러요) */
  signalsByRef: (ref: string) => c.request<{ signals: { id: string; ref: string | null }[] }>(`/api/signals?ref=${enc(ref)}`),
  patchSignal: (id: string, body: { status?: 'open' | 'resolved' | 'snoozed'; lane?: string; reason?: string | null; feedback?: 'mute' | 'urgent' }) =>
    c.write<unknown>(`/api/signals/${enc(id)}`, 'PATCH', body),
  createSignal: (body: Record<string, unknown>) => c.write<{ id: string }>('/api/signals', 'POST', body),
  clearSamples: () => c.write<unknown>('/api/signals?sample=1', 'DELETE'),
  deleteRule: (id: string) => c.write<unknown>(`/api/rules/${enc(id)}`, 'DELETE'),
  /** 노트가 없는 일의 첫 노트(빈 노트, 버전 0 에서). 그 뒤 편집은 notes 모듈의 docs write */
  startNote: (ref: string) => c.write<{ version?: number }>(`/api/work/${enc(ref)}/note`, 'PUT', { html: '', text: '', md: '', expectedVersion: 0 }),
  search: (q: string, exclude: string) => c.request<{ results: Brief[] }>(`/api/work/search?q=${enc(q)}&exclude=${enc(exclude)}`),
  link: (a: string, b: string, label: string) => c.write<{ id: string }>('/api/work/links', 'POST', { a, b, label }),
  unlink: (id: string) => c.write<unknown>(`/api/work/links/${enc(id)}`, 'DELETE'),
  runsFor: (target: string) => c.request<{ runs: Run[] }>(`/api/runs?target=${enc(target)}`),
  runsInThread: (thread: string) => c.request<{ runs: Run[] }>(`/api/runs?thread=${enc(thread)}`),
  /** AI 실행 시작. clientKey(먼저 기록의 키)가 있으면 같은 키·같은 요청은 서버가 그 실행을 돌려줘요(하나만) */
  startRun: (body: { prompt: string; target?: string; kind?: 'chat' | 'draft'; provider?: string; model?: string; effort?: string; clientKey?: string }) => c.write<Run>('/api/runs', 'POST', body),
  /** 노트 끝에 붙이기(docs write append): 기존 HTML 은 그대로, 뒤에 가로줄 + 새 글. 읽은 버전이 아니면 409, 같은 글이 이미 있으면 applied 0(duplicate). 노트가 없으면 404 */
  appendNote: (ref: string, md: string, expectedVersion: number, onceKey?: string) => c.write<WriteResult>(`/api/docs/${enc(ref)}/write`, 'POST', { mode: 'append', md, expectedVersion, ...(onceKey ? { onceKey } : {}) }),
  markApplied: (id: string) => c.write<unknown>(`/api/runs/${enc(id)}`, 'PATCH', { applied: true }),
  /** 보드 항목 지우기(서버는 지움 표시만, 웹 보드 지우기와 같음) */
  deleteItem: (boardId: string, id: string) => c.write<unknown>(`/api/boards/${enc(boardId)}/items/${enc(id)}`, 'DELETE'),
  /** 판 이름·영역 바꾸기(PATCH /api/boards/:id). 영역 색이 없으면 서버가 기본 색을 줘요 */
  saveBoard: (boardId: string, body: { name?: string; areas?: { id?: string; name: string; color?: string }[] }) => c.write<Board>(`/api/boards/${enc(boardId)}`, 'PATCH', body),
  /** 일의 문서 메타(태그·사용자 속성·version). 문서 색인은 노트가 있는 일만이라 없으면 404 */
  docMeta: (ref: string) => c.request<FetchResult>(`/api/docs/${enc(ref)}?view=meta`),
  docsSchema: () => c.request<SchemaResult>('/api/docs/schema'),
  changeTags: (ref: string, change: { add?: string[]; remove?: string[] }) => c.write<{ ref: string; tags: string[] }>(`/api/docs/${enc(ref)}/tags`, 'POST', change),
  patchProps: (ref: string, body: { set?: Record<string, PropValue>; types?: Record<string, PropType>; remove?: string[]; expectedVersion: number }) =>
    c.write<{ ref: string; version: number; props: DocProp[] }>(`/api/docs/${enc(ref)}/props`, 'POST', body),
  models: () => c.request<{ providers: unknown[] }>('/api/models'),
  startCapture: (body: { kind: 'capture'; prompt: string; clientKey: string; hints?: CaptureHints; page?: unknown }) => c.write<Run>('/api/runs', 'POST', body),
  effects: (id: string) => c.request<CaptureResponse>(`/api/runs/${enc(id)}/effects`),
  undo: (id: string, ref: string) => c.write<unknown>(`/api/runs/${enc(id)}/undo`, 'POST', { ref }),
  retry: (id: string) => c.write<Run>(`/api/runs/${enc(id)}/retry`, 'POST'),
  stop: (id: string) => c.write<unknown>(`/api/runs/${enc(id)}/stop`, 'POST'),
})
/** 읽기만 workApi.x(origin, ...). 쓰기는 workOps(useWriteScope()) — 화면을 연 시점의 서버·계정으로만(api/scope.ts) */
export const workApi = byOrigin(workOps, ['work', 'search', 'runsFor', 'runsInThread', 'docMeta', 'docsSchema', 'models', 'effects'])

/** contracts createWork 가 부를 요청 하나(웹 api 대응). GET 은 읽기, 그 밖은 쓰기 규칙. 범위 고정 클라이언트를 넘기면 단계마다 범위를 확인해요 */
export function callWith(c: Client): Call {
  return <T,>(path: string, init: { method: string; body?: string }) =>
    init.method === 'GET'
      ? c.request<T>(path)
      : c.write<T>(path, init.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE', init.body === undefined ? undefined : JSON.parse(init.body))
}
