// 단계 2 테넌시 시험: 공개 리스너에서 사람마다 자기 저장소만 보이고, 비소유자 일은 소유자 실행기를 한 번도 부르지 않아요.
// 가짜 JWKS 로 RS256 토큰을 직접 서명해요(src/engine/public.test.ts 와 같은 방식). 실행기는 모두 가짜이고 호출을 기록해요.
import { describe, expect, test } from "bun:test"
import { Store } from "../engine/store"
import { RunManager } from "../engine/runs"
import { createAccess, isAllowed } from "../engine/access"
import type { CouncilDeps } from "../engine/council"
import { createApp, type AppDeps, type RecipesModule } from "../server"
import { createWorkspace } from "../workspace/api"
import { createTenants, tenantFrom, tenantKey, type Tenant } from "./tenants"

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test" }
const CERTS = "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs"
const ORIGIN = "https://quorum.lidgeai.com"
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
async function jwt(email: string) {
  const data = enc({ alg: "RS256", kid: "test" }) + "." + enc({ iss: "https://test-team.cloudflareaccess.com", aud: ["test-aud"], exp: Math.floor(Date.now() / 1000) + 600, email })
  return data + "." + Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))).toString("base64url")
}
const certsFetch = (async (input: string | URL | Request) => (String(input) === CERTS ? Response.json({ keys: [jwk] }) : new Response("no", { status: 500 }))) as unknown as typeof fetch

const fakeRecipes: RecipesModule = { listRecipes: () => [{ id: "luma-event" }], runRecipe: async () => ({ ok: true }) }

function makeTenant(email: string | null, role: "owner" | "guest", calls: string[]): Tenant {
  const who = role + ":" + (email ?? "local")
  const store = new Store(":memory:")
  const deps = (): CouncilDeps => ({
    ask: async (actor) => {
      calls.push(who + ":ask:" + actor)
      if (actor === "bot:scout") return JSON.stringify({ proposals: [{ title: "공지 읽고 정리", executor: "aside", why: "w", task: "t" }, { title: "참가비 결제하기", executor: "aside", why: "w", task: "결제", risk: ["money"] }] })
      if (actor === "bot:builder" || actor === "bot:keeper") return JSON.stringify({ proposals: [] })
      return JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }, { proposalId: "p2", stance: "keep", reason: "ok" }] })
    },
    executors: { aside: async () => { calls.push(who + ":aside"); return { summary: "정리 끝" } } },
  })
  const runs = new RunManager(store, deps, { sleep: async () => {} })
  const ws = createWorkspace({ path: ":memory:", engine: store })
  return tenantFrom({ email, role, store, runs, workspace: ws.handle, memory: async (q) => [{ owner: email, q }], recipes: async () => (role === "owner" ? fakeRecipes : null), health: async () => ({ aside: role === "owner", codex: false, gbrain: false, board: false }), mcpPropose: true })
}

