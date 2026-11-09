// 공개 리스너(quorum.lidgeai.com) 인증 시험. board/apps/server/server/public-listener.test.ts 의 방식(가짜 JWKS, RS256 토큰 직접 서명)을 가져왔어요.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Store } from "./store"
import { RunManager } from "./runs"
import { createAccess, publicCsrfAllowed } from "./access"
import { createApp, publicPortFrom, type AppDeps } from "../server"
import type { CouncilDeps } from "./council"

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test" }
const CERTS = "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs"
const ORIGIN = "https://quorum.lidgeai.com"
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
async function jwt(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = pair.privateKey) {
  const data = encode({ alg: "RS256", kid: "test", ...header }) + "." + encode({ iss: "https://test-team.cloudflareaccess.com", aud: ["test-aud"], exp: Math.floor(Date.now() / 1000) + 600, email: "Jun@LidgeAI.com", ...payload })
  return data + "." + Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data))).toString("base64url")
}
const certsFetch = (async (input: string | URL | Request) => (String(input) === CERTS ? Response.json({ keys: [jwk] }) : new Response("no", { status: 500 }))) as unknown as typeof fetch

const councilDeps = (): CouncilDeps => ({
  ask: async (actor) => actor === "bot:scout"
    ? JSON.stringify({ proposals: [{ title: "공지 읽고 정리", executor: "aside", why: "w", task: "t" }] })
    : ["bot:builder", "bot:keeper"].includes(actor) ? JSON.stringify({ proposals: [] }) : JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] }),
  executors: { aside: async () => ({ summary: "정리 끝" }) },
})

