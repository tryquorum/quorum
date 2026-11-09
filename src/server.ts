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
import { INSTALL_HINTS, liveDeps } from "./engine/live"
import type { Emit } from "./engine/council"
import { localRequestAllowed } from "./engine/local-guard"
import { createAccess, isAllowed, parseAllowed, publicCsrfAllowed, type User } from "./engine/access"
import { mcpHandler } from "./engine/mcp"
import { BoardClient } from "./executors/board"
import { ASIDE_BIN, resolveAsideAccount, type AsideAccount } from "./executors/aside"
import { CODEX_BIN } from "./executors/codex"
import { GBRAIN_BIN, searchMemory } from "./executors/gbrain"
import { asideRunner, listRecipes, runRecipe } from "./recipes"
import { createWorkspace } from "./workspace/api"
import { engineExecute } from "./workspace/council"
import { createTenants, tenantFrom, type Tenant, type TenantRegistry } from "./hosted/tenants"
import { openHosted, type Hosted } from "./hosted/hosted"
import { makeGuestTenant } from "./hosted/guest"
import { modelFromEnv } from "./hosted/model"
import { ACTIVE_LIMIT, cleanName, sameOriginMutation } from "./hosted/tokens"

export const VERSION = "0.2.0"
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export type Listener = "local" | "public"
export type HealthDetail = { ok: boolean; hint?: string; reason?: string | null; account?: string | null; email?: string | null }
export type Health = { aside: boolean; codex: boolean; gbrain: boolean; board: boolean; details?: Record<string, HealthDetail> }
export type RecipesModule = {
  listRecipes: () => unknown
  runRecipe: (id: string, vars: Record<string, string>, emit: Emit) => Promise<{ ok?: boolean; reason?: string } | unknown>
}
/** allowed: 연결 토큰 주인이 지금도 ALLOWED_EMAILS 에 있는지(토큰은 Access 를 거치지 않아서 매번 다시 봐요) */
export type PublicAuth = { who: (req: Request) => Promise<User | null>; origin: string; allowed?: (email: string) => boolean }

/** 공개 리스너 제한. 본문은 64KB(가장 큰 것: 노트 50,000자), 사람마다 1분에 API 600번·MCP 240번, 틀린 Bearer 는 주소마다 1분에 30번 */
export const PUBLIC_LIMITS = { bodyBytes: 64 * 1024, apiPerMin: 600, mcpPerMin: 240, badBearerPerMin: 30 }

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
  workspace?: (req: Request, parts: string[], me?: string | null) => Promise<Response>
  /** 사람마다 저장소를 나눠요(src/hosted/tenants.ts). 없으면 모두 위의 store·runs 하나를 써요 */
  tenants?: TenantRegistry
  /** 연결 토큰·감사 기록·속도 제한(src/hosted/hosted.ts). 공개 리스너에서 /mcp Bearer 와 /api/mcp-tokens 를 켜요 */
  hosted?: Hosted
}

export type HealthProbe = { asideBin: () => Promise<boolean>; account: () => Promise<AsideAccount>; which: (name: string) => string | null }
const realProbe: HealthProbe = { asideBin: () => Bun.file(ASIDE_BIN).exists(), account: () => resolveAsideAccount(), which: (n) => Bun.which(n) }

