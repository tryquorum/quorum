import { afterEach, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { DocsError, type DocsOps } from "@direction-board/contracts/docs"
import { mcpHandler, type McpPrincipal } from "./handler"

const originalReadonly = process.env.BOARD_MCP_READONLY
afterEach(() => { if (originalReadonly === undefined) delete process.env.BOARD_MCP_READONLY; else process.env.BOARD_MCP_READONLY = originalReadonly })
type Call = { method: string; args: readonly unknown[] }; type Structured = { guidance?: string; results?: readonly unknown[]; error?: string; status?: number; markdown?: string; [k: string]: unknown }
const structured = (r: { structuredContent?: Structured; [k: string]: unknown }) => r.structuredContent, resourceText = (c: { text: string } | { blob: string } | undefined) => { if (!c || !("text" in c)) throw new Error("expected text resource"); return c.text }
function fakeOps() {
  const calls: Call[] = []
  const doc = { ref: "doc:1", kind: "doc" as const, title: "문서", version: 3, frontmatter: { area: "집" }, markdown: "내용", truncated: false, links: { out: 1, in: 2 } }
  const schema = { kinds: ["doc" as const], statuses: ["open" as const], areas: ["집"], tags: [{ tag: "분류/하나", count: 1 }], props: [], linkLabels: ["언급"], fields: ["title"] }
  const ops: DocsOps = {
    search: (...args) => { calls.push({ method: "search", args }); return { results: [{ ref: "doc:1", kind: "doc", title: "문서", snippet: "내용", tags: [{ tag: "태그", by: "person" }, { tag: "자동", by: "auto" }, { tag: "에이전트", by: "agent" }, { tag: "본문", by: "body" }], personEdited: true, area: null, status: "open", due: null, props: [], updatedAt: 1, path: null }], total: 1 } },
    fetch: (...args) => { calls.push({ method: "fetch", args }); return { ...doc, ref: args[1].ref } },
    related: (...args) => { calls.push({ method: "related", args }); return { edges: [{ label: "언급", direction: "in", node: { ref: "doc:2", kind: "doc", title: "연결", status: "open" } }], truncated: true } },
    schema: (...args) => { calls.push({ method: "schema", args }); return schema },
    create: (...args) => { calls.push({ method: "create", args }); return { ref: "doc:1", version: 1 } },
    tag: (...args) => { calls.push({ method: "tag", args }); return { ref: args[1], tags: [] } },
    write: (...args) => { calls.push({ method: "write", args }); return { ref: args[1].ref, version: 4, applied: 1, warnings: [] } },
    archive: (...args) => { calls.push({ method: "archive", args }); return { ref: args[1], status: args[2] ? "archived" : "open" } },
    move: (...args) => { calls.push({ method: "move", args }); return { ref: args[1].ref, parent: args[1].parent } },
    act: (...args) => { calls.push({ method: "act", args }); return { results: [{ ok: true, do: "doc", ref: "doc:1", existing: true }, { ok: false, do: "task", error: "중복" }] } },
    meta: (...args) => { calls.push({ method: "meta", args }); return { ref: args[1].ref, version: 2 } },
    props: (...args) => { calls.push({ method: "props", args }); return { ref: args[1].ref, version: 2, props: [] } },
    note: (...args) => { calls.push({ method: "note", args }); return { ref: args[1], html: "", md: "", version: 1, personEdited: false } },
  }
  return { ops, calls, doc, schema }
}

async function connect(ops: DocsOps, principal: McpPrincipal = { owner: "alice", via: "bearer" }) {
  const handler = mcpHandler(ops, { authenticate: () => principal })
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (url, init) => handler(new Request(url, init)) })
  const client = new Client({ name: "test-client", version: "1" })
  await client.connect(transport)
  return client
}

const names = ["board_search", "board_fetch", "board_related", "board_schema", "board_act", "board_write", "board_archive"]

