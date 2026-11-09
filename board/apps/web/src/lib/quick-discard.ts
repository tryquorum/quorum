// 웹 기록 버리기(PR #43 리뷰 3): 계획에 대상 둘(남은 기록·그 자리의 쓰던 초안)을 각자 전제와 함께 담고 확인창에 둘 다 밝혀요.
// 실행은 대상마다 비교-후-쓰기 — 초안이 그사이 바뀌었으면 초안은 남겨요. 별도의 초안 비우기 호출은 없어요(소스 규칙). iOS quick/discardBoth.ts 와 같은 흐름
import { discardBothNote as noteOf, recordDiscardText, type DiscardBothResult } from "@direction-board/contracts/slot-store"
import { SAVE_FAILED, type QuickEdit } from "@direction-board/contracts/quick-recovery"
import type { QuickEditSlot, QuickSlot } from "@/lib/quick-slot"
import type { WebTarget } from "@/lib/store-plan"

export type DiscardBoth = { record: WebTarget; draft: WebTarget | null; message: string }

/** 확인창을 띄울 때: 보인 기록이 그 자리에 그대로면 기록 대상 + (있으면) 초안 대상 + 둘 다 밝히는 글. 기록이 그사이 바뀌었으면 null */
export function planDiscardBoth(slot: Pick<QuickSlot, "planDiscard">, edit: Pick<QuickEditSlot, "planClear">): DiscardBoth | null {
  const record = slot.planDiscard()
  if (!record) return null
  const draft = edit.planClear()
  return { record, draft, message: recordDiscardText(!!draft) }
}
/** 확인창 뒤: 대상마다 따로 실행 */
export function runDiscardBoth(slot: Pick<QuickSlot, "run">, edit: Pick<QuickEditSlot, "applyClear">, plan: DiscardBoth): DiscardBothResult<QuickEdit> {
  const record = slot.run(plan.record)
  const d = edit.applyClear(plan.draft)
  return { record, draft: d.r, now: d.now }
}
export const discardBothNote = (x: DiscardBothResult<QuickEdit>) => noteOf(x, SAVE_FAILED)
export { draftAfterDoneNote } from "@direction-board/contracts/slot-store"
