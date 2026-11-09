// 레시피 JSON 해석: 템플릿 채우기, 점 경로, 작은 스키마 검사, 응답 파싱·검증.
import { htmlToMarkdownLenient } from "./html-to-markdown"
import { breakText, RecipeError } from "./errors"
import type { MiniSchema, ParseSpec, RequestSpec, VerifySpec } from "./types"

const VAR = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

/** {{name}} 을 채워요. url 에서는 encodeURIComponent. 없는 값은 missing_var 오류 */
export function fill(template: string, vars: Record<string, string>, encode = false): string {
  return template.replace(VAR, (_, name: string) => {
    const v = name.startsWith("env.") ? process.env[name.slice(4)] : vars[name]
    if (v === undefined || v === "") throw new RecipeError("missing_var", `값이 없어요: ${name}`)
    return encode ? encodeURIComponent(v) : v
  })
}

/** 사람에게 보여 줄 경로: 질의 값은 템플릿 그대로(비밀·긴 id 를 이벤트에 싣지 않게) */
export function endpointOf(req: RequestSpec): string {
  return `${req.method} ${req.url}`
}

/** 점 경로("data.event.name"). "a|b" 는 앞에서부터 값이 있는 첫 경로. 빈 경로는 값 그대로 */
export function getPath(value: unknown, path?: string): unknown {
  if (!path) return value
  for (const alt of path.split("|")) {
    let cur: unknown = value
    for (const key of alt.trim().split(".")) {
      if (cur === null || cur === undefined) break
      cur = (cur as Record<string, unknown>)[key]
    }
    if (cur !== undefined && cur !== null) return cur
  }
  return undefined
}

function pickOne(item: unknown, spec: ParseSpec): unknown {
  if (!spec.pick) return item
  const out: Record<string, unknown> = {}
  for (const [field, path] of Object.entries(spec.pick)) {
    let v = getPath(item, path)
    if (spec.markdown?.includes(field) && typeof v === "string") v = htmlToMarkdownLenient(v)
    out[field] = v
  }
  return out
}

/** 응답 JSON 을 레시피 결과로. path 가 없는 값이면 parse 오류 */
export function parseBody(body: unknown, spec: ParseSpec): unknown {
  const at = getPath(body, spec.path)
  if (at === undefined) throw new RecipeError("parse", breakText("parse", `${spec.path || "$"} 없음`))
  return Array.isArray(at) ? at.map((x) => pickOne(x, spec)) : pickOne(at, spec)
}

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)

/** 작은 스키마 검사. 오류 문장 목록(비면 통과) */
export function validate(value: unknown, schema: MiniSchema, path = "$"): string[] {
  if (schema.type !== "any" && typeOf(value) !== schema.type) return [`${path}: ${schema.type} 이어야 하는데 ${typeOf(value)}`]
  const errors: string[] = []
  if (schema.type === "object") {
    const obj = value as Record<string, unknown>
    for (const key of schema.required || []) if (obj[key] === undefined || obj[key] === null) errors.push(`${path}.${key}: 없음`)
    for (const [key, sub] of Object.entries(schema.properties || {})) if (obj[key] !== undefined && obj[key] !== null) errors.push(...validate(obj[key], sub, `${path}.${key}`))
  }
  if (schema.type === "array") {
    const arr = value as unknown[]
    if (schema.minItems !== undefined && arr.length < schema.minItems) errors.push(`${path}: 최소 ${schema.minItems}개인데 ${arr.length}개`)
    if (schema.items) arr.slice(0, 50).forEach((x, i) => errors.push(...validate(x, schema.items!, `${path}[${i}]`)))
  }
  return errors
}

/** 검증: 스키마가 다르면 schema, 빈 결과를 허용하지 않으면 verify 오류 */
export function verifyResult(result: unknown, spec: VerifySpec): void {
  const errors = validate(result, spec.schema)
  if (errors.length) throw new RecipeError("schema", breakText("schema", errors.slice(0, 3).join("; ")))
  const empty = Array.isArray(result) ? result.length === 0 : result && typeof result === "object" ? Object.keys(result).length === 0 : result === "" || result == null
  if (spec.nonEmpty && empty) throw new RecipeError("verify", breakText("verify", "빈 결과"))
}
