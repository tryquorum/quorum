// 빠른 추가 실패 기록 자리(범위별 기기 저장, 자리마다 파일 하나 — PR #43 리뷰). 한 줄·상세 시트·목표 할 일이 자리별로 써요.
// 규칙은 계약 quick-recovery.ts, 자리별 저장·옛 묶음 읽어 넘기기는 slotStore.ts(계약 slot-store.ts).
// 기록을 지우는 길은 done(끝난 결과를 받아야 해요)과 discard(사람의 버리기 — 화면은 확인창 안에서만 불러요) 둘뿐이에요(리뷰 16).
// 닫기·뒤로·화면 내리기는 아무것도 지우지 않아요(writeRules·quickRecord 시험이 소스로 고정).
import { useCallback } from 'react'
import type { Done } from '@direction-board/contracts/quick-recovery'
import { isPending, migrateSlots, slotGate, SLOTS, type Pending } from './recovery'
import { useSlotStore, type SlotKind } from './slotStore'
import type { StoreIssue } from '../storeGate'
import type { CasTarget, PlanResult } from '@direction-board/contracts/slot-store'

export type SlotIssue = StoreIssue

// 지금 보내는 중인 추가(먼저 기록한 자리). 보내는 동안에는 그 기록을 "결과 불명"으로 보이지 않게 숨겨요(끝나면 바로 고쳐 써요)
const sending = new Set<string>()

const noticeText = (problem: 'read' | 'corrupt') => slotGate({ ready: true, problem, writeFailed: false }).notice?.text ?? ''
export const RECORDS: SlotKind<Pending> = {
  base: SLOTS,
  isOne: isPending,
  migrate: migrateSlots,
  what: '빠른 추가 기록',
  text: noticeText,
  writeText: slotGate({ ready: true, problem: null, writeFailed: true }).notice?.text,
}

export type PendingSlot = {
  /** 그 자리의 기록(없으면 null) */
  pending: Pending | null
  /** 그 자리의 기록을 잘 읽었는지(규칙 C — 읽기 전·못 읽음·깨짐·버리는 중이면 화면은 입력을 막아요) */
  loaded: boolean
  /** 새로 제출해도 되는지(다 읽기 전·읽기 실패·깨짐·버리는 중이면 false, 리뷰 6) */
  ready: boolean
  issue: SlotIssue | null
  /** 보내기 전에 기록을 남기고 기기에 닿을 때까지 기다려요(규칙 B). 실패하면 false 라 보내지 않아요 */
  writeAhead: (p: Pending) => Promise<boolean>
  /** 끝나지 않은 결과의 기록을 남겨요(지우는 길이 아니에요). 기기에 닿지 못하면 false(규칙 D) */
  keep: (p: Pending) => Promise<boolean>
  /** 끝(done)난 그 기록만 지워요 */
  done: (r: Done) => void
  /**
   * 사람의 버리기 계획(규칙 F, PR #43 리뷰 3): 그 화면에 보인 기록을 비우는 대상 — 지금 읽은 그 자리 기록이 본 것과 같을 때만, 아니면 null(그사이 바뀜).
   * 실행은 확인창 뒤 run(대상) — 원자적 비교-후-쓰기. 화면은 quick/discardBoth.ts 로 쓰던 초안 대상과 함께 계획해요
   */
  planDiscard: () => Promise<CasTarget<string> | null>
  /** 대상 하나 실행(비교-후-쓰기): done·changed·busy·failed */
  run: (t: CasTarget<string>) => Promise<PlanResult>
}

/**
 * 그 자리의 기록과 바꾸는 길. 읽지 못한 동안은 바꾸기도 무시해요(읽지 못한 파일을 빈 값으로 덮지 않게) — "버리고 새로"만 덮어요.
 * 그 자리 파일에만 써요 — 다른 자리의 기록은 다른 파일이라 이 자리의 깨짐·버리기가 닿지 않아요(PR #43 리뷰)
 */
export function usePendingSlot(slot: string): PendingSlot {
  const s = useSlotStore(RECORDS, slot)
  const { now, put: write, planShown, run: runTarget } = s
  const put = useCallback(
    async (p: Pending | null): Promise<boolean> => {
      const was = now()
      if (was) sending.delete(was.id)
      return write(p)
    },
    [now, write],
  )
  const keep = useCallback((p: Pending) => put(p), [put])
  const done = useCallback(
    (r: Done) => {
      // 그 자리의 기록이 이 결과의 것일 때만(다른 추가의 기록을 지우지 않게)
      const was = now()
      if (!was || was.id === r.id) void put(null)
    },
    [now, put],
  )
  // 화면에 보인 기록(이 그림의 mine)이 그 자리에 그대로 있을 때만 버리는 대상
  const shown = s.value
  const planDiscard = useCallback(async () => (shown ? planShown(shown) : null), [shown, planShown])
  const run = useCallback(
    async (t: CasTarget<string>) => {
      if (shown) sending.delete(shown.id)
      return runTarget(t)
    },
    [shown, runTarget],
  )
  const writeAhead = useCallback(
    async (p: Pending) => {
      sending.add(p.id)
      const ok = await write(p)
      if (!ok) sending.delete(p.id)
      return ok
    },
    [write],
  )
  // 옛 자리 이름(리뷰 18 전 개발 빌드)의 기록도 그 대상의 새 자리에서 보여요(계약 migrateSlots — slotView 가 옛 묶음을 읽을 때)
  const mine = s.value
  return { pending: mine && !sending.has(mine.id) ? mine : null, loaded: s.ok, ready: s.ok, issue: s.issue, writeAhead, keep, done, planDiscard, run }
}
