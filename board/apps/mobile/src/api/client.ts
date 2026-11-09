import type {
  StateResponse,
  SignalsResponse,
  SearchResult,
  FetchResult,
  Run,
  SettingsInfo,
  Item,
} from '@direction-board/contracts'
import { ScopeChangedError } from './queryStore'
import { isExpired, tokenClaims, type AccessSession } from './session'

export { ScopeChangedError }

export const DEFAULT_ORIGIN = 'https://direction.lidgeai.com'
/** GET /api/work/:ref 중 레인 0 읽기 화면이 쓰는 부분(전체 모양은 apps/server/server/works.ts) */
export type WorkDetail = {
  ref: string
  self: { ref: string; type: string; title: string; source: string | null; status: string; area: string | null; due: number | null; when?: string | null; lane?: string }
  noteVersioning?: boolean
  note: { html: string; text: string; md?: string | null; version?: number } | null
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 401 이 로그인 거절(401 응답·Access 로그인 페이지)인지. JSON 이 아닌 응답만으로는 토큰을 버리지 않아요. */
    readonly loginRequired = status === 401,
    /** 응답 본문(JSON 일 때만). 409 의 current·ops·run 같은 서버 현재 값이 여기 있어요 */
    readonly body: unknown = null,
  ) {
    super(message)
  }
  /** 서버가 확실히 거절해서 쓰이지 않은 요청인지: 서버 err() 의 JSON {error} 4xx, 또는 Access 로그인 요구 */
  get rejected(): boolean {
    if (this instanceof UnexpectedBodyError) return false
    if (this.loginRequired) return true
    const b = this.body
    return this.status >= 400 && this.status < 500 && !!b && typeof b === 'object' && typeof (b as { error?: unknown }).error === 'string'
  }
}
/** 409: 다른 곳에서 먼저 바뀜. body 에 서버가 돌려준 것이 그대로 있어요(노트 current, 순회 ops, AI 정리 run, 또는 error 글만) */
export class ConflictError extends ApiError {}
/**
 * 성공 응답인데 JSON 이 아님(Access 로그인 페이지일 수도, 프록시가 바꾼 응답일 수도). 읽기에서는 로그인 안내로 보이지만,
 * 쓰기에서는 이미 적용됐을 수 있어 결과 불명이에요. Access 로그인 주소로 간 리디렉트만 확실한 거절이에요.
 */
export class UnexpectedBodyError extends ApiError {}
/** 쓰기 결과를 모름(응답 유실, 5xx, 프록시가 만든 응답 등). 쓰였을 수도 있어서 다시 보내지 않고 다시 읽어 확인해요 */
export class UnknownWriteError extends Error {
  /** 계약 쪽 순수 규칙(quick-add createWork)이 클래스 없이 알아보는 표시 */
  readonly unknownWrite = true
  constructor(readonly cause: unknown) {
    super(cause instanceof NetworkError ? '서버에 닿지 않아 결과를 확인하지 못했어요' : '보낸 결과를 확인하지 못했어요')
  }
}
/** fetch 자체가 실패함(주소에 닿지 않음). iOS 의 fetch 는 TypeError 가 아닌 Error 를 던져요. */
export class NetworkError extends Error {}
export function errorMessage(error: unknown): string {
  if (error instanceof UnknownWriteError) return error.message
  if (error instanceof ConflictError) return '다른 곳에서 먼저 바뀌었어요'
  if (error instanceof ApiError)
    return error.loginRequired
      ? '로그인이 필요해요'
      : error.status === 401
        ? '서버 응답을 읽지 못했어요'
        : error.status === 403
          ? '이 서버에서 허용하지 않은 요청이에요'
          : `불러오지 못했어요 (HTTP ${error.status})`
  if (error instanceof NetworkError || error instanceof TypeError) return '서버에 닿지 않아요'
  if (error instanceof SyntaxError) return '서버 응답을 읽지 못했어요'
  return error instanceof Error ? error.message : '불러오지 못했어요'
}
export function normalizeOrigin(value: string): string {
  const u = new URL(value.trim())
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error('서버 주소만 입력해 주세요')
  return u.origin
}
type AuthHooks = { session: () => AccessSession | null; expired: (session: AccessSession) => void }
let auth: AuthHooks = { session: () => null, expired: () => {} }
/**
 * 앱이 로그인 상태를 알려 줘요. 토큰은 그 토큰을 받은 HTTPS 서버에만 붙여요. 리디렉트가 나면 iOS RN 네트워크 층이
 * 쿠키 외 헤더를 모두 지워서(react-native Libraries/Network/RCTHTTPRequestHandler.mm 의 willPerformHTTPRedirection)
 * 토큰이 다른 주소로 따라가지 않아요. expired 는 실패한 요청이 쓴 세션 객체를 받아, 그사이 새로 로그인한 세션은 지우지 않게 해요.
 */
