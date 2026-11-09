// 자리별 기기 저장(PR #43 리뷰): 빠른 추가 기록·편집 초안을 자리(한 줄·상세 시트·목표 할 일 × 대상)마다 따로 둬요.
// 한 자리의 깨짐·버리기가 다른 자리에 닿지 않게요. 예전에는 범위마다 한 묶음({ 자리: 값 })에 모았는데, 그 묶음은
// 그 자리 파일이 아직 없을 때만 읽어 넘겨요(그 자리의 다음 쓰기가 자리 파일로 옮겨요 — 앱이 스스로 쓰지 않아요).
// 웹(lib/quick-slot.ts, localStorage 키)과 iOS(features/board/quick/slotStore.ts, 범위 폴더의 파일)가 같은 판정을 써요.
import { legacySlotKind } from "./quick-recovery.ts"

/** 저장 이름 하나를 읽은 결과: 읽는 중 · 못 읽음 · 깨짐(JSON 아님) · 없음 · 값 */
export type Raw = { s: "loading" } | { s: "read" } | { s: "corrupt" } | { s: "absent" } | { s: "value"; v: unknown }
/**
 * 자리 하나의 상태. 문제의 level 은 버리기가 닿는 곳이에요:
 * slot = 그 자리만(자리 파일을 비워요 — 다른 자리 그대로), bundle = 옛 묶음 전체(그 안 모든 자리가 버려져요 — 확인창이 밝혀요)
 */
export type SlotView<T> = { s: "loading" } | { s: "ok"; value: T | null } | { s: "read" | "corrupt"; level: "slot" | "bundle" }

/** 자리의 저장 이름(옛 묶음 이름 + "." + 자리). 파일 이름·저장소 키로 그대로 쓸 수 있게 자리를 인코딩해요 */
export const slotName = (base: string, slot: string) => base + "." + encodeURIComponent(slot)

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/**
 * 자리 파일(own)이 있으면 그것만(null 은 "비어 있음"), 없으면 옛 묶음(bundle)에서 그 자리를 읽어요.
 * 옛 묶음 안에서 다른 자리 항목이 깨졌어도 이 자리는 읽고, 이 자리 항목이 깨졌으면 이 자리만의 문제예요.
 * 묶음 자체를 못 읽었거나 나눌 수 없으면(JSON 아님·객체 아님·어느 자리인지 모를 옛 이름의 깨진 항목) 묶음 단위 문제예요
 */
export function slotView<T>(own: Raw, bundle: Raw, slot: string, isOne: (v: unknown) => v is T, migrate: (m: Record<string, T>) => Record<string, T>): SlotView<T> {
  if (own.s === "loading") return own
  if (own.s === "read" || own.s === "corrupt") return { s: own.s, level: "slot" }
  if (own.s === "value") return own.v === null ? { s: "ok", value: null } : isOne(own.v) ? { s: "ok", value: own.v } : { s: "corrupt", level: "slot" }
  if (bundle.s === "loading") return bundle
  if (bundle.s === "read" || bundle.s === "corrupt") return { s: bundle.s, level: "bundle" }
  if (bundle.s === "absent") return { s: "ok", value: null }
  if (!plain(bundle.v)) return { s: "corrupt", level: "bundle" }
  const good: Record<string, T> = {}
  let mine = false
  for (const [k, v] of Object.entries(bundle.v)) {
    if (isOne(v)) good[k] = v
    else if (legacySlotKind(k)) return { s: "corrupt", level: "bundle" }
    else if (k === slot) mine = true
  }
  if (mine) return { s: "corrupt", level: "slot" }
  return { s: "ok", value: migrate(good)[slot] ?? null }
}

/** 옛 묶음 전체를 버릴 때 확인창 글(그 안 모든 자리가 버려져요) */
export const bundleDiscardText = (what: string) =>
  `예전 방식으로 한 파일에 모아 둔 ${what}이에요 · 버리면 그 파일 안의 모든 자리(한 줄·상세 추가·목표 할 일)의 기록이 함께 버려져요. 자리별로 따로 저장한 기록은 그대로예요.`

/**
 * 여러 기록을 담은 파일(AI 정리 칩·보낸 요청)을 버릴 때 확인창 글: 나눌 수 있으면 깨진 것만 버리고 성한 것은 남겨요,
 * 나눌 수 없으면(못 읽음·JSON 아님·모양이 다름) 통째로 버린다고 밝혀요
 */
export function recordsDiscardText(what: string, parts: { dropped: number; kept: number } | null): string {
  return parts
    ? `깨진 ${what} 기록 ${parts.dropped}개만 버리고 성한 ${parts.kept}개는 그대로 둬요.`
    : `${what} 기록 파일을 읽을 수 없어 통째로 버려요 · 그 안의 기록이 모두 사라지고, 앞에서 보낸 것이 이미 저장됐을 수 있어요.`
}

