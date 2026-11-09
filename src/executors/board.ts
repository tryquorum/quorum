/**
 * Direction Board MCP client (JSON-RPC 2.0 over HTTP POST to <baseUrl>/mcp).
 *
 * Live server: QUORUM_BOARD_URL (default http://127.0.0.1:3070).
 * Headers required by the server: content-type: application/json and
 * accept: application/json, text/event-stream. Loopback calls need no auth;
 * when DIRECTION_TOKEN is set (or a token is passed via options) an
 * Authorization: Bearer <token> header is added. The token is never logged.
 *
 * board_write inputSchema (live tools/list, 2026-11-09):
 *   - ref: string, minLength 1 (required) — target document ref.
 *   - mode: "append" | "replace" | "patch" (required).
 *   - md: required when mode is "append" or "replace" (per allOf).
 *   - expectedVersion: required when mode is "replace" or "patch" (per allOf).
 *   - edits: required when mode is "patch" (minItems 1, per allOf).
 *   - idempotencyKey / onceKey: optional.
 * postRunResult uses ref + mode "append" + md + onceKey: ref identifies the
 * run-result document, mode "append" is the only mode that does not need
 * expectedVersion or edits, md carries title+body+tags, and onceKey
 * ("quorum:run:<title>") makes retries idempotent. The ref returned in the
 * board_write result (structuredContent.ref) is treated as the created ref.
 */

export type BoardClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  token?: string;
  writeEnabled?: boolean;
};

export type BoardSearchHit = {
  ref: string;
  title: string;
  kind: string;
  snippet?: string;
};

type JsonRpcResponse = {
  result?: {
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: { code?: number; message?: string; data?: unknown };
  [key: string]: unknown;
};

function parseSseBody(body: string): unknown {
  let parsed: unknown;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
  }
  return parsed;
}

export class BoardClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly writeEnabled: boolean;
  private nextId = 1;

  constructor(opts: BoardClientOptions = {}) {
    const envUrl = process.env.QUORUM_BOARD_URL;
    this.baseUrl = (opts.baseUrl ?? envUrl ?? "http://127.0.0.1:3070").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.token = opts.token ?? process.env.DIRECTION_TOKEN;
    this.writeEnabled = opts.writeEnabled ?? process.env.QUORUM_BOARD_WRITE === "1";
  }

  private async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;

    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    const url = `${this.baseUrl}/mcp`;

    const doFetch = () => this.fetchImpl(url, { method: "POST", headers, body: payload });

    let response: Response;
    if (timeoutMs !== undefined) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: payload,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } else {
      response = await doFetch();
    }

    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseSseBody(text);
    }
    if (parsed === undefined) throw new Error("Empty response from board MCP server");

    const rpc = parsed as JsonRpcResponse;
    if (rpc.error) throw new Error(rpc.error.message ?? `JSON-RPC error ${rpc.error.code ?? "unknown"}`);
    if (rpc.result === undefined) throw new Error("Malformed JSON-RPC response from board MCP server");
    return rpc.result;
  }

  async available(): Promise<boolean> {
    try {
      await this.request("tools/list", undefined, 3000);
      return true;
    } catch {
      return false;
    }
  }

  async callTool(name: string, args?: unknown): Promise<unknown> {
    const result = (await this.request("tools/call", { name, arguments: args ?? {} })) as {
      content?: { type?: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    if (result.isError) {
      const firstText = result.content?.find((c) => typeof c.text === "string")?.text;
      throw new Error(firstText || `Tool "${name}" reported an error`);
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    const firstText = result.content?.find((c) => typeof c.text === "string")?.text;
    if (firstText !== undefined) {
      try {
        return JSON.parse(firstText);
      } catch {
        return firstText;
      }
    }
    return result;
  }

  async search(q: string, limit = 5): Promise<BoardSearchHit[]> {
    const data = (await this.callTool("board_search", { q, limit })) as {
      results?: { ref?: unknown; title?: unknown; kind?: unknown; snippet?: unknown }[];
    };
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r) => ({
      ref: String(r.ref ?? ""),
      title: String(r.title ?? ""),
      kind: String(r.kind ?? ""),
      snippet: typeof r.snippet === "string" ? r.snippet : undefined,
    }));
  }

  async postRunResult(input: {
    title: string;
    body: string;
    tags?: string[];
  }): Promise<{ posted: false; reason: string } | { posted: true; ref: string }> {
    if (!this.writeEnabled) {
      return { posted: false, reason: "QUORUM_BOARD_WRITE is not 1" };
    }

    // board_write fields used: ref (run-result document ref), mode "append"
    // (no expectedVersion/edits needed), md (title + body + tags rendered as
    // markdown), onceKey (idempotent per run title). See header comment.
    const ref = `quorum:run:${input.title}`;
    const tagLine = input.tags && input.tags.length > 0 ? `\ntags: ${input.tags.join(", ")}` : "";
    const md = `# ${input.title}\n\n${input.body}${tagLine}\n`;
    const data = (await this.callTool("board_write", {
      ref,
      mode: "append",
      md,
      onceKey: `quorum:run:${input.title}`,
    })) as { ref?: unknown; error?: unknown };
    if (typeof data?.ref === "string") {
      return { posted: true, ref: data.ref };
    }
    if (typeof data?.error === "string") throw new Error(data.error);
    throw new Error("board_write did not return a created ref");
  }
}
