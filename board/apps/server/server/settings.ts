import { join } from "node:path";
import type { McpCheck, SettingsInfo, SettingsListener } from "@direction-board/contracts/settings";
import type { User } from "./auth.ts";

export type SettingsContext = {
  listener: SettingsListener;
  macOwner: boolean;
  port: number;
  /** 이 서버에 닿는 루프백 host(127.0.0.1, [::1], localhost) */
  loopback: string;
  publicOrigin: string;
  localOpen: boolean;
  dbPath: string;
  vaultDir: string;
  repoRoot: string;
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

let build: { version: string; commit: string | null } | null = null;
/** 버전은 웹 패키지 버전, 커밋은 서버가 시작한 저장소의 HEAD. git 이 없으면 null */
async function buildInfo(repoRoot: string) {
  if (build) return build;
  let version = "0.0.0";
  try { version = String((await Bun.file(join(repoRoot, "apps", "web", "package.json")).json()).version || version); } catch { /* 기본값 */ }
  let commit: string | null = null;
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: repoRoot, stdout: "pipe", stderr: "ignore" });
    commit = p.exitCode === 0 ? p.stdout.toString().trim() || null : null;
  } catch { commit = null; }
  build = { version, commit };
  return build;
}

export async function settingsInfo(u: User, ctx: SettingsContext): Promise<SettingsInfo> {
  const { version, commit } = await buildInfo(ctx.repoRoot);
  return {
    me: { email: u.email, agent: u.agent },
    // 앱이 결과 불명 뒤 같은 키로 자동 재전송해도 되는지의 증거(runs.ts clientKey, docs/document.ts onceKey)
    capabilities: ["runClientKey", "noteOnceKey", "docCreateId"],
    listener: ctx.listener,
    macOwner: ctx.macOwner,
    version,
    commit,
    mcp: {
      localUrl: `http://${ctx.loopback}:${ctx.port}/mcp`,
      publicUrl: `${ctx.publicOrigin.replace(/\/+$/, "")}/mcp`,
      localOpen: ctx.localOpen,
      readonly: process.env.BOARD_MCP_READONLY === "1",
    },
    paths: ctx.macOwner && !u.agent ? { db: ctx.dbPath, vault: ctx.vaultDir } : null,
  };
}

/**
 * 연결 확인: 이 서버의 로컬 리스너 /mcp 에 실제 HTTP 로 initialize → tools/list 를 보내요.
 * 로컬 /mcp 가 무인증 루프백으로 열려 있어야(DEV_LOCAL_USER) 성공해요. 인증 정보는 붙이지 않아요.
 */
export async function checkMcp(loopback: string, port: number, fetcher: typeof fetch = fetch): Promise<McpCheck> {
  const started = Date.now();
  const url = `http://${loopback}:${port}/mcp`;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const done = (step: McpCheck["step"], tools: number, error: string | null): McpCheck =>
    ({ ok: step === null, step, tools, ms: Date.now() - started, error, checkedAt: Date.now() });
  const call = async (body: unknown, extra: Record<string, string> = {}) => {
    const r = await fetcher(url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (r.status === 401) throw new Error("로컬 /mcp 가 인증을 요구해요(DEV_LOCAL_USER 없음)");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { result?: any; error?: { message?: string } };
    if (data.error) throw new Error(String(data.error.message || "MCP 오류"));
    return { data, version: r.headers.get("mcp-protocol-version") };
  };
  let protocol = "2025-06-18";
  try {
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "direction-board-check", version: "1" } } });
    protocol = String(init.data.result?.protocolVersion || protocol);
  } catch (e) { return done("initialize", 0, (e as Error).message || "실패"); }
  try {
    const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { "mcp-protocol-version": protocol });
    const tools = Array.isArray(list.data.result?.tools) ? list.data.result.tools.length : 0;
    return done(null, tools, null);
  } catch (e) { return done("tools/list", 0, (e as Error).message || "실패"); }
}

/** GET /api/settings, POST /api/mcp/check */
export async function settingsApi(req: Request, parts: string[], u: User, ctx: SettingsContext): Promise<Response | null> {
  if (parts[1] === "settings" && parts.length === 2) {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    return json(await settingsInfo(u, ctx));
  }
  if (parts[1] === "mcp" && parts[2] === "check" && parts.length === 3) {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!ctx.macOwner || u.agent) return json({ error: "only the Mac owner can check MCP" }, 403);
    return json(await checkMcp(ctx.loopback, ctx.port));
  }
  return null;
}
