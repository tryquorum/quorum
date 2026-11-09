// Workspace 시험. board 서버 시험처럼 임시 DB(임시 폴더)로 돌고, 실행기는 가짜예요(aside exec 는 유료라 부르지 않아요).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../engine/store"
import { RunManager } from "../engine/runs"
import type { QuorumEvent } from "../contract"
import { createWorkspace, localDay } from "./api"
import { APPROVE_PREFIX, engineExecute, type ExecuteFn } from "./council"
import { createItem, logItem, patchItem } from "./items"
import { getNote } from "./notes"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "quorum-ws-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const NOW = new Date(2026, 10, 9, 12, 0).getTime() // 2026-11-09 12:00 로컬
const call = async (ws: ReturnType<typeof createWorkspace>, method: string, path: string, body?: unknown) => {
  const req = new Request("http://127.0.0.1" + path, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) })
  const res = await ws.handle(req, new URL(req.url).pathname.split("/").filter(Boolean))
  return { status: res.status, body: (await res.json()) as any }
}

/** 엔진 저장소에 의회 한 번을 기록해요: p1 hold(aside), p2 pass(codex), p3 reject */
function recordCouncil(store: Store, runId: string, opts: { mode?: "live" | "replay"; request?: string; finish?: boolean; withResult?: boolean } = {}) {
  const mode = opts.mode ?? "live"
  store.createRun({ runId, request: opts.request ?? "블로그 글 3개 요약하고 정리", mode, startedAt: new Date(NOW).toISOString() })
  let seq = 0
  const ev = (type: QuorumEvent["type"], actor: string, text: string, data?: Record<string, unknown>) =>
    store.appendEvent({ runId, seq: seq++, at: new Date(NOW).toISOString(), mode, type, actor, text, ...(data ? { data } : {}) })
  ev("run.start", "council", "요청")
  ev("proposal", "bot:scout", "가격 페이지 확인", { proposalId: "p1", title: "가격 페이지 확인", executor: "aside", why: "w", task: "가격 페이지를 열어 표를 정리" })
  ev("proposal", "bot:builder", "요약 스크립트", { proposalId: "p2", title: "요약 스크립트", executor: "codex", why: "w", task: "요약 스크립트 작성" })
  ev("proposal", "bot:skeptic", "결제하기", { proposalId: "p3", title: "결제하기", executor: "aside", why: "w", task: "결제" })
  ev("verdict", "council", "hold · 가격 페이지 확인", { proposalId: "p1", decision: "hold", reason: "외부 로그인 필요" })
  ev("verdict", "council", "pass · 요약 스크립트", { proposalId: "p2", decision: "pass", reason: "안전" })
  ev("verdict", "council", "reject · 결제하기", { proposalId: "p3", decision: "reject", reason: "돈이 나가요" })
  if (opts.withResult !== false) {
    ev("execute.start", "codex", "요약 스크립트", { proposalId: "p2", executor: "codex" })
    ev("execute.result", "codex", "요약 스크립트를 만들었어요", { proposalId: "p2", executor: "codex", ok: true, summary: "요약 스크립트를 만들었어요\nsummarize.ts" })
  }
  if (opts.finish !== false) {
    ev("run.end", "council", "통과 1 · 보류 1 · 거절 1", { status: "done" })
    store.finishRun(runId, "done")
  }
}

