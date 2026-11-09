// 독립 리뷰(GO-WITH-FIXES) 지적 1–10 의 회귀 시험. 임시 DB, 가짜 실행기·가짜 3070(aside 는 부르지 않아요).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspace, openWorkspaceDb } from "./api"
import { appendNote, getNote, NOTE_MAX, putNote } from "./notes"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quorum-rf-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const NOW = new Date(2026, 10, 9, 12, 0).getTime()
const call = async (ws: ReturnType<typeof createWorkspace>, method: string, path: string, body?: unknown) => {
  const req = new Request("http://127.0.0.1" + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) })
  const res = await ws.handle(req, new URL(req.url).pathname.split("/").filter(Boolean))
  return { status: res.status, body: (await res.json()) as any }
}

describe("1 · 노트는 앞을 잘라내지 않아요", () => {
  test("45,000자 사람 노트에 8,000자 에이전트 결과가 붙어도 사람 글은 한 글자도 안 빠져요", () => {
    const db = openWorkspaceDb(join(dir, "w.db"))
    const human = "사".repeat(45_000)
    putNote(db, "item:a", human, NOW)
    appendNote(db, "item:a", "결".repeat(8_000), "agent", NOW + 1)
    const n = getNote(db, "item:a")!
    expect(n.md.startsWith(human)).toBe(true)
    expect(n.md.length).toBeLessThanOrEqual(NOTE_MAX)
    const overflow = db.query("SELECT md FROM note_overflow WHERE ref=?").all("item:a") as { md: string }[]
    expect(overflow.map((o) => o.md.length)).toEqual([8_000])
  })
  test("사람이 상한보다 긴 노트를 저장하면 자르지 않고 413 으로 거절해요", async () => {
    const ws = createWorkspace({ path: join(dir, "w.db"), now: () => NOW })
    await call(ws, "PUT", "/api/ws/notes?ref=item:a", { md: "처음 글" })
    const r = await call(ws, "PUT", "/api/ws/notes?ref=item:a", { md: "x".repeat(60_000) })
    expect(r.status).toBe(413)
    expect(getNote(ws.db, "item:a")!.md).toBe("처음 글")
  })
})

describe("9 · 노트 저장은 버전을 확인해요", () => {
  test("팝업을 연 사이 의회가 붙인 결과를 사람 저장이 지우지 않아요(409), 최신 버전이면 저장돼요", async () => {
    let clock = NOW
    const ws = createWorkspace({ path: join(dir, "w.db"), now: () => clock })
    const first = (await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: "내 메모" })).body
    clock += 1000
    appendNote(ws.db, "signal:s1", "## 실행 결과\n의회 결과", "agent", clock)
    const stale = await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: "내 메모 고침", baseUpdatedAt: first.updatedAt })
    expect(stale.status).toBe(409)
    expect(getNote(ws.db, "signal:s1")!.md).toContain("의회 결과")
    const cur = getNote(ws.db, "signal:s1")!
    clock += 1000
    const ok = await call(ws, "PUT", "/api/ws/notes?ref=signal:s1", { md: cur.md + "\n내 덧붙임", baseUpdatedAt: cur.updatedAt })
    expect(ok.status).toBe(200)
    expect(ok.body.md).toContain("의회 결과")
  })
})


// ---- 2 · running 이 영원히 멈추지 않아요 ----
import { Store } from "../engine/store"
import type { QuorumEvent } from "../contract"
import type { ExecuteFn } from "./council"

function seedHold(store: Store, runId: string) {
  store.createRun({ runId, request: "가짜 요청", mode: "live", startedAt: new Date(NOW).toISOString() })
  let seq = 0
  const ev = (type: QuorumEvent["type"], text: string, data?: Record<string, unknown>) => store.appendEvent({ runId, seq: seq++, at: new Date(NOW).toISOString(), mode: "live", type, actor: "council", text, ...(data ? { data } : {}) })
  ev("proposal", "p", { proposalId: "p1", title: "가짜 일", executor: "codex", why: "w", task: "가짜 지시" })
  ev("verdict", "hold · 가짜 일", { proposalId: "p1", decision: "hold", reason: "r" })
  ev("run.end", "end", { status: "done" })
  store.finishRun(runId, "done")
}
const never: ExecuteFn = () => ({ runId: "rx-never", done: new Promise(() => {}) })

describe("2 · 실행 중으로 멈춘 사건", () => {
  test("서버가 다시 시작되면 살아 있는 실행이 없는 running 사건은 끊김(error)으로 Needs you 에 돌아오고 Retry 할 수 있어요", async () => {
    const store = new Store(join(dir, "q.db"))
    seedHold(store, "r1")
    const ws1 = createWorkspace({ path: join(dir, "w.db"), engine: store, execute: never, now: () => NOW })
    const hold = (await call(ws1, "GET", "/api/ws/now")).body.needsYou[0]
    expect((await call(ws1, "POST", "/api/ws/signals/" + hold.id + "/approve")).status).toBe(202)
    // 다시 시작: 같은 DB, 이 프로세스가 시작한 실행은 없어요
    let ran = 0
    const ws2 = createWorkspace({ path: join(dir, "w.db"), engine: store, execute: () => { ran++; return { runId: "rx2", done: Promise.resolve({ ok: true, summary: "다시 했어요" }) } }, now: () => NOW + 1000 })
    const s = (await call(ws2, "GET", "/api/ws/signals/" + hold.id)).body.signal
    expect(s).toMatchObject({ status: "open", lane: "decide", kind: "error" })
    expect(s.reason).toContain("interrupted")
    expect((await call(ws2, "POST", "/api/ws/signals/" + hold.id + "/approve")).status).toBe(202)
    await ws2.settle()
    expect(ran).toBe(1)
    expect((await call(ws2, "GET", "/api/ws/signals/" + hold.id)).body.signal).toMatchObject({ lane: "review", kind: "done" })
  })

  test("실행기가 응답하지 않으면 시간 초과로 실패 처리해요", async () => {
    const store = new Store(join(dir, "q.db"))
    seedHold(store, "r2")
    const ws = createWorkspace({ path: join(dir, "w.db"), engine: store, execute: never, execTimeoutMs: 30, now: () => NOW })
    const hold = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")
    await ws.settle()
    const s = (await call(ws, "GET", "/api/ws/signals/" + hold.id)).body.signal
    expect(s).toMatchObject({ status: "open", lane: "decide", kind: "error" })
    expect(s.reason).toContain("시간 초과")
  })

  test("실행 중인 사건도 Dismiss(거절)할 수 있고, 늦게 온 결과가 다시 열지 않아요", async () => {
    const store = new Store(join(dir, "q.db"))
    seedHold(store, "r3")
    let finish!: (v: { ok: true; summary: string }) => void
    const ws = createWorkspace({ path: join(dir, "w.db"), engine: store, execute: () => ({ runId: "rx3", done: new Promise((r) => { finish = r }) }), now: () => NOW })
    const hold = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")
    expect((await call(ws, "POST", "/api/ws/signals/" + hold.id + "/reject", { why: "그만" })).status).toBe(200)
    finish({ ok: true, summary: "늦은 결과" })
    await ws.settle()
    expect((await call(ws, "GET", "/api/ws/signals/" + hold.id)).body.signal).toMatchObject({ status: "resolved", lane: "info" })
  })
})
