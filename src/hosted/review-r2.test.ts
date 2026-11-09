// 보안 리뷰 2차 지적 2개의 회귀 시험(고치기 전에 실패하는 것을 확인했어요).
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeGuestTenant } from "./guest"
import { openHosted } from "./hosted"
import { createTenants, tenantFrom } from "./tenants"
import { Store } from "../engine/store"
import { RunManager } from "../engine/runs"
import type { AppDeps } from "../server"
import { ORIGIN, publicApp } from "./test-kit"

const withDir = async (fn: (dir: string) => Promise<void>) => { const d = mkdtempSync(join(tmpdir(), "quorum-r2-")); try { await fn(d) } finally { rmSync(d, { recursive: true, force: true }) } }
const fakeModel = (async (_u: string, init: RequestInit) => {
  const prompt = JSON.parse(String(init.body)).messages[1].content as string
  const content = prompt.includes("정찰병") ? JSON.stringify({ proposals: [{ title: "Read the page", executor: "aside", why: "w", task: "read", risk: [] }] })
    : prompt.includes("제안 봇") ? JSON.stringify({ proposals: [] }) : JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] })
  return Response.json({ choices: [{ message: { content } }] })
}) as unknown as typeof fetch

describe("review round 2 fixes", () => {
  test("#1 a result reaches Review even when its run is older than the latest 100 runs", () => withDir(async (dir) => {
    const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "api", model: { url: "https://m/v1", key: "k", model: "m", fetch: fakeModel } })
    const r = g.start("read the page")
    if (!("runId" in r)) throw new Error("start failed")
    for (let i = 0; i < 300 && g.store.getRun(r.runId)?.status !== "done"; i++) await Bun.sleep(1)
    // 그 뒤로 실행이 120개 더 생겨 이 실행이 최근 100개 밖으로 밀려요
    for (let i = 0; i < 120; i++) g.store.createRun({ runId: "later" + i, request: "x", mode: "live", startedAt: new Date(Date.now() + 1000 + i).toISOString(), kind: "council" })
    const l = g.tasks.lease({})!
    expect(g.tasks.report({ taskId: l.task.id, leaseId: l.leaseId, ok: true, text: "done https://x" }).status).toBe(200)
    const sig = g.workspace!(new Request("http://x/api/ws/now"), ["api", "ws", "now"], "judge@example.com")
    const now = await (await sig).json() as { review: { title: string; body: string }[] }
    expect(now.review.map((s) => [s.title, s.body])).toEqual([["Read the page", "done https://x"]])
  }))

  test("#1 a result whose Workspace signal cannot be found is not acknowledged; the lease can report again", () => withDir(async (dir) => {
    const g = makeGuestTenant({ email: "judge@example.com", key: "k", dir, hosted: openHosted(":memory:"), bots: "client" })
    const t = g.tasks.enqueue({ kind: "browser", ref: "quorum:rmissing:p1", title: "t", prompt: "p", runId: "rmissing", proposalId: "p1" })
    const l = g.tasks.lease({})!
    expect(g.tasks.report({ taskId: t.id, leaseId: l.leaseId, ok: true, text: "r" }).status).toBe(500)
    expect(g.tasks.get(t.id)!.status).toBe("leased")
  }))

  test("#2 guests cannot start replays (they bypass the council limit); the owner still can", () => withDir(async (dir) => {
    const hosted = openHosted(":memory:")
    const store = new Store(":memory:")
    const runs = new RunManager(store, () => ({ ask: async () => "{}", executors: {} }), { sleep: async () => {} })
    const owner = tenantFrom({ email: "jun@lidgeai.com", role: "owner", store, runs, memory: async () => [], recipes: async () => null, health: async () => ({ aside: true, codex: false, gbrain: false, board: false }), mcpPropose: false })
    const tenants = createTenants({ owner, ownerEmail: "jun@lidgeai.com", makeGuest: (email, key) => makeGuestTenant({ email, key, dir: join(dir, key), hosted, bots: "client" }) })
    const deps: AppDeps = { store, runs, siteRoot: "/x", health: owner.health, memory: owner.memory, recipes: owner.recipes, tenants, hosted }
    const { as } = publicApp(deps)
    const judge = as("judge@example.com"), jun = as("jun@lidgeai.com")
    const g = tenants.resolve({ email: "judge@example.com" }, "public") as ReturnType<typeof makeGuestTenant>
    g.store.createRun({ runId: "rold", request: "x", mode: "live", startedAt: new Date().toISOString(), kind: "council" })
    g.store.appendEvent({ runId: "rold", seq: 0, at: new Date().toISOString(), mode: "live", type: "run.end", actor: "council", text: "end", data: { status: "done" } })
    g.store.finishRun("rold", "done")
    expect((await judge("/api/runs", { body: { mode: "replay", replayId: "rold" }, headers: { origin: ORIGIN } })).status).toBe(403)
    store.createRun({ runId: "jold", request: "x", mode: "live", startedAt: new Date().toISOString(), kind: "council" })
    store.appendEvent({ runId: "jold", seq: 0, at: new Date().toISOString(), mode: "live", type: "run.end", actor: "council", text: "end", data: { status: "done" } })
    store.finishRun("jold", "done")
    expect((await jun("/api/runs", { body: { mode: "replay", replayId: "jold" }, headers: { origin: ORIGIN } })).status).toBe(201)
  }))
})