describe("빠른 기록(capture)", () => {
  test("사람 글에서 날짜만 읽고, 같은 키·같은 글은 한 번만 저장해요", async () => {
    const ws = createWorkspace({ path: join(dir, "workspace.db"), now: () => NOW })
    const a = await call(ws, "POST", "/api/ws/items", { text: "내일 3시 계약서 검토", clientKey: "k1" })
    expect(a.status).toBe(201)
    expect(a.body.item.text).toBe("계약서 검토")
    expect(a.body.item.raw).toBe("내일 3시 계약서 검토")
    expect(a.body.item.due).toBe("2026-11-10T15:00")
    expect(a.body.item.textBy).toBe("person")
    const again = await call(ws, "POST", "/api/ws/items", { text: "내일 3시 계약서 검토", clientKey: "k1" })
    expect(again.status).toBe(200)
    expect(again.body.existed).toBe("same")
    expect(again.body.item.id).toBe(a.body.item.id)
    const conflict = await call(ws, "POST", "/api/ws/items", { text: "다른 글", clientKey: "k1" })
    expect(conflict.status).toBe(409)
    const same = await call(ws, "POST", "/api/ws/items", { text: "계약서 검토!" })
    expect(same.body.existed).toBe("open")
    expect(same.body.item.id).toBe(a.body.item.id)
    expect((await call(ws, "POST", "/api/ws/items", { text: "  " })).status).toBe(400)
  })

  test("Now 화면: 오늘 마감은 Due today, 날짜 없는 사람 기록은 Inbox, 완료하면 빠져요", async () => {
    const ws = createWorkspace({ path: join(dir, "workspace.db"), now: () => NOW })
    const today = await call(ws, "POST", "/api/ws/items", { text: "오늘 세금계산서 발행" })
    await call(ws, "POST", "/api/ws/items", { text: "회의록 정리하기" })
    await call(ws, "POST", "/api/ws/items", { text: "모레 발표 자료" })
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.today).toBe(localDay(NOW))
    expect(v.dueToday.map((i: any) => i.text)).toEqual(["세금계산서 발행"])
    expect(v.inbox.map((i: any) => i.text)).toEqual(["회의록 정리하기"])
    expect(v.later.map((i: any) => i.text)).toEqual(["발표 자료"])
    expect((await call(ws, "POST", "/api/ws/items/" + today.body.item.id + "/done")).status).toBe(200)
    expect((await call(ws, "GET", "/api/ws/now")).body.dueToday).toEqual([])
  })

  test("사람 글 보호: 의회는 사람이 쓴 제목을 못 바꾸고, 사람 기록은 자동 기록이 넘쳐도 남아요", () => {
    const ws = createWorkspace({ path: join(dir, "workspace.db"), now: () => NOW })
    const r = createItem(ws.db, { text: "보험 갱신 확인" }, NOW)
    if ("error" in r) throw new Error(r.error)
    const id = r.item.id
    const denied = patchItem(ws.db, id, { text: "AI가 고친 제목" }, "council", NOW)
    expect(denied).toEqual({ status: 403, error: "사람이 쓴 글은 사람만 고쳐요" })
    logItem(ws.db, id, { by: "person", text: "내가 쓴 기록" }, NOW)
    for (let i = 0; i < 90; i++) logItem(ws.db, id, { by: "agent", text: "auto " + i }, NOW + i)
    const it = patchItem(ws.db, id, {}, "person", NOW)
    if ("error" in it) throw new Error(it.error)
    expect(it.log.filter((l) => l.by === "person").map((l) => l.text)).toEqual(["내가 쓴 기록"])
    expect(it.log.filter((l) => l.by === "agent").length).toBe(80)
    expect(it.text).toBe("보험 갱신 확인")
  })

  test("seq 가 다르면 409 로 덮지 않아요", async () => {
    const ws = createWorkspace({ path: join(dir, "workspace.db"), now: () => NOW })
    const a = (await call(ws, "POST", "/api/ws/items", { text: "주간 보고 쓰기" })).body.item
    expect((await call(ws, "PATCH", "/api/ws/items/" + a.id, { text: "주간 보고 쓰기(수정)", seq: a.seq })).status).toBe(200)
    expect((await call(ws, "PATCH", "/api/ws/items/" + a.id, { text: "옛 화면에서 고침", seq: a.seq })).status).toBe(409)
  })
})