export function configureAuth(hooks: AuthHooks) {
  auth = hooks
}
/** 지금 로그인의 동기 식별자(서버 주소 + 토큰). 쓰기 줄이 보내기 직전에 줄 설 때와 같은지 봐요 */
export function sessionIdentity(): string {
  const session = auth.session()
  return session ? `${session.origin}|${session.token}` : 'anon'
}
/** 화면이 쓰는 공용 요청. 레인별 API 모듈(api/*.ts)은 이것과 write 로 경로를 더해요 */
/**
 * 노트 이미지 등 RN 이 직접 읽는 주소. 상대 주소는 지금 서버로 풀고, 토큰은 request 와 같은 규칙으로만 붙여요:
 * 주소의 origin 이 지금 서버와 같고 https 이고 그 서버에서 받은 로그인일 때. 외부·http·다른 서버에는 붙이지 않아요.
 */
export function imageSource(origin: string, src: string): { uri: string; headers?: Record<string, string> } {
  let url: URL
  try {
    url = new URL(src, origin)
  } catch {
    return { uri: src }
  }
  const session = auth.session()
  const token = session && url.origin === origin && origin.startsWith('https://') && session.origin === origin && !isExpired(session.token) ? session.token : null
  return { uri: url.href, ...(token ? { headers: { 'cf-access-token': token } } : {}) }
}
/** 범위 고정 없이 보낸 쓰기(전역 클라이언트·request 의 POST 등). 앱의 쓰기는 늘 화면을 연 시점의 범위로만 보내요(api/scope.ts useWriteScope) */
export class GlobalWriteError extends Error {
  constructor() {
    super('쓰기는 화면을 연 시점의 서버·계정으로만 보내요')
  }
}
const readOnly = (init?: RequestInit) => !init?.method || /^(GET|HEAD)$/i.test(init.method)
/** 읽기(GET). 쓰기 메서드를 넘기면 보내지 않아요 — 쓰기는 범위 고정 클라이언트(ScopedClient.write·upload)로만 */
export async function request<T>(origin: string, path: string, init?: RequestInit): Promise<T> {
  if (!readOnly(init)) throw new GlobalWriteError()
  return authed<T>(origin, path, init)
}
async function authed<T>(origin: string, path: string, init?: RequestInit): Promise<T> {
  const session = auth.session()
  const used = session && session.origin === origin && origin.startsWith('https://') ? session : null
  const token = used?.token ?? null
  if (used && isExpired(used.token)) {
    auth.expired(used)
    throw new ApiError(401, 'Access token expired')
  }
  try {
    return await send<T>(origin + path, init, token)
  } catch (error) {
    // 토큰을 붙였는데 Access 가 다시 로그인을 요구하면 그 토큰은 더 쓰지 않아요
    if (used && error instanceof ApiError && error.loginRequired) auth.expired(used)
    throw error
  }
}
/**
 * 쓰기 요청. 실패를 세 가지로 나눠 던져요: ConflictError(409), ApiError(rejected — 서버가 거절해 쓰이지 않음),
 * UnknownWriteError(그 밖 모두 — 쓰였는지 모름). 어느 경우에도 다시 보내지 않아요.
 * 모듈 안에서만 써요: 밖에서는 범위 고정 클라이언트(pinnedClient)가 범위를 확인한 뒤 이것을 불러요.
 */
