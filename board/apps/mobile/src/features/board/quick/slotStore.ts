// 빠른 추가 기록·쓰던 초안의 자리별 기기 저장(PR #43 리뷰). 자리(한 줄·상세 시트·목표 할 일 × 대상)마다 범위 폴더 안의 파일 하나라
// 한 자리의 깨짐·버리기가 다른 자리에 닿지 않아요. 예전 묶음 파일(quickPending·quickEdit)은 그 자리 파일이 없을 때만 읽어 넘기고,
// 그 자리의 다음 쓰기가 자리 파일로 옮겨요(앱이 스스로 쓰지 않아요). 판정은 계약 slot-store.ts(웹과 같음).
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { planDraftClear, planRecordDiscard, planSlotDiscard, rawOfSeen, slotName, slotView, type CasTarget, type PlanResult, type Raw, type Seen, type SlotView } from '@direction-board/contracts/slot-store'
import { useSmallStore } from '../stored'
import type { SmallStore, StorePlan } from '../smallStore'
import { busyNotice, resetFailedText, type StoreIssue } from '../storeGate'

// 자리 파일·묶음 파일은 JSON 이면 읽어 두고(값 검사는 slotView 가 자리마다), JSON 이 아니면 깨짐
const anyJson = (v: unknown): v is unknown => v !== undefined
const ABSENT = Symbol('absent')

/** 저장소의 이름 하나를 계약의 Raw 로 */
export function rawOf(store: SmallStore, name: string): Raw {
  const st = store.status(name)
  if (st !== 'ok') return st === 'loading' ? { s: 'loading' } : { s: st }
  const v = store.get<unknown>(name, ABSENT)
  return v === ABSENT ? { s: 'absent' } : { s: 'value', v }
}

export type SlotKind<T> = {
  /** 예전 묶음 이름(자리 파일 이름의 앞부분) */
  base: string
  isOne: (v: unknown) => v is T
  migrate: (m: Record<string, T>) => Record<string, T>
  /** 안내에 쓰는 이름(빠른 추가 기록·쓰던 초안) */
  what: string
  /** 읽기 실패·깨짐 안내 글 */
  text: (kind: 'read' | 'corrupt') => string
  /** 기록을 기기에 남기지 못했을 때 안내 글(없으면 알리지 않아요 — 쓰던 초안은 EditSaveNotice 가 알려요) */
  writeText?: string
}

export type SlotStore<T> = {
  store: SmallStore
  /** 그 자리를 잘 읽었는지(읽는 중·버리는 중·읽기 실패·깨짐이면 false — 규칙 E) */
  ok: boolean
  /** 그 자리의 값(준비 전·문제면 null) */
  value: T | null
  issue: StoreIssue | null
  /** 지금(그림이 아니라 저장소 기준) 잘 읽었는지 */
  okNow: () => boolean
  /** 지금 그 자리의 값 */
  now: () => T | null
  /** 그 자리 파일에 값(null = 비움)을 쓰고 기기에 닿을 때까지 기다려요. 잘 읽지 못했으면 쓰지 않고 false(규칙 E) */
  put: (value: T | null) => Promise<boolean>
  /** 화면에 보인 값(shown)을 버리는 대상(규칙 F): 지금 읽은 그 자리 값이 본 것과 같을 때만, 아니면 null(그사이 바뀜) */
  planShown: (shown: T) => Promise<CasTarget<string> | null>
  /** 그 자리 값을 비우는 대상(전제 = 지금 원문): 값이 없거나 읽지 못하면 null */
  planClear: () => Promise<CasTarget<string> | null>
  /** 대상 하나를 원자적 비교-후-쓰기로 실행(PR #43 리뷰 3) */
  run: (t: CasTarget<string>) => Promise<PlanResult>
  /** 지금 그 자리 값을 기기에서 다시 읽어요(바뀜 뒤 화면이 그 값을 보여요) */
  readNow: () => Promise<T | null>
  /** 자리 파일·옛 묶음의 저장 이름 */
  names: { own: string; base: string }
  /** 지금 자리 파일·옛 묶음을 읽은 것(규칙 G 자동 저장의 전제) */
  seenBoth: () => Promise<{ own: { key: string; seen: Seen }; bundle: { key: string; seen: Seen } }>
  /** 조용한 비교-후-쓰기(자동 저장 — 그 이름을 닫지 않아요) */
  runQuiet: (t: CasTarget<string>) => Promise<PlanResult>
}

