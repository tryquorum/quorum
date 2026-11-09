import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { DocsError, type DocsOps, type SearchInput, type FetchInput, type RelatedInput, type WriteInput } from "@direction-board/contracts/docs"
import { actionDescription, errorOutput, inputs, outputs, type ToolName } from "./schemas"

export type McpPrincipal = { owner: string; via: "loopback" | "bearer" }
export type McpOptions = { authenticate(request: Request): McpPrincipal | null | Promise<McpPrincipal | null> }

/**
 * Host integration: call mcpHandler(ops, { authenticate }) for each Request.
 * authenticate must verify the actual peer or Bearer credential and enforce Host/Origin
 * policy before returning a principal. Request URL, Host and forwarding headers are not
 * evidence of a peer. A reverse proxy is not the original peer unless explicitly trusted.
 * If peer information comes from the router, bind a new authenticator to that request;
 * never share a request-specific principal across concurrent requests. Reject unknown peers.
 * This adapter does not implement the host's network, token or DNS-rebinding policy.
 */
export function mcpHandler(ops: DocsOps, opts: McpOptions): (request: Request) => Promise<Response> {
  return async request => {
    let principal: McpPrincipal | null
    try { principal = await opts.authenticate(request) } catch { principal = null }
    if (!principal || typeof principal.owner !== "string" || !principal.owner.trim() || !["loopback", "bearer"].includes(principal.via)) {
      return new Response("Unauthorized", { status: 401 })
    }
    // Stateless request/response mode has no server-initiated event stream.
    if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST" } })
    const readonly = process.env.BOARD_MCP_READONLY === "1"
    const server = createServer(ops, principal.owner, readonly)
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    try {
      await server.connect(transport)
      return await transport.handleRequest(request)
    } finally {
      await server.close()
    }
  }
}

const instructions = [
  "먼저 board_search로 검색하고 필요한 문서를 board_fetch로 읽으세요.",
  "편집하기 전에 board_fetch로 최신 version을 확인하세요.",
  "사람이 쓴 내용을 보호하고 변경은 제안으로 남기세요.",
  "새로 만들기 전에 같은 일이나 문서를 검색하세요.",
  "태그는 앞뒤 공백 제거, 소문자, 공백을 하이픈으로 바꾸고 최대 40자, /로 계층을 표현하세요.",
  "속성(메타데이터) 키·타입은 board_schema 의 props 로 확인하고, board_search 의 props·sort 로 거르고 정렬하며, board_act 의 meta·props 로 고치세요.",
  "문서는 parent 로 계층을 가져요. 옮기기는 board_act move, 하위 문서는 doc 에 parent 를 넣어요.",
].join("\n")

const descriptions: Record<ToolName, string> = {
  board_search: "문서를 검색합니다. props 로 사용자 속성 조건(eq·neq·exists·missing·gt·gte·lt·lte·contains, AND)을 걸고 sort 로 prop:<키>/-prop:<키> 정렬을 할 수 있습니다. 결과마다 due 와 props 가 있습니다.", board_fetch: "문서의 본문이나 구조를 가져옵니다. frontmatter 에 due 와 props 가 있습니다.",
  board_related: "문서 관계를 가져옵니다.", board_schema: "문서 종류·영역·태그와 쓰이는 사용자 속성 키·타입·개수(select·list 는 쓰인 값)를 가져옵니다.",
  board_act: `작업과 문서의 액션을 실행합니다. ${actionDescription} 일부 작업이 적용됐을 수 있으므로 전체 묶음을 다시 시도하지 말고 각 결과와 현재 상태를 확인하세요.`, board_write: "문서를 추기, 교체 또는 부분 수정합니다.",
  board_archive: "독립 문서를 보관하거나 복원합니다.",
}
const writes = new Set<ToolName>(["board_act", "board_write", "board_archive"])
const schemaJSON = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-7" })
const readLimit = 20000
class ReadLimitError extends Error {}

