// 사람별 MCP 연결 토큰·Bearer 인증·감사 기록·제한 시험.
import { describe, expect, test } from "bun:test"
import { Store } from "../engine/store"
import { RunManager } from "../engine/runs"
import type { AppDeps } from "../server"
import { createWorkspace } from "../workspace/api"
import { createTenants, tenantFrom, type Tenant } from "./tenants"
import { openHosted, createLimiter } from "./hosted"
import { ORIGIN, publicApp, rpc } from "./test-kit"

function tenant(email: string | null, role: "owner" | "guest"): Tenant {
  const store = new Store(":memory:")
  const runs = new RunManager(store, () => ({ ask: async () => "{}", executors: {} }), { sleep: async () => {} })
  const ws = createWorkspace({ path: ":memory:", engine: store })
  return tenantFrom({ email, role, store, runs, workspace: ws.handle, memory: async () => [], recipes: async () => null, health: async () => ({ aside: false, codex: false, gbrain: false, board: false }), mcpPropose: false })
}

function setup(allowed: string[] = ["*"], clock = { t: 1_000_000 }) {
  const hosted = openHosted(":memory:", () => clock.t)
  const owner = tenant("jun@lidgeai.com", "owner")
  const tenants = createTenants({ owner, ownerEmail: "jun@lidgeai.com", makeGuest: (e) => tenant(e, "guest") })
  const deps: AppDeps = { store: owner.store, runs: owner.runs, siteRoot: "/nonexistent", health: owner.health, memory: owner.memory, recipes: owner.recipes, tenants, hosted }
  const { as } = publicApp(deps, allowed)
  return { hosted, tenants, clock, judge: as("judge@example.com"), other: as("other@example.com"), anon: as(null) }
}
const make = (call: ReturnType<typeof setup>["judge"], name = "my aside") => call("/api/mcp-tokens", { body: { name }, headers: { origin: ORIGIN } })

describe("per-person MCP connection tokens", () => {
  test("the secret is shown once and only its hash is stored; lists never include it", async () => {
    const s = setup()
    const r = await make(s.judge)
    expect(r.status).toBe(201)
    expect(r.body.secret).toMatch(/^qmcp_[A-Za-z0-9_-]{43}$/)
    expect(r.body.token).toMatchObject({ name: "my aside", lastUsedAt: null, revokedAt: null })
    const list = await s.judge("/api/mcp-tokens")
    expect(JSON.stringify(list.body)).not.toContain(r.body.secret)
    expect(list.body.tokens.length).toBe(1)
    const dump = JSON.stringify(s.hosted.db.query("SELECT * FROM mcp_tokens").all()) + JSON.stringify(s.hosted.db.query("SELECT * FROM audit").all())
    expect(dump).not.toContain(r.body.secret)
    expect(dump).not.toContain(r.body.secret.slice(12))
  })

  test("Bearer token on /mcp acts as its owner; other people cannot see or revoke it; revoke is immediate", async () => {
    const s = setup()
    const { secret, token } = (await make(s.judge)).body
    await s.judge("/api/runs", { body: { request: "judge 의 일" }, headers: { origin: ORIGIN } })
    const viaToken = await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: secret })
    expect(viaToken.status).toBe(200)
    expect(viaToken.body.result.structuredContent.runs.map((x: { request: string }) => x.request)).toEqual(["judge 의 일"])
    expect((await s.other("/api/mcp-tokens")).body.tokens).toEqual([])
    expect((await s.other("/api/mcp-tokens/" + token.id, { method: "DELETE", headers: { origin: ORIGIN } })).status).toBe(404)
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: secret })).status).toBe(200)
    expect((await s.judge("/api/mcp-tokens/" + token.id, { method: "DELETE", headers: { origin: ORIGIN } })).status).toBe(200)
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: secret })).status).toBe(401)
  })

  test("a bad Bearer is 401 even next to a valid login; tokens do not open /api", async () => {
    const s = setup()
    const { secret } = (await make(s.judge)).body
    expect((await s.judge("/mcp", { body: rpc("quorum_runs"), bearer: "qmcp_wrong" })).status).toBe(401)
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: "Bearer" })).status).toBe(401)
    expect((await s.anon("/api/ws/items", { bearer: secret })).status).toBe(401)
    expect((await s.anon("/api/mcp-tokens", { bearer: secret })).status).toBe(401)
  })

  test("removing the person from ALLOWED_EMAILS stops their token too", async () => {
    const hostedAllowed = ["judge@example.com"]
    const s = setup(hostedAllowed)
    const { secret } = (await make(s.judge)).body
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: secret })).status).toBe(200)
    hostedAllowed.length = 0
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: secret })).status).toBe(401)
  })

  test("cross-site token writes are refused; at most 5 active tokens per person; names are checked", async () => {
    const s = setup()
    expect((await s.judge("/api/mcp-tokens", { body: { name: "x" }, headers: { origin: "https://evil.example" } })).status).toBe(403)
    expect((await s.judge("/api/mcp-tokens", { body: { name: "" }, headers: { origin: ORIGIN } })).status).toBe(400)
    for (let i = 0; i < 5; i++) expect((await make(s.judge, "t" + i)).status).toBe(201)
    expect((await make(s.judge, "t6")).status).toBe(409)
    expect((await make(s.other, "o1")).status).toBe(201)
  })

  test("audit log records token and auth events for the person, without secrets", async () => {
    const s = setup()
    const { token } = (await make(s.judge)).body
    await s.judge("/api/mcp-tokens/" + token.id, { method: "DELETE", headers: { origin: ORIGIN } })
    await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: "qmcp_nope" })
    const mine = (await s.judge("/api/audit")).body.map((a: { action: string }) => a.action)
    expect(mine).toEqual(expect.arrayContaining(["token.create", "token.revoke"]))
    expect((await s.other("/api/audit")).body).toEqual([])
    expect(s.hosted.db.query("SELECT COUNT(*) AS n FROM audit WHERE action='mcp.auth_fail'").get()).toEqual({ n: 1 })
  })
})

describe("abuse limits", () => {
  test("repeated bad Bearer tokens from one address get 429", async () => {
    const s = setup()
    let last = 0
    for (let i = 0; i < 31; i++) last = (await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: "qmcp_bad" + i, headers: { "cf-connecting-ip": "203.0.113.9" } })).status
    expect(last).toBe(429)
    expect((await s.anon("/mcp", { body: rpc("quorum_runs"), bearer: "qmcp_bad", headers: { "cf-connecting-ip": "203.0.113.10" } })).status).toBe(401)
  })
  test("large bodies are refused with 413 before they are read", async () => {
    const s = setup()
    expect((await s.judge("/api/ws/items", { raw: JSON.stringify({ text: "x".repeat(70_000) }), headers: { origin: ORIGIN } })).status).toBe(413)
  })
  test("limiter: sliding window per key", () => {
    const clock = { t: 0 }
    const l = createLimiter(() => clock.t)
    expect([l.take("a", 2, 1000), l.take("a", 2, 1000), l.take("a", 2, 1000), l.take("b", 2, 1000)]).toEqual([true, true, false, true])
    clock.t = 1001
    expect(l.take("a", 2, 1000)).toBe(true)
  })
})
