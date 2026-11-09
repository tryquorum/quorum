// Workspace HTTP API (/api/ws/*). 출처: board/apps/server/server.ts 의 json()/err() 도우미와 parts 로 경로 고르기.
// DB 는 .quorum/workspace.db 하나(bun:sqlite). 방향판 실제 DB 와 3070 서버는 열지 않아요.
// 호출 전 src/server.ts 가 localRequestAllowed 로 이 맥 안의 요청만 들여보내요.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { approveSignal, initCouncilSync, rejectSignal, resolveSignal, syncCouncil, type EngineStore, type ExecuteFn } from "./council"
import { archiveItem, createItem, getItem, initItems, listItems, logItem, patchItem, type Item } from "./items"
import { appendNote, getNote, initNotes, putNote } from "./notes"
import { getSignal, ingestSignal, initSignals, listSignals, type Signal } from "./signals"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const failed = (r: unknown): r is { status: number; error: string } => !!r && typeof r === "object" && "error" in r && "status" in r
const REF = /^(item|signal):[A-Za-z0-9_-]{1,40}$/

export type WorkspaceDeps = { path: string; engine?: EngineStore; execute?: ExecuteFn; now?: () => number }
export type NowView = {
  today: string
  needsYou: Signal[]
  running: Signal[]
  dueToday: Item[]
  review: Signal[]
  inbox: Item[]
  later: Item[]
  counts: { needsYou: number; dueToday: number; review: number; inbox: number; running: number }
}

export function openWorkspaceDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 3000;")
  initItems(db)
  initSignals(db)
  initNotes(db)
  initCouncilSync(db)
  return db
}

export const localDay = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

/** "Now" 대시보드: Needs you → Due today → Review → Inbox 순서로, 바로 처리할 것만 */
export function nowView(db: ReturnType<typeof openWorkspaceDb>, now: number): NowView {
  const today = localDay(now)
  const open = listSignals(db, { open: true })
  const items = listItems(db)
  const needsYou = open.filter((s) => s.status === "open" && (s.lane === "decide" || s.lane === "now" || s.lane === "main"))
    .sort((a, b) => (a.lane === "now" ? -1 : 0) - (b.lane === "now" ? -1 : 0) || b.updated_at - a.updated_at)
  const running = open.filter((s) => s.status === "running" || s.lane === "running")
  const review = open.filter((s) => s.status === "open" && s.lane === "review")
  const dueToday = items.filter((i) => i.due && i.due.slice(0, 10) <= today).sort((a, b) => String(a.due).localeCompare(String(b.due)))
  const inbox = items.filter((i) => !i.due)
  const later = items.filter((i) => i.due && i.due.slice(0, 10) > today).sort((a, b) => String(a.due).localeCompare(String(b.due)))
  return { today, needsYou, running, dueToday, review, inbox, later, counts: { needsYou: needsYou.length, dueToday: dueToday.length, review: review.length, inbox: inbox.length, running: running.length } }
}

export function createWorkspace(deps: WorkspaceDeps) {
  const db = openWorkspaceDb(deps.path)
  const clock = deps.now ?? Date.now
  const sync = () => { if (deps.engine) { try { syncCouncil(db, deps.engine, clock()) } catch (e) { console.error("[workspace] council sync failed:", e) } } }
  /** 시험이 승인 실행을 기다릴 때 써요 */
  const pending = new Set<Promise<void>>()

  async function handle(req: Request, parts: string[]): Promise<Response> {
    const url = new URL(req.url)
    const m = req.method
    const body = async () => ((await req.json().catch(() => null)) as Record<string, unknown> | null)
    const [, , res, id, action] = parts // api ws <res> <id> <action>

    if (res === "now" && m === "GET") { sync(); return json(nowView(db, clock())) }

    if (res === "items") {
      if (!id && m === "GET") return json(listItems(db, { done: url.searchParams.get("done") === "1" }))
      if (!id && m === "POST") {
        const b = await body()
        if (!b) return err(400, "JSON body required")
        const r = createItem(db, b, clock())
        return failed(r) ? err(r.status, r.error) : json(r, r.existed ? 200 : 201)
      }
      if (!id) return err(405, "method not allowed")
      if (!action && m === "GET") {
        const it = getItem(db, id)
        return it ? json({ item: it, note: getNote(db, "item:" + id) }) : err(404, "item not found")
      }
      if (!action && (m === "PATCH" || m === "PUT")) {
        const b = await body()
        if (!b) return err(400, "JSON body required")
        const r = patchItem(db, id, b, "person", clock())
        return failed(r) ? err(r.status, r.error) : json(r)
      }
      if (!action && m === "DELETE") return archiveItem(db, id, clock()) ? json({ ok: true }) : err(404, "item not found")
      if (action === "done" && m === "POST") {
        const r = patchItem(db, id, { done: true }, "person", clock())
        return failed(r) ? err(r.status, r.error) : json(r)
      }
      if (action === "log" && m === "POST") {
        const b = await body()
        const r = logItem(db, id, { by: "person", text: typeof b?.text === "string" ? b.text : "" }, clock())
        return failed(r) ? err(r.status, r.error) : json(r)
      }
    }

    if (res === "signals") {
      if (!id && m === "GET") { sync(); return json(listSignals(db, { open: url.searchParams.get("all") !== "1" })) }
      if (!id && m === "POST") {
        // 다른 봇도 방향판처럼 "시작/에러/끝/승인 필요"를 보낼 수 있어요
        const b = await body()
        const r = ingestSignal(db, { ...(b || {}), source: typeof b?.source === "string" ? b.source : "agent" }, clock())
        return typeof r === "string" ? err(400, r) : json(r, 201)
      }
      if (!id) return err(405, "method not allowed")
      if (!action && m === "GET") {
        const s = getSignal(db, id)
        return s ? json({ signal: s, note: getNote(db, "signal:" + id) }) : err(404, "signal not found")
      }
      if (action === "approve" && m === "POST") {
        const r = approveSignal(db, id, deps.execute, clock())
        if (r.done) { const p = r.done.catch((e) => console.error("[workspace] approve finish failed:", e)).finally(() => pending.delete(p)); pending.add(p) }
        return json(r.body, r.status)
      }
      if (action === "reject" && m === "POST") {
        const b = await body()
        const r = rejectSignal(db, id, typeof b?.why === "string" ? b.why.trim().slice(0, 500) : "", clock())
        return json(r.body, r.status)
      }
      if (action === "resolve" && m === "POST") { const r = resolveSignal(db, id, clock()); return json(r.body, r.status) }
    }

    if (res === "notes") {
      const ref = url.searchParams.get("ref") || ""
      if (!REF.test(ref)) return err(400, "ref must be item:<id> or signal:<id>")
      if (!id && m === "GET") return json(getNote(db, ref) ?? { ref, md: "", by: "", updatedAt: 0, personEdited: false })
      if (!id && m === "PUT") {
        const b = await body()
        if (typeof b?.md !== "string") return err(400, "md required")
        return json(putNote(db, ref, b.md, clock()))
      }
      if (id === "append" && m === "POST") {
        const b = await body()
        if (typeof b?.md !== "string" || !b.md.trim()) return err(400, "md required")
        return json(appendNote(db, ref, b.md, "agent", clock()))
      }
    }
    return err(404, "unknown route " + m + " " + url.pathname)
  }

  return { db, handle, sync, settle: () => Promise.all([...pending]) }
}