export function useSlotStore<T>(kind: SlotKind<T>, slot: string): SlotStore<T> {
  const store = useSmallStore()
  const { base, isOne, migrate } = kind
  const own = slotName(base, slot)
  useEffect(() => {
    void store.load(own, anyJson)
    void store.load(base, anyJson)
  }, [store, own, base])
  useSyncExternalStore(
    useCallback(
      (l: () => void) => {
        const a = store.subscribe(own, l)
        const b = store.subscribe(base, l)
        return () => {
          a()
          b()
        }
      },
      [store, own, base],
    ),
    () => store.version(own) + ':' + store.version(base),
  )
  const viewNow = useCallback((): SlotView<T> => slotView(rawOf(store, own), rawOf(store, base), slot, isOne, migrate), [store, own, base, slot, isOne, migrate])
  const okNow = useCallback(() => viewNow().s === 'ok', [viewNow])
  const now = useCallback(() => {
    const v = viewNow()
    return v.s === 'ok' ? v.value : null
  }, [viewNow])
  const put = useCallback(async (value: T | null) => (viewNow().s === 'ok' ? store.setDurable(own, value) : false), [viewNow, store, own])
  const seenBoth = useCallback(async () => ({ own: { key: own, seen: await store.see(own) }, bundle: { key: base, seen: await store.see(base) } }), [store, own, base])
  const planShown = useCallback(
    async (shown: T) => {
      const s = await seenBoth()
      return planRecordDiscard(s.own, s.bundle, slot, isOne, migrate, shown, '')
    },
    [seenBoth, slot, isOne, migrate],
  )
  const planClear = useCallback(
    async () => {
      const s = await seenBoth()
      return planDraftClear(s.own, s.bundle, slot, isOne, migrate)
    },
    [seenBoth, slot, isOne, migrate],
  )
  const run = useCallback((x: CasTarget<string>) => store.compareAndWrite(x), [store])
  const readNow = useCallback(async () => {
    const s = await seenBoth()
    const v = slotView(rawOfSeen(s.own.seen), rawOfSeen(s.bundle.seen), slot, isOne, migrate)
    return v.s === 'ok' ? v.value : null
  }, [seenBoth, slot, isOne, migrate])
  const runQuiet = useCallback((x: CasTarget<string>) => store.compareAndWrite(x, { quiet: true }), [store])
  const names = useMemo(() => ({ own, base }), [own, base])
  const view = viewNow()
  return { store, ok: view.s === 'ok', value: view.s === 'ok' ? view.value : null, issue: slotIssue(store, kind, own, slot, view), okNow, now, put, planShown, planClear, run, readNow, names, seenBoth, runQuiet }
}

/**
 * 자리 하나의 안내. 버리기가 닿는 곳: 그 자리 문제면 자리 파일만 비우고(옛 묶음에 그 자리 항목이 깨져 있어도 자리 파일이 앞서요),
 * 옛 묶음 자체의 문제면 묶음을 비워요 — 확인창이 그 안 모든 자리가 버려진다고 밝혀요. 다시 읽기는 문제가 있는 파일을 실제로 다시 읽어요
 */
export function slotIssue<T>(store: SmallStore, kind: SlotKind<T>, own: string, slot: string, view: SlotView<T>): StoreIssue | null {
  const busy = store.busy(own) ?? store.busy(kind.base)
  if (busy) return busyNotice(kind.what, busy, store.retrying(own) ?? store.retrying(kind.base))
  if (view.s === 'ok') return kind.writeText && store.writeFailed(own) ? { kind: 'write', text: kind.writeText } : null
  if (view.s === 'loading') return null
  const bundle = view.level === 'bundle'
  // 그 자리 문제의 까닭이 자리 파일이면 자리 파일을, 옛 묶음 안 그 자리 항목이면 묶음을 다시 읽어요
  const reread = bundle || store.status(own) === 'ok' ? kind.base : own
  const failed = store.resetFailed(own) || store.resetFailed(kind.base)
  const text = kind.text(view.s)
  return {
    kind: view.s,
    text: failed ? resetFailedText(text) : text,
    retry: () => void store.reload(reread, anyJson),
    // 규칙 F: 확인창을 띄울 때 지금 자리 파일·옛 묶음을 읽어 계획(지울 곳 하나 + 확인창 글)을 만들고, 실행은 그 계획만(전제가 바뀌면 0건)
    plan: async () => planSlotDiscard({ key: own, seen: await store.see(own) }, { key: kind.base, seen: await store.see(kind.base) }, slot, kind.isOne, kind.migrate, kind.what),
    apply: (p: StorePlan) => store.apply(p),
  }
}
