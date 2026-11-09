import { describe, expect, test } from "bun:test";
import { BoardClient } from "./board";

type CapturedCall = {
  url: string | URL | Request;
  init?: RequestInit;
};

function makeFakeFetch(body: string, contentType = "application/json") {
  const calls: CapturedCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    });
  }) as typeof fetch;
  return { impl, calls };
}

function rpcResult(result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result });
}

describe("BoardClient", () => {
  test("plain JSON response parsing via structuredContent", async () => {
    const { impl } = makeFakeFetch(
      rpcResult({ structuredContent: { results: [], total: 0 }, content: [] }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    const out = await client.callTool("board_schema", {});
    expect(out).toEqual({ results: [], total: 0 });
  });

  test("plain JSON response parsing via text content JSON", async () => {
    const { impl } = makeFakeFetch(
      rpcResult({ content: [{ type: "text", text: JSON.stringify({ ok: true, n: 7 }) }] }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    const out = await client.callTool("board_schema", {});
    expect(out).toEqual({ ok: true, n: 7 });
  });

  test("plain JSON response parsing via raw text fallback", async () => {
    const { impl } = makeFakeFetch(
      rpcResult({ content: [{ type: "text", text: "plain text result" }] }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    const out = await client.callTool("board_schema", {});
    expect(out).toBe("plain text result");
  });

  test("SSE response parsing", async () => {
    const sseBody = [
      "event: message",
      `data: ${rpcResult({ structuredContent: { results: [{ ref: "r1", title: "t", kind: "doc", snippet: "s" }], total: 1 } })}`,
      "",
    ].join("\n");
    const { impl } = makeFakeFetch(sseBody, "text/event-stream");
    const client = new BoardClient({ fetchImpl: impl });
    const out = await client.callTool("board_search", { q: "x" });
    expect(out).toEqual({
      results: [{ ref: "r1", title: "t", kind: "doc", snippet: "s" }],
      total: 1,
    });
  });

  test("JSON-RPC error -> throws", async () => {
    const { impl } = makeFakeFetch(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    await expect(client.callTool("board_search", {})).rejects.toThrow("bad params");
  });

  test("result.isError -> throws", async () => {
    const { impl } = makeFakeFetch(
      rpcResult({ content: [{ type: "text", text: "tool blew up" }], isError: true }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    await expect(client.callTool("board_search", {})).rejects.toThrow("tool blew up");
  });

  test("search mapping", async () => {
    const { impl, calls } = makeFakeFetch(
      rpcResult({
        structuredContent: {
          results: [
            { ref: "item:1", title: "First", kind: "doc", snippet: "hello" },
            { ref: "item:2", title: "Second", kind: "todo" },
          ],
          total: 2,
        },
      }),
    );
    const client = new BoardClient({ fetchImpl: impl });
    const hits = await client.search("hello", 2);
    expect(hits).toEqual([
      { ref: "item:1", title: "First", kind: "doc", snippet: "hello" },
      { ref: "item:2", title: "Second", kind: "todo", snippet: undefined },
    ]);
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent.method).toBe("tools/call");
    expect(sent.params.name).toBe("board_search");
    expect(sent.params.arguments).toEqual({ q: "hello", limit: 2 });
  });

  test("postRunResult with writeEnabled false makes zero fetch calls", async () => {
    let count = 0;
    const impl = (async () => {
      count++;
      return new Response("{}");
    }) as typeof fetch;
    const client = new BoardClient({ fetchImpl: impl, writeEnabled: false });
    const out = await client.postRunResult({ title: "Run done", body: "# body" });
    expect(out).toEqual({ posted: false, reason: "QUORUM_BOARD_WRITE is not 1" });
    expect(count).toBe(0);
  });

  test("postRunResult with writeEnabled true sends a tools/call named board_write", async () => {
    const { impl, calls } = makeFakeFetch(
      rpcResult({ structuredContent: { ref: "item:new-doc", version: 1, applied: 1, warnings: [] } }),
    );
    const client = new BoardClient({ fetchImpl: impl, writeEnabled: true });
    const out = await client.postRunResult({ title: "Run done", body: "# body", tags: ["quorum"] });
    expect(calls.length).toBe(1);
    expect(out).toEqual({ posted: true, ref: "item:new-doc" });
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent.method).toBe("tools/call");
    expect(sent.params.name).toBe("board_write");
    expect(sent.params.arguments.mode).toBe("append");
    expect(sent.params.arguments.ref).toContain("Run done");
    expect(sent.params.arguments.md).toContain("Run done");
    expect(sent.params.arguments.md).toContain("# body");
  });

  test("Authorization header present only when token set", async () => {
    const body = rpcResult({ structuredContent: { ok: true } });

    const withToken = makeFakeFetch(body);
    const c1 = new BoardClient({ fetchImpl: withToken.impl, token: "secret-token-value" });
    await c1.callTool("board_schema", {});
    const headers1 = withToken.calls[0]?.init?.headers as Record<string, string>;
    expect(headers1["authorization"]).toBe("Bearer secret-token-value");
    expect(headers1["content-type"]).toBe("application/json");
    expect(headers1["accept"]).toBe("application/json, text/event-stream");

    const withoutToken = makeFakeFetch(body);
    const c2 = new BoardClient({ fetchImpl: withoutToken.impl, token: undefined });
    // Ensure env does not leak a token into this test.
    delete process.env.DIRECTION_TOKEN;
    const c3 = new BoardClient({ fetchImpl: withoutToken.impl });
    await c3.callTool("board_schema", {});
    const headers3 = withoutToken.calls[0]?.init?.headers as Record<string, string>;
    expect("authorization" in headers3).toBe(false);
  });

  test("available returns true on tools/list success", async () => {
    const { impl } = makeFakeFetch(rpcResult({ tools: [] }));
    const client = new BoardClient({ fetchImpl: impl });
    await expect(client.available()).resolves.toBe(true);
  });

  test("available returns false when tools/list fails", async () => {
    const impl = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const client = new BoardClient({ fetchImpl: impl });
    await expect(client.available()).resolves.toBe(false);
  });
});