describe("stateless MCP SDK transport", () => {
  test.each(["board_act", "board_write", "board_archive"] as const)("%s exceptions after side effects never recommend blind retry", async name => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      const tool = (await client.listTools()).tools.find(item => item.name === name)!
      const validate = new AjvJsonSchemaValidator().getValidator(tool.outputSchema!)
      const effects: string[] = []
      const current = { version: 7, md: "현재", truncated: false }
      for (const kind of ["unexpected", "docs", "conflict"] as const) {
        const fail = () => {
          effects.push(`${name}:${kind}`)
          throw kind === "docs" ? new DocsError(503, "일부 처리 오류", current) : kind === "conflict" ? new DocsError(409, "버전 충돌", current) : new Error("private-secret")
        }
        if (name === "board_act") ops.act = fail
        if (name === "board_write") ops.write = fail
        if (name === "board_archive") ops.archive = fail
        const args = name === "board_act" ? { actions: [{ do: "task" }] } : name === "board_write" ? { ref: "doc:x", mode: "append", md: "a" } : { ref: "doc:x", archived: true }
        const response = await client.callTool({ name, arguments: args })
        expect(effects.at(-1)).toBe(`${name}:${kind}`)
        expect(response.isError).toBe(true)
        expect(validate(response.structuredContent).valid).toBe(true)
        expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }])
        const data = structured(response)!
        expect(data.guidance).toContain("적용 여부")
        expect(data.guidance).toContain("현재 상태")
        expect(data.guidance).toContain("전체 묶음")
        expect(data.guidance).toContain("다시 시도하지")
        if (kind === "docs") expect(data).toMatchObject({ error: "일부 처리 오류", status: 503, current })
        if (kind === "conflict") {
          expect(data.guidance).toContain("version")
          expect(data.guidance).toContain("수동")
          expect(data).toMatchObject({ error: "버전 충돌", status: 409, current })
        }
        if (kind === "unexpected") expect(JSON.stringify(data)).not.toContain("private-secret")
      }
      expect(effects).toHaveLength(3)
    } finally { await client.close() }
  })

  test("all-failed act results without error details include actionable guidance", async () => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      const tool = (await client.listTools()).tools.find(item => item.name === "board_act")!
      const results = [{ ok: false, do: "task" }, { ok: false, do: "note", ref: "doc:1" }]
      ops.act = () => ({ results })
      const response = await client.callTool({ name: "board_act", arguments: { actions: [{ do: "task" }, { do: "note" }] } })
      expect(response.isError).toBe(true)
      expect(structured(response)?.results).toEqual(results)
      expect(structured(response)?.guidance).toContain("입력")
      expect(structured(response)?.guidance).toContain("개별 결과")
      expect(structured(response)?.guidance).toContain("현재 상태")
      expect(new AjvJsonSchemaValidator().getValidator(tool.outputSchema!)(response.structuredContent).valid).toBe(true)
      expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }])
    } finally { await client.close() }
  })

  test("leaves the 30-action policy to DocsOps without cutting input", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      await client.listTools()
      const actions = Array.from({ length: 31 }, (_, index) => ({ do: "note", ref: `doc:${index}`, md: "x" }))
      await client.callTool({ name: "board_act", arguments: { actions } })
      expect(calls.at(-1)).toEqual({ method: "act", args: ["alice", actions] })
    } finally { await client.close() }
  })

  test("read exceptions retain their previous guidance", async () => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      await client.listTools()
      ops.fetch = () => { throw new DocsError(400, "입력 오류") }
      const known = await client.callTool({ name: "board_fetch", arguments: { ref: "x" } })
      expect(known.structuredContent).toEqual({ error: "입력 오류", status: 400, guidance: "입력을 확인하고 필요하면 board_search 또는 board_fetch로 확인하세요." })
      ops.fetch = () => { throw new Error("private-secret") }
      const unexpected = await client.callTool({ name: "board_fetch", arguments: { ref: "x" } })
      expect(unexpected.structuredContent).toEqual({ error: "문서 작업을 완료하지 못했습니다.", guidance: "입력을 확인하고 다시 시도하거나 관리자에게 문의하세요." })
    } finally { await client.close() }
  })

  test.each(["409", "400", "unexpected"])("listed SDK tool returns schema-valid %s error", async kind => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      const tools = (await client.listTools()).tools
      ops.write = () => { throw kind === "409" ? new DocsError(409, "충돌", { version: 9, md: "현재", truncated: false }) : new Error("private-secret") }
      const name = kind === "400" ? "board_fetch" : "board_write"
      const args = kind === "400" ? { ref: "x", maxChars: 0 } : { ref: "x", mode: "replace", md: "a", expectedVersion: 2 }
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }])
      expect(new AjvJsonSchemaValidator().getValidator(tools.find(tool => tool.name === name)!.outputSchema!)(result.structuredContent).valid).toBe(true)
      expect(JSON.stringify(result)).not.toContain("private-secret")
      if (kind === "409") expect(result.structuredContent).toMatchObject({ status: 409, current: { version: 9, md: "현재", truncated: false } })
      if (kind === "400") expect(result.structuredContent).toMatchObject({ status: 400 })
    } finally { await client.close() }
  })
  test("initialize, metadata, each tool, output schemas and exact DocsOps mapping", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      expect(client.getServerVersion()?.name).toBe("direction-board")
      const instructions = client.getInstructions()!
      expect(instructions.split("\n").length).toBeLessThanOrEqual(10)
      for (const part of ["검색", "version", "사람", "새로", "태그", "40", "/"]) expect(instructions).toContain(part)
      const { tools } = await client.listTools()
      expect(tools.map(tool => tool.name)).toEqual(names)
      const actions = [{ do: "doc", title: "새 문서", nested: { x: 1 } }, { do: "task", title: "일" }]
      const cases = [
        ["board_search", { q: "내용", limit: 50, drafts: "exclude" }, "search", ["alice", { q: "내용", limit: 50, drafts: "exclude" }]],
        ["board_fetch", { ref: "doc:1", view: "section", section: "제목", maxChars: 100, offset: 2 }, "fetch", ["alice", { ref: "doc:1", view: "section", section: "제목", maxChars: 100, offset: 2 }]],
        ["board_related", { ref: "doc:1", direction: "in", depth: 2 }, "related", ["alice", { ref: "doc:1", direction: "in", depth: 2 }]],
        ["board_schema", {}, "schema", ["alice"]],
        ["board_act", { actions }, "act", ["alice", actions]],
        ["board_write", { ref: "doc:1", mode: "patch", edits: [{ oldStr: "a", newStr: "b" }], expectedVersion: 3 }, "write", ["alice", { ref: "doc:1", mode: "patch", edits: [{ oldStr: "a", newStr: "b" }], expectedVersion: 3 }, "agent"]],
        ["board_archive", { ref: "doc:1", archived: true }, "archive", ["alice", "doc:1", true]],
      ] as const
      const validator = new AjvJsonSchemaValidator()
      for (const [name, args, method, expected] of cases) {
        const tool = tools.find(item => item.name === name)!
        const read = !["board_act", "board_write", "board_archive"].includes(name)
        expect(tool.annotations).toEqual({ readOnlyHint: read, idempotentHint: read, destructiveHint: ["board_write", "board_archive"].includes(name), openWorldHint: false })
        expect(tool.inputSchema.type).toBe("object")
        expect(tool.outputSchema?.type).toBe("object")
        const result = await client.callTool({ name, arguments: args })
        expect(result.isError).toBeUndefined()
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }])
        expect(validator.getValidator(tool.outputSchema!)(result.structuredContent).valid).toBe(true)
        expect(calls.at(-1)).toEqual({ method, args: expected })
        if (name === "board_act") expect(result.structuredContent).toEqual({ results: [{ ok: true, do: "doc", ref: "doc:1", existing: true }, { ok: false, do: "task", error: "중복" }], guidance: expect.stringContaining("전체 묶음을 다시 시도하지 마세요") })
      }
    } finally { await client.close() }
  })

  test("readonly lists four tools and blocks direct write calls", async () => {
    process.env.BOARD_MCP_READONLY = "1"
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(names.slice(0, 4))
      for (const [name, args] of [["board_act", { actions: [] }], ["board_write", { ref: "x", mode: "append", md: "x" }], ["board_archive", { ref: "x", archived: true }]] as const) {
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true)
      }
      expect((await client.callTool({ name: "board_unknown", arguments: {} })).isError).toBe(true)
      expect(calls).toEqual([])
    } finally { await client.close() }
  })

  test("rejects invalid ranges and write shapes before DocsOps", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      const cases = [
        ["board_search", { limit: 0 }], ["board_search", { limit: 51 }], ["board_search", { limit: 1.5 }],
        ["board_fetch", { ref: "x", maxChars: 0 }], ["board_fetch", { ref: "x", maxChars: 20001 }], ["board_fetch", { ref: "x", offset: -1 }], ["board_fetch", { ref: "x", offset: 0.5 }],
        ["board_write", { ref: "x", mode: "append" }], ["board_write", { ref: "x", mode: "replace", md: "x" }],
        ["board_write", { ref: "x", mode: "replace", expectedVersion: 1 }], ["board_write", { ref: "x", mode: "patch", expectedVersion: 1 }],
        ["board_write", { ref: "x", mode: "patch", expectedVersion: 1, edits: [] }], ["board_write", { ref: "x", mode: "patch", edits: [{ oldStr: "a", newStr: "b" }] }],
        ["board_write", { ref: "x", mode: "patch", expectedVersion: 1, edits: [{ oldStr: "a", newStr: "b", op: "append", md: "c" }] }],
        ["board_write", { ref: "x", mode: "patch", expectedVersion: 1, edits: [{ oldStr: "a" }] }],
      ] as const
      for (const [name, args] of cases) expect((await client.callTool({ name, arguments: args })).isError).toBe(true)
      expect(calls).toEqual([])
    } finally { await client.close() }
  })

  test("passes valid append, replace, and heading patch without injecting defaults", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      for (const args of [
        { ref: "x", mode: "append", md: "a" },
        { ref: "x", mode: "replace", md: "b", expectedVersion: 1, idempotencyKey: "key" },
        { ref: "x", mode: "patch", expectedVersion: 2, edits: [{ heading: "제목/소제목", op: "append", md: "c" }] },
      ]) {
        expect((await client.callTool({ name: "board_write", arguments: args })).isError).toBeUndefined()
        expect(calls.at(-1)).toEqual({ method: "write", args: ["alice", args, "agent"] })
      }
    } finally { await client.close() }
  })

  test("act describes six kinds and forwards arbitrary action fields", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      const tool = (await client.listTools()).tools.find(item => item.name === "board_act")!
      const actionSchema = tool.inputSchema.properties!.actions as { description: string; items: { description: string; additionalProperties: unknown } }
      for (const desc of [tool.description!, actionSchema.description, actionSchema.items.description]) {
        for (const token of ["task", "title", "note", "remindAt", "area", "link", "label", "why", "done", "update", "ref", "md", "doc", "tags", "tag", "add", "remove"]) expect(desc).toContain(token)
        for (const fields of ["task: 필수 do, title, note", "done: 필수 do, ref", "update: 필수 do, ref", "note: 필수 do, ref, md", "doc: 필수 do, title, md", "tag: 필수 do, ref"]) expect(desc).toContain(fields)
      }
      expect(tool.description).toContain("다시 시도하지")
      expect(actionSchema.items.additionalProperties).toBeDefined()
      const actions = [
        { do: "task", title: "t", note: "1234567890", custom: { keep: 1 } },
        { do: "done", ref: "x", newField: true }, { do: "update", ref: "x", done: false },
        { do: "note", ref: "x", md: "body" }, { do: "doc", title: "d", md: "body" },
        { do: "tag", ref: "x", add: ["tag"], remove: ["old"] },
      ]
      expect(new AjvJsonSchemaValidator().getValidator(tool.inputSchema)({ actions }).valid).toBe(true)
      await client.callTool({ name: "board_act", arguments: { actions } })
      expect(calls.at(-1)).toEqual({ method: "act", args: ["alice", actions] })
    } finally { await client.close() }
  })

  test("act reports all-fail, mixed, empty, and successful results without losing actions", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      const tool = (await client.listTools()).tools.find(item => item.name === "board_act")!
      const validate = new AjvJsonSchemaValidator().getValidator(tool.outputSchema!)
      const actions = [{ do: "task", title: "a", note: "1234567890" }, { do: "note", ref: "x", md: "b" }]
      const failure = [{ ok: false, do: "task", error: "bad" }, { ok: false, do: "note", ref: "x", error: "missing" }]
      const mixed = [{ ok: true, do: "task", ref: "x", existing: true }, { ok: false, do: "note", error: "bad" }]
      const success = [{ ok: true, do: "task", ref: "x" }, { ok: true, do: "note", ref: "x" }]
      for (const [results, isError] of [[failure, true], [mixed, false], [[], true], [success, false]] as const) {
        ops.act = (...args) => { calls.push({ method: "act", args }); return { results: [...results] } }
        const result = await client.callTool({ name: "board_act", arguments: { actions } })
        expect(result.isError === true).toBe(isError)
        expect(structured(result)?.results).toEqual(results)
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }])
        expect(validate(result.structuredContent).valid).toBe(true)
        expect(calls.at(-1)).toEqual({ method: "act", args: ["alice", actions] })
        if (results === mixed) {
          expect(structured(result)?.guidance).toContain("이미 적용됐을 수")
          expect(structured(result)?.guidance).toContain("전체 묶음을 다시 시도하지")
        } else if (results.length === 0) {
          expect(structured(result)?.guidance).toContain("적용 여부를 알 수 없습니다")
          expect(structured(result)?.guidance).toContain("다시 시도하지")
        } else if (results === failure) {
          expect(structured(result)?.guidance).toContain("개별 결과")
          expect(structured(result)?.guidance).toContain("현재 상태")
        } else expect(result.structuredContent).toEqual({ results })
      }
      const count = calls.length
      const emptyInput = await client.callTool({ name: "board_act", arguments: { actions: [] } })
      expect(emptyInput.isError).toBe(true)
      expect(emptyInput.structuredContent).toMatchObject({ status: 400 })
      expect(calls).toHaveLength(count)
    } finally { await client.close() }
  })

  test("DocsError preserves 409 current including large content, other status, and strips unexpected secrets", async () => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      await client.listTools()
      const md = "한".repeat(8000)
      ops.write = () => { throw new DocsError(409, "충돌", { version: 9, md, truncated: true }) }
      const conflict = await client.callTool({ name: "board_write", arguments: { ref: "x", mode: "replace", md: "a", expectedVersion: 2 } })
      expect(conflict.isError).toBe(true)
      expect(conflict.structuredContent).toEqual({ error: "충돌", status: 409, current: { version: 9, md, truncated: true }, guidance: expect.stringContaining("board_fetch") })
      expect(conflict.content).toEqual([{ type: "text", text: JSON.stringify(conflict.structuredContent) }])
      expect(structured(conflict)?.guidance).toContain("offset")
      ops.fetch = () => { throw new DocsError(404, "없음") }
      expect((await client.callTool({ name: "board_fetch", arguments: { ref: "x" } })).structuredContent).toEqual({ error: "없음", status: 404, guidance: expect.any(String) })
      ops.fetch = () => { throw new Error("secret-token") }
      expect(JSON.stringify(await client.callTool({ name: "board_fetch", arguments: { ref: "x" } }))).not.toContain("secret-token")
    } finally { await client.close() }
  })

  test.each(["board_search", "board_fetch", "board_related", "board_schema"] as const)("%s limits complete serialized JSON at exactly 20000 UTF-16 code units", async name => {
    const { ops, doc } = fakeOps()
    const client = await connect(ops)
    try {
      await client.listTools()
      const prefix = "한😀\"\\\n"
      expect(JSON.stringify(prefix).length - 2).toBeGreaterThan(prefix.length)
      const make = (value: string) => {
        if (name === "board_search") return { results: [{ ref: "doc:1", kind: "doc" as const, title: value, snippet: "s", tags: [{ tag: "x", by: "agent" as const }], personEdited: false, area: null, status: "open" as const, due: null, props: [], updatedAt: 1, path: null }], total: 1 }
        if (name === "board_fetch") return { ...doc, markdown: "x", frontmatter: { extra: value } }
        if (name === "board_related") return { edges: [{ label: "a", direction: "in" as const, node: { ref: "doc:1", kind: "doc" as const, title: value, status: "open" as const } }], truncated: true }
        return { kinds: ["doc" as const], statuses: ["open" as const], areas: [value], tags: [], props: [], linkLabels: [], fields: [] }
      }
      for (const size of [19999, 20000, 20001]) {
        const value = prefix + "x".repeat(size - JSON.stringify(make(prefix)).length)
        const result = make(value)
        expect(JSON.stringify(result).length).toBe(size)
        if (name === "board_search") ops.search = () => result as ReturnType<DocsOps["search"]>
        if (name === "board_fetch") ops.fetch = () => result as ReturnType<DocsOps["fetch"]>
        if (name === "board_related") ops.related = () => result as ReturnType<DocsOps["related"]>
        if (name === "board_schema") ops.schema = () => result as ReturnType<DocsOps["schema"]>
        const response = await client.callTool({ name, arguments: name === "board_fetch" || name === "board_related" ? { ref: "doc:1" } : {} })
        expect(response.isError === true).toBe(size > 20000)
        expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }])
        if (size > 20000) {
          expect(typeof structured(response)?.error).toBe("string")
          expect(typeof structured(response)?.guidance).toBe("string")
          expect(structured(response)?.status).not.toBe(413)
          expect(JSON.stringify(response.structuredContent)).toMatch(/limit|section|offset|좁/)
        } else expect(response.structuredContent).toEqual(result)
      }
    } finally { await client.close() }
  })

  test("write, archive and act receipts have no serialized size limit", async () => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      await client.listTools()
      const warning = "큰".repeat(21000)
      ops.write = () => ({ ref: "doc:1", version: 3, applied: 1, warnings: [warning] })
      ops.archive = () => ({ ref: warning, status: "archived" })
      const results = Array.from({ length: 1000 }, (_, i) => ({ ok: true, do: "note", ref: `doc:${i}` }))
      ops.act = () => ({ results })
      for (const [name, args, expected] of [
        ["board_write", { ref: "doc:1", mode: "append", md: "x" }, { ref: "doc:1", version: 3, applied: 1, warnings: [warning] }],
        ["board_archive", { ref: "doc:1", archived: true }, { ref: warning, status: "archived" }],
        ["board_act", { actions: [{ do: "note" }] }, { results }],
      ] as const) {
        expect(JSON.stringify(expected).length).toBeGreaterThan(20000)
        const response = await client.callTool({ name, arguments: args })
        expect(response.isError).toBeUndefined()
        expect(response.structuredContent).toEqual(expected)
        expect(response.content).toEqual([{ type: "text", text: JSON.stringify(expected) }])
      }
    } finally { await client.close() }
  })

  test("search drafts is an enum passed through and L1 results use updated contract", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      const tool = (await client.listTools()).tools.find(tool => tool.name === "board_search")!
      for (const drafts of ["include", "exclude", "only"]) {
        const response = await client.callTool({ name: "board_search", arguments: { drafts } })
        expect(response.isError).toBeUndefined()
        expect(calls.at(-1)).toEqual({ method: "search", args: ["alice", { drafts }] })
        expect(structured(response)?.results).toEqual([expect.objectContaining({ tags: [{ tag: "태그", by: "person" }, { tag: "자동", by: "auto" }, { tag: "에이전트", by: "agent" }, { tag: "본문", by: "body" }], personEdited: true })])
        expect(new AjvJsonSchemaValidator().getValidator(tool.outputSchema!)(response.structuredContent).valid).toBe(true)
      }
      const count = calls.length
      expect((await client.callTool({ name: "board_search", arguments: { drafts: "other" } })).isError).toBe(true)
      expect(calls).toHaveLength(count)
    } finally { await client.close() }
  })

  test("published schemas require the updated fields and reject invalid tags or drafts", async () => {
    const { ops } = fakeOps()
    const client = await connect(ops)
    try {
      const tools = (await client.listTools()).tools
      const schemaFor = (name: string) => tools.find(tool => tool.name === name)!
      const validator = new AjvJsonSchemaValidator()
      const searchInput = validator.getValidator(schemaFor("board_search").inputSchema)
      expect(searchInput({ drafts: "only" }).valid).toBe(true)
      expect(searchInput({ drafts: "invalid" }).valid).toBe(false)
      const searchOutput = validator.getValidator(schemaFor("board_search").outputSchema!)
      const hit = { ref: "doc:1", kind: "doc", title: "t", snippet: "s", tags: [{ tag: "x", by: "person" }], personEdited: true, area: null, status: "open", due: null, props: [], updatedAt: 1, path: null }
      expect(searchOutput({ results: [hit], total: 1 }).valid).toBe(true)
      expect(searchOutput({ results: [{ ...hit, tags: [{ tag: "x", by: "invalid" }] }], total: 1 }).valid).toBe(false)
      const { personEdited: _ignored, ...missingPersonEdited } = hit
      expect(searchOutput({ results: [missingPersonEdited], total: 1 }).valid).toBe(false)
      const relatedOutput = validator.getValidator(schemaFor("board_related").outputSchema!)
      expect(relatedOutput({ edges: [], truncated: false }).valid).toBe(true)
      expect(relatedOutput({ edges: [] }).valid).toBe(false)
      const writeOutput = validator.getValidator(schemaFor("board_write").outputSchema!)
      expect(writeOutput({ error: "conflict", status: 409, current: { version: 2, md: "x", truncated: true }, guidance: "fetch" }).valid).toBe(true)
      expect(writeOutput({ error: "conflict", status: 409, current: { version: 2, md: "x" }, guidance: "fetch" }).valid).toBe(false)
    } finally { await client.close() }
  })
})

