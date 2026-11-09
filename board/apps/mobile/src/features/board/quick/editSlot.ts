// 빠른 추가 편집 중 초안(PR #39 리뷰 17). 자리(bar·sheet·goal:<id>)마다 제출 기록(pendingSlot.ts, 고정)과 따로, 아직 보내지 않은 입력을
// 범위별 기기 저장(자리마다 파일 하나 — PR #43 리뷰, slotStore.ts)에 둬요. 짧은 지연(400ms)으로 저장하고, 화면을 닫거나 내릴 때·앱이 뒤로 갈 때 바로 저장해요(지우지 않아요).
// 다시 열면 편집 초안이 먼저예요(잠긴 기록이면 기록의 초안 — 계약 restoreSource). 지우는 길은 done·버리기·사람이 칸을 다 비움.
// 규칙 E(리뷰 22): 읽는 중·읽기 실패·깨짐이면 준비 완료가 아니에요 — 입력·자동 저장·자동 삭제가 없고, 안내와 다시 읽기·버리고 새로(확인창)를 보여요.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { EDITS, editEmpty, editMeaning, isEdit, migrateEdits, storeProblemText, type QuickEdit } from '@direction-board/contracts/quick-recovery'
import type { StoreIssue } from '../storeGate'
import { planDraftClear, rawOfSeen, sameSeen, slotView, type CasTarget, type PlanResult, type Seen } from '@direction-board/contracts/slot-store'
import { useSlotStore, type SlotKind } from './slotStore'

export const EDIT_DRAFTS: SlotKind<QuickEdit> = { base: EDITS, isOne: isEdit, migrate: migrateEdits, what: '쓰던 초안', text: (k) => storeProblemText('쓰던 초안', k) }
/** 자리 파일에 둘 값: 빈 초안은 "초안 없음"(null)이에요 */
const asStored = (e: QuickEdit | null) => (e && !editEmpty(e) ? e : null)

export type EditSlot = {
  /** 편집 초안 저장을 잘 읽었는지(읽는 중·읽기 실패·깨짐이면 false — 규칙 E) */
  ready: boolean
  /** 그 자리의 편집 초안(준비 전에는 null) */
  initial: QuickEdit | null
  /** 읽지 못했거나 깨졌을 때의 안내(다시 읽기 = 실제로 다시 읽어요, 버리고 새로 = 확인창 뒤) */
  issue: StoreIssue | null
  /** 마지막 저장이 기기에 닿지 못했는지(규칙 D — 밀린 값은 버리지 않고 남겨 다시 저장해요) */
  failed: boolean
  /** 전제(known)나 지금 초안을 기기에서 읽지 못해 쓰지 않았는지(PR #43 리뷰 6 — 다른 곳의 초안을 덮지 않게 멈춤). 다시 저장(flush)이 다시 읽어요 */
  readFailed: boolean
  /** 아직 기기에 닿지 않은 편집이 있는지(밀렸거나 실패) — 닫기·옮기기 전에 flush 해요 */
  unsaved: () => boolean
  /** 바뀔 때마다 불러요. 준비 전이면 무시하고, 처음 읽은 값과 같으면(빈 칸 = 초안 없음 포함) 쓰지 않아요 — 사람이 바꾼 것만 저장 */
  change: (e: QuickEdit | null) => void
  /** 밀린 편집을 지금 기기에 저장(닫기·옮기기 전). 닿았거나 밀린 것이 없으면 true, 못 닿으면 false(밀린 값은 그대로) */
  flush: () => Promise<boolean>
  /**
   * 쓰던 초안 비우기 계획(PR #43 리뷰 3·5 — 무조건 비우는 길은 없어요): 밀린 편집을 저장 줄에서 먼저 저장해 보고, 이 화면이 기기에 있음을 확인한 값(known)을
   * 전제로 그 자리 초안을 비우는 대상. 그때 기기의 다른 초안은 전제가 되지 않아요(충돌 중이면 비우기 0건). known 에 초안이 없으면 null
   */
  planClear: () => Promise<CasTarget<string> | null>
  /**
   * 비우기 실행(저장 줄 안): 충돌 중(사람이 고르기 전)이면 0건 "changed"·now null — 다른 초안과 안내를 그대로 둬요(리뷰 5).
   * 대상이 있으면 원자적 비교-후-쓰기(전제가 바뀌었으면 0건 "changed" + 지금 초안 — 화면은 그 글로), 없으면 기기가 known 그대로인지만 보고(다르면 "changed" + 지금 초안)
   * 밀린 값을 내려놓아요. busy·failed 면 밀린 값도 그대로예요
   */
  applyClear: (t: CasTarget<string> | null) => Promise<{ r: PlanResult; now: QuickEdit | null }>
  /**
   * 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿨을 때(제출 끝·AI 넘김·버리기 뒤·복원·바뀜 채우기) 그 값을 "기기와 맞춘 값"으로 기록 — 자동 저장 타이머를 취소하고
   * 밀린 값을 내려놓아 자동 저장이 그것을 사람 편집처럼 쓰지 않아요. 화면은 setByProgram 으로만 불러요
   */
  adopt: (e: QuickEdit | null, forSlot?: string) => void
  /** 자동 저장이 "다른 곳에서 바뀐 초안"을 만나 쓰지 않았는지(전제 = 이 화면이 마지막으로 읽거나 쓴 기기 값) */
  conflict: boolean
  /** 충돌 · 불러오기: 지금 기기 초안을 돌려주고 그것을 새 전제로(화면은 setByProgram 으로 칸에). 읽지 못하면 undefined(아무것도 바꾸지 않아요) */
  takeTheirs: () => Promise<QuickEdit | null | undefined>
  /** 충돌 · 내 것으로 덮기(확인창 뒤): 잘 읽은 지금 기기 값을 새 전제로 칸의 글을 저장(읽지 못하면 쓰지 않고 false) */
  keepMine: () => Promise<boolean>
}

