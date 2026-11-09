// 깨진 레시피의 새 경로 찾기. http 후보를 순서대로 시도하고, 모두 실패하면 (있을 때만) Aside 로 실제 페이지에서 찾아요.
// 후보는 검증(verify)을 통과해야만 채택해요. 실패한 후보와 이유는 모두 돌려줘서 이벤트·기억에 남겨요.
import { buildDiscoverScript, parseProbes } from "./aside"
import { callRecipe, checkBody, templatize } from "./call"
import { classifyRunError, RecipeError, RUN_ERROR_MESSAGE } from "./errors"
import { endpointOf, fill } from "./spec"
import type { Candidate, RecipeCtx, RecipeDef } from "./types"

export type Attempt = { via: "http" | "aside"; endpoint: string; ok: boolean; status?: number; reason?: string }
export type Found = { candidate: Candidate; result: unknown; via: "http" | "aside"; status: number }
export type DiscoverOut = { found: Found | null; attempts: Attempt[]; asideError?: string }

export async function discover(def: RecipeDef, ctx: RecipeCtx, onAttempt: (a: Attempt) => void): Promise<DiscoverOut> {
  const attempts: Attempt[] = []
  const note = (a: Attempt) => { attempts.push(a); onAttempt(a) }
  const broken = endpointOf(def.request)
  const tried = new Set<string>([broken])
  for (const c of def.discover.http?.candidates || []) {
    const endpoint = endpointOf(c.request)
    if (tried.has(endpoint)) continue
    tried.add(endpoint)
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
  for (const p of probesOut) {
    const url = templatize(p.url, ctx.vars)
    const candidate: Candidate = { request: { method: a.method || "GET", url, ...(a.headers ? { headers: a.headers } : {}) }, parse: a.parse || def.parse, note: "aside" }
    const endpoint = endpointOf(candidate.request)
    if (endpoint === broken && p.status >= 400) { note({ via: "aside", endpoint, ok: false, status: p.status, reason: `HTTP ${p.status}` }); continue }
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