describe("resources and trust boundary", () => {
  test.each(["schema", "document"] as const)("%s resource applies the cap to the underlying operation JSON", async kind => {
    const { ops, doc, schema } = fakeOps()
    const client = await connect(ops)
    try {
      const make = (value: string) => kind === "schema" ? { ...schema, areas: [value] } : { ...doc, frontmatter: { extra: value }, markdown: "짧음" }
      const uri = kind === "schema" ? "board://schema" : "board://doc/doc%3A1"
      for (const size of [20000, 20001]) {
        const prefix = "😀\"\n"
        const result = make(prefix + "x".repeat(size - JSON.stringify(make(prefix)).length))
        expect(JSON.stringify(result).length).toBe(size)
        if (kind === "schema") ops.schema = () => result as ReturnType<DocsOps["schema"]>
        else ops.fetch = () => result as ReturnType<DocsOps["fetch"]>
        if (size === 20000) {
          const response = await client.readResource({ uri })
          expect(resourceText(response.contents[0])).toBe(kind === "schema" ? JSON.stringify(result) : "짧음")
        } else {
          await expect(client.readResource({ uri })).rejects.toThrow(/좁|limit|section|offset/)
        }
      }
    } finally { await client.close() }
  })

  test("one shared handler isolates inverted asynchronous authentication for tools, resources and rejection", async () => {
    const { ops, calls, doc } = fakeOps()
    ops.fetch = (owner, input) => { calls.push({ method: "fetch", args: [owner, input] }); return { ...doc, ref: input.ref, markdown: `owner:${owner}` } }
    let armed = false
    const pending = new Map<string, () => void>()
    let allEntered: () => void = () => {}
    const entered = new Promise<void>(resolve => { allEntered = resolve })
    const authOrder: string[] = []
    const startOrder: string[] = []
    const handler = mcpHandler(ops, { authenticate: async request => {
      const id = request.headers.get("x-test-principal")!
      if (armed) {
        startOrder.push(id)
        await new Promise<void>(resolve => { pending.set(id, resolve); if (pending.size === 3) allEntered() })
        authOrder.push(id)
        if (id === "denied") return null
      }
      return { owner: id, via: "bearer" }
    } })
    const makeClient = async (id: string) => {
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { requestInit: { headers: { "x-test-principal": id } }, fetch: (url, init) => handler(new Request(url, init)) })
      const client = new Client({ name: "test-client", version: "1" })
      await client.connect(transport)
      return client
    }
    const [alice, bob, denied] = await Promise.all([makeClient("alice"), makeClient("bob"), makeClient("denied")])
    try {
      armed = true
      const first = alice.callTool({ name: "board_fetch", arguments: { ref: "doc:alice" } })
      const second = bob.readResource({ uri: "board://doc/doc%3Abob" })
      const third = denied.callTool({ name: "board_fetch", arguments: { ref: "doc:denied" } }).then(() => false, () => true)
      await entered
      expect(startOrder).toEqual(["alice", "bob", "denied"])
      pending.get("bob")!()
      const bobResult = await second
      expect(resourceText(bobResult.contents[0])).toBe("owner:bob")
      pending.get("denied")!()
      expect(await third).toBe(true)
      expect(calls).toEqual([{ method: "fetch", args: ["bob", { ref: "doc:bob", view: "markdown" }] }])
      pending.get("alice")!()
      const aliceResult = await first
      expect(structured(aliceResult)?.markdown).toBe("owner:alice")
      expect(authOrder).toEqual(["bob", "denied", "alice"])
      expect(calls).toEqual([
        { method: "fetch", args: ["bob", { ref: "doc:bob", view: "markdown" }] },
        { method: "fetch", args: ["alice", { ref: "doc:alice" }] },
      ])
    } finally { await Promise.all([alice.close(), bob.close(), denied.close()]) }
  })

  test("lists and reads schema and document templates with canonical encoded refs", async () => {
    const { ops, calls, schema } = fakeOps()
    const client = await connect(ops)
    try {
      expect((await client.listResources()).resources.map(item => item.uri)).toEqual(["board://schema"])
      expect((await client.listResourceTemplates()).resourceTemplates.map(item => item.uriTemplate)).toEqual(["board://doc/{ref}"])
      const resource = await client.readResource({ uri: "board://schema" })
      expect(JSON.parse(resourceText(resource.contents[0]))).toEqual(schema)
      for (const ref of ["doc:한글", "doc:a/b", "doc:100%", "doc:a?b#c", "doc:%2F", "doc:MiXeD"]) {
        const uri = `board://doc/${encodeURIComponent(ref)}`
        const result = await client.readResource({ uri })
        expect(result.contents).toEqual([{ uri, mimeType: "text/markdown", text: "내용" }])
        expect(calls.at(-1)).toEqual({ method: "fetch", args: ["alice", { ref, view: "markdown" }] })
      }
      const uri = "board://doc/doc%3a%ED%95%9C"
      await client.readResource({ uri })
      expect(calls.at(-1)?.args[1]).toEqual({ ref: "doc:한", view: "markdown" })
      const count = calls.length
      for (const uri of ["board://doc/doc%", "board://doc/doc%GG", "board://doc/doc%3Afoo?x=1", "board://doc/doc%3Afoo#bar", "board://doc/doc:foo", "board://doc/a/b", "board://doc/", "board://schema?x=1", "board://doc/%61"]) {
        await expect(client.readResource({ uri })).rejects.toThrow()
      }
      expect(calls).toHaveLength(count)
    } finally { await client.close() }
  })

  test("truncated resource leaves markdown intact and supplies separate continuation metadata", async () => {
    const { ops, doc } = fakeOps()
    const client = await connect(ops)
    try {
      ops.fetch = () => ({ ...doc, markdown: "부분", truncated: true, nextOffset: 2 })
      const { contents } = await client.readResource({ uri: "board://doc/doc%3A1" })
      expect(resourceText(contents[0])).toBe("부분")
      expect(JSON.parse(resourceText(contents[1]))).toEqual({ truncated: true, nextOffset: 2, guidance: expect.stringContaining("board_fetch") })
      ops.fetch = () => ({ ...doc, truncated: true })
      const missing = await client.readResource({ uri: "board://doc/doc%3A1" })
      expect(JSON.parse(resourceText(missing.contents[1]))).not.toHaveProperty("nextOffset")
      ops.fetch = () => { throw new DocsError(404, "없는 문서") }
      await expect(client.readResource({ uri: "board://doc/doc%3A1" })).rejects.toThrow("없는 문서")
      ops.fetch = () => { throw new Error("private-secret") }
      await expect(client.readResource({ uri: "board://doc/doc%3A1" })).rejects.not.toThrow("private-secret")
    } finally { await client.close() }
  })

  test("authentication fails closed for every request even with forged loopback headers", async () => {
    const { ops, calls } = fakeOps()
    for (const authenticate of [() => null, () => { throw new Error("secret-token") }, () => ({ owner: "", via: "loopback" as const })]) {
      const handler = mcpHandler(ops, { authenticate })
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await handler(new Request("http://127.0.0.1/mcp", { method, headers: { Host: "localhost", "X-Forwarded-For": "127.0.0.1", Authorization: "Bearer secret-token", Origin: "http://localhost" } }))
        expect(response.status).toBe(401)
        expect(await response.text()).not.toContain("secret-token")
      }
    }
    expect(calls).toEqual([])
  })

  test("concurrent request-bound loopback and bearer principals never mix owners", async () => {
    const { ops, calls } = fakeOps()
    const clients = await Promise.all([connect(ops, { owner: "alice", via: "loopback" }), connect(ops, { owner: "bob", via: "bearer" })])
    try {
      await Promise.all(Array.from({ length: 20 }, (_, i) => clients[i % 2].callTool({ name: "board_fetch", arguments: { ref: `doc:${i}` } })))
      await Promise.all(clients.map(client => client.readResource({ uri: "board://doc/doc%3Ashared" })))
      for (let i = 0; i < 20; i++) expect(calls).toContainEqual({ method: "fetch", args: [i % 2 ? "bob" : "alice", { ref: `doc:${i}` }] })
      for (const owner of ["alice", "bob"]) expect(calls).toContainEqual({ method: "fetch", args: [owner, { ref: "doc:shared", view: "markdown" }] })
    } finally { await Promise.all(clients.map(client => client.close())) }
  })

  test("foreign resource access is denied by owner-scoped DocsOps", async () => {
    const { ops, doc } = fakeOps()
    ops.fetch = (owner, input) => {
      if (owner !== "alice") throw new DocsError(404, "문서를 찾을 수 없습니다.")
      return { ...doc, ref: input.ref }
    }
    const [alice, bob] = await Promise.all([connect(ops, { owner: "alice", via: "loopback" }), connect(ops, { owner: "bob", via: "bearer" })])
    try {
      expect(resourceText((await alice.readResource({ uri: "board://doc/doc%3Aprivate" })).contents[0])).toBe("내용")
      await expect(bob.readResource({ uri: "board://doc/doc%3Aprivate" })).rejects.toThrow("문서를 찾을 수 없습니다")
    } finally { await Promise.all([alice.close(), bob.close()]) }
  })

  test("authenticate runs on each SDK request and denied follow-up never reaches DocsOps", async () => {
    const { ops, calls } = fakeOps()
    let allow = true
    let authenticates = 0
    const handler = mcpHandler(ops, { authenticate: () => { authenticates++; return allow ? { owner: "alice", via: "bearer" } : null } })
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (url, init) => handler(new Request(url, init)) })
    const client = new Client({ name: "test-client", version: "1" })
    try {
      await client.connect(transport)
      await client.listTools()
      expect(authenticates).toBeGreaterThanOrEqual(3)
      allow = false
      await expect(client.callTool({ name: "board_schema", arguments: {} })).rejects.toThrow()
      expect(calls).toEqual([])
    } finally { await client.close() }
  })
})