const keyOf = editMeaning
type Known = { slot: string; own: Seen; bundle: Seen }

/**
 * 규칙 D(리뷰 21): 저장 함수는 모두 성공 여부를 돌려주고, 실패하면 밀린 값을 버리지 않아요 — 화면은 실패면 닫기·옮기기를 하지 않아요.
 * 저장 줄(PR #43 리뷰 5): 이 화면의 기기 작업(자동 저장·비우기·불러오기·덮기)은 줄 하나로 차례차례 — 다음 저장은 앞 저장이 끝난 뒤 그때의 최신 입력으로,
 * 전제(known = 이 화면이 마지막으로 잘 읽거나 쓴 값)는 줄 안에서 읽어요(줄 밖에서 미리 잡지 않아요). 충돌 중에는 known 을 바꾸지 않아요.
 * known 은 잘 읽거나 쓴 원문(없음 포함)만이에요(PR #43 리뷰 6): 읽기가 실패하면 known 을 바꾸지 않고(처음이면 비워 두고) 쓰기 0건 + 읽기 실패 안내 —
 * 못 읽은 값을 전제로 삼는 길이 없어요(계약 sameSeen 은 못 읽음을 언제나 다름으로 봐요)
 */
export function useEditSlot(slot: string): EditSlot {
  const { ok, value, issue, okNow, run, names, seenBoth, runQuiet } = useSlotStore(EDIT_DRAFTS, slot)
  const initial = ok ? value : null
  const queued = useRef<{ e: QuickEdit | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 이 자리에서 마지막으로 기기와 맞춘 값(처음 읽은 값부터). 같은 값은 다시 쓰지 않아요(빈 칸이 "초안 지우기"가 되지 않게)
  const last = useRef<{ slot: string; key: string } | null>(null)
  // 화면이 처음 보인(복원한) 값 — 처음 known 을 늦게 읽었는데 그사이 바뀌었으면 known 으로 받되 충돌로(덮지 않게)
  const firstShown = useRef<{ slot: string; key: string } | null>(null)
  if (ok && firstShown.current?.slot !== slot) firstShown.current = { slot, key: keyOf(value) }
  const [failed, setFailed] = useState(false)
  const failedRef = useRef(false)
  const [readFailed, setReadFailed] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const mark = useCallback((done: boolean) => {
    failedRef.current = !done
    if (live.current) setFailed(!done)
  }, [])
  const markRead = useCallback((failedNow: boolean) => {
    if (live.current) setReadFailed(failedNow)
  }, [])
  const [conflict, setConflict] = useState(false)
  const conflictRef = useRef(false)
  const markConflict = useCallback((v: boolean) => {
    conflictRef.current = v
    if (live.current) setConflict(v)
  }, [])
  // 저장 줄: 앞 작업이 끝난 뒤에 시작해요(실패해도 줄은 이어져요)
  const lineRef = useRef<Promise<unknown>>(Promise.resolve())
  const inLine = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run_ = lineRef.current.then(op, op)
    lineRef.current = run_.then(
      () => undefined,
      () => undefined,
    )
    return run_
  }, [])
  /** 자리 파일·옛 묶음을 지금 읽어요. 둘 다 잘 읽혀 그 자리 초안을 알 수 있을 때만 ok(그 원문이 known 후보), 아니면 읽기 실패 안내 */
  const look = useCallback(async (): Promise<{ ok: true; known: Known; value: QuickEdit | null } | { ok: false }> => {
    const s = await seenBoth()
    const v = slotView(rawOfSeen(s.own.seen), rawOfSeen(s.bundle.seen), slot, isEdit, migrateEdits)
    if (s.own.seen.s === 'unreadable' || s.bundle.seen.s === 'unreadable' || v.s !== 'ok') {
      markRead(true)
      return { ok: false }
    }
    markRead(false)
    return { ok: true, known: { slot, own: s.own.seen, bundle: s.bundle.seen }, value: v.value }
  }, [seenBoth, slot, markRead])
  // 규칙 G: known — 자동 저장·비우기의 전제. 그 자리를 잘 읽으면 줄 안에서 바로 잡아 둬요
  const base = useRef<Known | null>(null)
  /** 지금 known(없으면 읽어 잡아요). 읽지 못하면 null — 쓰지 않아요 */
  const ensureBase = useCallback(async (): Promise<Known | null> => {
    if (base.current?.slot === slot) return base.current
    const l = await look()
    if (!l.ok) return null
    base.current = l.known
    if (firstShown.current?.slot === slot && keyOf(l.value) !== firstShown.current.key) markConflict(true)
    return base.current
  }, [slot, look, markConflict])
  useEffect(() => {
    if (ok) void inLine(ensureBase)
  }, [ok, ensureBase, inLine])
  // 줄 안에서만 불러요: 밀린 최신 입력을 known 과 비교-후-쓰기. 쓰는 동안 더 들어온 입력도 이어서(같은 줄 차례라 자기 앞 저장과 부딪치지 않아요)
  const saveInLine = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const next = queued.current
      if (!next) return true
      // 읽는 중·읽기 실패·깨짐이면 쓰지 않아요(규칙 E) — 밀린 값은 그대로, 다시 읽은 뒤에 저장해요
      if (!okNow()) return false
      // 다른 곳에서 바뀐 초안이 있으면 사람이 고를 때까지 쓰지 않아요(규칙 G)
      if (conflictRef.current) return false
      // 자동 저장도 비교-후-쓰기(규칙 G): 전제 = known(지금 줄 안에서). known 을 읽지 못하면 쓰지 않아요(리뷰 6)
      const b = await ensureBase()
      if (!b) {
        mark(false)
        return false
      }
      if (conflictRef.current) return false
      const v = asStored(next.e)
      const r = await runQuiet({ premises: [{ key: names.own, seen: b.own }, { key: names.base, seen: b.bundle }], write: { key: names.own, value: v } })
      if (r === 'done') {
        base.current = { ...b, own: { s: 'text', text: JSON.stringify(v) } }
        mark(true)
        markRead(false)
        if (queued.current === next) {
          queued.current = null
          return true
        }
        continue
      }
      if (r === 'changed') {
        // 읽지 못해 다름이면 읽기 실패(쓰지 않음), 읽혔는데 다르면 충돌 — 어느 쪽이든 known 은 그대로
        if ((await look()).ok) markConflict(true)
        else mark(false)
        return false
      }
      mark(false)
      return false
    }
  }, [okNow, ensureBase, runQuiet, names, mark, markRead, markConflict, look])
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    return inLine(saveInLine)
  }, [inLine, saveInLine])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void flush()
    })
    return () => {
      sub.remove()
      void flush() // 닫기·화면 내리기: 남은 편집을 바로 저장(닫기는 화면이 먼저 flush 가 닿았을 때만 해요)
    }
  }, [flush])
  const change = useCallback(
    (e: QuickEdit | null) => {
      if (!okNow()) return
      const key = keyOf(e)
      if (!last.current || last.current.slot !== slot) last.current = { slot, key: firstShown.current?.slot === slot ? firstShown.current.key : keyOf(null) }
      if (key === last.current.key && !queued.current) return
      last.current = { slot, key }
      queued.current = { e }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 400)
    },
    [okNow, slot, flush],
  )
  const planClear = useCallback(async () => {
    await flush() // 밀린 편집을 먼저(못 해도 전제는 known — 그때 기기의 다른 초안이 아니에요. 밀린 값은 비우기가 끝나면 내려놓아요)
    return inLine(async () => {
      const b = await ensureBase()
      return b ? planDraftClear({ key: names.own, seen: b.own }, { key: names.base, seen: b.bundle }, slot, isEdit, migrateEdits) : null
    })
  }, [flush, inLine, ensureBase, names, slot])
  const applyClear = useCallback(
    (t: CasTarget<string> | null): Promise<{ r: PlanResult; now: QuickEdit | null }> => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      return inLine(async () => {
        // 충돌 중(사람이 고르기 전): 비우기 0건 — 다른 초안·안내·known 그대로. 제출·버린 내 밀린 값만 내려놓아요(리뷰 5 P1-1)
        if (conflictRef.current) {
          queued.current = null
          return { r: 'changed' as PlanResult, now: null }
        }
        let r: PlanResult
        if (t) r = await run(t)
        else {
          // 비울 것이 없다고 본 known 이 기기 그대로인지만 봐요(쓰지 않아요). known·지금을 읽지 못하면 확인하지 못함(failed — 0건)
          const b = await ensureBase()
          const l = b ? await look() : null
          r = !b || !l?.ok ? 'failed' : sameSeen(l.known.own, b.own) && sameSeen(l.known.bundle, b.bundle) ? 'done' : 'changed'
        }
        if (r === 'done') {
          queued.current = null
          last.current = { slot, key: keyOf(null) }
          // 방금 비운 값이 새 known(쓴 원문 그대로 — 다시 읽지 않아요)
          if (t && base.current?.slot === slot) base.current = { ...base.current, own: { s: 'text', text: JSON.stringify(t.write.value) } }
          mark(true)
          return { r, now: null }
        }
        if (r === 'changed') {
          // 그사이 바뀐 초안은 남기고, 화면이 그 글을 보이게 지금 값을 돌려줘요 — 잘 읽었을 때만 그 값이 새 known. 읽지 못하면 known 그대로·확인하지 못함
          const l = await look()
          if (!l.ok) return { r: 'failed' as PlanResult, now: null }
          base.current = l.known
          queued.current = null
          last.current = { slot, key: keyOf(l.value) }
          mark(true)
          return { r, now: l.value }
        }
        return { r, now: null }
      })
    },
    [inLine, run, slot, mark, ensureBase, look],
  )
  const adopt = useCallback(
    (e: QuickEdit | null, forSlot?: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      queued.current = null
      last.current = { slot: forSlot ?? slot, key: keyOf(e) }
    },
    [slot],
  )
  const takeTheirs = useCallback(
    () =>
      inLine(async (): Promise<QuickEdit | null | undefined> => {
        // 읽지 못하면 아무것도 바꾸지 않아요(충돌·known 그대로 + 읽기 실패 안내) — undefined
        const l = await look()
        if (!l.ok) return undefined
        base.current = l.known
        queued.current = null
        last.current = { slot, key: keyOf(l.value) }
        markConflict(false)
        return l.value
      }),
    [inLine, look, slot, markConflict],
  )
  const keepMine = useCallback(async () => {
    // 덮기의 전제도 잘 읽은 지금 원문만 — 읽지 못하면 쓰지 않고 충돌 그대로
    const took = await inLine(async () => {
      const l = await look()
      if (!l.ok) return false
      base.current = l.known
      markConflict(false)
      return true
    })
    return took ? flush() : false
  }, [inLine, look, markConflict, flush])
  const unsaved = useCallback(() => !!queued.current || failedRef.current, [])
  return { ready: ok, initial, issue, failed, readFailed, unsaved, change, flush, planClear, applyClear, adopt, conflict, takeTheirs, keepMine }
}
