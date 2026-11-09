// 기록 버리기(PR #43 리뷰 3): 계획에 대상 둘(남은 기록·그 자리의 쓰던 초안)을 각자 전제와 함께 담고 확인창에 둘 다 밝혀요.
// 실행은 대상마다 원자적 비교-후-쓰기 — 초안이 그사이 바뀌었으면 초안은 남기고 "쓰던 초안이 그사이 바뀌어 남겨 뒀어요". 별도의 초안 비우기 호출은 없어요(소스 규칙).
import { discardBothNote as noteOf, recordDiscardText, type CasTarget, type DiscardBothResult as Result, type PlanResult } from '@direction-board/contracts/slot-store'
import { SAVE_FAILED, type QuickEdit } from './recovery'
import type { PendingSlot } from './pendingSlot'
import type { EditSlot } from './editSlot'

export type DiscardBoth = { record: CasTarget<string>; draft: CasTarget<string> | null; message: string }
export type DiscardBothResult = Result<QuickEdit>

/** 확인창을 띄울 때: 보인 기록이 그 자리에 그대로면 기록 대상 + (있으면) 초안 대상 + 둘 다 밝히는 글. 기록이 그사이 바뀌었으면 null */
export async function planDiscardBoth(slot: Pick<PendingSlot, 'planDiscard'>, edit: Pick<EditSlot, 'planClear'>): Promise<DiscardBoth | null> {
  const record = await slot.planDiscard()
  if (!record) return null
  const draft = await edit.planClear()
  return { record, draft, message: recordDiscardText(!!draft) }
}
/** 확인창 뒤: 대상마다 따로 실행(초안 대상이 없으면 밀린 값만 내려놓아요) */
export async function runDiscardBoth(slot: Pick<PendingSlot, 'run'>, edit: Pick<EditSlot, 'applyClear'>, plan: DiscardBoth): Promise<DiscardBothResult> {
  const record = await slot.run(plan.record)
  const d = await edit.applyClear(plan.draft)
  return { record, draft: d.r, now: d.now }
}
/** 결과 안내(둘 다 끝났으면 null — 계약 discardBothNote) */
export const discardBothNote = (x: DiscardBothResult) => noteOf(x, SAVE_FAILED)
export { draftAfterDoneNote } from '@direction-board/contracts/slot-store'
