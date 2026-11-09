import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { normPage, pageBlock } from "./page-context.ts"
import { initOps } from "./ops.ts"
process.env.ASIDE_ACCOUNT = "u_page_test_no_account"
const { initRuns, runsApi } = await import("./runs.ts")

let db: Database
const timers: ReturnType<typeof setInterval>[] = []
const realInterval = globalThis.setInterval
const launches: unknown[][] = []
const launch = (...args: unknown[]) => { launches.push(args) }
const item = (bid: string, id: string, data: Record<string, unknown>) =>
  db.query("INSERT INTO items(board_id,id,data,deleted) VALUES (?,?,?,0)").run(bid, id, JSON.stringify(data))
const signal = (id: string, lane: string, title: string, owner = "a") =>
  db.query("INSERT INTO signals(id,owner,ref,source,kind,title,lane,status,meta,due,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'open',NULL,NULL,1,1)").run(id, owner, "x:" + id, "gmail", "approval", title, lane)

beforeEach(() => {
  db = new Database(":memory:")
  db.exec("CREATE TABLE boards(id TEXT, name TEXT, kind TEXT, owner TEXT, deleted INTEGER DEFAULT 0)")
  db.exec("CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, deleted INTEGER DEFAULT 0)")
  db.exec("CREATE TABLE work_notes(owner TEXT, ref TEXT, html TEXT, text TEXT, by TEXT, updated_at INTEGER)")
  db.exec("CREATE TABLE signals(id TEXT, owner TEXT, ref TEXT, source TEXT, kind TEXT, title TEXT, body TEXT, url TEXT, area TEXT, task TEXT, agent TEXT, lane TEXT, reason TEXT, status TEXT, meta TEXT, due INTEGER, created_at INTEGER, updated_at INTEGER, resolved_at INTEGER)")
  db.exec("INSERT INTO boards VALUES ('pb','나','personal','a',0), ('other','남의 판','personal','b',0)")
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const t = realInterval(...args); timers.push(t); return t }) as typeof setInterval
  initRuns(db)
  initOps(db)
  launches.length = 0
})
afterEach(() => { globalThis.setInterval = realInterval; for (const t of timers.splice(0)) clearInterval(t); db.close() })

describe("normPage", () => {
  test("keeps known views and safe ids only", () => {
    expect(normPage({ view: "list", board: "pb", work: "item:pb:a1" })).toEqual({ view: "list", board: "pb", work: "item:pb:a1" })
    expect(normPage({ view: "admin" })).toBeNull()
    expect(normPage({ view: "home", board: "x y", work: "javascript:alert(1)" })).toEqual({ view: "home" })
    expect(normPage(null)).toBeNull()
  })
})

