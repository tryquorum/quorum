// Quorum HTTP API. 계약: docs/contract.md
// 리스너 두 개 (board/apps/server/server.ts 의 serve("local"|"public") 구조 그대로):
//   local  127.0.0.1:4317 (QUORUM_PORT) — 이 맥 안에서 온 요청만(local-guard, board auth.ts localRequestAllowed)
//   public 127.0.0.1:4318 (QUORUM_PUBLIC_PORT) — Cloudflare 터널 뒤 quorum.lidgeai.com. Access JWT 가 유효하고 ALLOWED_EMAILS 에 있는 사람만
//          /api·/mcp·정적 파일을 써요. 쓰기 요청은 PUBLIC_ORIGIN 에서 온 것만(publicCsrfAllowed). ACCESS_AUD·ALLOWED_EMAILS 가 없으면 열지 않아요.
// 출처: board server.ts 의 json()/err(), parts 라우팅, PUBLIC_PORT 검사·"public listener disabled" 처리, 공개 /api/health 예외, 재시작 정리(runs.ts initRuns).
import { join, normalize } from "node:path"
import { PORT, type QuorumEvent } from "./contract"
import { Store } from "./engine/store"
import { RunManager } from "./engine/runs"
import { liveDeps } from "./engine/live"
import type { Emit } from "./engine/council"
import { localRequestAllowed } from "./engine/local-guard"
import { createAccess, parseAllowed, publicCsrfAllowed, type User } from "./engine/access"
import { mcpHandler } from "./engine/mcp"
import { BoardClient } from "./executors/board"
import { ASIDE_BIN } from "./executors/aside"
import { CODEX_BIN } from "./executors/codex"
import { GBRAIN_BIN, searchMemory } from "./executors/gbrain"
import { asideRunner, listRecipes, runRecipe } from "./recipes"
import { createWorkspace } from "./workspace/api"
import { engineExecute } from "./workspace/council"

export const VERSION = "0.2.0"
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export type Listener = "local" | "public"
export type Health = { aside: boolean; codex: boolean; gbrain: boolean; board: boolean }
export type RecipesModule = {
  listRecipes: () => unknown
  runRecipe: (id: string, vars: Record<string, string>, emit: Emit) => Promise<{ ok?: boolean; reason?: string } | unknown>
}
export type PublicAuth = { who: (req: Request) => Promise<User | null>; origin: string }

export type AppDeps = {
  store: Store
  runs: RunManager
  siteRoot: string
  health: () => Promise<Health>
  memory: (q: string) => Promise<unknown>
  recipes: () => Promise<RecipesModule | null>
  /** QUORUM_MCP_PROPOSE=1 일 때만 MCP 로 의회를 열 수 있어요 */
  mcpPropose?: boolean
  /** 로컬 리스너의 /api/me 이메일(QUORUM_LOCAL_USER). 없으면 null */
  localUser?: string | null
  /** Workspace(/api/ws/*). src/workspace/api.ts */
  workspace?: (req: Request, parts: string[]) => Promise<Response>
}

export async function liveHealth(board: BoardClient): Promise<Health> {
  const [aside, boardOk] = await Promise.all([Bun.file(ASIDE_BIN).exists(), board.available().catch(() => false)])
  return { aside, codex: Bun.which(CODEX_BIN) !== null, gbrain: Bun.which(GBRAIN_BIN) !== null, board: boardOk }
}

function cached<T>(fn: () => Promise<T>, ms: number): () => Promise<T> {
  let at = 0
  let value: Promise<T> | null = null
  return () => {
    if (!value || Date.now() - at > ms) { at = Date.now(); value = fn() }
    return value
  }
}

async function serveStatic(siteRoot: string, pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname === "/app" ? "app.html" : pathname === "/w" ? "workspace.html" : pathname.slice(1)
  const full = normalize(join(siteRoot, rel))
  if (!full.startsWith(siteRoot)) return new Response("forbidden", { status: 403 })
  const file = Bun.file(full)
  return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 })
}

function sse(d: AppDeps, runId: string, afterSeq: number): Response {
  let unsub = () => {}
  let ka: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const enc = new TextEncoder()
      let closed = false
      const send = (s: string) => { if (!closed) ctrl.enqueue(enc.encode(s)) }
      const close = () => {
        if (closed) return
        send("event: done\ndata: {}\n\n")
        closed = true
        if (ka) clearInterval(ka)
        unsub()
        ctrl.close()
      }
      let last = afterSeq
      const push = (e: QuorumEvent) => {
        if (e.seq <= last) return
        last = e.seq
        send("id: " + e.seq + "\ndata: " + JSON.stringify(e) + "\n\n")
      }
      // 구독을 먼저 걸고 저장된 이벤트를 보내요(겹치는 이벤트는 seq 로 걸러서 빠지거나 두 번 가지 않아요)
      const live = d.runs.isLive(runId)
      if (live) unsub = d.runs.subscribe(runId, (e) => (e ? push(e) : close()))
      for (const e of d.store.getEvents(runId, last)) push(e)
      if (!live) return close()
      ka = setInterval(() => send(": keepalive\n\n"), 10_000)
    },
    cancel() {
      if (ka) clearInterval(ka)
      unsub()
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" } })
}

