// 할 일·메모의 기록(log) 규칙 한 곳. 기록은 두 묶음이에요: 사람 기록과 자동 기록(by 가 agent·goat·system).
// - 사람 기록은 서버가 절대 지우지 않아요.
// - 자동 기록은 사람 기록 수와 상관없이 자기들끼리 최근 80개(AUTO_MAX)만 남겨요. 전체 길이는 80 을 넘을 수 있어요. 자동 기록을 못 남기는 경우는 없어요.
// - 화면 PUT 합치기(mergeLog)는 기존 배열을 그대로 두고(중복 포함), 들어온 기록 중 기존에 없는 것만 더해요. 비교는 id 가 둘 다 있으면 id, 아니면 by·at·text 필드별.
// - 정책(LogPolicy)은 파일럿에서만 줘요: 사람 기록 1000개(HUMAN_MAX) 상한(넘게 하는 새 사람 기록은 409, 그 요청 전체 미적용),
//   그리고 actor 가 있으면 새 기록의 by·at·id 를 서버가 정하고(by=로그인한 사람, at=서버 시각) 한 요청 새 기록 수·사람별 추가 빈도를 제한해요.
//   개인 방향판(정책 없음)은 보낸 by·at 을 그대로 두고 상한이 하나도 없어요.
// 설계: docs/internals/pilot.md
export type LogLine = { by: string; at: number; text: string; id?: string }
export type LogFail = { status: number; error: string }
/** 파일럿 기록 정책. humanLimit: HUMAN_MAX 상한. actor 가 있으면 새 기록을 서버가 찍고 maxNew·take(n: 빈도, 되면 센 것으로 쳐요)를 봐요 */
export type LogPolicy = { humanLimit: true; actor?: string; maxNew?: number; now?: number; take?: (n: number) => boolean }
export const AUTO_MAX = 80
export const HUMAN_MAX = 1000
const AUTO = new Set(["agent", "goat", "system"])
const ID = /^[A-Za-z0-9_-]{1,40}$/
export const isAutoLog = (e: { by?: unknown } | null | undefined): boolean => AUTO.has(String(e?.by))
export const humanCount = (log: unknown): number => (Array.isArray(log) ? log.filter((e) => !isAutoLog(e)).length : 0)
/** 새 기록의 안정 id(옛 기록은 id 없이 필드로 비교해요) */
export const logId = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 16)
export const validLogId = (v: unknown): v is string => typeof v === "string" && ID.test(v)
const fieldKey = (e: LogLine) => JSON.stringify([e.by, e.at, e.text])
const tooMany = (): LogFail => ({ status: 409, error: "사람 기록이 너무 많아요(1000개). 새 기록 없이 다시 저장해 주세요" })
const tooFast = (): LogFail => ({ status: 429, error: "기록을 너무 자주 더했어요. 잠시 뒤에 다시 해 주세요" })

/** 사람 기록은 모두, 자동 기록은 최근 AUTO_MAX 개만. 순서는 그대로 */
export function trimLog<T extends { by?: unknown }>(log: readonly T[]): T[] {
  let drop = Math.max(0, log.filter(isAutoLog).length - AUTO_MAX)
  return log.filter((e) => !(isAutoLog(e) && drop-- > 0))
}

/** 같은 기록인지: 둘 다 id 가 있으면 id, 아니면 by·at·text 를 필드별로(구분자를 쓰지 않아 섞이지 않아요) */
export function sameLine(a: LogLine, b: LogLine): boolean {
  if (a.id && b.id) return a.id === b.id
  return a.by === b.by && a.at === b.at && a.text === b.text
}

/**
 * 화면이 보낸 기록을 기존 기록에 합쳐요. 기존 배열은 순서·중복까지 그대로 두고, 들어온 기록 하나마다 아직 짝지어지지 않은
 * 기존 기록이 있으면 짝짓고(sameLine), 없으면 새 기록으로 끝에 더해요(다중집합). 실패면 LogFail(요청 전체를 받지 않아요)
 */
export function mergeLog(existing: unknown, incoming: unknown, policy?: LogPolicy): { log: LogLine[]; added: number } | LogFail {
  const base = Array.isArray(existing) ? (existing as LogLine[]) : []
  const used = new Array<boolean>(base.length).fill(false)
  const byId = new Map<string, number[]>(), byFields = new Map<string, number[]>()
  base.forEach((b, k) => {
    if (b.id) byId.set(b.id, [...(byId.get(b.id) ?? []), k])
    byFields.set(fieldKey(b), [...(byFields.get(fieldKey(b)) ?? []), k])
  })
  const added: LogLine[] = []
  for (const e of Array.isArray(incoming) ? (incoming as LogLine[]) : []) {
    const k = (e.id ? byId.get(e.id)?.find((i) => !used[i]) : undefined) ?? byFields.get(fieldKey(e))?.find((i) => !used[i] && sameLine(base[i], e))
    if (k !== undefined) { used[k] = true; continue }
    added.push(policy?.actor ? { by: policy.actor, at: policy.now ?? Date.now(), text: e.text, id: logId() } : e.id ? e : { ...e, id: logId() })
  }
  if (policy?.maxNew !== undefined && added.length > policy.maxNew) return { status: 409, error: `새 기록은 한 번에 ${policy.maxNew}개까지예요` }
  const newHumans = added.filter((e) => !isAutoLog(e)).length
  if (policy && newHumans && humanCount(base) + newHumans > HUMAN_MAX) return tooMany()
  if (policy?.take && newHumans && !policy.take(newHumans)) return tooFast()
  return { log: trimLog([...base, ...added]), added: added.length }
}

/** 기록 하나 덧붙이기(id 를 붙여요). 정책이 있을 때만: 사람 기록이 HUMAN_MAX 에 닿았으면 409, 빈도를 넘으면 429. 자동 기록은 언제나 남아요 */
export function appendLog(prev: unknown, entry: LogLine, policy?: LogPolicy): LogLine[] | LogFail {
  const list = Array.isArray(prev) ? (prev as LogLine[]) : []
  if (policy && !isAutoLog(entry)) {
    if (humanCount(list) >= HUMAN_MAX) return tooMany()
    if (policy.take && !policy.take(1)) return tooFast()
  }
  return trimLog([...list, { ...entry, id: entry.id ?? logId() }])
}
