// 레시피 자가수리 시험. 로컬 Bun.serve 로 깨짐·후보 검증·버전 증가를 결정적으로 확인해요.
// 격리 방식은 board/apps/server/server/*.test.ts 를 따라요: :memory: DB, 임시 defs 폴더, 가짜 바이너리(/usr/bin/false). 실제 Luma·aside·gbrain 은 부르지 않아요.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { QuorumEvent } from "../contract"
import { asideRunner, buildDiscoverScript, parseProbes, RESULT_PREFIX, type AsideRunner } from "./aside"
import { fixedSegments, templatize } from "./call"
import { GbrainMemory, MemoryError, repairNote, type Memory } from "./memory"
import { listRecipes, runRecipe } from "./runner"
import { RecipeStore } from "./store"
import type { RecipeDef } from "./types"
import { watchRecipes } from "./watch"

let server: ReturnType<typeof Bun.serve>
let base = ""
const hits: string[] = []
let blastsAuth = false // true 면 get-blasts 가 쿠키 없이는 401 (실제 Luma 처럼)

beforeAll(() => {
  server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)
      hits.push(url.pathname + url.search)
      const ev = url.searchParams.get("event_api_id")
      if (url.pathname === "/url") return Response.json({ kind: "event", data: { api_id: `evt-${url.searchParams.get("url")}`, event: { name: "행사" } } })
      if (url.pathname === "/event/get-posts") return Response.json({ message: "Not found." }, { status: 404 })
      if (url.pathname === "/event/get-wrong") return Response.json({ entries: [{ nope: 1 }] }) // 같은 키, 다른 모양(스키마 불일치)
      if (url.pathname === "/event/get-empty") return Response.json({ entries: [] })
      if (url.pathname === "/event/get-blasts") {
        if (blastsAuth && req.headers.get("cookie") !== "session=ok") return Response.json({ message: "You are not signed in." }, { status: 401 })
        return Response.json({ entries: [{ api_id: `b1-${ev}`, message: "<p>체크인은 <b>9시</b></p>", created_at: "2026-11-09T00:00:00Z" }, { api_id: "b2", message: "<p>점심</p>", created_at: "2026-11-09T03:00:00Z" }] })
      }
      return Response.json({ message: "nope" }, { status: 404 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

let dir = ""
let db: Database
let store: RecipeStore
let events: QuorumEvent[] = []
const emit = (e: QuorumEvent) => { events.push(e) }
const types = () => events.map((e) => e.type)
const puts: { slug: string; markdown: string; reason?: string }[] = []
const memory: Memory = { put: async (slug, markdown, reason) => { puts.push({ slug, markdown, reason }) }, search: async () => [] }

function blasts(candidates: string[], extra: Partial<RecipeDef> = {}): RecipeDef {
  return {
    id: "t-blasts", site: "test", intent: "공지 읽기", version: 1, vars: ["eventApiId", "slug"],
    request: { method: "GET", url: `${base}/event/get-posts?event_api_id={{eventApiId}}` },
    parse: { path: "entries", pick: { id: "api_id", message: "message", created_at: "created_at" }, markdown: ["message"] },
    verify: { schema: { type: "array", minItems: 1, items: { type: "object", required: ["id", "message"] } }, nonEmpty: true },
    discover: { http: { candidates: candidates.map((p) => ({ request: { method: "GET" as const, url: `${base}${p}?event_api_id={{eventApiId}}` } })) }, aside: { startUrl: `${base}/{{slug}}`, match: "/event/" } },
    ...extra,
  }
}
async function useDef(def: RecipeDef) { await writeFile(join(dir, `${def.id}.json`), JSON.stringify(def)) }
const ctx = (over: Record<string, unknown> = {}) => ({ vars: { eventApiId: "evt-123", slug: "my-event" }, runId: "run-1", store, memory, ...over })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "quorum-recipes-test-"))
  db = new Database(":memory:")
  store = new RecipeStore(db, dir)
  events = []; puts.length = 0; hits.length = 0; blastsAuth = false
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe("runRecipe", () => {
  test("healthy recipe: run -> ok, no repair, contract-shaped events", async () => {
    await useDef(blasts([], { request: { method: "GET", url: `${base}/event/get-blasts?event_api_id={{eventApiId}}` } }))
    const out = await runRecipe("t-blasts", ctx({ seqStart: 5, mode: "replay" }), emit)
    expect(out.ok).toBe(true)
    expect(out.repaired).toBe(false)
    expect(types()).toEqual(["recipe.run", "recipe.run"])
    expect(events.map((e) => e.seq)).toEqual([5, 6])
    expect(out.nextSeq).toBe(7)
    for (const e of events) {
      expect(e).toMatchObject({ runId: "run-1", mode: "replay", actor: "recipe:t-blasts" })
      expect(Number.isNaN(Date.parse(e.at))).toBe(false)
      expect(e.data).toMatchObject({ recipeId: "t-blasts", version: 1 })
    }
    expect(events[1].data).toMatchObject({ status: 200, count: 2 })
    // html -> markdown (board vault converter)
    expect((out.result as any[])[0]).toEqual({ id: "b1-evt-123", message: "체크인은 **9시**", created_at: "2026-11-09T00:00:00Z" })
  })

  test("404 -> broken -> wrong-shape candidate rejected -> verified candidate saved as v2 -> memory.saved", async () => {
    await useDef(blasts(["/event/get-posts", "/event/get-wrong", "/event/get-blasts"]))
    const out = await runRecipe("t-blasts", ctx(), emit)
    expect(types()).toEqual(["recipe.run", "recipe.broken", "recall", "recipe.run", "recipe.run", "recipe.repaired", "memory.saved"])
    expect(events[2]).toMatchObject({ actor: "gbrain", data: { hits: [] } })
    events.splice(2, 1)
    expect(events[1].data).toMatchObject({ status: 404, kind: "http" })
    // get-posts 는 깨진 경로와 같아서 다시 시도하지 않아요
    expect(hits.filter((h) => h.startsWith("/event/get-posts")).length).toBe(1)
    expect(events[2].data).toMatchObject({ phase: "discover", ok: false, endpoint: `GET ${base}/event/get-wrong?event_api_id={{eventApiId}}` })
    expect(String(events[2].data!.reason)).toContain("$[0].id")
    expect(events[3].data).toMatchObject({ phase: "discover", ok: true })
    expect(events[4].data).toMatchObject({ recipeId: "t-blasts", version: 2, previousVersion: 1, endpoint: `GET ${base}/event/get-blasts?event_api_id={{eventApiId}}`, previousEndpoint: `GET ${base}/event/get-posts?event_api_id={{eventApiId}}`, status: 200 })
    expect(out).toMatchObject({ ok: true, repaired: true, version: 2 })
    expect(store.current("t-blasts").version).toBe(2)
    expect(store.history("t-blasts").map((h) => [h.version, h.reason])).toEqual([[1, null], [2, "응답 코드가 성공이 아니에요 (HTTP 404)"]])
    expect(store.health("t-blasts")).toMatchObject({ ok: true })
    expect(puts.length).toBe(1)
    expect(puts[0].slug).toBe("recipes/t-blasts-v2")
    expect(puts[0].markdown).toContain("get-posts")
    expect(puts[0].markdown).toContain("get-blasts")
    expect(events[5]).toMatchObject({ actor: "gbrain", data: { slug: "recipes/t-blasts-v2" } })
  })

  test("after repair the next run uses v2 directly without breaking", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    await runRecipe("t-blasts", ctx(), emit)
    events = []
    const out = await runRecipe("t-blasts", ctx({ runId: "run-2" }), emit)
    expect(types()).toEqual(["recipe.run", "recipe.run"])
    expect(out).toMatchObject({ ok: true, repaired: false, version: 2 })
    expect(puts.length).toBe(1)
  })

  test("200 with empty list is broken by verify (nonEmpty)", async () => {
    await useDef(blasts(["/event/get-blasts"], { request: { method: "GET", url: `${base}/event/get-empty?event_api_id={{eventApiId}}` } }))
    await runRecipe("t-blasts", ctx(), emit)
    expect(events[1].type).toBe("recipe.broken")
    expect(events[1].data).toMatchObject({ status: 200 })
    expect(["schema", "verify"]).toContain(events[1].data!.kind as string)
    expect(events.at(-2)!.type).toBe("recipe.repaired")
  })

  test("no candidate passes -> error event, version unchanged, health not ok", async () => {
    await useDef(blasts(["/event/get-wrong", "/event/get-empty", "/missing"]))
    const out = await runRecipe("t-blasts", ctx(), emit)
    expect(out.ok).toBe(false)
    expect(types()).toEqual(["recipe.run", "recipe.broken", "recall", "recipe.run", "recipe.run", "recipe.run", "error"])
    expect(store.current("t-blasts").version).toBe(1)
    expect(store.health("t-blasts")).toMatchObject({ ok: false })
    expect(puts.length).toBe(0)
  })

  test("401 candidate is rejected over plain http (login needed), like real Luma get-blasts", async () => {
    blastsAuth = true
    await useDef(blasts(["/event/get-blasts"]))
    const out = await runRecipe("t-blasts", ctx(), emit)
    expect(out.ok).toBe(false)
    expect(events[3].data).toMatchObject({ status: 401, ok: false })
  })

  test("{{env.X}} header is sent when set, so a cookie makes the login-only candidate pass", async () => {
    blastsAuth = true
    const def = blasts(["/event/get-blasts"])
    def.discover.http!.candidates[0].request.headers = { cookie: "{{env.QUORUM_TEST_COOKIE}}" }
    await useDef(def)
    process.env.QUORUM_TEST_COOKIE = "session=ok"
    try {
      const out = await runRecipe("t-blasts", ctx(), emit)
      expect(out).toMatchObject({ ok: true, version: 2 })
      expect(store.current("t-blasts").request.headers).toEqual({ cookie: "{{env.QUORUM_TEST_COOKIE}}" })
    } finally { delete process.env.QUORUM_TEST_COOKIE }
  })

  test("gbrain failure surfaces as an error event (fake binary /usr/bin/false); repair stays saved", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    const out = await runRecipe("t-blasts", ctx({ memory: new GbrainMemory({ bin: "/usr/bin/false" }) }), emit)
    expect(out).toMatchObject({ ok: true, version: 2 })
    expect(events.at(-1)).toMatchObject({ type: "error", actor: "gbrain" })
    expect(events.at(-1)!.text).toContain("exited 1")
    expect(store.current("t-blasts").version).toBe(2)
  })

  test("gbrain recall: a past repair note becomes the first candidate; other hosts in the note are ignored", async () => {
    await useDef(blasts([]))
    const searches: string[] = []
    const note = `# t-blasts v7\n\n- new endpoint: GET https://evil.example/steal?event_api_id={{eventApiId}}\n- new endpoint: GET ${base}/event/get-blasts?event_api_id={{eventApiId}}\n`
    const recalling: Memory = { put: memory.put, search: async (q) => { searches.push(q); return [{ slug: "recipes/t-blasts-v7", score: 1.2, snippet: note }, { slug: "recipes/other-v2", score: 1, snippet: "- new endpoint: GET http://x/y" }] } }
    const out = await runRecipe("t-blasts", ctx({ memory: recalling }), emit)
    expect(searches).toEqual(["recipes/t-blasts"])
    expect(out).toMatchObject({ ok: true, version: 2 })
    const rc = events.find((e) => e.type === "recall")!
    expect(rc.data!.hits).toEqual([{ id: "recipes/t-blasts-v7", summary: "# t-blasts v7", decision: "repair", score: 1.2 }])
    expect(hits.some((h) => h.includes("steal"))).toBe(false)
    expect(events.filter((e) => (e.data as any)?.phase === "discover").map((e) => (e.data as any).endpoint)).toEqual([`GET ${base}/event/get-blasts?event_api_id={{eventApiId}}`])
  })

  test("slug conflict (another machine wrote v2 first): same repair -> duplicate, different repair -> run-suffixed slug", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    const written: string[] = []
    let existing = ""
    const conflicting: Memory = {
      search: async () => [],
      get: async () => existing,
      put: async (slug, md) => {
        if (slug === "recipes/t-blasts-v2") throw new MemoryError("gbrain put exited 1", 1, "ended conflict with revision_required")
        written.push(slug)
      },
    }
    const same = repairNote({ recipeId: "t-blasts", site: "x", intent: "y", fromVersion: 1, toVersion: 2, previousEndpoint: `GET ${base}/event/get-posts?event_api_id={{eventApiId}}`, endpoint: `GET ${base}/event/get-blasts?event_api_id={{eventApiId}}`, reason: "other words", at: "earlier" })
    existing = same
    await runRecipe("t-blasts", ctx({ memory: conflicting }), emit)
    expect(events.at(-1)).toMatchObject({ type: "memory.saved", data: { slug: "recipes/t-blasts-v2", duplicate: true } })
    expect(written).toEqual([])

    db.close(); db = new Database(":memory:"); store = new RecipeStore(db, dir); events = []
    existing = same.replace("get-blasts", "get-something-else")
    await runRecipe("t-blasts", ctx({ memory: conflicting, runId: "Run 42!" }), emit)
    expect(events.at(-1)).toMatchObject({ type: "memory.saved", data: { slug: "recipes/t-blasts-v2-run-42", duplicate: false } })
    expect(written).toEqual(["recipes/t-blasts-v2-run-42"])
  })

  test("engine call shape: runRecipe(id, { vars, runId }, emit) defaults memory to GbrainMemory (QUORUM_GBRAIN_BIN) and listRecipes(store)", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    process.env.QUORUM_GBRAIN_BIN = "/usr/bin/false"
    try {
      const out = await runRecipe("t-blasts", { vars: { eventApiId: "evt-123", slug: "s" }, runId: "engine-1", store }, emit)
      expect(out).toMatchObject({ ok: true, version: 2 })
      // 기본 gbrain 은 /usr/bin/false 라 회상·기록 실패가 둘 다 error 로 드러나요
      expect(events.filter((e) => e.type === "error" && e.actor === "gbrain").length).toBe(2)
    } finally { delete process.env.QUORUM_GBRAIN_BIN }
    expect(listRecipes(store)).toEqual([expect.objectContaining({ id: "t-blasts", version: 2 })])
  })

  test("engine Emit (type, actor, text, data) + POST body as ctx: top-level strings become vars, derive fills eventApiId from another recipe", async () => {
    await writeFile(join(dir, "t-event.json"), JSON.stringify({ id: "t-event", site: "test", intent: "행사 읽기", version: 1, vars: ["slug"], request: { method: "GET", url: `${base}/url?url={{slug}}` }, parse: { path: "data", pick: { api_id: "api_id", name: "event.name" } }, verify: { schema: { type: "object", required: ["api_id"] } }, discover: {} }))
    await useDef(blasts(["/event/get-blasts"], { derive: { eventApiId: { recipe: "t-event", field: "api_id" } } }))
    const calls: [string, string, string, Record<string, unknown> | undefined][] = []
    const engineEmit = (type: string, actor: string, text: string, data?: Record<string, unknown>) => { calls.push([type, actor, text, data]) }
    const body = { slug: "my-event", nested: { ignored: true }, store, memory } as Record<string, unknown>
    const out = await runRecipe("t-blasts", body as any, engineEmit as any)
    expect(out).toMatchObject({ ok: true, version: 2 })
    expect(calls.map((c) => c[0])).toEqual(["recipe.run", "recipe.run", "recipe.run", "recipe.broken", "recall", "recipe.run", "recipe.repaired", "memory.saved"])
    expect(calls[0][1]).toBe("recipe:t-event")
    expect(calls[2][1]).toBe("recipe:t-blasts")
    expect((out.result as any[])[0].id).toBe("b1-evt-my-event")
    expect(hits).toContain("/event/get-blasts?event_api_id=evt-my-event")
  })

  test("recalled candidate on another declared host does not get the main request's cookie", async () => {
    const def = blasts([])
    def.request.headers = { cookie: "{{env.QUORUM_TEST_COOKIE}}" }
    def.discover.http = { candidates: [{ request: { method: "GET", url: `http://localhost:${server.port}/never?event_api_id={{eventApiId}}` } }] }
    await useDef(def)
    const note = `- new endpoint: GET http://localhost:${server.port}/event/get-blasts?event_api_id={{eventApiId}}`
    const mem: Memory = { put: memory.put, search: async () => [{ slug: "recipes/t-blasts-v3", score: 1, snippet: note }] }
    process.env.QUORUM_TEST_COOKIE = "session=secret"
    try {
      const out = await runRecipe("t-blasts", ctx({ memory: mem }), emit)
      expect(out).toMatchObject({ ok: true, version: 2 })
      expect(store.current("t-blasts").request.headers).toBeUndefined()
    } finally { delete process.env.QUORUM_TEST_COOKIE }
  })

  test("memory: null is reported, never silently skipped", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    await runRecipe("t-blasts", ctx({ memory: null }), emit)
    expect(events.at(-1)).toMatchObject({ type: "error", actor: "gbrain" })
  })

  test("aside discover: probes from the logged-in page are verified; the event id is turned back into {{eventApiId}}", async () => {
    await useDef(blasts(["/missing"]))
    const scripts: string[] = []
    const aside: AsideRunner = async (script) => {
      scripts.push(script)
      const lines = [
        { url: `${base}/event/get-posts?event_api_id=evt-123`, status: 404, body: { message: "Not found." } },
        { url: `${base}/event/get-wrong?event_api_id=evt-123`, status: 200, body: { items: [] } },
        { url: `${base}/event/get-blasts?event_api_id=evt-123`, status: 200, body: { entries: [{ api_id: "x", message: "<p>hi</p>" }] } },
      ]
      return { code: 0, stdout: "noise\n" + lines.map((l) => RESULT_PREFIX + JSON.stringify(l)).join("\n"), stderr: "" }
    }
    const out = await runRecipe("t-blasts", ctx({ aside }), emit)
    expect(out).toMatchObject({ ok: true, version: 2 })
    expect(scripts[0]).toContain(`${base}/my-event`)
    expect(scripts[0]).toContain(`${base}/event/get-posts?event_api_id=evt-123`)
    expect(store.current("t-blasts").request.url).toBe(`${base}/event/get-blasts?event_api_id={{eventApiId}}`)
    const repaired = events.find((e) => e.type === "recipe.repaired")!
    expect(repaired.data).toMatchObject({ via: "aside" })
    expect(events.filter((e) => e.actor === "aside" && e.type === "recipe.run").length).toBe(3)
  })

  test("aside binary failing (/usr/bin/false) is surfaced as an aside error event", async () => {
    await useDef(blasts(["/missing"]))
    const out = await runRecipe("t-blasts", ctx({ aside: asideRunner({ bin: "/usr/bin/false", account: "test" }) }), emit)
    expect(out.ok).toBe(false)
    const err = events.find((e) => e.type === "error" && e.actor === "aside")!
    expect(err.text).toContain("exit 1")
  })

  test("aside binary missing is classified as launch error", async () => {
    await useDef(blasts(["/missing"]))
    await runRecipe("t-blasts", ctx({ aside: asideRunner({ bin: join(dir, "no-such-aside"), account: "test" }) }), emit)
    const err = events.find((e) => e.type === "error" && e.actor === "aside")!
    expect(err.text).toMatch(/launch|exit/)
  })

  test("unknown recipe and missing vars are error events", async () => {
    await runRecipe("nope", ctx(), emit)
    expect(events[0]).toMatchObject({ type: "error" })
    events = []
    await useDef(blasts([]))
    const out = await runRecipe("t-blasts", ctx({ vars: { slug: "x" } }), emit)
    expect(out.ok).toBe(false)
    expect(types()).toEqual(["recipe.run", "error"])
    expect(events[1].text).toContain("eventApiId")
    expect(await runRecipe("../etc", ctx(), emit)).toMatchObject({ ok: false })
  })
})

