// 기기 저장 이름 하나의 상태(읽기 전·읽기 실패·깨짐·쓰기 실패)를 화면에 알리는 공용 장치(규칙 B, 014_write_inventory.md).
// AI 정리 칩·먼저 기록(intents)·지금 판이 같이 써요: 못 읽었거나 깨졌으면 "없음"으로 보지 않고 새 제출·덮어쓰기를 막고
// 다시 읽기·버리고 새로를 보여요. 쓰기 실패는 막지 않고 확인을 요청해요. 빠른 추가 기록·쓰던 초안은 자리별 저장(quick/slotStore.ts)이에요.
// PR #43 리뷰: 다시 읽는 중·버리는 중에는 단추 없이 그 상태를 보여요(버리는 동안 다시 읽기·새 제출이 닫혀요). 한 파일이 여러 기록을 담으면(split)
// 버릴 때 성한 기록은 남기고 깨진 것만 버려요 — 나눌 수 없으면(못 읽음·JSON 아님) 확인창에 모두 버려진다고 밝혀요.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useSmallStore } from './stored'
import type { SmallStore, StorePlan } from './smallStore'
import { slotGate, storeProblemText, type SlotNotice } from './quick/recovery'
import { planFileDiscard, type PlanResult } from '@direction-board/contracts/slot-store'

/**
 * retry = 실제로 다시 읽기(성공하면 오류 상태가 풀려요). 버리고 새로는 규칙 F(PR #43 리뷰 2): plan = 확인창을 띄울 때 지금 본 것으로 계획을 만들어요
 * (지울 곳 하나 + 확인창 글, 버릴 것이 없으면 null), apply = 확인창 뒤 그 계획만 실행(전제가 바뀌었으면 아무것도 지우지 않고 "changed").
 * busy = 다시 읽는 중·버리는 중(그동안 단추가 없어요)
 */
export type StoreIssue = SlotNotice & { retry?: () => void; plan?: () => Promise<StorePlan | null>; apply?: (plan: StorePlan) => Promise<PlanResult>; busy?: 'reload' | 'reset' }
/** 여러 기록을 담은 파일의 깨진 값을 나눠요: 성한 기록만 남긴 값과 버릴 개수. 나눌 수 없으면 null */
export type Split<T> = (raw: unknown) => { keep: T; dropped: number; kept: number } | null

/** 다시 읽는 중·버리는 중 안내(단추 없음), 버리지 못했으면 다시 시도 안내 */
export function busyNotice(what: string, busy: 'reload' | 'reset', kind: 'read' | 'corrupt' | null): StoreIssue {
  return { kind: kind ?? 'read', text: busy === 'reset' ? `${what} 기록을 버리는 중이에요…` : `${what} 기록을 다시 읽는 중이에요…`, busy }
}
export const resetFailedText = (text: string) => text.split(' · ')[0] + ' · 버리지 못했어요 · 다시 시도해 주세요'

export function useStoreGate<T>(name: string, check: (v: unknown) => v is T, empty: T, what?: string, split?: Split<T>): { store: SmallStore; ready: boolean; ok: boolean; canSubmit: boolean; problem: 'read' | 'corrupt' | null; issue: StoreIssue | null } {
  const store = useSmallStore()
  useEffect(() => void store.load(name, check), [store, name, check])
  useSyncExternalStore(
    useCallback((l: () => void) => store.subscribe(name, l), [store, name]),
    () => store.version(name),
  )
  const ready = store.ready(name)
  const problem = store.problem(name)
  const busy = store.busy(name)
  const gate = slotGate({ ready, problem, writeFailed: store.writeFailed(name) }, what)
  const label = what ?? '빠른 추가'
  const notice = gate.notice
  const issue: StoreIssue | null = busy
    ? busyNotice(label, busy, store.retrying(name))
    : notice
      ? notice.kind === 'write'
        ? notice
        : {
            ...notice,
            ...(what ? { text: storeProblemText(what, notice.kind) } : {}),
            ...(store.resetFailed(name) ? { text: resetFailedText(what ? storeProblemText(what, notice.kind) : notice.text) } : {}),
            retry: () => void store.reload(name, check),
            // 확인창을 띄울 때 지금 파일을 읽어 계획을 만들어요(깨진 기록만·통째로 — 확인창 글이 그 범위를 밝혀요)
            plan: async () => planFileDiscard({ key: name, seen: await store.see(name) }, check, empty, label, split),
            apply: (p: StorePlan) => store.apply(p),
          }
      : null
  // ok: 다 읽었고 읽기 문제가 없음(규칙 E — 이것만 준비 완료). 버리는 동안은 ready 가 아니에요(새 제출이 닫혀요)
  return { store, ready, ok: ready && !problem, canSubmit: gate.canSubmit, problem, issue }
}
