// Quorum HTTP API (기본 포트 4317). 계약: docs/contract.md
// 출처: board/apps/server/server.ts 의 json()/err() 응답 도우미(no-store), 경로를 parts 로 나눠 고르는 방식, 저장소 초기화 순서,
// 그리고 board runs.ts 의 "재시작 때 하는 중인 실행 닫기". 바꾼 점: 사람 인증 대신 이 맥 전용(기본 HOST 127.0.0.1)으로 열고,
// 실행 이벤트를 SSE 로 흘려요.
import { join, normalize } from "node:path"
import { PORT, type QuorumEvent } from "./contract"
import { Store } from "./engine/store"
import { RunManager } from "./engine/runs"
import { liveDeps } from "./engine/live"
import type { Emit } from "./engine/council"
import { localRequestAllowed } from "./engine/local-guard"
import { mcpHandler } from "./engine/mcp"
import { BoardClient } from "./executors/board"
import { ASIDE_BIN } from "./executors/aside"
import { CODEX_BIN } from "./executors/codex"
import { GBRAIN_BIN, searchMemory } from "./executors/gbrain"
import { createWorkspace } from "./workspace/api"
import { engineExecute } from "./workspace/council"

export const VERSION = "0.1.0"
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

export type Health = { aside: boolean; codex: boolean; gbrain: boolean; board: boolean }
export type RecipesModule = {
  listRecipes?: () => unknown
  runRecipe?: (id: string, ctx: Record<string, unknown>, emit: Emit) => Promise<unknown>
}

export type AppDeps = {
  store: Store
  runs: RunManager
  siteRoot: string
  health: () => Promise<Health>
  memory: (q: string) => Promise<unknown>
  recipes: () => Promise<RecipesModule | null>
  /** QUORUM_MCP_PROPOSE=1 일 때만 MCP 로 의회를 열 수 있어요 */
  mcpPropose?: boolean
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

export function createApp(d: AppDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const m = req.method
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] === "api" || parts[0] === "mcp") {
      if (!localRequestAllowed(req)) return err(403, "이 맥 안에서 온 요청만 받아요")
    }
    if (parts[0] === "mcp" && parts.length === 1) {
      return mcpHandler({ store: d.store, start: (request) => d.runs.start(request).runId, memory: d.memory, allowPropose: !!d.mcpPropose, version: VERSION }, req)
    }
    if (parts[0] !== "api") return serveStatic(d.siteRoot, url.pathname)
    if (parts[1] === "ws" && d.workspace) return d.workspace(req, parts)

    if (parts[1] === "health" && m === "GET") return json({ ok: true, version: VERSION, executors: await d.health() })

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
      const runRecipe = mod?.runRecipe
      if (!mod || !runRecipe) return err(501, "recipes lane not merged yet (src/recipes/index.ts runRecipe)")
      if (parts.length === 2 && m === "GET") return json(mod.listRecipes ? await mod.listRecipes() : [])
      if (parts.length === 4 && parts[3] === "run" && m === "POST") {
        const ctx = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>
        const recipeId = parts[2]
        const { runId } = d.runs.startCustom("recipe: " + recipeId, async (emit) => {
          emit("run.start", "recipe:" + recipeId, "레시피 실행: " + recipeId, { recipeId })
          await runRecipe(recipeId, ctx, emit)
          emit("run.end", "recipe:" + recipeId, "레시피가 끝났어요", { status: "done", recipeId })
          return "done"
        })
        return json({ runId }, 201)
      }
    }
    return err(404, "unknown route " + m + " " + url.pathname)
  }
}

async function loadRecipes(): Promise<RecipesModule | null> {
  const path = join(import.meta.dir, "recipes", "index.ts")
  if (!(await Bun.file(path).exists())) return null
  return (await import(path)) as RecipesModule
}

if (import.meta.main) {
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
  const app = createApp({
    store,
    runs,
    siteRoot: join(import.meta.dir, "..", "site"),
    health: cached(() => liveHealth(board), 15_000),
    memory: (q) => searchMemory(q, 10).then((hits) => hits.map((h) => ({ slug: h.slug, title: h.title, snippet: h.snippet, score: h.score }))),
    recipes: loadRecipes,
    mcpPropose: process.env.QUORUM_MCP_PROPOSE === "1",
    workspace: workspace.handle,
  })
  Bun.serve({ port: PORT, hostname: process.env.QUORUM_HOST || "127.0.0.1", idleTimeout: 255, fetch: app })
  console.log("quorum on http://localhost:" + PORT + " (board write " + (board.writeEnabled ? "on" : "off") + ")")
}