function setup(fetchImpl = certsFetch, localUser: string | null = null) {
  const store = new Store(":memory:")
  const runs = new RunManager(store, councilDeps, { sleep: async () => {} })
  const deps: AppDeps = { store, runs, siteRoot: "/nonexistent", health: async () => ({ aside: true, codex: true, gbrain: true, board: false }), memory: async (q) => [{ q }], recipes: async () => null, localUser }
  const access = createAccess({ team: "test-team", aud: "test-aud", allowed: ["jun@lidgeai.com"], fetch: fetchImpl })
  const pub = createApp(deps, "public", { who: access.who, origin: ORIGIN })
  const local = createApp(deps, "local")
  const call = (app: typeof pub, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    app(new Request("http://127.0.0.1:4318" + path, { ...init, headers: { host: "quorum.lidgeai.com", ...(init.headers || {}) } }))
  return { store, runs, pub, local, call }
}
const tok = (t: string) => ({ "cf-access-jwt-assertion": t })

describe("public listener: Cloudflare Access (board auth.ts)", () => {
  test("401 without a valid Access login on /api, /mcp and static files; health stays minimal", async () => {
    const { pub, call } = setup()
    for (const path of ["/api/me", "/api/runs", "/mcp", "/", "/app"]) expect((await call(pub, path)).status).toBe(401)
    expect(await (await call(pub, "/api/health")).json()).toEqual({ ok: true, version: expect.any(String) })
    // 로컬인 척하는 헤더는 공개 리스너에서 아무 의미가 없어요
    const spoofs: Record<string, string>[] = [{ host: "localhost" }, { host: "127.0.0.1" }, { "x-forwarded-for": "127.0.0.1" }, { "cf-connecting-ip": "127.0.0.1" }, { origin: "http://localhost" }]
    for (const h of spoofs) {
      expect((await call(pub, "/api/me", { headers: h })).status).toBe(401)
      expect((await call(pub, "/mcp", { headers: h })).status).toBe(401)
    }
    // 쓰기는 인증보다 교차 사이트 검사가 먼저예요(board 순서): 로컬 Origin 을 단 POST 는 403
    expect((await call(pub, "/mcp", { method: "POST", headers: { origin: "http://localhost" }, body: "{}" })).status).toBe(403)
  })
  test("401 for forged, wrong-audience, expired, not-yet-valid, wrong-issuer and not-allowed tokens", async () => {
    const { pub, call } = setup()
    const bad = [
      await jwt({}, {}, other.privateKey),
      await jwt({}, { alg: "none" }),
      await jwt({}, { kid: "unknown" }),
      await jwt({ aud: "wrong" }),
      await jwt({ exp: 1 }),
      await jwt({ nbf: Math.floor(Date.now() / 1000) + 600 }),
      await jwt({ iss: "https://evil.cloudflareaccess.com" }),
      await jwt({ email: "other@example.com" }),
      await jwt({ email: "" }),
      "not.a.jwt",
    ]
    for (const t of bad) expect((await call(pub, "/api/me", { headers: tok(t) })).status).toBe(401)
    expect((await call(pub, "/api/me", { headers: { authorization: "Bearer anything" } })).status).toBe(401)
  })
  test("200 for an allowed Access login by header or CF_Authorization cookie; /api/me returns the lowercased email", async () => {
    const { pub, call } = setup()
    const good = await jwt()
    const me = await call(pub, "/api/me", { headers: tok(good) })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ email: "jun@lidgeai.com", listener: "public" })
    const cookie = await call(pub, "/api/me", { headers: { cookie: "a=b; CF_Authorization=" + good } })
    expect(await cookie.json()).toEqual({ email: "jun@lidgeai.com", listener: "public" })
    expect((await (await call(pub, "/api/health", { headers: tok(good) })).json()) as object).toHaveProperty("executors")
    expect((await call(pub, "/", { headers: tok(good) })).status).toBe(404) // 인증은 통과, 테스트용 siteRoot 에 파일이 없을 뿐
    const mcp = await call(pub, "/mcp", { method: "POST", headers: { ...tok(good), "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
    expect(mcp.status).toBe(200)
  })
  test("403 for cross-site writes even with a valid login; PUBLIC_ORIGIN and CLI writes start a run", async () => {
    const { pub, call, store } = setup()
    const h = { ...tok(await jwt()), "content-type": "application/json" }
    const body = JSON.stringify({ request: "공지 정리" })
    expect((await call(pub, "/api/runs", { method: "POST", headers: { ...h, origin: "https://evil.example" }, body })).status).toBe(403)
    expect((await call(pub, "/api/runs", { method: "POST", headers: { ...h, origin: "http://localhost:5173" }, body })).status).toBe(403)
    expect((await call(pub, "/api/runs", { method: "POST", headers: { ...h, "sec-fetch-site": "cross-site" }, body })).status).toBe(403)
    expect(store.listRuns()).toEqual([])
    expect((await call(pub, "/api/runs", { method: "POST", headers: { ...h, origin: ORIGIN }, body })).status).toBe(201)
    expect((await call(pub, "/api/runs", { method: "POST", headers: h, body })).status).toBe(201)
    expect(store.listRuns().length).toBe(2)
    // 로그인이 없으면 같은 Origin 이어도 401
    expect((await call(pub, "/api/runs", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body })).status).toBe(401)
  })
  test("fails closed when the Access key list cannot be fetched", async () => {
    const { pub, call } = setup((async () => new Response("down", { status: 503 })) as unknown as typeof fetch)
    expect((await call(pub, "/api/me", { headers: tok(await jwt()) })).status).toBe(401)
  })
  test("local listener keeps local-only rules and reports QUORUM_LOCAL_USER", async () => {
    const { local } = setup(certsFetch, "jun@lidgeai.com")
    const r = await local(new Request("http://localhost:4317/api/me", { headers: { host: "localhost:4317" } }))
    expect(await r.json()).toEqual({ email: "jun@lidgeai.com", listener: "local" })
    expect((await local(new Request("http://localhost:4317/api/me", { headers: { host: "quorum.lidgeai.com" } }))).status).toBe(403)
  })
  test("publicCsrfAllowed and publicPortFrom follow board rules", () => {
    const req = (method: string, h: Record<string, string>) => new Request("http://x/api/runs", { method, headers: h })
    expect(publicCsrfAllowed(req("GET", { origin: "https://evil.example" }), ORIGIN)).toBe(true)
    expect(publicCsrfAllowed(req("POST", { origin: ORIGIN }), ORIGIN)).toBe(true)
    expect(publicCsrfAllowed(req("POST", { origin: ORIGIN + "/" }), ORIGIN)).toBe(false)
    expect(publicPortFrom(undefined, 4317)).toBe(4318)
    expect(publicPortFrom("", 4317)).toBeNull()
    expect(publicPortFrom("4317", 4317)).toBe("invalid")
    expect(publicPortFrom("70000", 4317)).toBe("invalid")
  })
})

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => { const s = createServer(); s.on("error", fail); s.listen(0, "127.0.0.1", () => { const port = (s.address() as { port: number }).port; s.close(() => ok(port)) }) })
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function spawnServer(env: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "quorum-public-test-"))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const localPort = await freePort()
  let publicPort = await freePort()
  while (publicPort === localPort) publicPort = await freePort()
  const preload = join(dir, "preload.ts")
  await writeFile(preload, "const original = globalThis.fetch;\nglobalThis.fetch = (input, init) => String(input) === " + JSON.stringify(CERTS) + " ? Promise.resolve(Response.json(" + JSON.stringify({ keys: [jwk] }) + ")) : original(input, init);\n")
  const proc = Bun.spawn([process.execPath, "--preload", preload, resolve(import.meta.dir, "../server.ts")], {
    cwd: dir,
    env: { PATH: "/usr/bin:/bin", HOME: dir, QUORUM_PORT: String(localPort), QUORUM_PUBLIC_PORT: String(publicPort), QUORUM_STATE_DIR: dir, ACCESS_TEAM: "test-team", ASIDE_BIN: "/usr/bin/false", QUORUM_BOARD_URL: "http://127.0.0.1:9", QUORUM_RECIPES_DB: join(dir, "recipes.db"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  cleanup.push(async () => { proc.kill(); await proc.exited })
  const local = "http://127.0.0.1:" + localPort
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(local + "/api/me")).ok) break } catch { /* 아직 안 열렸어요 */ }
    if (proc.exitCode !== null) throw new Error("server exited " + proc.exitCode + ": " + (await new Response(proc.stderr).text()))
    await Bun.sleep(50)
  }
  return { local, pub: "http://127.0.0.1:" + publicPort, proc }
}

describe("server.ts listeners (spawned)", () => {
  test("opens the public listener only with ACCESS_AUD and ALLOWED_EMAILS, and enforces Access there", async () => {
    const { local, pub } = await spawnServer({ ACCESS_AUD: "test-aud", ALLOWED_EMAILS: "jun@lidgeai.com" })
    expect(await (await fetch(local + "/api/me")).json()).toEqual({ email: null, listener: "local" })
    expect((await fetch(pub + "/api/me")).status).toBe(401)
    expect((await fetch(pub + "/")).status).toBe(401)
    const me = await fetch(pub + "/api/me", { headers: tok(await jwt()) })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ email: "jun@lidgeai.com", listener: "public" })
    expect((await fetch(pub + "/app", { headers: tok(await jwt()) })).status).toBe(200)
  }, 15000)
  test("without ACCESS_AUD the public port stays closed", async () => {
    const { local, pub } = await spawnServer({ ALLOWED_EMAILS: "jun@lidgeai.com" })
    expect((await fetch(local + "/api/me")).status).toBe(200)
    await expect(fetch(pub + "/api/me")).rejects.toThrow()
  }, 15000)
})
