// 서버·웹·모바일이 함께 쓰는 API 응답 타입은 packages/contracts 에 있어요.
import {
  compareWorkOrder,
  computeGoalProgress,
  computeGoalState,
  goalStateLabel,
  goalProgressBasis,
  linkedTodosForGoal,
  whenOfItem,
  type Area,
  type Board,
  type ChangesResponse,
  type Collector,
  type ErrorKind,
  type GoalProgress,
  type GoalState,
  type Item,
  type Lane,
  type Rule,
  type Run,
  type RunThread,
  type Signal,
  type SignalsResponse,
  type StateResponse,
} from '@direction-board/contracts'
export { compareWorkOrder, computeGoalProgress, computeGoalState, goalProgressBasis, goalStateLabel, linkedTodosForGoal }
export type { Lane, Signal, Collector, Rule, SignalsResponse, Area, Board, Item, StateResponse, ChangesResponse, ErrorKind, RunThread, Run, GoalProgress, GoalState }

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })
  if (!r.ok) {
    const body: unknown = await r.json().catch(() => null)
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.trim() ? body.error : `HTTP ${r.status}`
    throw new ApiError(message, r.status, body)
  }
  const body = await r.json() as T
  if (typeof window !== 'undefined' && ((init.method === 'PUT' && /^\/api\/(?:work|docs)\/[^/]+\/note$/.test(path)) || (init.method === 'PATCH' && /^\/api\/docs\/[^/]+\/meta$/.test(path)) || (init.method === 'POST' && (path === '/api/docs' || /^\/api\/docs\/[^/]+\/(?:write|tags|props|move|archive)$/.test(path))))) {
    window.dispatchEvent(new Event('docs:changed'))
  }
  return body
}

/** 이미지 하나를 서버(data/uploads)에 올리고 주소를 받는다 */
export async function uploadImage(file: Blob): Promise<string> {
  const r = await fetch("/api/files", { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return ((await r.json()) as { url: string }).url
}

/** multipart 본문 보내기(이슈 첨부). content-type 은 브라우저가 경계값과 함께 정해요. 실패는 api() 와 같은 ApiError */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", body: form })
  const body: unknown = await r.json().catch(() => null)
  if (!r.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.trim() ? body.error : `HTTP ${r.status}`
    throw new ApiError(message, r.status, body)
  }
  return body as T
}

/** AI 결과물에 적힌 로컬 이미지 경로(/Users/..., file://..., ~/...)를 서버가 보여주는 주소로 바꾼다 */
const LOCAL = /^(\/Users\/|\/home\/|\/tmp\/|\/private\/|\/var\/folders\/|~\/)/
export function fileSrc(src: string): string {
  let s = src
  if (s.startsWith("file://")) s = decodeURI(s.slice(7))
  return LOCAL.test(s) ? `/api/files/local?path=${encodeURIComponent(s)}` : src
}

export const uid = () => Math.random().toString(36).slice(2, 12)

/** 할 일·목표의 기준 시각(로컬 ms): 시각이 있으면 그 시각, 날짜만 있으면 그날 23:59:59, 없으면 null */
export const whenOf = (it: Item) => whenOfItem(it)

/* 자연어 날짜 (옛 보드와 같은 규칙: /legacy/when.js 의 window.W) */
type WApi = {
  parse: (t: string, now?: Date) => { at: string; title: string; spans: [number, number][] } | null
  short: (v: string, now?: Date) => string
  long: (v: string, now?: Date) => string
  quick: (now?: Date) => { k: string; label: string; sub: string; at: string }[]
}
declare global {
  interface Window {
    W?: WApi
  }
}
export const W = {
  parse: (t: string) => window.W?.parse(t) ?? null,
  short: (v: string) => (window.W ? window.W.short(v) : v),
  long: (v: string) => (window.W ? window.W.long(v) : v),
  /** 빠른 선택 칩(오늘 저녁·내일·주말·다음 주). when.js 가 없으면 비어 있다 */
  quick: () => window.W?.quick() ?? [],
}
// 짧은 글(D-day·지난 시간·출처 이름)은 iOS 와 함께 쓰려고 packages/contracts/src/board-text.ts 에 있어요
export { ago, dday, isoLocal, SOURCE, srcName } from "@direction-board/contracts/board-text"
