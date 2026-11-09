import { describe, expect, test } from "bun:test"
import { Store } from "./store"
import { RunManager } from "./runs"
import { createApp } from "../server"
import { localRequestAllowed } from "./local-guard"
import type { CouncilDeps } from "./council"

const deps = (): CouncilDeps => ({
  ask: async (actor) => actor === "bot:scout"
    ? JSON.stringify({ proposals: [{ title: "공지 읽고 정리", executor: "aside", why: "w", task: "t" }] })
    : actor.startsWith("bot:") && ["bot:builder", "bot:keeper"].includes(actor) ? JSON.stringify({ proposals: [] }) : JSON.stringify({ critiques: [{ proposalId: "p1", stance: "keep", reason: "ok" }] }),
  executors: { aside: async () => ({ summary: "정리 끝" }) },
})

function make(mcpPropose = false) {
  const store = new Store(":memory:")
  const runs = new RunManager(store, deps, { sleep: async () => {} })
  const app = createApp({ store, runs, siteRoot: "/nonexistent", health: async () => ({ aside: true, codex: true, gbrain: true, board: true }), memory: async (q) => [{ q }], recipes: async () => null, mcpPropose })
  const rpc = async (body: unknown, extra: Record<string, string> = {}) =>
    app(new Request("http://localhost:4317/mcp", { method: "POST", headers: { host: "localhost:4317", "content-type": "application/json", ...extra }, body: JSON.stringify(body) }))
  return { store, runs, app, rpc }
}
const req = (method: string, headers: Record<string, string>) => new Request("http://localhost:4317/api/runs", { method, headers })

describe("local request guard (board auth.ts localRequestAllowed)", () => {
  test("allows same-machine callers, including the Vite dev origin and CLI without Origin", () => {
    expect(localRequestAllowed(req("POST", { host: "localhost:4317" }))).toBe(true)
    expect(localRequestAllowed(req("POST", { host: "127.0.0.1:4317", origin: "http://localhost:5173" }))).toBe(true)
    expect(localRequestAllowed(req("GET", { host: "[::1]:4317", "sec-fetch-site": "same-origin" }))).toBe(true)
  })
  test("refuses other sites, foreign Host headers (DNS rebinding) and https/odd origins", () => {
    expect(localRequestAllowed(req("POST", { host: "localhost:4317", origin: "https://evil.example" }))).toBe(false)
    expect(localRequestAllowed(req("POST", { host: "localhost:4317", "sec-fetch-site": "cross-site" }))).toBe(false)
    expect(localRequestAllowed(req("GET", { host: "localhost:4317", "sec-fetch-site": "cross-site" }))).toBe(false)
    expect(localRequestAllowed(req("POST", { host: "evil.example:4317" }))).toBe(false)
    expect(localRequestAllowed(req("POST", { host: "localhost:4317", origin: "null" }))).toBe(false)
  })
  test("the app returns 403 before starting a paid run for a cross-site POST", async () => {
    const { store, app } = make()
    const res = await app(new Request("http://localhost:4317/api/runs", { method: "POST", headers: { host: "localhost:4317", origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ request: "결제해" }) }))
    expect(res.status).toBe(403)
    expect(store.listRuns()).toEqual([])
  })
})

describe("Quorum MCP", () => {
  test("initialize, tools/list hides quorum_propose by default, notifications get 202, GET is 405", async () => {
    const { rpc, app } = make()
    const init = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json()) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(init.result.protocolVersion).toBe("2025-03-26")
    expect(init.result.serverInfo.name).toBe("quorum")
    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toEqual(["quorum_runs", "quorum_run", "quorum_memory"])
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202)
    expect((await app(new Request("http://localhost:4317/mcp", { headers: { host: "localhost:4317" } }))).status).toBe(405)
    const unknown = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "nope" })).json()) as { error: { code: number } }
    expect(unknown.error.code).toBe(-32601)
    const hidden = (await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "quorum_propose", arguments: { request: "x" } } })).json()) as { result: { isError: boolean } }
    expect(hidden.result.isError).toBe(true)
  })
  test("with QUORUM_MCP_PROPOSE an agent can open a council and read its digest", async () => {
    const { rpc, runs } = make(true)
    const list = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toContain("quorum_propose")
    const started = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "quorum_propose", arguments: { request: "공지 정리" } } })).json()) as { result: { structuredContent: { runId: string } } }
    const runId = started.result.structuredContent.runId
    while (runs.isLive(runId)) await Bun.sleep(1)
    const digest = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "quorum_run", arguments: { runId } } })).json()) as { result: { structuredContent: Record<string, unknown> } }
    expect(digest.result.structuredContent).toMatchObject({ runId, status: "done", verdicts: [{ proposalId: "p1", decision: "pass" }], results: [{ proposalId: "p1", ok: true, summary: "정리 끝" }] })
    const mem = (await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "quorum_memory", arguments: { q: "공지" } } })).json()) as { result: { structuredContent: unknown } }
    expect(mem.result.structuredContent).toEqual({ q: "공지", results: [{ q: "공지" }] })
    const missing = (await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "quorum_run", arguments: { runId: "none" } } })).json()) as { result: { isError: boolean; structuredContent: { guidance: string } } }
    expect(missing.result.isError).toBe(true)
    expect(missing.result.structuredContent.guidance).toContain("quorum_runs")
  })
})
