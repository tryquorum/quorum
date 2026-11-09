import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { legacyDb } from "../docs/storage.test.ts"
import { initDocs, setHtmlToMarkdown, setStrictHtmlToMarkdown, stopDocsRefresh } from "../docs/storage.ts"
import { createDocsOps } from "../docs/ops.ts"
import { htmlToMarkdown, noteHtmlToMarkdown } from "../vault/index.ts"
import { mcpHandler } from "./handler"

// (리뷰 4) MCP board_write 도 docs write 의 onceKey 를 받고(strict 입력 스키마), 결과에 duplicate 를 실어요(출력 스키마). 실제 MCP 전송으로.
describe("MCP board_write onceKey", () => {
  test("같은 onceKey 는 한 번만, 두 번째는 duplicate true(출력 스키마 통과)", async () => {
    const db = legacyDb()
    initDocs(db)
    setHtmlToMarkdown(db, noteHtmlToMarkdown)
    setStrictHtmlToMarkdown(db, htmlToMarkdown)
    try {
      const ops = createDocsOps(db, { act: () => ({ results: [] }) })
      const { ref } = ops.create("alice", { title: "mcp once", md: "앞 글" }, "person")
      const handler = mcpHandler(ops, { authenticate: () => ({ owner: "alice", via: "bearer" }) })
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (url, init) => handler(new Request(url, init)) })
      const client = new Client({ name: "test-client", version: "1" })
      await client.connect(transport)
      const tools = await client.listTools()
      const write = tools.tools.find((t) => t.name === "board_write")!
      expect(JSON.stringify(write.inputSchema)).toContain("onceKey")
      expect(JSON.stringify(write.outputSchema)).toContain("duplicate")
      const first = await client.callTool({ name: "board_write", arguments: { ref, mode: "append", md: "에이전트 메모", onceKey: "run:m1" } })
      expect(first.isError ?? false).toBe(false)
      expect((first.structuredContent as { applied: number }).applied).toBe(1)
      const again = await client.callTool({ name: "board_write", arguments: { ref, mode: "append", md: "에이전트 메모", onceKey: "run:m1" } })
      expect(again.structuredContent).toMatchObject({ applied: 0, duplicate: true })
      // (리뷰 8) 키 없는 기존 MCP append 는 저장 마크다운이 예전 그대로(가로줄 없이 A\n\nB)
      const before = ops.note("alice", ref).md
      const plain = await client.callTool({ name: "board_write", arguments: { ref, mode: "append", md: "키 없는 메모" } })
      expect((plain.structuredContent as { applied: number }).applied).toBe(1)
      expect(ops.note("alice", ref).md).toBe(`${before}\n\n키 없는 메모`)
      await client.close()
    } finally { stopDocsRefresh(db); db.close() }
  })
})
