// 기기 저장 이름 하나를 화면에서 쓰는 훅(규칙 E, 리뷰 22). 저장소(SmallStore)를 받아서 실제 앱(stored.ts useStored)과 시험 하네스가 같은 코드를 써요.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { storeProblemText, withEul } from '@direction-board/contracts/quick-recovery'
import type { SmallStore, StorePlan } from './smallStore'
import { planFileDiscard, type PlanResult } from '@direction-board/contracts/slot-store'

/** 이름 하나가 준비되지 않은 까닭: 읽는 중 · 읽기 실패 · 깨짐 */
export type StoreProblem = 'loading' | 'read' | 'corrupt'
/**
 * 다시 읽기(실제로 다시 읽음) · 초기화 계획(규칙 F — 확인창을 띄울 때 지금 값을 읽어 "그 이름만 처음 값으로" 계획, 깨지지 않았으면 null)
 * · 실행(확인창 뒤 그 계획만, 값이 바뀌었으면 0건 "changed")
 */
export type ProblemActions = { retry: () => void; plan: () => Promise<StorePlan | null>; apply: (plan: StorePlan) => Promise<PlanResult> }
/** 화면 설정 초기화 확인창 글 */
export const SETTING_RESET_TEXT = '깨진 설정을 지우고 처음 값으로 돌려요. 되돌릴 수 없어요.'
/** 지금 읽기 실패·깨짐이면 그 문제와 동작(화면은 문제가 풀릴 때까지 표시해요 — StoreProblemNotice), 아니면 null */
export type StoreIssueNow = { problem: 'read' | 'corrupt'; retrying?: boolean; resetting?: boolean; resetFailed?: boolean } & ProblemActions

/**
 * 화면 설정 문제 안내 글(리뷰 23·24 P2). 깨짐이면 손상 안내 + 초기화(확인창 문구), 읽기 실패면 다시 읽기만(값이 멀쩡할 수 있어요)
 */
export function storeProblemCopy(label: string, problem: 'read' | 'corrupt', state?: { retrying?: boolean; resetting?: boolean; resetFailed?: boolean }): { text: string; reset: { title: string; message: string } | null } {
  // 초기화하는 동안(PR #43 리뷰): 단추 없이 "초기화하는 중" — 끝나기 전에는 다시 읽기·바꾸기가 닫혀요
  if (state?.resetting) return { text: `${withEul(label)} 초기화하는 중이에요…`, reset: null }
  // 다시 읽는 동안(리뷰 25 P2): 직전 문제를 남긴 채 "다시 읽는 중"(단추 없음)
  if (state?.retrying) return { text: `${withEul(label)} 다시 읽는 중이에요…`, reset: null }
  // 초기화 쓰기가 실패했으면 문제 그대로 + 다시 시도(확인창은 같아요)
  if (problem === 'corrupt' && state?.resetFailed)
    return { text: `${withEul(label)} 초기화하지 못했어요 · 다시 시도해 주세요`, reset: { title: `${withEul(label)} 초기화할까요?`, message: SETTING_RESET_TEXT } }
  if (problem === 'corrupt')
    return {
      text: storeProblemText(label, 'corrupt').split(' · ')[0] + ' · 초기화하면 처음 값으로 돌아가요',
      reset: { title: `${withEul(label)} 초기화할까요?`, message: SETTING_RESET_TEXT },
    }
  return { text: `${withEul(label)} 기기에서 읽지 못했어요 · 다시 읽어 주세요`, reset: null }
}

/**
 * 값·바꾸기·준비·문제. 준비(ready)는 다 읽었고 읽기 문제가 없을 때만이에요 — 읽는 중·읽기 실패·깨짐이면 false 이고 그동안 바꾸기는 쓰지 않아요(false).
 * 바꾸지 못하면 onProblem 으로 알려요. 넷째 값(issue)은 지금 상태 그대로라, 다시 읽어 또 실패하거나 깨짐으로 바뀌면 그대로 따라가요(리뷰 24 P2)
 */
export function useStoredIn<T>(
  store: SmallStore,
  name: string,
  init: T,
  check: (value: unknown) => value is T,
  onProblem?: (name: string, problem: StoreProblem, actions: ProblemActions) => void,
): [T, (value: T) => boolean, boolean, StoreIssueNow | null] {
  useEffect(() => void store.load(name, check), [store, name, check])
  const value = useSyncExternalStore(
    useCallback((l: () => void) => store.subscribe(name, l), [store, name]),
    () => store.get(name, init),
  )
  // 상태 + 다시 읽는 중의 직전 문제 + 초기화 실패(리뷰 25 P2): 저장소에 있어 화면이 다시 그려지거나 새로 그려져도 같아요
  const snap = useSyncExternalStore(
    useCallback((l: () => void) => store.subscribe(name, l), [store, name]),
    () => `${store.status(name)}|${store.retrying(name) ?? ''}|${store.resetFailed(name) ? 1 : 0}|${store.busy(name) ?? ''}`,
  )
  const [status, retrying, resetFailed, busy] = snap.split('|') as [ReturnType<SmallStore['status']>, '' | 'read' | 'corrupt', '0' | '1', '' | 'reload' | 'reset']
  // init 은 화면마다 새로 만들 수 있어 처음 값을 기억해요(초기화가 그 값으로)
  const first = useMemo(() => init, [store, name]) // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useMemo<ProblemActions>(
    () => ({
      retry: () => void store.reload(name, check),
      plan: async () => planFileDiscard({ key: name, seen: await store.see(name) }, check, first, name, undefined, SETTING_RESET_TEXT),
      apply: (p: StorePlan) => store.apply(p),
    }),
    [store, name, check, first],
  )
  const issue = useMemo<StoreIssueNow | null>(
    () =>
      status === 'read' || status === 'corrupt'
        ? { problem: status, ...(resetFailed === '1' ? { resetFailed: true } : {}), ...actions }
        : status === 'loading' && retrying
          ? { problem: retrying, ...(busy === 'reset' ? { resetting: true } : { retrying: true }), ...actions }
          : null,
    [status, retrying, resetFailed, busy, actions],
  )
  const set = useCallback(
    (next: T) => {
      const done = store.set(name, next)
      const now = store.status(name)
      if (!done && now !== 'ok') onProblem?.(name, now, actions)
      return done
    },
    [store, name, onProblem, actions],
  )
  return [value, set, status === 'ok', issue]
}