/** 실행기마다 쓸 수 있는지와, 꺼져 있으면 왜 그런지·어떻게 켜는지(화면의 연결 카드가 그대로 보여 줘요) */
export async function liveHealth(board: Pick<BoardClient, "available">, probe: HealthProbe = realProbe): Promise<Health & { details: Record<string, HealthDetail> }> {
  const [bin, boardOk] = await Promise.all([probe.asideBin(), board.available().catch(() => false)])
  const acct: AsideAccount = bin ? await probe.account() : { account: null, email: null, source: "none", reason: "The Aside CLI is not at " + ASIDE_BIN + ". Install Aside from https://aside.com and sign in (or set ASIDE_BIN)" }
  const codex = probe.which(CODEX_BIN) !== null
  const gbrain = probe.which(GBRAIN_BIN) !== null
  const aside = bin && !!acct.account
  return {
    aside, codex, gbrain, board: boardOk,
    details: {
      aside: { ok: aside, account: acct.account, email: acct.email, reason: acct.reason },
      codex: codex ? { ok: true } : { ok: false, hint: INSTALL_HINTS.codex },
      gbrain: gbrain ? { ok: true } : { ok: false, hint: INSTALL_HINTS.gbrain },
      board: boardOk ? { ok: true } : { ok: false, hint: INSTALL_HINTS.board },
    },
  }
}