describe("의회 연결", () => {
  test("hold 는 Needs you, pass 실행 결과는 Review, reject 는 기록만. 두 번 읽어도 한 번만 들어가요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r1")
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.needsYou.map((s: any) => [s.title, s.kind, s.lane])).toEqual([["가격 페이지 확인", "approval", "decide"]])
    expect(v.needsYou[0].meta).toMatchObject({ runId: "r1", proposalId: "p1", executor: "aside", task: "가격 페이지를 열어 표를 정리" })
    expect(v.review.map((s: any) => [s.title, s.lane, s.body])).toEqual([["요약 스크립트", "review", "요약 스크립트를 만들었어요\nsummarize.ts"]])
    expect(getNote(ws.db, "signal:" + v.review[0].id)?.md).toContain("## 실행 결과 (codex)")
    const all = (await call(ws, "GET", "/api/ws/signals?all=1")).body
    expect(all.find((s: any) => s.title === "결제하기")).toMatchObject({ lane: "info", status: "resolved" })
    expect(all.length).toBe(3)
    await call(ws, "GET", "/api/ws/now")
    expect((await call(ws, "GET", "/api/ws/signals?all=1")).body.length).toBe(3)
  })

  test("실행 중인 의회는 판정이 나오는 대로 들어오고, pass 는 결과 전까지 running 이에요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r2", { finish: false, withResult: false })
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.needsYou.length).toBe(1)
    expect(v.running.map((s: any) => s.title)).toEqual(["요약 스크립트"])
    store.appendEvent({ runId: "r2", seq: 7, at: new Date(NOW).toISOString(), mode: "live", type: "execute.result", actor: "codex", text: "실패", data: { proposalId: "p2", ok: false, error: "codex timeout" } })
    store.finishRun("r2", "done")
    const v2 = (await call(ws, "GET", "/api/ws/now")).body
    expect(v2.running).toEqual([])
    expect(v2.needsYou.map((s: any) => [s.title, s.kind])).toEqual([["가격 페이지 확인", "approval"], ["요약 스크립트", "error"]])
  })

  test("다시 틀기(replay)와 Workspace 승인 실행은 사건으로 넣지 않아요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "rp", { mode: "replay" })
    recordCouncil(store, "ra", { request: APPROVE_PREFIX + "가격 페이지 확인" })
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    expect((await call(ws, "GET", "/api/ws/signals?all=1")).body).toEqual([])
  })

  test("Approve: 엔진 실행기로 그 제안을 실행하고 결과를 노트에 붙여요. 두 번 눌러도 한 번만", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r3")
    const calls: string[] = []
    let finish!: (o: { ok: true; summary: string }) => void
    const execute: ExecuteFn = (p, ctx) => { calls.push(p.executor + ":" + p.task + ":" + ctx.runId); return { runId: "rx1", done: new Promise((r) => { finish = r }) } }
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, execute, now: () => NOW })
    const hold = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    const a = await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")
    expect(a.status).toBe(202)
    expect(a.body.execRunId).toBe("rx1")
    expect(a.body.signal).toMatchObject({ status: "running", lane: "running" })
    expect((await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")).status).toBe(409)
    expect(calls.length).toBe(1)
    expect(calls[0]).toStartWith("aside:가격 페이지를 열어 표를 정리\n")
    expect(calls[0]).toEndWith(":r3")
    finish({ ok: true, summary: "가격표를 정리했어요: Pro $20" })
    await ws.settle()
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.needsYou).toEqual([])
    const done = v.review.find((s: any) => s.id === hold.id)
    expect(done).toMatchObject({ lane: "review", kind: "done", body: "가격표를 정리했어요: Pro $20" })
    expect(done.meta).toMatchObject({ decidedBy: "person", decision: "approve", execRunId: "rx1" })
    const note = (await call(ws, "GET", "/api/ws/signals/" + hold.id)).body.note.md
    expect(note).toContain("## 승인")
    expect(note).toContain("## 실행 결과 (aside)\n\n가격표를 정리했어요: Pro $20")
  })

  test("Approve 실패는 Needs you 로 돌아오고, 실행기가 없으면 501 로 그대로 둬요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r4")
    const none = createWorkspace({ path: join(dir, "a.db"), engine: store, now: () => NOW })
    const h0 = (await call(none, "GET", "/api/ws/now")).body.needsYou[0]
    expect((await call(none, "POST", "/api/ws/signals/" + h0.id + "/approve")).status).toBe(501)
    expect((await call(none, "GET", "/api/ws/now")).body.needsYou.map((s: any) => s.id)).toEqual([h0.id])

    const ws = createWorkspace({ path: join(dir, "b.db"), engine: store, execute: () => ({ runId: "rx2", done: Promise.resolve({ ok: false, error: "aside: 로그인 필요" }) }), now: () => NOW })
    const h = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    expect((await call(ws, "POST", "/api/ws/signals/" + h.id + "/approve")).status).toBe(202)
    await ws.settle()
    const back = (await call(ws, "GET", "/api/ws/now")).body.needsYou.find((s: any) => s.id === h.id)
    expect(back).toMatchObject({ kind: "error", lane: "decide", status: "open" })
    expect((await call(ws, "GET", "/api/ws/signals/" + h.id)).body.note.md).toContain("aside: 로그인 필요")
  })

  test("Reject 는 닫고 기록만, 다시 읽어도 사람이 내린 결정을 덮지 않아요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r5", { finish: false })
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    const h = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    expect((await call(ws, "POST", "/api/ws/signals/" + h.id + "/reject", { why: "지금은 필요 없어요" })).status).toBe(200)
    store.appendEvent({ runId: "r5", seq: 100, at: new Date(NOW).toISOString(), mode: "live", type: "verdict", actor: "council", text: "hold · 가격 페이지 확인", data: { proposalId: "p1", decision: "hold", reason: "다시" } })
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.needsYou).toEqual([])
    expect((await call(ws, "GET", "/api/ws/signals/" + h.id)).body.signal).toMatchObject({ status: "resolved", reason: "사람이 거절했어요: 지금은 필요 없어요" })
  })

  test("Ask the council: 항목에 runId 를 이으면 의회 판정이 그 항목을 가리키고, 끝나면 기록이 남아요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    const it = (await call(ws, "POST", "/api/ws/items", { text: "경쟁사 가격 조사" })).body.item
    expect((await call(ws, "PATCH", "/api/ws/items/" + it.id, { runId: "r6" })).body.runId).toBe("r6")
    expect((await call(ws, "PATCH", "/api/ws/items/" + it.id, { runId: "../x" })).status).toBe(400)
    recordCouncil(store, "r6")
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.needsYou[0].meta.itemId).toBe(it.id)
    const log = (await call(ws, "GET", "/api/ws/items/" + it.id)).body.item.log
    expect(log.map((l: any) => [l.by, l.text])).toEqual([["agent", "의회 r6: 통과 1 · 보류 1 · 거절 1"]])
  })

  test("engineExecute: 엔진 실행기를 startCustom 위에서 불러 콘솔 이벤트로 남기고, 그 실행은 다시 사건이 되지 않아요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    const runs = new RunManager(store, () => { throw new Error("의회는 열지 않아요") })
    const seen: string[] = []
    const execute = engineExecute(runs, () => ({ aside: async (p, ctx) => { seen.push(p.task + "@" + ctx.runId); return { summary: "끝났어요: " + p.title } } }))
    const r = execute({ proposalId: "p1", title: "가격 페이지 확인", executor: "aside", task: "표 정리", why: "" }, { runId: "r7", request: "req" })
    expect(await r.done).toEqual({ ok: true, summary: "끝났어요: 가격 페이지 확인" })
    expect(seen).toEqual(["표 정리@r7-ok-p1"])
    const run = store.getRun(r.runId)!
    expect(run.request).toBe(APPROVE_PREFIX + "가격 페이지 확인")
    expect(store.getEvents(r.runId).map((e) => e.type)).toEqual(["run.start", "execute.start", "execute.result", "run.end"])
    const missing = engineExecute(runs, () => ({}))({ proposalId: "p1", title: "t", executor: "codex", task: "x", why: "" }, { runId: "r7", request: "req" })
    expect(await missing.done).toEqual({ ok: false, error: "실행기 codex 를 쓸 수 없어요" })
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    expect((await call(ws, "GET", "/api/ws/signals?all=1")).body).toEqual([])
  })
})