async function classify<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch (error) {
    if (error instanceof ScopeChangedError || error instanceof ConflictError || (error instanceof ApiError && error.rejected)) throw error
    throw new UnknownWriteError(error)
  }
}
const writeNow = <T>(origin: string, path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, headers?: Record<string, string>) =>
  classify(() => authed<T>(origin, path, { method, ...(headers ? { headers } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
/** 서버의 마지막 관문(PR #39 리뷰 17): 시작 범위의 로그인 주체를 밝히면 서버가 지금 주체와 다를 때 쓰기 0건·409 scope-changed */
export const EXPECT_USER = 'X-Direction-Expect-User'
/** 범위 이름(서버 주소|주체)의 주체. 로그인 없이(anon) 붙는 로컬 개발 서버나 이메일을 모르는 토큰이면 밝히지 않아요(서버가 정한 주체 그대로) */
export function expectUser(scope: string): string | null {
  const who = scope.slice(scope.lastIndexOf('|') + 1)
  return who && who !== 'anon' && who !== 'signed-in' ? who : null
}
async function send<T>(url: string, init: RequestInit | undefined, token: string | null): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      // 본문 형식은 요청이 정할 수 있어요(사진 올리기의 image/*). 토큰 머리는 늘 위 규칙대로만
      headers: { 'content-type': 'application/json', ...(init?.headers as Record<string, string> | undefined), ...(token ? { 'cf-access-token': token } : {}) },
    })
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : 'fetch failed')
  }
  if (response.url && new URL(response.url).hostname.toLowerCase().endsWith('cloudflareaccess.com'))
    throw new ApiError(401, 'Access login')
  const json = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')
  if (!response.ok) {
    const body: unknown = json ? await response.json().catch(() => null) : null
    const text = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `HTTP ${response.status}`
    // 시작 범위의 주체와 지금 주체가 달라 서버가 거절(쓰기 0건): 범위가 바뀐 것과 같아요 — 기록은 그대로, "다른 계정에서 시작한 작업"
    if (response.status === 409 && text === 'scope-changed') throw new ScopeChangedError('다른 계정에서 시작한 작업이에요 · 그 계정으로 돌아가면 이어서 해요')
    if (response.status === 409) throw new ConflictError(409, text, false, body)
    throw new ApiError(response.status, text, response.status === 401, body)
  }
  if (!json)
    // 토큰 없이 받은 HTML 은 Access 로그인 페이지일 가능성이 커요. 토큰을 붙였다면 프록시 오류 페이지로 보고 토큰을 지켜요
    throw new UnexpectedBodyError(401, 'Expected JSON', !token)
  return (await response.json()) as T
}
export const api = {
  state: (origin: string) => request<StateResponse>(origin, '/api/state'),
  signals: (origin: string) => request<SignalsResponse>(origin, '/api/signals'),
  /** 할 일·목표 저장(웹 useBoard.save 와 같은 본문). 서버가 저장한 항목을 돌려줘요 */
  saveItem: (s: ScopedClient, item: Item) => {
    const { boardId, id, by, updatedAt, deleted, ...rest } = item as Item & { by?: unknown; updatedAt?: unknown }
    void by
    void updatedAt
    void deleted
    return s.write<Item>(`/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(id)}`, 'PUT', { id, ...rest })
  },
  /** 웹 설정창과 같은 계정·연결 정보(GET /api/settings) */
  settings: (origin: string) => request<SettingsInfo>(origin, '/api/settings'),
  /** 일 상세(웹 work-view 와 같은 GET /api/work/:ref). 노트가 없는 할 일·사건도 열려요(문서 색인은 노트가 있는 것만) */
  work: (origin: string, ref: string) => request<WorkDetail>(origin, `/api/work/${encodeURIComponent(ref)}`),
  docs: (origin: string, cursor?: string) =>
    request<SearchResult>(
      origin,
      `/api/docs/search?sort=updated&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  async doc(origin: string, ref: string): Promise<FetchResult> {
    let offset = 0
    let first: FetchResult | undefined
    let markdown = ''
    for (;;) {
      const page = await request<FetchResult>(
        origin,
        `/api/docs/${encodeURIComponent(ref)}?view=markdown&maxChars=20000&offset=${offset}`,
      )
      if (first && first.version !== page.version)
        throw new Error('읽는 동안 문서가 바뀌었어요. 다시 시도해 주세요')
      first ??= page
      markdown += page.markdown
      if (!page.truncated) return { ...first, markdown, truncated: false, nextOffset: undefined }
      if (page.nextOffset === undefined || page.nextOffset <= offset)
        throw new Error('문서의 나머지를 읽지 못했어요')
      offset = page.nextOffset
    }
  },
  runs: (origin: string, thread: string) =>
    request<{ runs: Run[] }>(origin, `/api/runs?thread=${encodeURIComponent(thread)}`),
}


/** 요청 한 벌. 전역(지금 서버로 바로)과 범위 고정(흐름 시작 때의 서버·로그인일 때만) 둘 다 이 모양이에요 */
export type Client = {
  origin: string
  request<T>(path: string, init?: RequestInit): Promise<T>
  write<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T>
}
/** 전역 클라이언트: 읽기 전용. 쓰기를 부르면 보내지 않고 GlobalWriteError(쓰기는 useWriteScope 의 범위 고정 클라이언트로) */
export const globalClient = (origin: string): Client => ({
  origin,
  request: (path, init) => request(origin, path, init),
  write: () => Promise.reject(new GlobalWriteError()),
})
/** 범위 식별: 서버 주소 + 로그인 주체(QueryProvider·기기 저장과 같은 계산). 같은 계정의 토큰 갱신에는 그대로예요 */
export function scopeIdentity(origin: string): string {
  const session = auth.session()
  const principal = session && session.origin === origin ? (tokenClaims(session.token)?.email ?? 'signed-in') : 'anon'
  return `${origin}|${principal}`
}
export type ScopedClient = Client & {
  /** 고정한 범위 이름(서버 주소 + 로그인 주체) */
  scope: string
  /** 시작 때의 범위 그대로인지 */
  same(): boolean
  /** 범위가 바뀌었으면 ScopeChangedError */
  check(): void
  /** 본문을 그대로 보내는 쓰기(사진 올리기). 범위 확인·실패 나누기는 write 와 같아요 */
  upload<T>(path: string, init: RequestInit & { method: 'POST' }): Promise<T>
}
/**
 * 범위 고정 클라이언트. 만들 때 서버 주소와 로그인 주체를 잡고, 모든 요청(흐름 안의 자동 재전송 포함)을 보내기 직전에
 * 지금 범위와 비교해 다르면 보내지 않고 ScopeChangedError 를 던져요. sameView 는 화면 쪽 범위(지금 서버 설정 등)가 그대로인지.
 * 여러 단계 흐름(AI 정리 시작·재시도, 빠른 추가, 노트에 넣기, 초안 넣기, 새 일 만들기)은 이것만 써요(api/scoped.test.ts 가 고정).
 */
export function scopedClient(origin: string, sameView: () => boolean = () => true): ScopedClient {
  return pinnedClient(origin, scopeIdentity(origin), sameView, () => new ScopeChangedError())
}
/**
 * 복구 기록(결과 불명·부분 완료) 재개용: 그 기록이 저장한 시작 범위로 고정해요. 지금 범위가 다르면 보내지 않고
 * "다른 계정에서 시작한 작업" 으로 멈추고, 원래 계정으로 돌아오면 그대로 보내요. 재개는 늘 이것으로(api/scoped.test.ts 가 고정)
 */
export function resumeClient(origin: string, scope: string, sameView: () => boolean = () => true): ScopedClient {
  return pinnedClient(origin, scope, sameView, () => new ScopeChangedError('다른 계정에서 시작한 작업이에요 · 그 계정으로 돌아가면 이어서 해요'))
}
function pinnedClient(origin: string, pinned: string, sameView: () => boolean, error: () => ScopeChangedError): ScopedClient {
  const same = () => sameView() && scopeIdentity(origin) === pinned
  const check = () => {
    if (!same()) throw error()
  }
  // 모든 쓰기에 시작 범위의 주체를 밝혀요 — 확인 뒤 보내는 사이에 계정이 바뀌어도 서버가 거절해요
  const who = expectUser(pinned)
  const expect: Record<string, string> | undefined = who ? { [EXPECT_USER]: who } : undefined
  return {
    origin,
    scope: pinned,
    same,
    check,
    // async 라도 본문은 부르는 즉시(같은 틱에) 돌아서, 확인과 보내기 사이에 범위가 바뀔 틈이 없어요
    request: async (path, init) => {
      check()
      return request(origin, path, init)
    },
    write: async (path, method, body) => {
      check()
      return writeNow(origin, path, method, body, expect)
    },
    upload: async (path, init) => {
      check()
      return classify(() => authed(origin, path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...expect } }))
    },
  }
}
type Ops = Record<string, (...args: never[]) => unknown>
export type ByOrigin<T extends Ops, K extends keyof T> = { [P in K]: T[P] extends (...a: infer A) => infer R ? (origin: string, ...a: A) => R : never }
/**
 * 클라이언트를 받는 요청 묶음(ops(c)) 중 **읽기**만 origin 을 첫 인자로 받는 모양으로(reads 에 적은 이름만). 쓰기는 이 모양에 없어서
 * ops(useWriteScope()) 로만 부를 수 있어요(타입이 막고, 전역 클라이언트의 쓰기는 GlobalWriteError)
 */
export function byOrigin<T extends Ops, K extends keyof T & string>(ops: (c: Client) => T, reads: readonly K[]): ByOrigin<T, K> {
  return Object.fromEntries(reads.map((k) => [k, (origin: string, ...a: never[]) => (ops(globalClient(origin))[k] as (...x: never[]) => unknown)(...a)])) as ByOrigin<T, K>
}
