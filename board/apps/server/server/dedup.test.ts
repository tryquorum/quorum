import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { DONE_RECENT_MS, findSameTodo, normTitle } from "./dedup.ts"
import { actionsApi } from "./actions.ts"
import { initOps, opsApi } from "./ops.ts"

let db: Database
const NOW = 1_800_000_000_000
const put = (bid: string, iid: string, data: Record<string, unknown>, updated_at = NOW) =>
  db.query("INSERT INTO items(board_id,id,data,by,updated_at,deleted,seq) VALUES (?,?,?,?,?,0,1) ON CONFLICT(board_id,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").run(bid, iid, JSON.stringify(data), "x", updated_at)
const read = (bid: string, iid: string) => { const r = db.query("SELECT data FROM items WHERE board_id=? AND id=?").get(bid, iid) as any; return r ? { data: JSON.parse(r.data) } : null }
const count = () => (db.query("SELECT count(*) AS n FROM items").get() as any).n
const note = (ref: string) => (db.query("SELECT text FROM work_notes WHERE owner='a' AND ref=?").get(ref) as any)?.text as string | undefined
const deps = {
  personalBoard: () => ({ id: "pb", areas: [] }),
  readItem: read,
  putItem: (bid: string, iid: string, data: any) => put(bid, iid, data, Date.now()),
  ingest: () => ({ id: "s1" }),
  startRun: async () => ({}),
  port: 0,
}
beforeEach(() => {
  db = new Database(":memory:")
  db.exec("CREATE TABLE items(board_id TEXT, id TEXT, data TEXT, by TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0, seq INTEGER, PRIMARY KEY(board_id,id))")
  db.exec("CREATE TABLE work_notes(owner TEXT, ref TEXT, html TEXT, text TEXT, by TEXT, updated_at INTEGER, PRIMARY KEY(owner,ref))")
  db.exec("CREATE TABLE work_links(id TEXT, owner TEXT, a TEXT, b TEXT, label TEXT, by TEXT, created_at INTEGER)")
  db.exec("CREATE TABLE boards(id TEXT, kind TEXT, owner TEXT, deleted INTEGER DEFAULT 0)")
  db.exec("INSERT INTO boards VALUES ('pb','personal','a',0)")
  initOps(db)
})
const act = async (actions: unknown[]) => {
  const url = new URL("http://localhost/api/act")
  const res = await actionsApi(db, new Request(url, { method: "POST", body: JSON.stringify({ actions }) }), ["api", "act"], { email: "a", agent: false }, true, deps)
  return (await res!.json()) as any
}
const report = async (body: unknown) => {
  const url = new URL("http://localhost/api/ops/report")
  const res = await opsApi(db, new Request(url, { method: "POST", body: JSON.stringify(body) }), url, { email: "a", agent: false }, ["api", "ops", "report"], true, deps)
  return (await res!.json()) as any
}

describe("findSameTodo", () => {
  test("ignores spaces, punctuation and case but not wording", () => {
    expect(normTitle(" YP0731 좌석, 지정하기! ")).toBe(normTitle("yp0731좌석지정하기"))
    put("pb", "a1", { type: "todo", text: "YP0731 좌석 지정하기", done: false })
    expect(findSameTodo(db, "pb", "yp0731 좌석지정하기.")?.ref).toBe("item:pb:a1")
    expect(findSameTodo(db, "pb", "도쿄 좌석 지정")).toBeNull()
  })
  test("prefers open, finds recently done only within window, skips short titles and other boards", () => {
    put("pb", "old", { type: "todo", text: "계약서 보내기", done: true }, NOW - DONE_RECENT_MS - 1)
    expect(findSameTodo(db, "pb", "계약서 보내기", { doneWithinMs: DONE_RECENT_MS, now: NOW })).toBeNull()
    put("pb", "recent", { type: "todo", text: "계약서 보내기", done: true }, NOW - 1000)
    expect(findSameTodo(db, "pb", "계약서 보내기", { doneWithinMs: DONE_RECENT_MS, now: NOW })?.iid).toBe("recent")
    put("pb", "open", { type: "todo", text: "계약서  보내기", done: false }, NOW - 5000)
    expect(findSameTodo(db, "pb", "계약서 보내기", { doneWithinMs: DONE_RECENT_MS, now: NOW })?.iid).toBe("open")
    put("pb", "s", { type: "todo", text: "답장", done: false })
    expect(findSameTodo(db, "pb", "답장")).toBeNull()
    put("other", "o", { type: "todo", text: "다른 판의 일 하기", done: false })
    expect(findSameTodo(db, "pb", "다른 판의 일 하기")).toBeNull()
    put("pb", "st", { type: "sticky", text: "스티커 메모 내용", done: false })
    expect(findSameTodo(db, "pb", "스티커 메모 내용")).toBeNull()
  })
})

