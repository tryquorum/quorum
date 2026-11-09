import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpTokenCreated, McpTokenList } from "@direction-board/contracts/settings";
import { accessJwt, mcpCall, startIsolated, type Isolated } from "./test/isolated.ts";

let servers: Isolated[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.stop(); });
const start = async (env: Record<string, string> = {}) => { const s = await startIsolated(env); servers.push(s); return s; };
const access = async (email = "jun@lidgeai.com") => ({ "cf-access-jwt-assertion": await accessJwt({ email }) });
const make = (base: string, name: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/mcp-tokens`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ name }) });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe("MCP connection tokens", () => {
  test("secret is returned once, stored only as a hash, works on /mcp until revoked", async () => {
    const s = await start({ AGENT_OWNER: "agent-owner@example.com" });
    const r = await make(s.local, "  노트북 Codex  ");
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { token, secret } = await r.json() as McpTokenCreated;
    expect(secret).toMatch(/^dbt_[A-Za-z0-9_-]{43}$/);
    expect(token).toMatchObject({ name: "노트북 Codex", prefix: secret.slice(0, 12), lastUsedAt: null, revokedAt: null });
    const listed = await (await fetch(`${s.local}/api/mcp-tokens`)).text();
    expect(listed).not.toContain(secret);
    expect(listed).not.toContain("hash");

    const pub = await mcpCall(s.pub, "tools/list", bearer(secret));
    expect(pub.status).toBe(200);
    expect(pub.body.result.tools).toHaveLength(7);
    expect((await mcpCall(s.local, "tools/list", bearer(secret))).status).toBe(200);

    const db = new Database(join(s.dir, "board.db"), { readonly: true });
    const row = db.query("SELECT * FROM mcp_tokens WHERE id=?").get(token.id) as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.hash).toBe(new Bun.CryptoHasher("sha256").update(secret).digest("hex"));
    // MCP 주인은 AGENT_OWNER 가 아니라 토큰을 만든 사람
    expect(row.owner).toBe("jun@lidgeai.com");
    const used = row.last_used_at as number;
    expect(used).toBeGreaterThan(0);
    await mcpCall(s.pub, "tools/list", bearer(secret));
    expect((db.query("SELECT last_used_at FROM mcp_tokens WHERE id=?").get(token.id) as { last_used_at: number }).last_used_at).toBe(used);
    expect(JSON.stringify(db.query("SELECT * FROM events").all())).not.toContain(secret);
    db.close();

    const revoked = await fetch(`${s.local}/api/mcp-tokens/${token.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
    expect((await revoked.json() as { token: { revokedAt: number } }).token.revokedAt).toBeGreaterThan(0);
    expect((await mcpCall(s.pub, "tools/list", bearer(secret))).status).toBe(401);
    // 폐기·틀린 Bearer 는 로컬 무인증 루프백으로 넘어가지 않아요
    expect((await mcpCall(s.local, "tools/list", bearer(secret))).status).toBe(401);
    expect((await mcpCall(s.local, "tools/list", bearer("dbt_wrong"))).status).toBe(401);
    expect((await mcpCall(s.local, "tools/list")).status).toBe(200);
    expect((await fetch(`${s.local}/api/mcp-tokens/${token.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${s.local}/api/mcp-tokens/0123456789abcdef`, { method: "DELETE" })).status).toBe(404);
    expect(await readFile(join(s.dir, "board.db"), "latin1")).not.toContain(secret);
    const logs = await s.logs();
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(row.hash as string);
  }, 20000);

  test("bearer scheme is case-insensitive everywhere and never falls back to human or loopback auth", async () => {
    const s = await start();
    const { token, secret } = await (await make(s.local, "case")).json() as McpTokenCreated;
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      const h = { authorization: `${scheme} ${secret}` };
      expect((await mcpCall(s.pub, "tools/list", h)).status).toBe(200);
      expect((await fetch(`${s.local}/api/mcp-tokens`, { headers: h })).status).toBe(401);
      expect((await fetch(`${s.pub}/api/me`, { headers: { cookie: `CF_Authorization=${await accessJwt()}`, ...h } })).status).toBe(401);
      expect((await fetch(`${s.pub}/api/me`, { headers: { authorization: `${scheme} test-agent-token` } })).status).toBe(200);
    }
    for (const other of ["Basic dXNlcjpwYXNz", "Token abc", "Bearer"]) {
      expect((await fetch(`${s.local}/api/mcp-tokens`, { headers: { authorization: other } })).status).toBe(401);
      expect((await mcpCall(s.local, "tools/list", { authorization: other })).status).toBe(401);
    }
    await fetch(`${s.local}/api/mcp-tokens/${token.id}`, { method: "DELETE" });
    expect((await mcpCall(s.local, "tools/list", { authorization: `bearer ${secret}` })).status).toBe(401);
  }, 20000);

  test("MCP calls with a connection token act as the token's creator", async () => {
    const s = await start({ AGENT_OWNER: "agent-owner@example.com" });
    // 로컬 개발자(jun)의 문서. 토큰은 jun 이 만들었으니 찾고, AGENT_TOKEN(다른 주인)은 못 찾아요
    expect((await fetch(`${s.local}/api/docs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "ownerprobe 문서", md: "ownerprobe" }) })).status).toBe(200);
    const { secret } = await (await make(s.local, "owner")).json() as McpTokenCreated;
    const search = (h: Record<string, string>) => mcpCall(s.local, "tools/call", h, { name: "board_search", arguments: { q: "ownerprobe" } });
    const mine = await search(bearer(secret));
    expect(mine.status).toBe(200);
    expect(mine.body.result.structuredContent.results.length).toBeGreaterThan(0);
    const agent = await search(bearer("test-agent-token"));
    expect(agent.status).toBe(200);
    expect(agent.body.result.structuredContent.results).toHaveLength(0);
  }, 20000);

  test("only the Mac owner human manages tokens; connection tokens never reach REST", async () => {
    const s = await start();
    const { secret } = await (await make(s.local, "a")).json() as McpTokenCreated;
    expect((await make(s.pub, "x", await access("other@example.com"))).status).toBe(403);
    expect((await fetch(`${s.pub}/api/mcp-tokens`, { headers: await access("other@example.com") })).status).toBe(403);
    for (const base of [s.local, s.pub]) {
      expect((await make(base, "x", bearer("test-agent-token"))).status).toBe(403);
      expect((await fetch(`${base}/api/mcp-tokens`, { headers: bearer("test-agent-token") })).status).toBe(403);
    }
    // 연결 토큰 Bearer 는 로컬 개발자 로그인이나 공개 주인 Access 와 함께 와도 REST 에서 401
    expect((await fetch(`${s.local}/api/mcp-tokens`, { headers: bearer(secret) })).status).toBe(401);
    expect((await make(s.local, "x", bearer(secret))).status).toBe(401);
    expect((await fetch(`${s.pub}/api/mcp-tokens`, { headers: { ...await access(), ...bearer(secret) } })).status).toBe(401);
    expect((await fetch(`${s.local}/api/state`, { headers: bearer(secret) })).status).toBe(401);
    expect((await fetch(`${s.pub}/api/me`, { headers: { cookie: `CF_Authorization=${await accessJwt()}`, ...bearer(secret) } })).status).toBe(401);
    expect((await make(s.pub, "owner", await access())).status).toBe(201);
  }, 20000);

  test("browser mutations must come from the listener's own origin", async () => {
    const s = await start();
    const own = `http://127.0.0.1:${s.localPort}`;
    for (const extra of [{ origin: "http://127.0.0.1:5999" }, { origin: "http://localhost:5999" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])
      expect((await make(s.local, "x", extra)).status).toBe(403);
    expect((await make(s.local, "own", { origin: own, "sec-fetch-site": "same-origin" })).status).toBe(201);
    const { token } = await (await make(s.local, "cli")).json() as McpTokenCreated;
    expect((await fetch(`${s.local}/api/mcp-tokens/${token.id}`, { method: "DELETE", headers: { origin: "http://127.0.0.1:5999" } })).status).toBe(403);
    const owner = await access();
    expect((await make(s.pub, "x", { ...owner, origin: "https://evil.example" })).status).toBe(403);
    expect((await make(s.pub, "x", { ...owner, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await make(s.pub, "x", { ...owner, origin: "https://board.example", "sec-fetch-site": "same-origin" })).status).toBe(201);
  }, 20000);

  test("validation, active limit and a listing that never hides active tokens", async () => {
    const s = await start();
    for (const bad of ["", "   ", "a".repeat(41), "탭\t이름"]) expect((await make(s.local, bad)).status).toBe(400);
    const oldest = (await (await make(s.local, "oldest")).json() as McpTokenCreated).token;
    for (let i = 0; i < 55; i++) {
      const { token } = await (await make(s.local, `tmp ${i}`)).json() as McpTokenCreated;
      expect((await fetch(`${s.local}/api/mcp-tokens/${token.id}`, { method: "DELETE" })).status).toBe(200);
    }
    for (let i = 0; i < 19; i++) expect((await make(s.local, `k${i}`)).status).toBe(201);
    expect((await make(s.local, "over")).status).toBe(409);
    const { tokens } = await (await fetch(`${s.local}/api/mcp-tokens`)).json() as McpTokenList;
    expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(20);
    expect(tokens.some((t) => t.id === oldest.id)).toBe(true);
    expect(tokens.filter((t) => t.revokedAt !== null)).toHaveLength(20);
  }, 30000);

  test("an AGENT_TOKEN that starts with dbt_ keeps working on both listeners", async () => {
    const s = await start({ AGENT_TOKEN: "dbt_legacy-agent-token" });
    expect((await mcpCall(s.pub, "tools/list", bearer("dbt_legacy-agent-token"))).status).toBe(200);
    expect((await mcpCall(s.local, "tools/list", bearer("dbt_legacy-agent-token"))).status).toBe(200);
    expect((await fetch(`${s.pub}/api/me`, { headers: bearer("dbt_legacy-agent-token") })).status).toBe(200);
  }, 20000);
});