/** 레시피 POST 본문에서 vars 만 꺼내요(함수·저장소 같은 ctx 값은 본문으로 받지 않아요) */
function recipeVars(body: Record<string, unknown>): Record<string, string> {
  const src = body.vars && typeof body.vars === "object" && !Array.isArray(body.vars) ? (body.vars as Record<string, unknown>) : body
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) if (typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(k)) out[k] = v.slice(0, 400)
  return out
}

const LANDING_FILES = new Set(["/", "/index.html", "/og.png", "/og.svg", "/favicon.svg"])
const LANDING_DIRS = ["/assets/", "/logos/", "/fixtures/", "/media/"]
/** 공개 리스너에서 로그인 없이 줄 수 있는 랜딩 파일인지. 읽기(GET/HEAD)만 */
export function isPublicLanding(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false
  if (pathname.includes("..")) return false
  return LANDING_FILES.has(pathname) || LANDING_DIRS.some((dir) => pathname.startsWith(dir))
}

export function createApp(d: AppDeps, listener: Listener = "local", pub?: PublicAuth): (req: Request) => Promise<Response> {
  if (listener === "public" && !pub) throw new Error("public listener needs Access auth")
  return async (req) => {
    const url = new URL(req.url)
    const m = req.method
    const parts = url.pathname.split("/").filter(Boolean)
    const guarded = parts[0] === "api" || parts[0] === "mcp"

    let user: User | null
    if (listener === "local") {
      if (guarded && !localRequestAllowed(req)) return err(403, "이 맥 안에서 온 요청만 받아요")
      user = d.localUser ? { email: d.localUser } : null
    } else {
      const p = pub as PublicAuth // justified: checked when the app was created
      if (!publicCsrfAllowed(req, p.origin)) return err(403, "origin not allowed")
      user = await p.who(req)
      if (!user) {
        // 터널 상태 확인용으로 health 만 열어 두되, 실행기 상태는 로그인한 사람에게만 보여요 (board 공개 리스너와 같음)
        if (url.pathname === "/api/health" && m === "GET") return json({ ok: true, version: VERSION })
        // 랜딩(소개 페이지)과 그 정적 파일은 로그인 없이 보여요. Workspace(/w)·콘솔(/app)·API·MCP 는 로그인한 사람만
        if (isPublicLanding(m, url.pathname)) return serveStatic(d.siteRoot, url.pathname)
        return guarded ? err(401, "login required (Cloudflare Access)") : new Response("login required", { status: 401 })
      }
    }

    if (parts[0] === "mcp" && parts.length === 1) {
      return mcpHandler({ store: d.store, start: (request) => d.runs.start(request).runId, memory: d.memory, allowPropose: !!d.mcpPropose, version: VERSION }, req)
    }
    if (parts[0] !== "api") return serveStatic(d.siteRoot, url.pathname)
    if (parts[1] === "ws" && d.workspace) return d.workspace(req, parts)

    if (parts[1] === "health" && m === "GET") return json({ ok: true, version: VERSION, executors: await d.health() })
    if (parts[1] === "me" && parts.length === 2 && m === "GET") return json({ email: user?.email ?? null, listener })

    if (parts[1] === "runs") {
      if (parts.length === 2 && m === "GET") return json(d.store.listRuns(Math.min(200, Number(url.searchParams.get("limit")) || 50)))
      if (parts.length === 2 && m === "POST") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
        if (!body) return err(400, "JSON body required")
        if (body.mode === "replay") {
          const replayId = str(body.replayId, 80)
          if (!replayId) return err(400, "replayId required for replay")
          const r = d.runs.replay(replayId)
          return "error" in r ? err(r.status, r.error) : json({ runId: r.runId, mode: "replay", replayOf: replayId }, 201)
        }
        if (body.mode !== undefined && body.mode !== "live") return err(400, "mode must be live or replay")
        const request = str(body.request, 4000)
        if (!request) return err(400, "request required")
        return json({ runId: d.runs.start(request).runId, mode: "live" }, 201)
      }
      const run = parts[2] ? d.store.getRun(parts[2]) : null
      if (parts.length >= 3 && !run) return err(404, "run not found")
      if (run && parts.length === 3 && m === "GET") return json({ ...run, events: d.store.getEvents(run.runId) })
      if (run && parts.length === 4 && parts[3] === "events" && m === "GET") {
        const lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? -1)
        return sse(d, run.runId, Number.isFinite(lastId) ? lastId : -1)
      }
    }

    if (parts[1] === "memory" && m === "GET") {
      const q = str(url.searchParams.get("q"), 200)
      if (!q) return err(400, "q required")
      try { return json({ q, results: await d.memory(q) }) } catch (e) { return err(502, "gbrain: " + (e instanceof Error ? e.message : String(e))) }
    }

    if (parts[1] === "recipes") {
      const mod = await d.recipes()
      if (!mod) return err(501, "recipes are not available")
      if (parts.length === 2 && m === "GET") return json(await mod.listRecipes())
      if (parts.length === 4 && parts[3] === "run" && m === "POST") {
        const recipeId = parts[2]
        if (!/^[a-z0-9-]{1,60}$/.test(recipeId)) return err(400, "recipe id must be [a-z0-9-]")
        const vars = recipeVars(((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>)
        const { runId } = d.runs.startCustom("recipe: " + recipeId, async (emit) => {
          emit("run.start", "recipe:" + recipeId, "레시피 실행: " + recipeId, { recipeId })
          const out = (await mod.runRecipe(recipeId, vars, emit)) as { ok?: boolean; reason?: string } | undefined
          const ok = out?.ok !== false
          emit("run.end", "recipe:" + recipeId, ok ? "레시피가 끝났어요" : "레시피가 실패했어요: " + (out?.reason || ""), { status: ok ? "done" : "error", recipeId })
          return ok ? "done" : "error"
        })
        return json({ runId }, 201)
      }
    }
    return err(404, "unknown route " + m + " " + url.pathname)
  }
}