/** 규칙 F(PR #43 리뷰 2): 확인창을 띄울 때 읽은 저장 이름 하나 — 없음 · 원문 · 못 읽음. 계획의 전제예요 */
export type Seen = { s: "absent" } | { s: "text"; text: string } | { s: "unreadable" }
/**
 * 다시 읽은 것이 전제와 같은지(원문은 글자 하나까지). 못 읽음은 언제나 다름이에요 — 못 읽음끼리도(PR #43 리뷰 6: 못 읽은 값은 known 이 될 수 없고,
 * 읽기가 계속 실패하는 동안 그사이 바뀐 파일을 덮지 않게). 자동 저장·비우기·넘김 뒤 비우기는 모두 이것으로만 비교해요
 */
export const sameSeen = (a: Seen, b: Seen): boolean =>
  (a.s === "absent" && b.s === "absent") || (a.s === "text" && b.s === "text" && a.text === b.text)
/** 사람이 확인창에서 고른 계획인지(규칙 F — 확인창 글이 있는 계획). 자동 저장·비우기의 대상(CasTarget)에는 확인창 글이 없어요 */
export const isConfirmedPlan = <K>(plan: CasTarget<K>): plan is DiscardPlan<K> => typeof (plan as Partial<DiscardPlan<K>>).message === "string"
/**
 * 계획의 전제 i 가 지금도 맞는지. 못 읽은 것을 전제로 쓰는 길은 하나뿐 — 사람이 확인창에서 고른 "읽지 못한 것 버리기" 계획이고, 지금도 읽지 못할 때만이에요.
 * 그 밖의 전제는 sameSeen(못 읽음은 언제나 다름). 비교-후-쓰기(iOS SmallStore·웹 store-plan)는 이것으로만 전제를 봐요
 */
export function premiseHolds<K>(plan: CasTarget<K>, i: number, now: Seen): boolean {
  const seen = plan.premises[i]?.seen
  if (!seen) return false
  if (seen.s === "unreadable") return isConfirmedPlan(plan) && now.s === "unreadable"
  return sameSeen(seen, now)
}
/** 읽은 것을 판정용 Raw 로 */
export function rawOfSeen(x: Seen): Raw {
  if (x.s === "unreadable") return { s: "read" }
  if (x.s === "absent") return { s: "absent" }
  try {
    return { s: "value", v: JSON.parse(x.text) as unknown }
  } catch {
    return { s: "corrupt" }
  }
}
/**
 * 규칙 F "확인한 계획만 실행": 확인창을 띄울 때 만든 계획. 전제(읽은 이름마다 본 것)와 쓸 곳(이 계획이 지우는 대상 — 늘 하나), 확인창 글.
 * 실행은 이 객체만 받아 전제를 다시 읽고, 다르거나(다시 읽기 실패 포함) 하면 아무것도 쓰지 않고 "changed" 예요 — 더 넓은 삭제로 바꾸는 길은 없어요
 */
export type DiscardPlan<K = string> = CasTarget<K> & { message: string }
/**
 * 원자적 비교-후-쓰기의 대상 하나(PR #43 리뷰 3): 전제(이름마다 본 것)가 지금도 같을 때만 그 이름 하나에 값을 써요. 모든 버리기·초기화는
 * 대상마다 이것 하나로만 실행해요(iOS SmallStore.compareAndWrite, 웹 store-plan compareAndWrite)
 */
export type CasTarget<K = string> = { premises: { key: K; seen: Seen }[]; write: { key: K; value: unknown } }
/** done = 썼음, changed = 전제와 달라 0건, busy = 앞선 쓰기가 아직 끝나지 않아 0건, failed = 쓰기 실패 */
export type PlanResult = "done" | "changed" | "busy" | "failed"
/** 앞선 쓰기가 끝나지 않아 아무것도 지우지 않았을 때 안내 */
export const BUSY_TEXT = "기기 저장이 아직 끝나지 않았어요 · 아무것도 지우지 않았어요. 잠시 뒤 다시 해 주세요"
/** 기록은 버렸지만 쓰던 초안이 그사이 바뀌어 남겨 뒀을 때 */
export const DRAFT_KEPT_TEXT = "쓰던 초안이 그사이 바뀌어 남겨 뒀어요"
/** 기록 버리기 확인창 글(그 자리의 쓰던 초안도 같이 버릴 때는 둘 다 밝혀요) */
export const recordDiscardText = (withDraft: boolean) =>
  withDraft ? "이 기록과 이 자리의 쓰던 초안을 버려요 · 앞에서 보낸 것이 이미 저장됐을 수 있어요. 버린 뒤에는 목록에서 직접 확인해 주세요." : "이 기록을 버려요 · 앞에서 보낸 것이 이미 저장됐을 수 있어요. 버린 뒤에는 목록에서 직접 확인해 주세요."
/**
 * 그 자리의 쓰던 초안을 비우는 대상(전제 = 지금 읽은 자리 파일·옛 묶음). 읽어 보니 초안이 없거나 읽지 못하면 null(비우지 않아요 — 읽지 못한 초안은 그 안내가 따로 있어요)
 */
