// Workspace API 클라이언트(/api/ws/*). 서버 계약: src/workspace/api.ts. 출처: board/apps/web/src/lib/api.ts 의 call() 모양(no-store, 오류 본문 error 를 그대로 보여 주기).
export type LogLine = { by: string; at: number; text: string; id?: string }
export type Item = {
  id: string; type: "todo" | "goal"; text: string; raw?: string; done: boolean; due: string | null; log: LogLine[]; runId?: string; textBy: "person" | "council"
  by: string; createdAt: number; updatedAt: number; seq: number; localEdited: boolean
  source?: "capture" | "direction-board"; sourceId?: string; remindAt?: string; area?: string; boardId?: string; space?: string; goalId?: string; placed?: boolean; doneAt?: number
}
export type GoalView = { goal: Item; total: number; done: number; open: Item[]; next: string | null }
export type Area = { id: string; name: string; color: string }
export type Meta = {
  boards: { id: string; name: string; kind: string; areas: Area[] }[]
  spaces: { id: string; kind: string; name: string }[]
  me: { email: string } | null
  import: { ok: boolean; at: number | null; error: string | null; seq: number; items: number; signals: number; base: string } | null
}
export type Signal = {
  id: string; ref: string | null; source: string; kind: string; title: string; body: string | null; lane: string; reason: string | null
  status: "open" | "running" | "resolved"; meta: Record<string, any>; created_at: number; updated_at: number; resolved_at: number | null
}
export type Note = { ref: string; md: string; by: string; updatedAt: number; personEdited: boolean; version?: number; overflow?: number }
export type NowView = {
  today: string; needsYou: Signal[]; running: Signal[]; dueToday: Item[]; goals: GoalView[]; review: Signal[]; inbox: Item[]; later: Item[]
  counts: { needsYou: number; dueToday: number; review: number; inbox: number; running: number; goals: number }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/**
 * 데이터 주입 지점. 기본은 fetch·EventSource 로 서버에 붙고, 랜딩의 데모(site/web/src/landing/demo)는 녹화된 서울 실행을
 * 돌려주는 전송 계층을 꽂아 같은 Workspace 화면을 네트워크 없이 그려요. 화면 코드는 이 차이를 몰라요.
 */
export type Transport = {
  call: (path: string, init: { method?: string; body?: unknown }) => Promise<unknown>
  events: (path: string) => EventSource
}
let transport: Transport | null = null
export function setTransport(t: Transport | null) { transport = t }
/** 실행 이벤트 스트림(SSE). 데모에서는 녹화 이벤트를 차례로 흘려요 */
export function openEvents(path: string): EventSource { return transport ? transport.events(path) : new EventSource(path) }

export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (transport) return (await transport.call(path, init)) as T
  const res = await fetch(path, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "HTTP " + res.status)
  return data as T
}

export const ws = {
  now: () => call<NowView>("/api/ws/now"),
  meta: () => call<Meta>("/api/ws/meta"),
  items: (done: boolean) => call<Item[]>("/api/ws/items" + (done ? "?done=1" : "")),
  signals: () => call<Signal[]>("/api/ws/signals"),
  syncBoard: () => call<Meta["import"]>("/api/ws/import/sync", { method: "POST" }),
  capture: (text: string, clientKey: string) => call<{ item: Item; existed: "same" | "open" | null }>("/api/ws/items", { method: "POST", body: { text, clientKey } }),
  patch: (id: string, body: Record<string, unknown>) => call<Item>("/api/ws/items/" + id, { method: "PATCH", body }),
  done: (id: string) => call<Item>("/api/ws/items/" + id + "/done", { method: "POST" }),
  log: (id: string, text: string) => call<Item>("/api/ws/items/" + id + "/log", { method: "POST", body: { text } }),
  archive: (id: string) => call<{ ok: true }>("/api/ws/items/" + id, { method: "DELETE" }),
  item: (id: string) => call<{ item: Item; note: Note | null }>("/api/ws/items/" + id),
  signal: (id: string) => call<{ signal: Signal; note: Note | null; approvalPreview?: string; previewHash?: string }>("/api/ws/signals/" + id),
  /** previewHash: 사람이 본 실행 글의 지문. 그사이 글이 바뀌었으면 서버가 409 로 실행하지 않아요 */
  approve: (id: string, previewHash?: string) => call<{ signal: Signal; execRunId?: string }>("/api/ws/signals/" + id + "/approve", { method: "POST", body: previewHash ? { previewHash } : {} }),
  reject: (id: string, why = "") => call<{ signal: Signal }>("/api/ws/signals/" + id + "/reject", { method: "POST", body: { why } }),
  resolve: (id: string) => call<{ signal: Signal }>("/api/ws/signals/" + id + "/resolve", { method: "POST" }),
  /** baseVersion: 화면의 노트가 출발한 버전 번호(새 노트는 0). 그사이 바뀌었으면 409, 너무 길면 413 */
  saveNote: (ref: string, md: string, baseVersion: number) => call<Note>("/api/ws/notes?ref=" + encodeURIComponent(ref), { method: "PUT", body: { md, baseVersion } }),
  /** 의회에 넘기기: 콘솔과 같은 POST /api/runs 로 열고, runId 를 항목에 이어요 */
  ask: async (item: Item) => {
    const r = await call<{ runId: string }>("/api/runs", { method: "POST", body: { request: item.raw ?? item.text } })
    return ws.patch(item.id, { runId: r.runId })
  },
}

/** 같은 제출을 두 번 저장하지 않게(board quick-add 의 clientKey) */
export const newKey = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