// The limit is on JSON.stringify(operationResult).length, including escaped characters.
// Resources invoke the same fetch/schema operations and use the same bound before projection.
function serializeReadResult(result: object): string {
  const text = JSON.stringify(result)
  if (text.length > readLimit) throw new ReadLimitError()
  return text
}

function documentRef(uri: string): string | null {
  const match = /^board:\/\/doc\/([^/?#]+)$/.exec(uri)
  if (!match) return null
  try {
    const decoded = decodeURIComponent(match[1])
    const normalize = (s: string) => s.replace(/%[0-9a-fA-F]{2}/g, escape => escape.toUpperCase())
    return normalize(encodeURIComponent(decoded)) === normalize(match[1]) ? decoded : null
  } catch { return null }
}

function errorResult(error: unknown, writeAttempt = false) {
  const writeGuidance = error instanceof DocsError && error.status === 409
    ? "작업의 적용 여부는 불명확합니다. 현재 상태와 board_fetch의 최신 version을 확인하고 잘린 본문은 offset으로 이어 읽은 뒤 수동으로 판단하세요. 전체 묶음을 무분별하게 다시 시도하지 마세요."
    : "작업의 적용 여부는 불명확합니다. 입력과 현재 상태를 확인하고 전체 묶음을 무분별하게 다시 시도하지 마세요. 필요하면 관리자에게 문의하세요."
  const data = error instanceof ReadLimitError
    ? { error: "읽기 결과의 JSON이 20000자를 초과했습니다.", guidance: "board_search의 조건과 limit, board_related의 limit를 줄이거나 board_fetch의 section, maxChars, offset으로 범위를 좁히세요. board_schema가 너무 크면 관리자에게 문의하세요." }
    : error instanceof DocsError
    ? { error: error.message, status: error.status, ...(error.current ? { current: error.current } : {}), guidance: writeAttempt ? writeGuidance : error.status === 409 ? "board_fetch로 최신 문서와 version을 확인하세요. 잘린 본문은 offset으로 이어 읽은 후 다시 시도하세요." : "입력을 확인하고 필요하면 board_search 또는 board_fetch로 확인하세요." }
    : { error: "문서 작업을 완료하지 못했습니다.", guidance: writeAttempt ? writeGuidance : "입력을 확인하고 다시 시도하거나 관리자에게 문의하세요." }
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data }
}

function createServer(ops: DocsOps, owner: string, readonly: boolean): Server {
  const server = new Server({ name: "direction-board", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} }, instructions })
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: (Object.keys(inputs) as ToolName[]).filter(name => !readonly || !writes.has(name)).map(name => {
    const read = !writes.has(name)
    const inputSchema = schemaJSON(inputs[name])
    if (name === "board_write") Object.assign(inputSchema, { allOf: [
      { if: { properties: { mode: { enum: ["replace", "patch"] } }, required: ["mode"] }, then: { required: ["expectedVersion"] } }, // oxlint-disable-line unicorn/no-thenable -- JSON Schema Draft-7 conditional keyword
      { if: { properties: { mode: { enum: ["append", "replace"] } }, required: ["mode"] }, then: { required: ["md"] } }, // oxlint-disable-line unicorn/no-thenable -- JSON Schema Draft-7 conditional keyword
      { if: { properties: { mode: { const: "patch" } }, required: ["mode"] }, then: { required: ["edits"], properties: { edits: { minItems: 1 } } } }, // oxlint-disable-line unicorn/no-thenable -- JSON Schema Draft-7 conditional keyword
    ] })
    return { name, description: descriptions[name], inputSchema, outputSchema: { type: "object" as const, anyOf: [schemaJSON(outputs[name]), schemaJSON(errorOutput)] }, annotations: { readOnlyHint: read, idempotentHint: read, destructiveHint: name === "board_write" || name === "board_archive", openWorldHint: false } }
  }) }))
  server.setRequestHandler(CallToolRequestSchema, request => {
    const name = request.params.name as ToolName
    if (!Object.hasOwn(inputs, name) || (readonly && writes.has(name))) return errorResult(new DocsError(404, "사용할 수 없는 도구입니다."))
    const parsed = inputs[name].safeParse(request.params.arguments ?? {})
    if (!parsed.success) return errorResult(new DocsError(400, "도구 입력이 올바르지 않습니다."))
    const arg = parsed.data
    if (name === "board_write") {
      const write = arg as WriteInput
      if ((write.mode !== "append" && write.expectedVersion === undefined) || (write.mode !== "patch" && write.md === undefined) || (write.mode === "patch" && (!write.edits || write.edits.length === 0))) {
        return errorResult(new DocsError(400, "쓰기 모드에 필요한 md, edits 또는 expectedVersion을 확인하세요."))
      }
    }
    try {
      let result: object
      switch (name) {
        case "board_search": result = ops.search(owner, arg as SearchInput); break
        case "board_fetch": result = ops.fetch(owner, arg as FetchInput); break
        case "board_related": result = ops.related(owner, arg as RelatedInput); break
        case "board_schema": result = ops.schema(owner); break
        case "board_act": {
          const acted = ops.act(owner, (arg as z.infer<typeof inputs.board_act>).actions)
          const hasSuccess = acted.results.some(item => item.ok)
          const hasFailure = acted.results.some(item => !item.ok)
          if (!acted.results.length) {
            result = { ...acted, guidance: "반환된 결과가 없어 적용 여부를 알 수 없습니다. 현재 상태를 확인하고 전체 묶음을 다시 시도하지 마세요." }
            return { isError: true, structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] }
          }
          if (!hasSuccess) {
            result = { ...acted, guidance: "입력과 개별 결과, 현재 상태를 확인하고 전체 묶음을 무분별하게 다시 시도하지 마세요." }
            return { isError: true, structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] }
          }
          result = hasFailure ? { ...acted, guidance: "일부 작업이 이미 적용됐을 수 있습니다. 각 결과와 현재 상태를 확인하고 전체 묶음을 다시 시도하지 마세요." } : acted
          break
        }
        case "board_write": result = ops.write(owner, arg as WriteInput, "agent"); break
        case "board_archive": { const archive = arg as z.infer<typeof inputs.board_archive>; result = ops.archive(owner, archive.ref, archive.archived); break }
      }
      const text = writes.has(name) ? JSON.stringify(result) : serializeReadResult(result)
      return { structuredContent: result, content: [{ type: "text" as const, text }] }
    } catch (error) { return errorResult(error, writes.has(name)) }
  })
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ uri: "board://schema", name: "board-schema", mimeType: "application/json" }] }))
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: [{ uriTemplate: "board://doc/{ref}", name: "board-document", mimeType: "text/markdown" }] }))
  server.setRequestHandler(ReadResourceRequestSchema, request => {
    const uri = request.params.uri
    const ref = uri === "board://schema" ? null : documentRef(uri)
    if (uri !== "board://schema" && ref === null) throw new McpError(ErrorCode.InvalidParams, "잘못된 리소스 URI입니다. ref를 encodeURIComponent로 인코딩하세요.")
    try {
      if (ref === null) return { contents: [{ uri, mimeType: "application/json", text: serializeReadResult(ops.schema(owner)) }] }
      const doc = ops.fetch(owner, { ref, view: "markdown" })
      serializeReadResult(doc)
      const contents: { uri: string; mimeType: string; text: string }[] = [{ uri, mimeType: "text/markdown", text: doc.markdown }]
      if (doc.truncated) contents.push({ uri, mimeType: "application/json", text: JSON.stringify({ truncated: true, ...(doc.nextOffset === undefined ? {} : { nextOffset: doc.nextOffset }), guidance: "board_fetch에서 offset 또는 section으로 이어서 읽으세요." }) })
      return { contents }
    } catch (error) {
      const result = errorResult(error)
      throw new McpError(error instanceof DocsError && error.status === 404 ? ErrorCode.InvalidParams : ErrorCode.InternalError, result.content[0].text)
    }
  })
  return server
}