export function planDraftClear<T, K>(own: { key: K; seen: Seen }, bundle: { key: K; seen: Seen }, slot: string, isOne: (v: unknown) => v is T, migrate: (m: Record<string, T>) => Record<string, T>): CasTarget<K> | null {
  const v = slotView(rawOfSeen(own.seen), rawOfSeen(bundle.seen), slot, isOne, migrate)
  return v.s === "ok" && v.value !== null ? { premises: [own, bundle], write: { key: own.key, value: null } } : null
}
/** 대상 하나의 결과 안내(done 이면 null) */
export const resultText = (r: PlanResult, failed: string): string | null => (r === "done" ? null : r === "changed" ? CHANGED_TEXT : r === "busy" ? BUSY_TEXT : failed)
/** 계획과 다르게 바뀌어 아무것도 지우지 않았을 때 안내 */
export const CHANGED_TEXT = "그사이 바뀌었어요 · 아무것도 지우지 않았어요. 다시 확인해 주세요"
/** 자리 하나만 버릴 때 확인창 글 */
export const slotDiscardText = (what: string) => `이 자리의 ${what}만 버려요 · 앞에서 보낸 것이 이미 저장됐을 수 있어요. 다른 자리의 기록은 그대로예요.`

/**
 * 자리 하나의 버리기 계획(지금 읽은 자리 파일·옛 묶음으로). 문제가 없으면 null(버릴 것 없음).
 * 그 자리 문제면 자리 파일만 비우고(null), 옛 묶음 자체의 문제면 묶음을 비워요({}) — 확인창 글이 그 범위를 밝혀요
 */
export function planSlotDiscard<T, K>(own: { key: K; seen: Seen }, bundle: { key: K; seen: Seen }, slot: string, isOne: (v: unknown) => v is T, migrate: (m: Record<string, T>) => Record<string, T>, what: string): DiscardPlan<K> | null {
  const v = slotView(rawOfSeen(own.seen), rawOfSeen(bundle.seen), slot, isOne, migrate)
  if (v.s === "ok" || v.s === "loading") return null
  const premises = [own, bundle]
  return v.level === "bundle" ? { premises, write: { key: bundle.key, value: {} }, message: bundleDiscardText(what) } : { premises, write: { key: own.key, value: null }, message: slotDiscardText(what) }
}
/**
 * 자리에 남은 기록 하나(화면에 보인 그 기록)를 버리는 계획: 지금 읽은 자리의 값이 본 기록과 같을 때만, 그 자리 파일을 비워요. 다르면 null(바뀜)
 */
export function planRecordDiscard<T, K>(own: { key: K; seen: Seen }, bundle: { key: K; seen: Seen }, slot: string, isOne: (v: unknown) => v is T, migrate: (m: Record<string, T>) => Record<string, T>, shown: T, message: string): DiscardPlan<K> | null {
  const v = slotView(rawOfSeen(own.seen), rawOfSeen(bundle.seen), slot, isOne, migrate)
  if (v.s !== "ok" || JSON.stringify(v.value) !== JSON.stringify(shown)) return null
  return { premises: [own, bundle], write: { key: own.key, value: null }, message }
}
/**
 * 기록 여럿을 담은 파일 하나(AI 정리 칩·보낸 요청)나 값 하나(화면 설정)의 버리기·초기화 계획. 지금 읽은 것이 없거나 멀쩡하면 null.
 * split 이 있으면 깨진 기록만 버리고 성한 것은 남겨요(확인창이 개수를 밝힘), 나눌 수 없으면 empty 로(확인창이 통째로라고 밝힘)
 */
export function planFileDiscard<T, K>(file: { key: K; seen: Seen }, check: (v: unknown) => boolean, empty: T, what: string, split?: (raw: unknown) => { keep: T; dropped: number; kept: number } | null, message?: string): DiscardPlan<K> | null {
  const raw = rawOfSeen(file.seen)
  if (raw.s === "absent" || (raw.s === "value" && check(raw.v))) return null
  const parts = raw.s === "value" && split ? split(raw.v) : null
  return { premises: [file], write: { key: file.key, value: parts ? parts.keep : empty }, message: message ?? (split ? recordsDiscardText(what, parts) : `${what} 기록을 버리고 새로 시작해요 · 앞에서 보낸 것이 이미 저장됐을 수 있어요.`) }
}

/** 기록 버리기(기록·쓰던 초안 두 대상)의 결과(PR #43 리뷰 3) */
export type DiscardBothResult<E> = { record: PlanResult; draft: PlanResult; now: E | null }
/** 기록 버리기 결과 안내(둘 다 끝났으면 null) — 기록이 안 지워졌으면 그 까닭, 초안이 그사이 바뀌었으면 남겨 뒀다고 */
export function discardBothNote<E>(x: DiscardBothResult<E>, failed: string): string | null {
  if (x.record !== "done") return resultText(x.record, failed)
  if (x.draft === "changed") return DRAFT_KEPT_TEXT
  return resultText(x.draft, failed)
}
/** 제출이 끝난(done) 뒤 쓰던 초안 비우기 결과 안내 — 바뀌었으면 남겨 둔 것을, 못 지웠으면 다음에 다시 보일 수 있음을 */
export const draftAfterDoneNote = (r: PlanResult, failed: string): string | null => (r === "done" ? null : r === "changed" ? DRAFT_KEPT_TEXT : failed)
