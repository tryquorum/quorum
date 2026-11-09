// 호스팅 시험 도구: 가짜 Cloudflare Access(JWKS·RS256 서명)와 사람별 요청 함수. 실제 Access·Aside 는 부르지 않아요.
import { createAccess, isAllowed } from "../engine/access"
import { createApp, type AppDeps } from "../server"
import type { TenantRegistry } from "./tenants"
import type { Hosted } from "./hosted"

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test" }
const CERTS = "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs"
export const ORIGIN = "https://quorum.lidgeai.com"
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
export async function jwt(email: string) {
  const data = enc({ alg: "RS256", kid: "test" }) + "." + enc({ iss: "https://test-team.cloudflareaccess.com", aud: ["test-aud"], exp: Math.floor(Date.now() / 1000) + 600, email })
  return data + "." + Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))).toString("base64url")
}
const certsFetch = (async (input: string | URL | Request) => (String(input) === CERTS ? Response.json({ keys: [jwk] }) : new Response("no", { status: 500 }))) as unknown as typeof fetch
/** 띄운 server.ts 에 preload 로 넣을 같은 키 목록 */
export const jwksForPreload = () => ({ url: CERTS, body: { keys: [jwk] } })

export type Call = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string>; bearer?: string; noJwt?: boolean; raw?: string }) => Promise<{ status: number; body: any }>

/** 공개 리스너 앱과, 이메일마다 Access 로그인(또는 Bearer 토큰)으로 부르는 함수 */
export function publicApp(deps: AppDeps, allowed: string[] = ["*"]) {
  const access = createAccess({ team: "test-team", aud: "test-aud", allowed, fetch: certsFetch })
  const app = createApp(deps, "public", { who: access.who, origin: ORIGIN, allowed: (e) => isAllowed(e, allowed) })
  const as = (email: string | null): Call => async (path, init = {}) => {
    const headers: Record<string, string> = { host: "quorum.lidgeai.com", ...(email && !init.noJwt ? { "cf-access-jwt-assertion": await jwt(email) } : {}), ...(init.bearer ? { authorization: "Bearer " + init.bearer } : {}) }
    const hasBody = init.body !== undefined || init.raw !== undefined
    if (hasBody) Object.assign(headers, { "content-type": "application/json" })
    const res = await app(new Request("http://127.0.0.1:4318" + path, { method: init.method ?? (hasBody ? "POST" : "GET"), headers: { ...headers, ...(init.headers || {}) }, ...(hasBody ? { body: init.raw ?? JSON.stringify(init.body) } : {}) }))
    const text = await res.text()
    let body: any = null
    try { body = JSON.parse(text) } catch { body = text }
    return { status: res.status, body }
  }
  return { app, as }
}
export const rpc = (name: string, args: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
export type { TenantRegistry, Hosted }

/** 의회 보류 하나를 엔진 저장소에 기록하고 Workspace 가 읽게 해요(밖에서 올린 사건은 runId 같은 예약 메타를 못 달아요) */
export async function holdSignal(g: { store: import("../engine/store").Store; workspace?: (req: Request, parts: string[], me?: string | null) => Promise<Response> }, task: string, request: string, runId = "rhold") {
  const at = new Date().toISOString()
  g.store.createRun({ runId, request, mode: "live", startedAt: at, kind: "council" })
  g.store.appendEvent({ runId, seq: 0, at, mode: "live", type: "proposal", actor: "bot:scout", text: "Draft a reply", data: { proposalId: "p1", title: "Draft a reply", executor: "aside", task } })
  g.store.appendEvent({ runId, seq: 1, at, mode: "live", type: "verdict", actor: "council", text: "hold · Draft a reply", data: { proposalId: "p1", decision: "hold", reason: "external" } })
  g.store.appendEvent({ runId, seq: 2, at, mode: "live", type: "run.end", actor: "council", text: "end", data: { status: "done" } })
  g.store.finishRun(runId, "done")
  const now = await (await g.workspace!(new Request("http://x/api/ws/now"), ["api", "ws", "now"], "judge@example.com")).json() as { needsYou: { id: string }[] }
  return now.needsYou[0]
}
