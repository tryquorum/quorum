// 시험용 격리 서버: 임시 디렉터리의 DB·거울, 빈 포트, 가짜 Access 인증서. 실제 data/ 와 3070 은 건드리지 않아요.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const serverPath = resolve(import.meta.dir, "../../server.ts");
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "test" };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** 시험 Access 팀이 서명한 JWT. payload 로 이메일 등을 바꿔요 */
export async function accessJwt(payload: Record<string, unknown> = {}): Promise<string> {
  const data = `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: "https://test-team.cloudflareaccess.com", aud: ["test-aud"], exp: Math.floor(Date.now() / 1000) + 600, email: "jun@lidgeai.com", ...payload })}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))).toString("base64url")}`;
}

async function freePort(): Promise<number> {
  for (;;) {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const port = Number(probe.port);
    await probe.stop(true);
    if (![3070, 3071, 3090, 3091].includes(port)) return port;
  }
}

export type Isolated = { local: string; pub: string; localPort: number; dir: string; stop: () => Promise<void>; logs: () => Promise<string> };

export async function startIsolated(overrides: Record<string, string> = {}): Promise<Isolated> {
  const dir = await mkdtemp(join(tmpdir(), "board-settings-test-"));
  const localPort = await freePort();
  let publicPort = await freePort();
  while (publicPort === localPort) publicPort = await freePort();
  const preload = join(dir, "preload.ts");
  await writeFile(preload, `const original = globalThis.fetch;\nglobalThis.fetch = (input, init) => String(input) === "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs" ? Promise.resolve(Response.json(${JSON.stringify({ keys: [jwk] })})) : original(input, init);\n`);
  const env = { PATH: "/usr/bin:/bin", HOME: dir, PORT: String(localPort), PUBLIC_PORT: String(publicPort), HOST: "127.0.0.1", DEV_LOCAL_USER: "jun@lidgeai.com", AGENT_TOKEN: "test-agent-token", ACCESS_TEAM: "test-team", ACCESS_AUD: "test-aud", ALLOWED_EMAILS: "jun@lidgeai.com,other@example.com", PUBLIC_ORIGIN: "https://board.example", DB_PATH: join(dir, "board.db"), VAULT_DIR: join(dir, "vault"), ASIDE_BIN: "/usr/bin/false", GOAT_BIN: "/usr/bin/false", ASIDE_ACCOUNT: `test_${crypto.randomUUID()}`, ...overrides };
  const proc = Bun.spawn([process.execPath, "--preload", preload, serverPath], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  let stopped: Promise<string> | null = null;
  // 멈추면서 서버 stdout·stderr 를 모아요(비밀값이 로그에 남지 않는지 시험)
  const finish = () => stopped ||= (async () => {
    proc.kill(); await proc.exited;
    const out = await new Response(proc.stdout).text() + await new Response(proc.stderr).text();
    await rm(dir, { recursive: true, force: true });
    return out;
  })();
  const stop = async () => { await finish(); };
  const logs = finish;
  const loop = env.HOST === "::1" ? "[::1]" : "127.0.0.1";
  const local = `http://${loop}:${localPort}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${local}/api/health`)).ok) return { local, pub: `http://127.0.0.1:${publicPort}`, localPort, dir, stop, logs }; } catch { /* 아직 시작 중 */ }
    if (proc.exitCode !== null) throw new Error(`server exited: ${await finish()}`);
    await Bun.sleep(50);
  }
  await stop();
  throw new Error("server startup timeout");
}

/** /mcp 에 JSON-RPC 한 번. 상태 코드와 본문을 돌려줘요 */
export async function mcpCall(base: string, method: string, headers: Record<string, string> = {}, params: unknown = {}) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { status: r.status, body: r.status === 200 ? await r.json() as any : null };
}
