// AI 모델 카탈로그(GET /api/models)와 고른 모델. 웹 명령창·설정과 iOS AI 탭·설정이 같은 규칙으로 골라요.
// 출처: apps/server/server/runs.ts modelCatalog().

export type ModelInfo = { id: string; name: string; efforts: string[] }
export type ProviderInfo = { id: string; label: string; status: "ok" | "expired"; models: ModelInfo[] }
export type ModelCatalog = { providers: ProviderInfo[]; default: { provider: string; modelId: string; effort: string } }
export type ModelChoice = { provider: string; model: string; effort: string }

/** 고른 값이 지금 카탈로그에서 쓸 수 있으면(제공자 ok, 모델 있음) 그대로, 아니면 서버 기본 모델. 카탈로그가 아직 없으면 고른 값 */
export function validChoice(cat: ModelCatalog | null, choice: ModelChoice | null): ModelChoice | null {
  if (!cat) return choice
  const ok = choice && cat.providers.some((p) => p.id === choice.provider && p.status === "ok" && p.models.some((m) => m.id === choice.model))
  if (ok) return choice
  return { provider: cat.default.provider, model: cat.default.modelId, effort: cat.default.effort }
}

/** 모델을 바꿀 때의 생각 수준: 지금 수준을 그 모델이 받으면 그대로, 아니면 high, 그것도 없으면 마지막 수준 */
export function pickEffort(model: ModelInfo, current: string | null | undefined): string {
  if (current && model.efforts.includes(current)) return current
  if (model.efforts.includes("high")) return "high"
  return model.efforts[model.efforts.length - 1] ?? current ?? "high"
}

/** 고른 모델 정보(이름·수준 목록). 카탈로그에 없으면 null */
export function findModel(cat: ModelCatalog | null, choice: Pick<ModelChoice, "provider" | "model"> | null): { provider: ProviderInfo; model: ModelInfo } | null {
  const provider = cat?.providers.find((p) => p.id === choice?.provider)
  const model = provider?.models.find((m) => m.id === choice?.model)
  return provider && model ? { provider, model } : null
}

/** 검색어에 맞는 모델(이름·id·제공자 이름의 부분 일치), 최대 40개 */
export function searchModels(cat: ModelCatalog | null, query: string): { provider: ProviderInfo; model: ModelInfo }[] {
  const s = query.trim().toLowerCase()
  if (!s || !cat) return []
  return cat.providers.flatMap((p) => p.models.filter((m) => `${m.name} ${m.id} ${p.label}`.toLowerCase().includes(s)).map((m) => ({ provider: p, model: m }))).slice(0, 40)
}

export const EFFORT_LABEL: Record<string, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", ultrabrowse: "Ultrabrowse" }
export const effortLabel = (effort: string) => EFFORT_LABEL[effort] ?? effort