describe("metadata over MCP", () => {
  test("board_search forwards props and prop sort, board_act documents meta and props", async () => {
    const { ops, calls } = fakeOps()
    const client = await connect(ops)
    try {
      const tools = (await client.listTools()).tools
      const search = tools.find(t => t.name === "board_search")!
      expect(JSON.stringify(search.inputSchema)).toContain("props")
      expect(search.description).toContain("prop:")
      expect(tools.find(t => t.name === "board_act")!.description).toContain("props: 필수 do, ref")
      const props = [{ key: "금액", op: "gte", value: 100 }, { key: "단계", op: "exists" }]
      const ok = await client.callTool({ name: "board_search", arguments: { props, sort: "-prop:금액" } })
      expect(ok.isError).toBeUndefined()
      expect(calls.at(-1)).toEqual({ method: "search", args: ["alice", { props, sort: "-prop:금액" }] })
      for (const args of [{ sort: "title" }, { props: [{ key: "a", op: "like", value: 1 }] }]) expect((await client.callTool({ name: "board_search", arguments: args })).isError).toBe(true)
      await client.callTool({ name: "board_act", arguments: { actions: [{ do: "meta", ref: "doc:1", status: "done" }, { do: "props", ref: "doc:1", set: { 단계: "계약" } }] } })
      expect(calls.at(-1)).toEqual({ method: "act", args: ["alice", [{ do: "meta", ref: "doc:1", status: "done" }, { do: "props", ref: "doc:1", set: { 단계: "계약" } }]] })
    } finally { await client.close() }
  })
})
