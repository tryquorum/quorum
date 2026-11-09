// 레시피 = 사이트 한 곳의 의도 하나를 부르는 방법. JSON(defs/*.json)으로 적고 runner.ts 가 실행·수리해요.
import type { QuorumEvent } from "../contract"
import type { Memory } from "./memory"
import type { AsideRunner } from "./aside"
import type { RecipeStore } from "./store"

/** 작은 JSON 스키마. 깨짐(모양이 달라짐) 판정에만 써요 */
export type MiniSchema = {
  type: "object" | "array" | "string" | "number" | "boolean" | "any"
  required?: string[]
  properties?: Record<string, MiniSchema>
  items?: MiniSchema
  minItems?: number
}
/** url·headers·body 의 {{name}} 은 vars 로 채워요(url 은 encodeURIComponent). {{env.NAME}} 은 process.env 에서 읽어요 */
export type RequestSpec = { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: string }
/** path: 응답 JSON 안의 점 경로("data.event"). pick: 결과 필드 -> 점 경로(배열이면 항목마다). markdown: pick 한 필드 중 HTML 을 마크다운으로 바꿀 것 */
export type ParseSpec = { path?: string; pick?: Record<string, string>; markdown?: string[] }
export type VerifySpec = { schema: MiniSchema; nonEmpty?: boolean }
export type Candidate = { request: RequestSpec; parse?: ParseSpec; note?: string }
export type DiscoverSpec = {
  http?: { candidates: Candidate[] }
  /** Aside 로 startUrl 을 열고 match 가 들어간 네트워크 요청 URL 을 후보로 모아요 */
  aside?: { startUrl: string; match: string; method?: "GET" | "POST"; headers?: Record<string, string>; parse?: ParseSpec }
}
export type RecipeDef = {
  id: string
  site: string
  intent: string
  version: number
  vars: string[]
  request: RequestSpec
  parse: ParseSpec
  verify: VerifySpec
  discover: DiscoverSpec
}
export type Emit = (e: QuorumEvent) => void
export type RecipeCtx = {
  vars: Record<string, string>
  runId: string
  mode?: "live" | "replay"
  /** 첫 이벤트의 seq (기본 1). 엔진이 앞에 이벤트를 냈으면 그다음 번호를 넘겨요 */
  seqStart?: number
  /** 생략하면 기본 저장소(openRecipeStore: .quorum/recipes.db 또는 QUORUM_RECIPES_DB) */
  store?: RecipeStore
  /** 생략하면 GbrainMemory(). null 이면 기억을 쓰지 않고, 그 사실을 error 이벤트로 드러내요 */
  memory?: Memory | null
  fetch?: typeof fetch
  /** 있으면 http 후보가 모두 실패했을 때 Aside 로 새 경로를 찾아요(실제 맥에서만). 생략하고 QUORUM_ASIDE=1 이면 asideRunner(). null 이면 끔 */
  aside?: AsideRunner | null
  timeoutMs?: number
}
export type RunOutcome = { ok: boolean; version: number; endpoint: string; result?: unknown; repaired?: boolean; reason?: string; nextSeq: number }
