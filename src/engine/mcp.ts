// Quorum MCP: 다른 에이전트가 의회 기록·기억을 읽고(기본), 허락되면 의회에 요청을 올려요.
// 출처: board/apps/server/server/mcp/handler.ts (방향판 2ee6e8a) — 상태 없는 요청/응답(JSON 응답, GET 405), instructions 문장 방식,
// 쓰기 도구를 환경 변수로 숨기기(BOARD_MCP_READONLY → QUORUM_MCP_PROPOSE), 읽기 결과 20000자 제한과 줄이는 법 안내, 오류를 isError 결과로 돌려주기.
// 바꾼 점: @modelcontextprotocol/sdk·zod 의존성 없이 JSON-RPC 2.0 을 직접 처리해요(Quorum 은 의존성 0). 인증은 server.ts 의 로컬 요청 검사가 맡아요.
// board runs.ts 의 "agents cannot start runs; a person starts them from the board" 정책을 따라 quorum_propose 는 QUORUM_MCP_PROPOSE=1 일 때만 보여요(aside exec 는 유료).
import type { RunSummary } from "../contract"
import type { Store } from "./store"

export type McpDeps = {
  store: Store
  start: (request: string) => string
  memory: (q: string) => Promise<unknown>
  allowPropose: boolean
  version: string
}

const PROTOCOL = "2025-06-18"
const READ_LIMIT = 20000
const instructions = [
  "quorum_runs 로 최근 실행을 보고, quorum_run 으로 한 실행의 판정과 결과를 읽으세요.",
  "비슷한 일을 올리기 전에 quorum_memory 로 지난 판정을 찾으세요. 가까운 판정이 있으면 의회가 그대로 재사용해요.",
  "quorum_propose 가 보이면 사람의 요청 한 문장을 올리세요. 보내기·결제·제출 같은 일은 의회가 보류하고 사람이 정해요.",
  "mode 가 replay 인 실행은 녹화를 다시 튼 것이에요. 새로 실행된 결과로 다루지 마세요.",
].join("\n")

type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> }
const read = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }
const TOOLS: Tool[] = [
  { name: "quorum_runs", description: "최근 의회 실행 목록(runId, request, mode, startedAt, status)을 가져와요.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false }, annotations: read },
  { name: "quorum_run", description: "실행 하나의 제안·판정·실행 결과를 요약해 가져와요. events 는 마지막 이벤트부터 잘려요.", inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false }, annotations: read },
  { name: "quorum_memory", description: "gbrain 에 기억된 지난 판정을 키워드로 찾아요.", inputSchema: { type: "object", properties: { q: { type: "string", minLength: 1 } }, required: ["q"], additionalProperties: false }, annotations: read },
]
const PROPOSE: Tool = { name: "quorum_propose", description: "의회에 요청을 올려요. 봇들이 제안하고 반박해서 통과한 일만 실행해요. runId 를 돌려줘요.", inputSchema: { type: "object", properties: { request: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["request"], additionalProperties: false }, annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true } }

class ToolError extends Error {
  constructor(message: string, public guidance: string) { super(message) }
}

function ok(result: object, limit = true) {
  const text = JSON.stringify(result)
  if (limit && text.length > READ_LIMIT) throw new ToolError("읽기 결과의 JSON이 20000자를 초과했어요.", "quorum_runs 의 limit 을 줄이거나 quorum_memory 검색어를 좁히세요.")
  return { structuredContent: result, content: [{ type: "text", text }] }
}
function fail(e: unknown) {
  const data = e instanceof ToolError ? { error: e.message, guidance: e.guidance } : { error: "작업을 마치지 못했어요: " + (e instanceof Error ? e.message : String(e)), guidance: "입력을 확인하고 다시 시도하세요." }
  return { isError: true, structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] }
}

export function runDigest(store: Store, runId: string) {
  const run = store.getRun(runId)
  if (!run) throw new ToolError("실행을 찾을 수 없어요.", "quorum_runs 로 runId 를 확인하세요.")
  const events = store.getEvents(runId)
  const pick = (t: string) => events.filter((e) => e.type === t)
  const props = pick("proposal").map((e) => ({ proposalId: e.data?.proposalId, title: e.data?.title, executor: e.data?.executor }))
  const verdicts = pick("verdict").map((e) => ({ proposalId: e.data?.proposalId, decision: e.data?.decision, reason: e.data?.reason, ...(e.data?.reusedFrom ? { reusedFrom: e.data.reusedFrom } : {}) }))
  const results = pick("execute.result").map((e) => ({ proposalId: e.data?.proposalId, executor: e.data?.executor, ok: e.data?.ok, summary: String(e.data?.summary ?? e.text).slice(0, 3000) }))
  const errors = pick("error").map((e) => ({ actor: e.actor, text: e.text.slice(0, 300) }))
  return { ...(run as RunSummary), proposals: props, verdicts, results, errors, end: pick("run.end").at(-1)?.data ?? null }
}

async function callTool(d: McpDeps, name: string, args: Record<string, unknown>) {
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")
  switch (name) {
    case "quorum_runs": return ok({ runs: d.store.listRuns(Math.max(1, Math.min(50, Number(args.limit) || 10))) })
    case "quorum_run": return ok(runDigest(d.store, str(args.runId, 80)))
    case "quorum_memory": {
      const q = str(args.q, 200)
      if (!q) throw new ToolError("q 가 필요해요.", "찾을 낱말을 넣으세요.")
      return ok({ q, results: await d.memory(q) })
    }
    case "quorum_propose": {
      if (!d.allowPropose) throw new ToolError("사용할 수 없는 도구예요.", "사람이 콘솔에서 요청을 올리거나 QUORUM_MCP_PROPOSE=1 로 켜야 해요.")
      const request = str(args.request, 4000)
      if (!request) throw new ToolError("request 가 필요해요.", "사람의 요청을 한 문장으로 넣으세요.")
      const runId = d.start(request)
      return ok({ runId, events: "/api/runs/" + runId + "/events" }, false)
    }
  }
  throw new ToolError("사용할 수 없는 도구예요.", "tools/list 로 도구 이름을 확인하세요.")
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const reply = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result })
const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

async function handleOne(d: McpDeps, m: Rpc): Promise<object | null> {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return rpcError(m?.id, -32600, "Invalid Request")
  const isNotification = m.id === undefined
  switch (m.method) {
    case "initialize": {
      const asked = typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : PROTOCOL
      return reply(m.id, { protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: "quorum", version: d.version }, instructions })
    }
    case "ping": return reply(m.id, {})
    case "tools/list": return reply(m.id, { tools: d.allowPropose ? [...TOOLS, PROPOSE] : TOOLS })
    case "tools/call": {
      const name = String(m.params?.name ?? "")
      const args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>
      try { return reply(m.id, await callTool(d, name, args)) } catch (e) { return reply(m.id, fail(e)) }
    }
  }
  if (isNotification) return null
  return rpcError(m.id, -32601, "Method not found: " + m.method)
}

export async function mcpHandler(d: McpDeps, req: Request): Promise<Response> {
  // 상태 없는 요청/응답 방식이라 서버가 먼저 여는 이벤트 흐름(GET)은 없어요 (board handler 와 같음)
  if (req.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  let body: unknown
  try { body = await req.json() } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }) }
  const batch = Array.isArray(body)
  const list = (batch ? body : [body]) as unknown[]
  const out = (await Promise.all(list.map((m) => handleOne(d, m as Rpc)))).filter((x): x is object => x !== null)
  if (!out.length) return new Response(null, { status: 202 })
  return Response.json(batch ? out : out[0], { headers: { "cache-control": "no-store" } })
}