/** 실제 레시피 레인(src/recipes). 이 맥에서는 Aside 로 수리할 수 있게 asideRunner 를 넘겨요(QUORUM_RECIPE_ASIDE=0 이면 끔) */
export const liveRecipes: RecipesModule = {
  listRecipes: () => listRecipes(),
  runRecipe: (id, vars, emit) => runRecipe(id, { vars, aside: process.env.QUORUM_RECIPE_ASIDE === "0" ? null : asideRunner() }, emit),
}

/** 공개 포트: 빈 값이면 끔, 기본 4318. 잘못된 값이면 어떤 리스너도 열지 않고 끝내요 (board PUBLIC_PORT 검사와 같음) */
export function publicPortFrom(raw: string | undefined, localPort: number): number | null | "invalid" {
  const v = raw === undefined ? "4318" : raw.trim()
  if (v === "") return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 65535 && n !== localPort ? n : "invalid"
}

if (import.meta.main) {
  const publicPort = publicPortFrom(process.env.QUORUM_PUBLIC_PORT, PORT)
  if (publicPort === "invalid") {
    console.error("[quorum] QUORUM_PUBLIC_PORT must be a valid port different from QUORUM_PORT")
    process.exit(1)
  }
  const stateDir = process.env.QUORUM_STATE_DIR || join(import.meta.dir, "..", ".quorum")
  const store = new Store(join(stateDir, "quorum.db"))
  const interrupted = store.interruptRunning(new Date().toISOString())
  if (interrupted.length) console.log("[quorum] closed " + interrupted.length + " interrupted run(s)")
  const board = new BoardClient()
  const runs = new RunManager(store, liveDeps(stateDir, board))
  const engineDeps = liveDeps(stateDir, board)
  const boardBase = process.env.QUORUM_BOARD_IMPORT === "0" ? undefined : process.env.QUORUM_BOARD_IMPORT_URL || "http://127.0.0.1:3070"
  const workspace = createWorkspace({ path: join(stateDir, "workspace.db"), engine: store, execute: engineExecute(runs, (id) => engineDeps(id).executors), boardBase })
  workspace.board?.start()
  const deps: AppDeps = {
    store,
    runs,
    siteRoot: join(import.meta.dir, "..", "site"),
    health: cached(() => liveHealth(board), 15_000),
    memory: (q) => searchMemory(q, 10).then((hits) => hits.map((h) => ({ slug: h.slug, title: h.title, snippet: h.snippet, score: h.score }))),
    recipes: async () => liveRecipes,
    mcpPropose: process.env.QUORUM_MCP_PROPOSE === "1",
    localUser: process.env.QUORUM_LOCAL_USER || null,
    workspace: workspace.handle,
  }
  Bun.serve({ port: PORT, hostname: process.env.QUORUM_HOST || "127.0.0.1", idleTimeout: 255, fetch: createApp(deps, "local") })
  console.log("quorum on http://localhost:" + PORT + " (board write " + (board.writeEnabled ? "on" : "off") + ")")
  if (publicPort !== null) {
    const aud = (process.env.ACCESS_AUD || "").trim()
    const allowed = parseAllowed(process.env.ALLOWED_EMAILS)
    if (!aud || !allowed.length) console.error("[quorum] public listener disabled: ACCESS_AUD and ALLOWED_EMAILS are required")
    else {
      const access = createAccess({ team: process.env.ACCESS_TEAM || "lidgeai.cloudflareaccess.com", aud, allowed })
      const origin = process.env.PUBLIC_ORIGIN || "https://quorum.lidgeai.com"
      try {
        Bun.serve({ port: publicPort, hostname: "127.0.0.1", idleTimeout: 255, fetch: createApp(deps, "public", { who: access.who, origin }) })
        console.log("[quorum] public listener on 127.0.0.1:" + publicPort + " for " + origin + " (" + allowed.length + " allowed)")
      } catch (e) {
        console.error("[quorum] public listener failed:", e)
      }
    }
  }
}