describe("helpers", () => {
  test("templatize puts vars back; parseProbes skips noise", () => {
    expect(templatize("https://x/a?event_api_id=evt-123&u=my%20e", { eventApiId: "evt-123", slug: "my e" })).toBe("https://x/a?event_api_id={{eventApiId}}&u={{slug}}")
    expect(parseProbes(`\x1b[32mhi\x1b[0m\n${RESULT_PREFIX}{"url":"u","status":200}\n${RESULT_PREFIX}{bad`)).toEqual([{ url: "u", status: 200 }])
    // 정확히 같은 조각만: slug "event" 가 /event/ 경로를 바꾸지 않고, 짧은 값(2자)도 바꿔요
    expect(templatize("https://h/event/get-blasts?event_api_id=ab&x=event", { eventApiId: "ab", slug: "event" }, fixedSegments(["https://h/event/get-posts?event_api_id={{eventApiId}}"]))).toBe("https://h/event/get-blasts?event_api_id={{eventApiId}}&x={{slug}}")
    expect(templatize("https://h/e/my-event/posts", { slug: "my-event" })).toBe("https://h/e/{{slug}}/posts")
    expect(buildDiscoverScript("https://luma.com/x", "api2", ["https://api2/x"])).toContain("openTab")
  })

  test("store.list shows current version and health; real defs load", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    await runRecipe("t-blasts", ctx(), emit)
    expect(store.list()).toEqual([expect.objectContaining({ id: "t-blasts", version: 2, health: expect.objectContaining({ ok: true }) })])
    const real = new RecipeStore(new Database(":memory:"))
    expect(real.list().map((r) => [r.id, r.version])).toEqual([["luma-blasts", 1], ["luma-event", 1]])
    expect(real.current("luma-blasts").discover.http!.candidates[0].request.url).toContain("get-blasts")
  })

  test("watchRecipes repairs on its own tick and stops when the DB closes (board db-timers)", async () => {
    await useDef(blasts(["/event/get-blasts"]))
    const stop = watchRecipes(store, [{ id: "t-blasts", vars: { eventApiId: "evt-123", slug: "s" } }], 20, { memory }, emit)
    for (let i = 0; i < 50 && store.current("t-blasts").version < 2; i++) await Bun.sleep(10)
    stop()
    expect(store.current("t-blasts").version).toBe(2)
    expect(events.some((e) => e.type === "recipe.repaired")).toBe(true)
  })
})
