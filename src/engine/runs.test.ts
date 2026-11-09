import { describe, expect, test } from "bun:test"
import { Store } from "./store"
import { RunManager } from "./runs"
import { createApp, VERSION } from "../server"
import type { CouncilDeps } from "./council"
import type { QuorumEvent } from "../contract"

const answers: Record<string, string> = {
  "bot:scout": JSON.stringify({ proposals: [{ title: "공지 읽고 정리", executor: "aside", why: "w", task: "t" }] }),
  "bot:builder": JSON.stringify({ proposals: [] }),
  "bot:keeper": JSON.stringify({ proposals: [] }),
}
const deps = (): CouncilDeps => ({
  ask: async (actor) => answers[actor] ?? JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] }),
  executors: { aside: async () => ({ summary: "정리 끝" }) },
})

function setup() {
  const store = new Store(":memory:")
  const runs = new RunManager(store, deps, { sleep: async () => {} })
  return { store, runs }
}

describe("RunManager", () => {
  test("live run persists numbered events and notifies subscribers until done", async () => {
    const { store, runs } = setup()
    const seen: (QuorumEvent | null)[] = []
    const { runId, done } = runs.start("공지 정리")
    runs.subscribe(runId, (e) => seen.push(e))
    await done
    const events = store.getEvents(runId)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i))
    expect(events.every((e) => e.mode === "live")).toBe(true)
    expect(events.map((e) => e.type)).toEqual(["run.start", "recall", "proposal", "critique", "critique", "critique", "critique", "verdict", "execute.start", "execute.result", "run.end"])
    expect(seen[seen.length - 1]).toBeNull()
    expect(store.getRun(runId)?.status).toBe("done")
    expect(runs.isLive(runId)).toBe(false)
  })

  test("replay re-emits the recording with mode replay and refuses unknown or running sources", async () => {
    const { store, runs } = setup()
    const live = runs.start("공지 정리")
    expect(runs.replay(live.runId)).toEqual({ error: "그 실행은 아직 끝나지 않았어요", status: 409 })
    await live.done
    expect(runs.replay("nope")).toEqual({ error: "replayId not found", status: 404 })
    const r = runs.replay(live.runId)
    if ("error" in r) throw new Error(r.error)
    await r.done
    const src = store.getEvents(live.runId)
    const rep = store.getEvents(r.runId)
    expect(rep.map((e) => [e.type, e.text])).toEqual(src.map((e) => [e.type, e.text]))
    expect(rep.every((e) => e.mode === "replay" && e.runId === r.runId)).toBe(true)
    expect(rep[0].data?.replayOf).toBe(live.runId)
    expect(store.getRun(r.runId)).toMatchObject({ mode: "replay", replayOf: live.runId, status: "done" })
  })

  test("interruptRunning closes runs left running by a restart (board runs.ts rule)", () => {
    const store = new Store(":memory:")
    store.createRun({ runId: "x1", request: "q", mode: "live", startedAt: "2026-11-09T01:00:00.000Z" })
    store.appendEvent({ runId: "x1", seq: 0, at: "2026-11-09T01:00:00.000Z", mode: "live", type: "run.start", actor: "council", text: "s" })
    expect(store.interruptRunning("2026-11-09T02:00:00.000Z")).toEqual(["x1"])
    expect(store.getRun("x1")?.status).toBe("error")
    expect(store.getEvents("x1").map((e) => [e.seq, e.type])).toEqual([[0, "run.start"], [1, "error"], [2, "run.end"]])
    expect(store.interruptRunning("2026-11-09T02:00:00.000Z")).toEqual([])
  })
})

describe("HTTP API", () => {
  const make = () => {
    const { store, runs } = setup()
    const app = createApp({
      store, runs, siteRoot: "/nonexistent",
      health: async () => ({ aside: true, codex: true, gbrain: false, board: true }),
      memory: async (q) => [{ slug: "quorum/verdicts/x", q }],
      recipes: async () => null,
    })
    const call = (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.set("host", "localhost:4317")
      return app(new Request("http://localhost:4317" + path, { ...init, headers }))
    }
    return { store, runs, call }
  }
  const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

  test("health, validation, recipes 501 and memory", async () => {
    const { call } = make()
    expect(await (await call("/api/health")).json()).toEqual({ ok: true, version: VERSION, executors: { aside: true, codex: true, gbrain: false, board: true } })
    expect((await call("/api/runs", post({}))).status).toBe(400)
    expect((await call("/api/runs", post({ mode: "replay" }))).status).toBe(400)
    expect((await call("/api/runs", post({ mode: "weird", request: "x" }))).status).toBe(400)
    expect((await call("/api/runs/none/events")).status).toBe(404)
    expect((await call("/api/recipes")).status).toBe(501)
    expect(await (await call("/api/memory?q=공지")).json()).toEqual({ q: "공지", results: [{ slug: "quorum/verdicts/x", q: "공지" }] })
  })

  test("POST /api/runs then SSE streams every event and ends with event: done; replay is marked", async () => {
    const { call } = make()
    const { runId } = (await (await call("/api/runs", post({ request: "공지 정리" }))).json()) as { runId: string }
    const res = await call("/api/runs/" + runId + "/events")
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await res.text()
    const datas = body.split("\n\n").filter((b) => b.startsWith("id: ")).map((b) => JSON.parse(b.split("\ndata: ")[1]) as QuorumEvent)
    expect(datas.map((e) => e.seq)).toEqual(datas.map((_, i) => i))
    expect(datas[datas.length - 1].type).toBe("run.end")
    expect(body.trimEnd().endsWith("event: done\ndata: {}")).toBe(true)
    // Last-Event-ID 뒤부터만
    const tail = await (await call("/api/runs/" + runId + "/events", { headers: { "last-event-id": String(datas.length - 2) } })).text()
    expect(tail.split("\n\n").filter((b) => b.startsWith("id: ")).length).toBe(1)
    const list = (await (await call("/api/runs")).json()) as { runId: string; status: string }[]
    expect(list[0]).toMatchObject({ runId, status: "done" })
    const rep = (await (await call("/api/runs", post({ mode: "replay", replayId: runId }))).json()) as { runId: string; mode: string }
    expect(rep.mode).toBe("replay")
    const repBody = await (await call("/api/runs/" + rep.runId + "/events")).text()
    const repEvents = repBody.split("\n\n").filter((b) => b.startsWith("id: ")).map((b) => JSON.parse(b.split("\ndata: ")[1]) as QuorumEvent)
    expect(repEvents.length).toBe(datas.length)
    expect(repEvents.every((e) => e.mode === "replay")).toBe(true)
  })
})