function setup(opts: { ownerEmail?: string | null; maxGuests?: number } = {}) {
  const calls: string[] = []
  const ownerEmail = opts.ownerEmail === undefined ? "jun@lidgeai.com" : opts.ownerEmail
  const owner = makeTenant(ownerEmail, "owner", calls)
  const tenants = createTenants({ owner, ownerEmail, makeGuest: (email) => makeTenant(email, "guest", calls), maxGuests: opts.maxGuests ?? 10 })
  const deps: AppDeps = { store: owner.store, runs: owner.runs, siteRoot: "/nonexistent", health: owner.health, memory: owner.memory, recipes: owner.recipes, tenants }
  const access = createAccess({ team: "test-team", aud: "test-aud", allowed: ["*"], fetch: certsFetch })
  const pub = createApp(deps, "public", { who: access.who, origin: ORIGIN })
  const local = createApp(deps, "local")
  const as = (email: string) => async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await pub(new Request("http://127.0.0.1:4318" + path, {
      method: init.method ?? "GET",
      headers: { host: "quorum.lidgeai.com", "cf-access-jwt-assertion": await jwt(email), ...(init.body !== undefined ? { "content-type": "application/json", origin: ORIGIN } : {}), ...(init.headers || {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }))
    const text = await res.text()
    let body: any = null
    try { body = JSON.parse(text) } catch { body = text }
    return { status: res.status, body }
  }
  return { calls, tenants, owner, pub, local, judge: as("judge@example.com"), other: as("other@example.com"), jun: as("jun@lidgeai.com") }
}

async function until(fn: () => boolean) {
  for (let i = 0; i < 500 && !fn(); i++) await Bun.sleep(1)
  expect(fn()).toBe(true)
}
const mcp = (name: string, args: Record<string, unknown>) => ({ method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } })

describe("tenancy on the public listener", () => {
  test("Workspace items belong to the person who wrote them", async () => {
    const s = setup()
    const made = await s.judge("/api/ws/items", { method: "POST", body: { text: "심사 메모" } })
    expect(made.status).toBe(201)
    const id = made.body.item.id
    expect((await s.other("/api/ws/items")).body).toEqual([])
    expect((await s.jun("/api/ws/items")).body).toEqual([])
    expect((await s.other("/api/ws/items/" + id)).status).toBe(404)
    expect((await s.other("/api/ws/items/" + id, { method: "PATCH", body: { text: "덮기" } })).status).toBe(404)
    expect((await s.other("/api/ws/items/" + id, { method: "DELETE", body: {} })).status).toBe(404)
    expect((await s.judge("/api/ws/items")).body.map((i: { text: string }) => i.text)).toEqual(["심사 메모"])
  })

  test("runs, events (SSE), signals and approvals stay with their owner; guest runs never touch the owner's executors", async () => {
    const s = setup()
    const r = await s.judge("/api/runs", { method: "POST", body: { request: "공지 읽어 줘" } })
    expect(r.status).toBe(201)
    const runId = r.body.runId
    const judgeT = s.tenants.resolve({ email: "judge@example.com" }, "public") as Tenant
    await until(() => judgeT.store.getRun(runId)?.status === "done")
    expect((await s.judge("/api/runs/" + runId)).status).toBe(200)
    for (const who of [s.other, s.jun]) {
      expect((await who("/api/runs/" + runId)).status).toBe(404)
      expect((await who("/api/runs/" + runId + "/events")).status).toBe(404)
      expect((await who("/api/runs")).body.map((x: { runId: string }) => x.runId)).not.toContain(runId)
    }
    // 보류된 결제 제안은 judge 의 Needs you 에만 있어요. 다른 사람은 그 사건을 읽지도 승인하지도 못해요
    const now = (await s.judge("/api/ws/now")).body
    const hold = now.needsYou.find((x: { title: string }) => x.title === "참가비 결제하기")
    expect(hold).toBeTruthy()
    expect((await s.other("/api/ws/now")).body.needsYou).toEqual([])
    expect((await s.other("/api/ws/signals/" + hold.id)).status).toBe(404)
    expect((await s.other("/api/ws/signals/" + hold.id + "/approve", { method: "POST", body: {} })).status).toBe(404)
    expect((await s.jun("/api/ws/signals/" + hold.id + "/approve", { method: "POST", body: {} })).status).toBe(404)
    expect(s.calls.some((c) => c.startsWith("owner:"))).toBe(false)
    expect(s.calls).toContain("guest:judge@example.com:aside")
  })

  test("memory, MCP and recipes are scoped too", async () => {
    const s = setup()
    const r = await s.judge("/api/runs", { method: "POST", body: { request: "x 정리" } })
    const judgeT = s.tenants.resolve({ email: "judge@example.com" }, "public") as Tenant
    await until(() => judgeT.store.getRun(r.body.runId)?.status === "done")
    expect((await s.other("/api/memory?q=x")).body.results).toEqual([{ owner: "other@example.com", q: "x" }])
    const peek = await s.other("/mcp", mcp("quorum_run", { runId: r.body.runId }))
    expect(peek.body.result.isError).toBe(true)
    const list = await s.other("/mcp", mcp("quorum_runs", {}))
    expect(list.body.result.structuredContent.runs).toEqual([])
    const mine = await s.judge("/mcp", mcp("quorum_run", { runId: r.body.runId }))
    expect(mine.body.result.isError).toBeUndefined()
    // 레시피는 소유자 맥의 Aside 로 수리해요: 비소유자는 목록이 비고 실행은 403
    expect((await s.judge("/api/recipes")).body).toEqual([])
    expect((await s.judge("/api/recipes/luma-event/run", { method: "POST", body: {} })).status).toBe(403)
    expect((await s.jun("/api/recipes")).body).toEqual([{ id: "luma-event" }])
  })

  test("only QUORUM_OWNER_EMAIL is the owner; without it nobody on the public listener is (fail closed); local is always the owner", async () => {
    const s = setup()
    expect((await s.jun("/api/me")).body).toMatchObject({ email: "jun@lidgeai.com", role: "owner" })
    expect((await s.judge("/api/me")).body).toMatchObject({ email: "judge@example.com", role: "guest" })
    const n = setup({ ownerEmail: null })
    expect((await n.jun("/api/me")).body.role).toBe("guest")
    await n.jun("/api/runs", { method: "POST", body: { request: "공지" } })
    await until(() => n.calls.some((c) => c.endsWith(":aside")))
    expect(n.calls.some((c) => c.startsWith("owner:"))).toBe(false)
    const res = await n.local(new Request("http://127.0.0.1:4317/api/me", { headers: { host: "127.0.0.1:4317" } }))
    expect((await res.json()).role).toBe("owner")
  })

  test("Workspace meta shows the logged-in email, not a forwarded header", async () => {
    const s = setup()
    const meta = await s.judge("/api/ws/meta", { headers: { "cf-access-authenticated-user-email": "jun@lidgeai.com" } })
    expect(meta.body.me).toEqual({ email: "judge@example.com" })
  })

  test("new guests stop at the cap with 503; existing guests keep working", async () => {
    const s = setup({ maxGuests: 1 })
    expect((await s.judge("/api/ws/items")).status).toBe(200)
    expect((await s.other("/api/ws/items")).status).toBe(503)
    expect((await s.judge("/api/ws/items")).status).toBe(200)
    expect((await s.jun("/api/ws/items")).status).toBe(200)
  })
})

describe("tenant keys and allowed emails", () => {
  test("tenantKey is a stable hash that does not contain the email", () => {
    expect(tenantKey("Judge@Example.com")).toBe(tenantKey("judge@example.com"))
    expect(tenantKey("judge@example.com")).toMatch(/^[a-f0-9]{24}$/)
    expect(tenantKey("judge@example.com")).not.toBe(tenantKey("other@example.com"))
  })
  test("ALLOWED_EMAILS takes exact emails, *@domain and *", () => {
    expect(isAllowed("a@x.com", ["a@x.com"])).toBe(true)
    expect(isAllowed("b@x.com", ["a@x.com"])).toBe(false)
    expect(isAllowed("b@x.com", ["*@x.com"])).toBe(true)
    expect(isAllowed("b@evilx.com", ["*@x.com"])).toBe(false)
    expect(isAllowed("b@x.com.evil", ["*@x.com"])).toBe(false)
    expect(isAllowed("anyone@any.org", ["*"])).toBe(true)
    expect(isAllowed("a@x.com", [])).toBe(false)
  })
})