describe("pageBlock", () => {
  test("list view shows open todos and goals with refs, not done ones", () => {
    item("pb", "t1", { type: "todo", text: "계약서 보내기", done: false, remindAt: "2026-11-07T10:00" })
    item("pb", "g1", { type: "goal", text: "GOAT 출시", done: false, due: "2026-12-01" })
    item("pb", "t2", { type: "todo", text: "끝난 일", done: true })
    signal("s1", "decide", "스폰서 가격 정하기")
    const t = pageBlock(db, "a", { view: "list", board: "pb" }, null)
    expect(t).toContain('"전체 목록" 화면')
    expect(t).toContain("계약서 보내기 (알림 2026-11-07T10:00) ref=item:pb:t1")
    expect(t).toContain("목표: GOAT 출시 (마감 2026-12-01) ref=item:pb:g1")
    expect(t).toContain("스폰서 가격 정하기 ref=signal:s1")
    expect(t).not.toContain("끝난 일")
  })
  test("list view orders timed items chronologically, date-only items after same-day timed items, and undated items last by manual order", () => {
    item("pb", "u2", { type: "todo", text: "기약 없는 둘째", done: false, z: 20 })
    item("pb", "u1", { type: "todo", text: "기약 없는 첫째", done: false, z: 10 })
    item("pb", "d1", { type: "todo", text: "날짜만 있는 할 일", done: false, remindAt: "2026-11-07", z: 5 })
    item("pb", "g1", { type: "goal", text: "날짜만 있는 목표", done: false, due: "2026-11-07", z: 15 })
    item("pb", "t2", { type: "todo", text: "오후 미팅", done: false, remindAt: "2026-11-07T15:00", z: 40 })
    item("pb", "t1", { type: "todo", text: "오전 미팅", done: false, remindAt: "2026-11-07T10:00", z: 50 })
    const t = pageBlock(db, "a", { view: "list", board: "pb" }, null)
    const idx = (s: string) => t.indexOf(s)
    expect(idx("오전 미팅")).toBeLessThan(idx("오후 미팅"))
    expect(idx("오후 미팅")).toBeLessThan(idx("날짜만 있는 할 일"))
    expect(idx("날짜만 있는 할 일")).toBeLessThan(idx("날짜만 있는 목표"))
    expect(idx("날짜만 있는 목표")).toBeLessThan(idx("기약 없는 첫째"))
    expect(idx("기약 없는 첫째")).toBeLessThan(idx("기약 없는 둘째"))
  })
  test("another person's board falls back to my own board", () => {
    item("other", "x", { type: "todo", text: "남의 비밀 할 일", done: false })
    item("pb", "m", { type: "todo", text: "내 할 일 하기", done: false })
    const t = pageBlock(db, "a", { view: "list", board: "other" }, null)
    expect(t).not.toContain("남의 비밀")
    expect(t).toContain("내 할 일 하기")
  })
  test("open work shows its title and note, or points to the attached context", () => {
    item("pb", "w", { type: "todo", text: "Pateway 계약서 보내기", done: false })
    db.query("INSERT INTO work_notes(owner,ref,text) VALUES ('a','item:pb:w','## 상황\n서명본 대기')").run()
    const t = pageBlock(db, "a", { view: "home", work: "item:pb:w" }, null)
    expect(t).toContain("열어 둔 일: Pateway 계약서 보내기 (ref=item:pb:w)")
    expect(t).toContain("서명본 대기")
    expect(pageBlock(db, "a", { view: "home", work: "item:pb:w" }, "item:pb:w")).toContain('위 "방향판 맥락"의 그 일')
    expect(pageBlock(db, "a", { view: "home", work: "item:other:x" }, null)).not.toContain("열어 둔 일")
  })
  test("home shows decisions and others' signals stay hidden", () => {
    signal("s1", "now", "지금 볼 것")
    signal("s2", "decide", "남의 결정", "b")
    const t = pageBlock(db, "a", { view: "home" }, null)
    expect(t).toContain("지금 볼 것")
    expect(t).not.toContain("남의 결정")
    expect(pageBlock(db, "a", null, null)).toBe("")
  })
})

describe("runs with page", () => {
  const post = async (body: unknown) => {
    const url = new URL("http://localhost/api/runs")
    return (await runsApi(db, new Request(url, { method: "POST", body: JSON.stringify(body) }), url, { email: "a", agent: false }, ["api", "runs"], true, () => {}, launch))!
  }
  const promptOf = (i: number) => { const args = launches[i][2] as string[]; return args[args.length - 1] }
  test("new chat, continued chat and retry all carry the current page; drafts do not", async () => {
    item("pb", "t1", { type: "todo", text: "계약서 보내기", done: false })
    const r = await post({ prompt: "이거 정리해줘", page: { view: "list", board: "pb" }, provider: "aside", model: "gpt-6.1-sol" })
    expect(r.status).toBe(201)
    const row = (await r.json()) as { id: string; page: string }
    expect(JSON.parse(row.page)).toEqual({ view: "list", board: "pb" })
    expect(promptOf(0)).toContain("[지금 보고 있는 화면]")
    expect(promptOf(0)).toContain("ref=item:pb:t1")
    expect(promptOf(0).endsWith("이거 정리해줘")).toBe(true)
    db.query("UPDATE runs SET status='done', session_id='sess' WHERE id=?").run(row.id)
    await post({ prompt: "이어서", parent: row.id, page: { view: "ops" } })
    expect(promptOf(1)).toContain('"운영" 화면')
    await post({ prompt: "초안", kind: "draft", page: { view: "list" }, provider: "aside", model: "gpt-6.1-sol" })
    expect(promptOf(2)).not.toContain("[지금 보고 있는 화면]")
    db.query("UPDATE runs SET status='error' WHERE id=?").run(row.id)
    const url = new URL(`http://localhost/api/runs/${row.id}/retry`)
    await runsApi(db, new Request(url, { method: "POST" }), url, { email: "a", agent: false }, ["api", "runs", row.id, "retry"], true, () => {}, launch)
    expect(promptOf(3)).toContain('"전체 목록" 화면')
  })
})
