// Workspace HTTP API (/api/ws/*). 출처: board/apps/server/server.ts 의 json()/err() 도우미와 parts 로 경로 고르기.
// DB 는 .quorum/workspace.db 하나(bun:sqlite). 방향판 실제 DB 와 3070 서버는 열지 않아요.
// 호출 전 src/server.ts 가 localRequestAllowed 로 이 맥 안의 요청만 들여보내요.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { approveSignal, initCouncilSync, rejectSignal, resolveSignal, sendPreview, syncCouncil, type HostedApprove, type EngineStore, type ExecuteFn } from "./council"
import { archiveItem, createItem, getItem, initItems, listItems, logItem, patchItem, type Item } from "./items"
import { appendNote, getNote, initNotes, putNote } from "./notes"
import { getSignal, ingestSignal, initSignals, listSignals, type Signal } from "./signals"
import { createBoardImport, initBoardImport, readMeta, type GetJson } from "./board-import"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const failed = (r: unknown): r is { status: number; error: string } => !!r && typeof r === "object" && "error" in r && "status" in r
const REF = /^(item|signal):[A-Za-z0-9_-]{1,40}$/

export type WorkspaceDeps = {
  path: string; engine?: EngineStore; execute?: ExecuteFn; now?: () => number
  /** 방향판 읽기 전용 가져오기(예: http://127.0.0.1:3070). 없으면 가져오지 않아요 */
  boardBase?: string; boardGet?: GetJson
  /** 처음 여는 빈 Workspace 에 Send to agent 로 바로 해 볼 데모 항목 하나를 넣어요(한 번만) */
  demo?: boolean
  /** 호스팅 비소유자: 승인한 일을 실행하지 않고 그 사람 대기열에 넣어요(src/hosted/guest.ts). 승인 전에 보낼 글을 보여 주고 그 해시로 승인해요 */
  hosted?: HostedApprove
}
export type GoalView = { goal: Item; total: number; done: number; open: Item[]; next: string | null }
export type NowView = {
  today: string
  needsYou: Signal[]
  running: Signal[]
  dueToday: Item[]
  goals: GoalView[]
  review: Signal[]
  inbox: Item[]
  later: Item[]
  counts: { needsYou: number; dueToday: number; review: number; inbox: number; running: number; goals: number }
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
  initBoardImport(db)
  return db
}

export const localDay = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

/** 할 일의 날짜: 목표는 due, 할 일은 due 또는 미리알림(remindAt). 로컬(이 맥, KST) 날짜로 비교해요 */
export const whenOf = (i: Item) => i.due ?? i.remindAt ?? null
const goalKey = (g: Item) => (g.source === "direction-board" && g.sourceId ? g.sourceId.split(":").pop()! : g.id)

/** 목표마다 이어진 할 일과 진행률. 출처: board goal-view.tsx 의 done/total 진행률과 다음 할 일 */
export function goalViews(all: Item[]): GoalView[] {
  return all.filter((g) => g.type === "goal" && !g.done).map((goal) => {
    const key = goalKey(goal)
    const todos = all.filter((t) => t.type === "todo" && t.goalId === key && (t.source ?? "capture") === (goal.source ?? "capture"))
    const open = todos.filter((t) => !t.done).sort((a, b) => String(whenOf(a) ?? "9").localeCompare(String(whenOf(b) ?? "9")))
    return { goal, total: todos.length, done: todos.length - open.length, open, next: open[0] ? whenOf(open[0]) : null }
  }).sort((a, b) => String(a.goal.due ?? "9").localeCompare(String(b.goal.due ?? "9")))
}

/** "Now" 대시보드: Needs you → Due today/overdue → Goals → Review → Inbox 순서로, 바로 처리할 것만(끝낸 일은 빼요) */
export function nowView(db: ReturnType<typeof openWorkspaceDb>, now: number): NowView {
  const today = localDay(now)
  const open = listSignals(db, { open: true })
  const all = listItems(db, { done: true })
  const items = all.filter((i) => !i.done && i.type === "todo")
  const needsYou = open.filter((s) => s.status === "open" && (s.lane === "decide" || s.lane === "now" || s.lane === "main"))
    .sort((a, b) => (a.lane === "now" ? 0 : 1) - (b.lane === "now" ? 0 : 1) || (a.source === "quorum" ? 0 : 1) - (b.source === "quorum" ? 0 : 1) || b.updated_at - a.updated_at)
  const running = open.filter((s) => s.status === "running" || s.lane === "running")
  const review = open.filter((s) => s.status === "open" && s.lane === "review")
  const byWhen = (a: Item, b: Item) => String(whenOf(a)).localeCompare(String(whenOf(b)))
  const dueToday = items.filter((i) => { const w = whenOf(i); return !!w && w.slice(0, 10) <= today }).sort(byWhen)
  const inbox = items.filter((i) => !whenOf(i) && !i.placed)
  const later = items.filter((i) => { const w = whenOf(i); return !!w && w.slice(0, 10) > today }).sort(byWhen)
  const goals = goalViews(all)
  return { today, needsYou, running, dueToday, goals, review, inbox, later, counts: { needsYou: needsYou.length, dueToday: dueToday.length, review: review.length, inbox: inbox.length, running: running.length, goals: goals.length } }
}