describe("방향판(3070) 읽기 전용 가져오기 — 가짜 데이터", () => {
  const state = (seq: number, items: any[]) => ({
    me: { email: "owner@example.test", agent: false }, seq,
    boards: [{ id: "b1", name: "나", kind: "personal", mine: true, deleted: false, areas: [{ id: "a1", name: "Area A", color: "#f00" }] }],
    spaces: [{ id: "personal", kind: "personal", name: "Personal" }], items,
  })
  const todo = (id: string, more: Record<string, unknown> = {}) => ({ id, boardId: "b1", type: "todo", text: "Fake todo " + id, done: false, updatedAt: 1, deleted: false, space: "personal", x: 0, y: 0, w: 200, h: 100, z: 1, placed: false, ...more })
  function fake(routes: Record<string, unknown[]>) {
    const calls: { url: string; method: string }[] = []
    const get = async (url: string, init: { method: "GET" }) => {
      calls.push({ url, method: init.method })
      const path = url.replace("http://board.test", "").replace(/\?.*$/, "")
      const queue = routes[path]
      if (!queue?.length) throw new Error("no fake for " + url)
      return queue.length > 1 ? queue.shift() : queue[0]
    }
    return { calls, get }
  }

  test("처음엔 /api/state, 그 뒤엔 /api/changes?since=seq. GET 만 부르고 지운 항목과 메모·선은 빼요", async () => {
    const f = fake({
      "/api/state": [state(10, [todo("t1", { remindAt: "2026-11-09T09:00", area: "a1" }), todo("t2"), { id: "s1", boardId: "b1", type: "sticky", text: "memo" }, todo("t3", { deleted: true }), { id: "g1", boardId: "b1", type: "goal", text: "Fake goal", due: "2026-12-01", done: false }, todo("t4", { goalId: "g1", done: true }), todo("t5", { goalId: "g1", remindAt: "2026-11-20" })])],
      "/api/changes": [{ seq: 12, boards: [], items: [todo("t2", { deleted: true }), todo("t6", { text: "Fake new" })] }],
      "/api/signals": [{ signals: [
        { id: "x1", title: "Fake decision", kind: "question", lane: "decide", status: "open", source: "goat" },
        { id: "x2", title: "Fake done", kind: "done", lane: "auto", status: "resolved", source: "goat" },
        { id: "x3", title: "Fake review", kind: "done", lane: "review", status: "open", source: "goat" },
      ] }],
    })
    const ws = createWorkspace({ path: join(dir, "workspace.db"), boardBase: "http://board.test", boardGet: f.get, now: () => NOW })
    const s1 = await ws.board!.tick(true)
    expect(s1).toMatchObject({ ok: true, seq: 10, items: 5 })
    const v = (await call(ws, "GET", "/api/ws/now")).body
    expect(v.dueToday.map((i: any) => i.sourceId)).toEqual(["b1:t1"])
    expect(v.dueToday[0]).toMatchObject({ source: "direction-board", area: "a1", textBy: "person" })
    expect(v.inbox.map((i: any) => i.sourceId)).toEqual(["b1:t2"])
    expect(v.goals.map((g: any) => [g.goal.text, g.done, g.total, g.next])).toEqual([["Fake goal", 1, 2, "2026-11-20"]])
    expect(v.needsYou.map((s: any) => [s.title, s.source, s.meta.from])).toEqual([["Fake decision", "direction-board", "direction-board"]])
    expect(v.review.map((s: any) => s.title)).toEqual(["Fake review"])
    const meta = (await call(ws, "GET", "/api/ws/meta")).body
    expect(meta.boards[0].areas).toEqual([{ id: "a1", name: "Area A", color: "#f00" }])
    expect(meta.me).toEqual({ email: "owner@example.test" })

    const s2 = await ws.board!.tick(false)
    expect(s2.seq).toBe(12)
    const v2 = (await call(ws, "GET", "/api/ws/now")).body
    expect(v2.inbox.map((i: any) => i.sourceId).sort()).toEqual(["b1:t6"])
    expect(f.calls.every((c) => c.method === "GET")).toBe(true)
    expect(f.calls.map((c) => c.url)).toEqual(["http://board.test/api/state", "http://board.test/api/signals", "http://board.test/api/changes?since=10"])
  })

  test("Quorum 에서 사람이 고친 사본은 3070 의 새 값이 덮지 않아요. 실패하면 다음엔 전체부터 다시 읽어요", async () => {
    let n = 0
    const get = async (url: string) => {
      n++
      if (url.endsWith("/api/state")) return state(20 + n, [todo("t1", { text: n > 1 ? "Changed upstream" : "Fake todo t1", updatedAt: n })])
      if (url.includes("/api/changes")) throw new Error("HTTP 500")
      return { signals: [] }
    }
    const ws = createWorkspace({ path: join(dir, "workspace.db"), boardBase: "http://board.test", boardGet: get, now: () => NOW })
    await ws.board!.tick(false)
    const it = (await call(ws, "GET", "/api/ws/now")).body.inbox[0]
    await call(ws, "PATCH", "/api/ws/items/" + it.id, { text: "Edited in Quorum" })
    expect((await ws.board!.tick(false)).ok).toBe(false)
    expect((await ws.board!.tick(false)).ok).toBe(true)
    const after = (await call(ws, "GET", "/api/ws/items/" + it.id)).body.item
    expect(after).toMatchObject({ text: "Edited in Quorum", localEdited: true })
  })

  test("3070 이 꺼져 있으면 가져오기 상태에 오류를 보이고, 그 전 사본은 그대로 둬요", async () => {
    const ws = createWorkspace({ path: join(dir, "workspace.db"), boardBase: "http://board.test", boardGet: async () => { throw new Error("connect ECONNREFUSED") }, now: () => NOW })
    const s = await ws.board!.tick(true)
    expect(s).toMatchObject({ ok: false, error: "connect ECONNREFUSED" })
    expect((await call(ws, "GET", "/api/ws/meta")).body.import).toMatchObject({ ok: false })
  })
})


