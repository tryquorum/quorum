// 규칙 F "확인한 계획만 실행"(PR #43 리뷰 2)의 웹 쪽: localStorage 키 하나를 지금 읽은 것(전제)과 계획 실행.
// 계획은 계약 slot-store.ts(planSlotDiscard·planRecordDiscard·planFileDiscard)가 만들고, 여기서는 읽기·실행만 해요.
import { premiseHolds, type CasTarget, type DiscardPlan, type PlanResult, type Seen } from "@direction-board/contracts/slot-store"

type StorageLike = Pick<Storage, "getItem" | "setItem">
export type WebPlan = DiscardPlan<string>
export type WebTarget = CasTarget<string>

/** 키 하나를 지금 읽어요: 없음 · 원문 · 못 읽음 */
export function seeKey(storage: StorageLike, key: string): Seen {
  try {
    const text = storage.getItem(key)
    return text === null ? { s: "absent" } : { s: "text", text }
  } catch {
    return { s: "unreadable" }
  }
}

/**
 * 원자적 비교-후-쓰기(PR #43 리뷰 3, iOS SmallStore.compareAndWrite 와 같은 모양): 전제의 키들을 다시 읽어 모두 같을 때만 쓸 곳 하나에 써요.
 * 다르거나(다시 읽기 실패 포함 — 전제가 원문·없음이었으면) 아무것도 쓰지 않고 "changed", 쓰기 실패면 "failed". localStorage 는 동기라
 * 읽기와 쓰기 사이에 다른 쓰기가 끼지 못해요. 모든 버리기·초기화는 이것 하나로만(소스 규칙)
 */
export function compareAndWrite(storage: StorageLike, plan: CasTarget<string>): PlanResult {
  for (const [i, p] of plan.premises.entries()) if (!premiseHolds(plan, i, seeKey(storage, p.key))) return "changed"
  try {
    storage.setItem(plan.write.key, JSON.stringify(plan.write.value))
    return "done"
  } catch {
    return "failed"
  }
}