describe("/api/act task", () => {
  test("same open title appends to the existing todo instead of creating", async () => {
    put("pb", "u1", { type: "todo", text: "Pateway에 계약서 보내기", done: false })
    const before = count()
    const r = await act([{ do: "task", title: "pateway 에 계약서 보내기", note: "## 상황\n새로 확인한 내용이에요" }])
    expect(r.results[0]).toMatchObject({ ok: true, ref: "item:pb:u1", existing: true })
    expect(count()).toBe(before)
    expect(note("item:pb:u1")).toContain("새로 확인한 내용")
    // 같은 내용을 다시 보내도 노트가 두 번 붙지 않는다
    await act([{ do: "task", title: "Pateway에 계약서 보내기", note: "## 상황\n새로 확인한 내용이에요" }])
    expect(note("item:pb:u1")!.split("새로 확인한 내용").length).toBe(2)
  })
  test("recently done same title is refused with the existing ref; new title still creates", async () => {
    put("pb", "d1", { type: "todo", text: "좌석 지정하기 YP0731", done: true }, Date.now() - 1000)
    const r = await act([{ do: "task", title: "좌석 지정하기 YP0731", note: "## 상황\n다시 해야 할지도" }])
    expect(r.results[0]).toMatchObject({ ok: false, ref: "item:pb:d1" })
    const before = count()
    const n = await act([{ do: "task", title: "완전히 새로운 일 하기", note: "## 상황\n새 일이에요" }])
    expect(n.results[0].ok).toBe(true)
    expect(n.results[0].existing).toBeUndefined()
    expect(count()).toBe(before + 1)
  })
})

describe("/api/ops/report cards", () => {
  test("card with ref updates the existing todo (note, remindAt) without creating or renaming", async () => {
    put("pb", "u2", { type: "todo", text: "도쿄 좌석 지정", done: false })
    const before = count()
    const r = await report({ cards: [{ ref: "item:pb:u2", title: "YP0731 좌석 지정하기", remindAt: "2026-11-13T08:45", note: "## 상황\n체크인 창 11-13" }] })
    expect(r.merged).toBe(1)
    expect(count()).toBe(before)
    const d = read("pb", "u2")!.data
    expect([d.text, d.remindAt]).toEqual(["도쿄 좌석 지정", "2026-11-13T08:45"])
    expect(note("item:pb:u2")).toContain("체크인 창")
  })
  test("ref done never closes a person's todo; foreign or missing refs are errors", async () => {
    put("pb", "u3", { type: "todo", text: "내가 만든 일 하기", done: false })
    const r = await report({ cards: [{ ref: "item:pb:u3", done: true }, { ref: "item:other:x", note: "x" }, { ref: "item:pb:nope", note: "x" }] })
    expect(read("pb", "u3")!.data.done).toBe(false)
    expect(r.errors.length).toBe(3)
  })
  test("new key with same open title merges into the existing todo; repeating the sweep adds nothing", async () => {
    put("pb", "u4", { type: "todo", text: "Modelflare 입금 확인하기", done: false })
    const before = count()
    const card = { key: "onchain:modelflare", title: "Modelflare 입금 확인하기", note: "## 상황\n아직 입금 없음" }
    const r1 = await report({ cards: [card] })
    const r2 = await report({ cards: [card] })
    expect([r1.merged, r2.merged, r1.cards]).toEqual([1, 1, 0])
    expect(count()).toBe(before)
    expect(note("item:pb:u4")!.split("아직 입금 없음").length).toBe(2)
  })
  test("new key with same recently done title is skipped; truly new card is created", async () => {
    put("pb", "u5", { type: "todo", text: "9번째 성찰과제 제출하기", done: true }, Date.now() - 1000)
    const before = count()
    const r = await report({ cards: [{ key: "lms:9", title: "9번째 성찰과제 제출하기", note: "## 상황\nx" }, { key: "lms:10", title: "10번째 성찰과제 제출하기", note: "## 상황\n새 과제" }] })
    expect([r.skipped, r.cards]).toEqual([1, 1])
    expect(count()).toBe(before + 1)
  })
})

