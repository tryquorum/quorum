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

/** 찾은 URL 의 vars 값 자리를 다시 {{name}} 으로 바꿔 다음 호출에도 쓰게 해요 */
export function templatize(url: string, vars: Record<string, string>): string {
  let out = url
  for (const [name, value] of Object.entries(vars).sort((a, b) => b[1].length - a[1].length)) {
    if (!value || value.length < 3) continue
    out = out.split(encodeURIComponent(value)).join(`{{${name}}}`)
    out = out.split(value).join(`{{${name}}}`)
  }
  return out
}