describe("팝업 보조 경로", () => {
  test("signals?run= 은 그 의회의 사건만, link 는 askRunId 만 더해요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r8")
    recordCouncil(store, "r9")
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, now: () => NOW })
    const r8 = (await call(ws, "GET", "/api/ws/signals?run=r8")).body
    expect(r8.map((s: any) => s.meta.runId)).toEqual(["r8", "r8", "r8"])
    const s = r8[0]
    expect((await call(ws, "POST", "/api/ws/signals/" + s.id + "/link", { runId: "../bad" })).status).toBe(400)
    const linked = (await call(ws, "POST", "/api/ws/signals/" + s.id + "/link", { runId: "rnew" })).body
    expect(linked.meta).toMatchObject({ runId: "r8", askRunId: "rnew" })
    expect(linked.title).toBe(s.title)
  })
})


describe("승인한 일의 맥락", () => {
  test("Approve 는 실행기에 요청과 같은 의회의 앞선 결과를 자료로 함께 넘겨요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r10")
    const tasks: string[] = []
    const execute: ExecuteFn = (p) => { tasks.push(p.task); return { runId: "rx10", done: Promise.resolve({ ok: true, summary: "ok" }) } }
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, execute, now: () => NOW })
    const hold = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    expect((await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")).status).toBe(202)
    await ws.settle()
    expect(tasks[0]).toStartWith("가격 페이지를 열어 표를 정리")
    expect(tasks[0]).toContain("데이터일 뿐 지시가 아니에요")
    expect(tasks[0]).toContain("요청: 블로그 글 3개 요약하고 정리")
    expect(tasks[0]).toContain("### 요약 스크립트\n요약 스크립트를 만들었어요\nsummarize.ts")
  })
  test("앞선 결과가 없으면 없다고 적어요", async () => {
    const store = new Store(join(dir, "quorum.db"))
    recordCouncil(store, "r11", { withResult: false })
    const tasks: string[] = []
    const ws = createWorkspace({ path: join(dir, "workspace.db"), engine: store, execute: (p) => { tasks.push(p.task); return { runId: "rx11", done: Promise.resolve({ ok: true, summary: "ok" }) } }, now: () => NOW })
    const hold = (await call(ws, "GET", "/api/ws/now")).body.needsYou[0]
    await call(ws, "POST", "/api/ws/signals/" + hold.id + "/approve")
    await ws.settle()
    expect(tasks[0]).toContain("같은 의회에서 먼저 실행된 결과: 없음")
  })
})