/** 방향판(3070) Workspace 가져오기는 QUORUM_BOARD_IMPORT_URL 이 있을 때만 켜요. QUORUM_BOARD_IMPORT=0 이면 꺼요 */
export function boardImportBase(env: Record<string, string | undefined>): string | undefined {
  if (env.QUORUM_BOARD_IMPORT === "0") return undefined
  return env.QUORUM_BOARD_IMPORT_URL?.trim() || undefined
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

function sse(d: Pick<Tenant, "store" | "runs">, runId: string, afterSeq: number): Response {
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
  // 테넌트 레지스트리가 없으면(옛 시험·단일 사용자) 모든 요청이 하나의 소유자 저장소를 써요
  const single: Tenant = tenantFrom({ email: d.localUser ?? null, role: "owner", store: d.store, runs: d.runs, workspace: d.workspace, memory: d.memory, recipes: d.recipes, health: d.health, mcpPropose: !!d.mcpPropose })
  const pick = (user: User | null) => (d.tenants ? d.tenants.resolve(user, listener) : single)
  return async (req) => {
    const url = new URL(req.url)
    const m = req.method
    const parts = url.pathname.split("/").filter(Boolean)
    const guarded = parts[0] === "api" || parts[0] === "mcp"

    let user: User | null
    let viaToken = false
    if (listener === "local") {
      if (guarded && !localRequestAllowed(req)) return err(403, "이 맥 안에서 온 요청만 받아요")
      user = d.localUser ? { email: d.localUser } : null
    } else {
      const p = pub as PublicAuth // justified: checked when the app was created
      if (!publicCsrfAllowed(req, p.origin)) return err(403, "origin not allowed")
      // 본문을 읽기 전에 크기부터 봐요(Bun.serve 의 maxRequestBodySize 와 같은 상한)
      // 길이 머리글이 없으면(chunked) 복사본을 읽어 재요. Bun.serve 의 maxRequestBodySize 가 그 위 상한이에요
      const declared = Number(req.headers.get("content-length") || 0)
      const size = declared || (req.body && !["GET", "HEAD"].includes(m) ? (await req.clone().arrayBuffer()).byteLength : 0)
      if (size > PUBLIC_LIMITS.bodyBytes) return err(413, "request body too large")
      const auth = req.headers.get("authorization")
      if (parts[0] === "mcp" && auth !== null) {
        // /mcp 만 연결 토큰을 받아요. 토큰이 틀리면 Access 로그인이 있어도 들여보내지 않아요(섞어 쓰지 않기)
        const ip = req.headers.get("cf-connecting-ip") || "unknown"
        const secret = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? ""
        const found = d.hosted && secret ? d.hosted.tokens.authenticate(secret) : null
        if (!found || !(p.allowed ? p.allowed(found.owner) : false)) {
          if (d.hosted && !d.hosted.limiter.take("badbearer:" + ip, PUBLIC_LIMITS.badBearerPerMin, 60_000)) return err(429, "too many failed attempts; wait a minute")
          d.hosted?.audit(found?.owner ?? null, "mcp.auth_fail", found ? "token owner no longer allowed" : "unknown or revoked token")
          return err(401, "invalid or revoked connection token")
        }
        user = { email: found.owner }
        viaToken = true
      } else user = await p.who(req)
      if (!user) {
        // 터널 상태 확인용으로 health 만 열어 두되, 실행기 상태는 로그인한 사람에게만 보여요 (board 공개 리스너와 같음)
        if (url.pathname === "/api/health" && m === "GET") return json({ ok: true, version: VERSION })
        // 랜딩(소개 페이지)과 그 정적 파일은 로그인 없이 보여요. Workspace(/w)·콘솔(/app)·API·MCP 는 로그인한 사람만
        if (isPublicLanding(m, url.pathname)) return serveStatic(d.siteRoot, url.pathname)
        return guarded ? err(401, "login required (Cloudflare Access)") : new Response("login required", { status: 401 })
      }
      // /mcp 는 배치 안의 호출 수만큼 mcpHandler 가 charge 로 세요
      if (d.hosted && guarded && parts[0] !== "mcp" && !d.hosted.limiter.take("api:" + user.email, PUBLIC_LIMITS.apiPerMin, 60_000)) {
        return err(429, "too many requests; slow down")
      }
    }
    if (!guarded) return serveStatic(d.siteRoot, url.pathname)

    const picked = pick(user)
    if (!("store" in picked)) return err(picked.status, picked.error)
    const t: Tenant = picked
    const guest = t.role === "guest"

    if (parts[0] === "mcp") {
      if (parts.length !== 1) return err(404, "unknown route " + m + " " + url.pathname)
      const h = listener === "public" ? d.hosted : undefined
      const email = user?.email ?? ""
      const secret = viaToken ? /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1] ?? "" : ""
      const p = pub as PublicAuth
      return mcpHandler({
        store: t.store, start: (request) => { const r = t.start(request); if ("error" in r) throw new Error(r.error); return r.runId }, memory: t.memory, allowPropose: t.mcpPropose, version: VERSION,
        ...(t.queue ? { queue: t.queue } : {}),
        ...(h ? { charge: (n: number) => { for (let i = 0; i < n; i++) if (!h.limiter.take("mcp:" + email, PUBLIC_LIMITS.mcpPerMin, 60_000)) return false; return true } } : {}),
        // 토큰으로 들어온 요청은 기다린 뒤 일을 넘기기 직전에 토큰·허용 목록을 다시 봐요(기다리는 사이 폐기될 수 있어요)
        ...(h && viaToken ? { stillAllowed: () => { const f = h.tokens.authenticate(secret); return !!f && f.owner === email && (p.allowed ? p.allowed(email) : false) } } : {}),
      }, req)
    }
    if (parts[1] === "ws" && t.workspace) return t.workspace(req, parts, user?.email ?? null)

    if (parts[1] === "mcp-tokens") {
      // 연결 토큰은 공개 리스너에서 Access 로 로그인한 사람이 자기 것만 다뤄요(토큰으로 토큰을 만들 수 없어요)
      if (listener !== "public" || !d.hosted || !user || viaToken) return err(403, "connection tokens are managed on the hosted site after login")
      const h = d.hosted
      const email = user.email
      if (m !== "GET" && !sameOriginMutation(req, (pub as PublicAuth).origin)) return err(403, "origin not allowed")
      if (parts.length === 2 && m === "GET") return json(h.tokens.list(email))
      if (parts.length === 2 && m === "POST") {
        const b = (await req.json().catch(() => null)) as { name?: unknown } | null
        const name = cleanName(b?.name)
        if (!name) return err(400, "name must be 1-40 characters without control characters")
        const made = h.tokens.create(email, name)
        if (!made) return err(409, "at most " + ACTIVE_LIMIT + " active tokens; revoke one first")
        h.audit(email, "token.create", "id " + made.token.id + " name " + name)
        return json(made, 201)
      }
      if (parts.length === 3 && m === "DELETE") {
        const id = /^[a-f0-9]{16}$/.test(parts[2]) ? parts[2] : ""
        const token = id ? h.tokens.revoke(email, id) : null
        if (!token) return err(404, "token not found")
        h.audit(email, "token.revoke", "id " + id)
        return json({ token })
      }
      return err(405, "method not allowed")
    }
    if (parts[1] === "audit" && parts.length === 2 && m === "GET") {
      if (!d.hosted || !user) return json([])
      return json(d.hosted.auditFor(user.email, Number(url.searchParams.get("limit")) || 100))
    }

    if (parts[1] === "health" && m === "GET") {
      const { details, mode, ...executors } = await t.health()
      return json({ ok: true, version: VERSION, executors, ...(details ? { details } : {}), ...(mode ? { mode } : {}) })
    }
    if (parts[1] === "me" && parts.length === 2 && m === "GET") return json({ email: user?.email ?? null, listener, role: t.role })

    if (parts[1] === "runs") {
      if (parts.length === 2 && m === "GET") return json(t.store.listRuns(Math.min(200, Number(url.searchParams.get("limit")) || 50)))
      if (parts.length === 2 && m === "POST") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
        if (!body) return err(400, "JSON body required")
        if (body.mode === "replay") {
          // 다시 틀기는 의회 제한 밖이라 비소유자는 쓸 수 없어요(자원 소모·Workspace 창 밀어내기 방지)
          if (guest) return err(403, "replays are only for the host on the hosted site")
          const replayId = str(body.replayId, 80)
          if (!replayId) return err(400, "replayId required for replay")
          const r = t.runs.replay(replayId)
          return "error" in r ? err(r.status, r.error) : json({ runId: r.runId, mode: "replay", replayOf: replayId }, 201)
        }
        if (body.mode !== undefined && body.mode !== "live") return err(400, "mode must be live or replay")
        const request = str(body.request, 4000)
        if (!request) return err(400, "request required")
        const r = t.start(request)
        return "error" in r ? err(r.status, r.error) : json({ runId: r.runId, mode: "live" }, 201)
      }
      const run = parts[2] ? t.store.getRun(parts[2]) : null
      if (parts.length >= 3 && !run) return err(404, "run not found")
      if (run && parts.length === 3 && m === "GET") return json({ ...run, events: t.store.getEvents(run.runId) })
      if (run && parts.length === 4 && parts[3] === "events" && m === "GET") {
        const lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? -1)
        return sse(t, run.runId, Number.isFinite(lastId) ? lastId : -1)
      }
    }

    if (parts[1] === "memory" && m === "GET") {
      const q = str(url.searchParams.get("q"), 200)
      if (!q) return err(400, "q required")
      try { return json({ q, results: await t.memory(q) }) } catch (e) { return err(502, "memory: " + (e instanceof Error ? e.message : String(e))) }
    }

    if (parts[1] === "recipes") {
      // 레시피는 소유자 맥의 Aside 로 깨진 API 를 고쳐요. 비소유자는 목록이 비고 실행할 수 없어요
      if (guest) return parts.length === 2 && m === "GET" ? json([]) : err(403, "recipes run on the host's Mac and are only for its owner")
      const mod = await t.recipes()
      if (!mod) return err(501, "recipes are not available")
      if (parts.length === 2 && m === "GET") return json(await mod.listRecipes())
      if (parts.length === 4 && parts[3] === "run" && m === "POST") {
        const recipeId = parts[2]
        if (!/^[a-z0-9-]{1,60}$/.test(recipeId)) return err(400, "recipe id must be [a-z0-9-]")
        const vars = recipeVars(((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>)
        const { runId } = t.runs.startCustom("recipe: " + recipeId, async (emit) => {
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
  runRecipe: async (id, vars, emit) => {
    if (process.env.QUORUM_RECIPE_ASIDE === "0") return runRecipe(id, { vars, aside: null }, emit)
    // 레시피 수리도 감지한 Aside 계정으로. 계정이 없으면 Aside 없이 돌려요(수리만 못 해요)
    const acct = await resolveAsideAccount()
    return runRecipe(id, { vars, aside: acct.account ? asideRunner({ account: acct.account }) : null }, emit)
  },
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
  const boardBase = boardImportBase(process.env)
  const workspace = createWorkspace({ path: join(stateDir, "workspace.db"), engine: store, execute: engineExecute(runs, (id) => engineDeps(id).executors), boardBase, demo: process.env.QUORUM_DEMO_ITEM !== "0" })
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
  // 호스팅: 로그인한 사람마다 자기 저장소. 소유자(QUORUM_OWNER_EMAIL)만 위의 저장소·이 맥 실행기를 써요
  const ownerEmail = (process.env.QUORUM_OWNER_EMAIL || "").trim().toLowerCase() || null
  const hosted = openHosted(join(stateDir, "hosted.db"))
  const guestBots = process.env.QUORUM_GUEST_BOTS === "api" ? "api" : "client"
  const guestModel = modelFromEnv(process.env)
  if (guestBots === "api" && !guestModel) console.error("[quorum] QUORUM_GUEST_BOTS=api but QUORUM_GUEST_MODEL_URL/_KEY/QUORUM_GUEST_MODEL are missing: guest councils will fail until they are set")
  const ownerTenant = tenantFrom({ email: ownerEmail ?? deps.localUser ?? null, role: "owner", store, runs, workspace: workspace.handle, memory: deps.memory, recipes: deps.recipes, health: deps.health, mcpPropose: !!deps.mcpPropose })
  deps.tenants = createTenants({
    owner: ownerTenant,
    ownerEmail,
    maxGuests: Number(process.env.QUORUM_MAX_GUESTS) || 200,
    makeGuest: (email, key) => makeGuestTenant({ email, key, dir: join(stateDir, "tenants", key), hosted, bots: guestBots, model: guestModel, councilsPerHour: Number(process.env.QUORUM_GUEST_COUNCILS_PER_HOUR) || 5 }),
  })
  deps.hosted = hosted
  Bun.serve({ port: PORT, hostname: process.env.QUORUM_HOST || "127.0.0.1", idleTimeout: 255, fetch: createApp(deps, "local") })
  console.log("quorum on http://localhost:" + PORT + " (board write " + (board.writeEnabled ? "on" : "off") + ")")
  // bun run dev -- --open (또는 QUORUM_OPEN=1): 브라우저로 Workspace 를 열어요
  if (process.argv.includes("--open") || process.env.QUORUM_OPEN === "1") {
    const url = "http://localhost:" + PORT + "/w"
    const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url]
    try { Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }) } catch (e) { console.error("[quorum] could not open a browser:", e) }
  }
  if (publicPort !== null) {
    const aud = (process.env.ACCESS_AUD || "").trim()
    const allowed = parseAllowed(process.env.ALLOWED_EMAILS)
    if (!aud || !allowed.length) console.error("[quorum] public listener disabled: ACCESS_AUD and ALLOWED_EMAILS are required")
    else {
      const access = createAccess({ team: process.env.ACCESS_TEAM || "lidgeai.cloudflareaccess.com", aud, allowed })
      const origin = process.env.PUBLIC_ORIGIN || "https://quorum.lidgeai.com"
      try {
        Bun.serve({ port: publicPort, hostname: "127.0.0.1", idleTimeout: 255, maxRequestBodySize: 1024 * 1024, fetch: createApp(deps, "public", { who: access.who, origin, allowed: (e) => isAllowed(e, allowed) }) })
        console.log("[quorum] public listener on 127.0.0.1:" + publicPort + " for " + origin + " (" + allowed.length + " allowed, owner " + (ownerEmail ? "set" : "NOT set: everyone is a guest") + ", guest bots " + guestBots + ")")
      } catch (e) {
        console.error("[quorum] public listener failed:", e)
      }
    }
  }
}
