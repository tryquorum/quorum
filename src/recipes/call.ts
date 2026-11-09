// 레시피 한 번 부르기: 요청 채우기 -> fetch -> 상태·JSON·파싱·검증. 깨지면 RecipeError(kind, status) 를 던져요.
import { breakText, RecipeError } from "./errors"
import { fill, parseBody, verifyResult } from "./spec"
import type { ParseSpec, RequestSpec, VerifySpec } from "./types"

/** headers 는 선택이라 값이 없는 {{env.X}} 머리글은 빼요. url·body 의 빈 값은 missing_var 오류 */
export function buildRequest(req: RequestSpec, vars: Record<string, string>): { method: string; url: string; headers: Record<string, string>; body?: string } {
  const headers: Record<string, string> = { accept: "application/json" }
  for (const [k, v] of Object.entries(req.headers || {})) {
    try { headers[k] = fill(v, vars) } catch (e) { if (!(e instanceof RecipeError && e.kind === "missing_var")) throw e }
  }
  return { method: req.method, url: fill(req.url, vars, true), headers, ...(req.body ? { body: fill(req.body, vars) } : {}) }
}

/** 응답 본문(JSON)을 파싱·검증. 통과하면 결과 */
export function checkBody(body: unknown, parse: ParseSpec, verify: VerifySpec): unknown {
  const result = parseBody(body, parse)
  verifyResult(result, verify)
  return result
}

export type CallOk = { status: number; result: unknown }

export async function callRecipe(spec: { request: RequestSpec; parse: ParseSpec; verify: VerifySpec }, vars: Record<string, string>, fetchFn: typeof fetch = fetch, timeoutMs = 15_000): Promise<CallOk> {
  const req = buildRequest(spec.request, vars)
  let res: Response
  try {
    res = await fetchFn(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" })
  } catch (e) {
    throw new RecipeError("network", breakText("network", String((e as Error)?.message || e)))
  }
  if (res.status === 401 || res.status === 403) throw new RecipeError("auth", breakText("auth", `HTTP ${res.status}`), res.status)
  if (!res.ok) throw new RecipeError("http", breakText("http", `HTTP ${res.status}`), res.status)
  let body: unknown
  try { body = await res.json() } catch { throw new RecipeError("parse", breakText("parse", "JSON 이 아니에요"), res.status) }
  try { return { status: res.status, result: checkBody(body, spec.parse, spec.verify) } }
  catch (e) { if (e instanceof RecipeError) throw new RecipeError(e.kind, e.message, res.status); throw e }
}

/**
 * 찾은 URL 의 vars 값 자리를 다시 {{name}} 으로 바꿔 다음 호출에도 쓰게 해요.
 * 질의 값과 경로 조각이 값과 정확히 같을 때만 바꿔요(부분 문자열을 바꾸면 slug "event" 가 /event/ 경로를 망가뜨려요).
 * fixed: 레시피에 선언된 URL 템플릿의 경로 조각. 고정 단어라 값과 같아도 바꾸지 않아요.
 */
export function templatize(url: string, vars: Record<string, string>, fixed: string[] = []): string {
  let u: URL
  try { u = new URL(url) } catch { return url }
  const nameOf = (raw: string): string | null => {
    let v = raw
    try { v = decodeURIComponent(raw) } catch { /* 그대로 비교 */ }
    for (const [name, value] of Object.entries(vars)) if (value && value === v) return name
    return null
  }
  const path = u.pathname.split("/").map((seg) => { const n = seg && !fixed.includes(seg) ? nameOf(seg) : null; return n ? `{{${n}}}` : seg }).join("/")
  const query = u.search ? "?" + u.search.slice(1).split("&").map((pair) => {
    const eq = pair.indexOf("=")
    if (eq < 0) return pair
    const n = nameOf(pair.slice(eq + 1).replace(/\+/g, " "))
    return n ? `${pair.slice(0, eq)}={{${n}}}` : pair
  }).join("&") : ""
  return `${u.protocol}//${u.host}${path}${query}`
}

/** 템플릿 URL 들의 고정 경로 조각({{..}} 아닌 것) */
export function fixedSegments(urls: string[]): string[] {
  const out = new Set<string>()
  for (const url of urls) {
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0]
    for (const seg of path.split("/")) if (seg && !seg.includes("{{")) out.add(seg)
  }
  return [...out]
}