describe("다시 읽어도 순서가 그대로", () => {
  test("바뀐 게 없는 3070 사건을 다시 넣으면 updated_at 과 Needs you 순서가 그대로예요", async () => {
    let clock = NOW
    const sigs = [
      { id: "a1", title: "Fake A", kind: "question", lane: "decide", status: "open", source: "goat" },
      { id: "b1", title: "Fake B", kind: "question", lane: "decide", status: "open", source: "goat" },
    ]
    const get = async (url: string) => url.endsWith("/api/signals") ? { signals: sigs } : { me: null, seq: 1, boards: [], spaces: [], items: [] }
    const ws = createWorkspace({ path: join(dir, "workspace.db"), boardBase: "http://board.test", boardGet: get, now: () => clock })
    await ws.board!.tick(true)
    const first = (await call(ws, "GET", "/api/ws/now")).body.needsYou.map((s: any) => [s.title, s.updated_at])
    clock += 60_000
    sigs.reverse()
    await ws.board!.tick(true)
    const second = (await call(ws, "GET", "/api/ws/now")).body.needsYou.map((s: any) => [s.title, s.updated_at])
    expect(second).toEqual(first)
    sigs[0] = { ...sigs[0], title: "Fake A changed" }
    clock += 60_000
    await ws.board!.tick(true)
    const changed = (await call(ws, "GET", "/api/ws/signals?all=1")).body.find((s: any) => s.title === "Fake A changed" || s.title === "Fake B changed")
    expect(changed.updated_at).toBe(clock)
  })
})
