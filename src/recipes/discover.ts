// 깨진 레시피의 새 경로 찾기. http 후보를 순서대로 시도하고, 모두 실패하면 (있을 때만) Aside 로 실제 페이지에서 찾아요.
// 후보는 검증(verify)을 통과해야만 채택해요. 실패한 후보와 이유는 모두 돌려줘서 이벤트·기억에 남겨요.
import { buildDiscoverScript, parseProbes } from "./aside"
import { callRecipe, checkBody, fixedSegments, templatize } from "./call"
import { classifyRunError, RecipeError, RUN_ERROR_MESSAGE } from "./errors"
import { endpointOf, fill, stripSecretParams } from "./spec"
import type { Candidate, RecipeCtx, RecipeDef, RequestSpec } from "./types"

export type Attempt = { via: "http" | "aside"; endpoint: string; ok: boolean; status?: number; reason?: string }
export type Found = { candidate: Candidate; result: unknown; via: "http" | "aside"; status: number }
export type DiscoverOut = { found: Found | null; attempts: Attempt[]; asideError?: string }

/** recalled: gbrain 에서 회상한 지난 수리 경로. 정의에 적힌 후보보다 먼저 시도해요 */
export async function discover(def: RecipeDef, ctx: RecipeCtx & { vars: Record<string, string> }, onAttempt: (a: Attempt) => void, recalled: Candidate[] = []): Promise<DiscoverOut> {
  const attempts: Attempt[] = []
  const note = (a: Attempt) => { attempts.push(a); onAttempt(a) }
  const broken = endpointOf(def.request)
  // 같은 URL 이라도 머리글(쿠키)이 다르면 다른 후보예요
  const keyOf = (q: RequestSpec) => `${q.method} ${q.url} ${JSON.stringify(q.headers || {})}`
  const tried = new Set<string>([keyOf(def.request)])
  for (const c of [...recalled, ...(def.discover.http?.candidates || [])]) {
    const endpoint = endpointOf(c.request)
    if (tried.has(keyOf(c.request))) continue
    tried.add(keyOf(c.request))
    try {
      const r = await callRecipe({ request: c.request, parse: c.parse || def.parse, verify: def.verify }, ctx.vars, ctx.fetch, ctx.timeoutMs)
      note({ via: "http", endpoint, ok: true, status: r.status })
      return { found: { candidate: c, result: r.result, via: "http", status: r.status }, attempts }
    } catch (e) {
      if (!(e instanceof RecipeError)) throw e
      note({ via: "http", endpoint, ok: false, status: e.status, reason: e.message })
    }
  }
  const a = def.discover.aside
  if (!a || !ctx.aside) return { found: null, attempts }
  // 로그인이 필요한 경로(401)도 브라우저 안에서는 통할 수 있어서 http 후보를 다시 넣어 시도해요
  const probes: string[] = []
  for (const c of [{ request: def.request }, ...(def.discover.http?.candidates || [])]) {
    try { probes.push(fill(c.request.url, ctx.vars, true)) } catch { /* 값이 없는 후보는 건너뛰어요 */ }
  }
  let startUrl: string
  try { startUrl = fill(a.startUrl, ctx.vars, true) } catch (e) { return { found: null, attempts, asideError: (e as Error).message } }
  const run = await ctx.aside(buildDiscoverScript(startUrl, a.match, [...new Set(probes)]))
  if (run.code !== 0) {
    const kind = classifyRunError(run.stderr || run.stdout, { spawnError: run.spawnError })
    return { found: null, attempts, asideError: `${RUN_ERROR_MESSAGE[kind]} [${kind}, exit ${run.code}] ${(run.stderr || "").trim().slice(-200)}` }
  }
  const probesOut = parseProbes(run.stdout)
  if (!probesOut.length) return { found: null, attempts, asideError: "Aside 가 후보를 하나도 보내지 않았어요" }
  const fixed = fixedSegments([def.request.url, a.startUrl, ...(def.discover.http?.candidates || []).map((c) => c.request.url)])
  // 머리글은 a.headers, 없으면 같은 호스트로 선언된 요청의 것을 물려받아요(쿠키 템플릿이 v2 에서 빠지지 않게)
  const hostOf = (u: string) => { try { return new URL(u).host } catch { return "" } }
  const declared = [def.request, ...(def.discover.http?.candidates || []).map((c) => c.request)]
  const headersFor = (u: string) => a.headers || declared.find((q) => q.headers && hostOf(q.url) === hostOf(u))?.headers
  for (const p of probesOut) {
    const url = stripSecretParams(templatize(p.url, ctx.vars, fixed))
    const headers = headersFor(url)
    const candidate: Candidate = { request: { method: a.method || "GET", url, ...(headers ? { headers } : {}) }, parse: a.parse || def.parse, note: "aside" }
    const endpoint = endpointOf(candidate.request)
    // 지금 버전과 똑같은 요청이 브라우저에서만 되면 새 버전을 만들지 않아요(서버에는 로그인 쿠키가 필요) — 같은 버전을 계속 쌓지 않게
    if (keyOf(candidate.request) === keyOf(def.request)) { note({ via: "aside", endpoint, ok: false, status: p.status, reason: p.status < 300 ? "브라우저에서만 돼요 — 서버에는 로그인 쿠키(예: LUMA_COOKIE)가 필요해요" : `HTTP ${p.status}` }); continue }
    if (p.status < 200 || p.status >= 300) { note({ via: "aside", endpoint, ok: false, status: p.status, reason: p.error || `HTTP ${p.status}` }); continue }
    try {
      const result = checkBody(p.body, candidate.parse!, def.verify)
      note({ via: "aside", endpoint, ok: true, status: p.status })
      return { found: { candidate, result, via: "aside", status: p.status }, attempts }
    } catch (e) {
      if (!(e instanceof RecipeError)) throw e
      note({ via: "aside", endpoint, ok: false, status: p.status, reason: e.message })
    }
  }
  return { found: null, attempts }
}