/** 첫 실행 데모 항목. 공개 페이지를 읽고 정리만 하는 일이라 의회가 통과시키기 쉽고, 보내기·결제가 없어요 */
export const DEMO_TEXT = "Read the top 3 stories on news.ycombinator.com right now and summarize each in one line with its link"

/** 한 번도 쓴 적 없는 Workspace(항목·사건이 지운 것까지 0개)에만 데모 항목을 넣어요. 그 뒤로는 지워도 다시 넣지 않아요 */
export function seedDemo(db: Database, now: number): boolean {
  return db.transaction(() => {
    if (db.query("SELECT 1 FROM kv WHERE key='demo.seeded'").get()) return false
    db.query("INSERT INTO kv(key,value) VALUES ('demo.seeded', ?)").run(JSON.stringify(now))
    const used = (db.query("SELECT (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM signals) AS n").get() as { n: number }).n
    if (used > 0) return false
    const r = createItem(db, { text: DEMO_TEXT, due: null }, now)
    return !failed(r)
  })()
}

export function createWorkspace(deps: WorkspaceDeps) {
  const db = openWorkspaceDb(deps.path)
  const clock = deps.now ?? Date.now
  if (deps.demo) seedDemo(db, clock())
  const sync = () => { if (deps.engine) { try { syncCouncil(db, deps.engine, clock()) } catch (e) { console.error("[workspace] council sync failed:", e) } } }
  const board = deps.boardBase ? createBoardImport(db, { base: deps.boardBase, get: deps.boardGet, now: clock }) : null
  /** 시험이 승인 실행을 기다릴 때 써요 */
  const pending = new Set<Promise<void>>()

  /** me: 로그인한 이메일(server.ts 가 Access JWT·로컬 설정으로 정해요). 주면 머리글보다 이것을 믿어요 */
  async function handle(req: Request, parts: string[], me?: string | null): Promise<Response> {
    const url = new URL(req.url)
    const m = req.method
    const body = async () => ((await req.json().catch(() => null)) as Record<string, unknown> | null)
    const [, , res, id, action] = parts // api ws <res> <id> <action>

    if (res === "now" && m === "GET") { sync(); return json(nowView(db, clock())) }
    if (res === "meta" && m === "GET") {
      // 로그인 이메일: Cloudflare Access 가 붙여 주는 머리글, 없으면 방향판이 알려 준 주인
      const meta = readMeta(db)
      const email = me !== undefined ? me || meta.me?.email || null : req.headers.get("cf-access-authenticated-user-email") || meta.me?.email || null
      return json({ ...meta, me: email ? { email } : null, import: board?.status() ?? null })
    }
    if (res === "import" && id === "sync" && m === "POST") {
      if (!board) return err(501, "방향판 가져오기가 꺼져 있어요")
      return json(await board.tick(true))
    }
    if (res === "goals" && m === "GET") return json(goalViews(listItems(db, { done: true })))

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
      if (!id && m === "GET") {
        sync()
        const run = url.searchParams.get("run")
        const list = listSignals(db, { open: url.searchParams.get("all") !== "1" && !run, limit: run ? 1000 : 200 })
        return json(run ? list.filter((s) => s.meta?.runId === run) : list)
      }
      if (!id && m === "POST") {
        // 다른 봇도 방향판처럼 "시작/에러/끝/승인 필요"를 보낼 수 있어요
        const b = await body()
        const r = ingestSignal(db, { ...(b || {}), source: typeof b?.source === "string" ? b.source : "agent" }, clock())
        return typeof r === "string" ? err(400, r) : json(r, 201)
      }
      if (!id) return err(405, "method not allowed")
      if (!action && m === "GET") {
        const s = getSignal(db, id)
        if (!s) return err(404, "signal not found")
        const send = sendPreview(db, s, deps.hosted)
        return json({ signal: s, note: getNote(db, "signal:" + id), ...(send ? { send } : {}) })
      }
      if (action === "approve" && m === "POST") {
        const b = deps.hosted ? await body() : null
        const r = approveSignal(db, id, deps.execute, clock(), deps.hosted, typeof b?.sendHash === "string" ? b.sendHash : null)
        if (r.done) { const p = r.done.catch((e) => console.error("[workspace] approve finish failed:", e)).finally(() => pending.delete(p)); pending.add(p) }
        return json(r.body, r.status)
      }
      if (action === "reject" && m === "POST") {
        const b = await body()
        const r = rejectSignal(db, id, typeof b?.why === "string" ? b.why.trim().slice(0, 500) : "", clock())
        return json(r.body, r.status)
      }
      if (action === "resolve" && m === "POST") { const r = resolveSignal(db, id, clock()); return json(r.body, r.status) }
      if (action === "link" && m === "POST") {
        // 팝업의 "Send to agent": 이 사건을 의회에 보낸 실행을 사건에 이어 둬요(사건 내용은 바꾸지 않아요)
        const b = await body()
        const runId = typeof b?.runId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(b.runId) ? b.runId : ""
        if (!runId) return err(400, "bad runId")
        const s = getSignal(db, id)
        if (!s) return err(404, "signal not found")
        db.query("UPDATE signals SET meta=?, updated_at=? WHERE id=?").run(JSON.stringify({ ...s.meta, askRunId: runId }), clock(), id)
        return json(getSignal(db, id))
      }
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

  return { db, handle, sync, board, settle: () => Promise.all([...pending]) }
}
