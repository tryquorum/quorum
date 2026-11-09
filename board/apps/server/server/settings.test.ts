import { afterEach, describe, expect, test } from "bun:test";
import type { McpCheck, SettingsInfo } from "@direction-board/contracts/settings";
import { accessJwt, startIsolated, type Isolated } from "./test/isolated.ts";

let servers: Isolated[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.stop(); });
const start = async (env: Record<string, string> = {}) => { const s = await startIsolated(env); servers.push(s); return s; };
const access = async (email = "jun@lidgeai.com") => ({ "cf-access-jwt-assertion": await accessJwt({ email }) });

describe("settings", () => {
  test("local owner sees MCP addresses, paths and build; AGENT_TOKEN never appears", async () => {
    const s = await start();
    const r = await fetch(`${s.local}/api/settings`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("test-agent-token");
    const info = JSON.parse(text) as SettingsInfo;
    expect(info.listener).toBe("local");
    expect(info.macOwner).toBe(true);
    expect(info.mcp).toEqual({ localUrl: `http://127.0.0.1:${s.localPort}/mcp`, publicUrl: "https://board.example/mcp", localOpen: true, readonly: false });
    expect(info.paths?.db.endsWith("board.db")).toBe(true);
    expect(typeof info.version).toBe("string");
  }, 15000);

  test("public non-owner and agent bearer get no paths; local without DEV_LOCAL_USER reports MCP closed", async () => {
    const s = await start();
    const other = await (await fetch(`${s.pub}/api/settings`, { headers: await access("other@example.com") })).json() as SettingsInfo;
    expect(other.listener).toBe("public");
    expect(other.macOwner).toBe(false);
    expect(other.paths).toBeNull();
    const owner = await (await fetch(`${s.pub}/api/settings`, { headers: await access() })).json() as SettingsInfo;
    expect(owner.macOwner).toBe(true);
    expect(owner.paths).not.toBeNull();
    const agent = await (await fetch(`${s.pub}/api/settings`, { headers: { authorization: "Bearer test-agent-token" } })).json() as SettingsInfo;
    expect(agent.me.agent).toBe(true);
    expect(agent.paths).toBeNull();
    expect((await fetch(`${s.pub}/api/settings`)).status).toBe(401);
    expect((await fetch(`${s.local}/api/settings`, { method: "POST", body: "{}" })).status).toBe(405);
  }, 15000);

  test("MCP check really calls the local /mcp and only the Mac owner may run it", async () => {
    const s = await start();
    const ok = await (await fetch(`${s.local}/api/mcp/check`, { method: "POST", body: "{}" })).json() as McpCheck;
    expect(ok).toMatchObject({ ok: true, step: null, error: null });
    expect(ok.tools).toBe(7);
    expect((await fetch(`${s.pub}/api/mcp/check`, { method: "POST", headers: await access("other@example.com"), body: "{}" })).status).toBe(403);
    expect((await fetch(`${s.pub}/api/mcp/check`, { method: "POST", headers: { authorization: "Bearer test-agent-token" }, body: "{}" })).status).toBe(403);
    expect((await fetch(`${s.local}/api/mcp/check`, { method: "POST", headers: { authorization: "Bearer test-agent-token" }, body: "{}" })).status).toBe(403);
    expect((await fetch(`${s.pub}/api/mcp/check`, { method: "POST", headers: await access(), body: "{}" })).status).toBe(200);
  }, 15000);

  test("IPv6 loopback bind shows a reachable local MCP address and the check reaches it", async () => {
    const s = await start({ HOST: "::1" });
    const info = await (await fetch(`${s.local}/api/settings`)).json() as SettingsInfo;
    expect(info.mcp.localUrl).toBe(`http://[::1]:${s.localPort}/mcp`);
    const r = await (await fetch(`${s.local}/api/mcp/check`, { method: "POST", body: "{}" })).json() as McpCheck;
    expect(r).toMatchObject({ ok: true, tools: 7 });
  }, 15000);

  test("MCP check reports the failed step when local /mcp needs auth", async () => {
    const s = await start({ DEV_LOCAL_USER: "" });
    const info = await (await fetch(`${s.pub}/api/settings`, { headers: await access() })).json() as SettingsInfo;
    expect(info.mcp.localOpen).toBe(false);
    const r = await (await fetch(`${s.pub}/api/mcp/check`, { method: "POST", headers: await access(), body: "{}" })).json() as McpCheck;
    expect(r).toMatchObject({ ok: false, step: "initialize" });
    expect(r.error).toContain("DEV_LOCAL_USER");
  }, 15000);
});
