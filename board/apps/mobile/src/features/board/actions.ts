// 판 화면 공용 동작: 할 일 끝냄/다시 열기, 사건 처리·AI가 처리함·확인함·규칙, 메인 고르기. 웹 home.tsx·tasks.ts 와 같은 요청·같은 토스트.
import { useCallback } from 'react'
import type { Item, Signal, SignalsResponse } from '@direction-board/contracts'
import { srcName } from '@direction-board/contracts/board-text'
import { latestItem, SIGNALS_KEY, useSaveItem } from '../../api/board'
import { api, UnknownWriteError } from '../../api/client'
import { useQueryStore } from '../../api/query'
import { useWriteScope } from '../../api/scope'
import { workOps } from '../../api/work'
import { useServer } from '../../server'
import { useToast } from '../../ui/Toast'
import { freshItem, isMainState, mainKeysOf, toggleMainKey, dayKey, undoTarget, type MainState } from './rules'
import { useStored } from './stored'

const failText = (error: unknown) => (error instanceof UnknownWriteError ? '저장됐는지 확인하지 못해 다시 불러왔어요' : '저장하지 못해 되돌렸어요')

/** 끝냄/다시 열기(낙관적). 성공하면 되돌리기 토스트, 실패하면 되돌린 이유를 알려요 */
export function useSetDone() {
  const save = useSaveItem()
  const toast = useToast()
  const store = useQueryStore()
  const { origin } = useServer()
  return useCallback(
    function set(item: Item, done: boolean): Promise<boolean> {
      // 이 동작과 그 되돌리기는 시작한 범위(서버·로그인)에 묶여요. 범위가 바뀌면 결과 알림도 되돌리기도 버려요
      const generation = store.generationNow
      const latest = latestItem(store, item) ?? item
      const mine = { ...latest, done }
      return save(mine).then(
        (saved: Item | undefined) => {
          // 되돌리기의 기준은 서버가 저장해 돌려준 그 항목(서버가 합친 기록·표시까지), 없으면 보낸 값
          const base = saved && typeof saved === 'object' && saved.id === mine.id ? saved : mine
          if (store.current(generation)) toast(done ? '끝냈어요' : '다시 열었어요', { label: '되돌리기', onPress: () => void undo(base, !done, generation) })
          return true
        },
        (error: unknown) => {
          if (store.current(generation)) toast(failText(error))
          return false
        },
      )
    },
    [save, toast, store, origin],
  )
  /**
   * 되돌리기: 먼저 서버를 다시 읽고, 그 항목이 내가 저장한 그 상태(mine) 그대로일 때만 done 을 되돌려요(리뷰 15 P2).
   * 그사이 다른 곳에서 바꿨으면(제목·날짜·끝냄 등) 덮지 않고 멈춰요. 읽기에 실패하면 되돌리지 않아요
   */
  async function undo(mine: Item, done: boolean, generation: number) {
    if (!store.current(generation)) return
    const fresh = await freshItem(() => api.state(origin), mine)
    if (!store.current(generation)) return
    if (!fresh.ok) return toast(fresh.reason === 'read' ? '최신 상태를 읽지 못해 되돌리지 않았어요. 다시 시도해 주세요' : '지금 목록에 그 일이 없어 되돌리지 않았어요')
    if (!undoTarget(fresh.item, mine)) return toast('그사이 다른 곳에서 바뀌어 되돌리지 않았어요 · 열어서 확인해 주세요')
    await save({ ...fresh.item, done }).catch(() => toast('되돌리지 못했어요'))
  }
}

type Patch = { status?: 'open' | 'resolved' | 'snoozed'; lane?: string; reason?: string | null; feedback?: 'mute' | 'urgent' }
const local = (s: Signal, p: Patch): Signal => {
  if (p.feedback === 'mute') return { ...s, lane: 'info', status: 'resolved' }
  if (p.feedback === 'urgent') return { ...s, lane: 'now', status: 'open' }
  return { ...s, ...(p.status ? { status: p.status } : {}), ...(p.lane ? { lane: p.lane as Signal['lane'] } : {}), ...(p.reason !== undefined ? { reason: p.reason } : {}) }
}

/** 사건 바꾸기(낙관적, 실패하면 그 변경만 되돌림). 규칙이 생기는 동작은 끝난 뒤 다시 읽어요 */
export function useSignalActions() {
  const store = useQueryStore()
  const { origin } = useServer()
  const scope = useWriteScope()
  const toast = useToast()
  const patch = useCallback(
    (s: Signal, p: Patch) =>
      store
        .mutate<SignalsResponse, unknown>(SIGNALS_KEY, {
          apply: (d) => ({ ...d, signals: d.signals.map((x) => (x.id === s.id ? local(x, p) : x)) }),
          send: () => workOps(scope).patchSignal(s.id, p),
          commit: (d, saved) => ({ ...d, signals: d.signals.map((x) => (x.id === s.id && saved && typeof saved === 'object' && 'id' in saved ? (saved as Signal) : x.id === s.id ? local(x, p) : x)) }),
          unknown: (e) => e instanceof UnknownWriteError,
        })
        .then(
          () => true,
          (e: unknown) => {
            toast(failText(e))
            return false
          },
        ),
    [store, scope, toast],
  )
  const refetch = useCallback(() => store.fetch(SIGNALS_KEY, () => api.signals(origin)), [store, origin])
  const withUndo = useCallback(
    async (s: Signal, p: Patch, message: string, back: Patch, description?: string) => {
      const generation = store.generationNow
      if (!(await patch(s, p)) || !store.current(generation)) return
      toast(description ? `${message} · ${description}` : message, { label: '되돌리기', onPress: () => void (store.current(generation) && patch(s, back)) })
    },
    [patch, store, toast],
  )
  return {
    patch,
    resolve: (s: Signal) => withUndo(s, { status: 'resolved' }, '처리했어요', { status: 'open' }),
    reopen: (s: Signal) => withUndo(s, { status: 'open' }, '다시 열었어요', { status: 'resolved' }),
    aiDone: (s: Signal) => withUndo(s, { status: 'resolved', lane: 'auto', reason: 'AI가 처리함' }, 'AI가 처리한 걸로 닫았어요', { status: 'open', lane: s.lane, reason: s.reason }),
    confirm: async (list: Signal[], quiet = false) => {
      const generation = store.generationNow
      const ok = await Promise.all(list.map((s) => patch(s, { status: 'resolved', lane: 'auto', reason: '확인함' })))
      if (quiet || !store.current(generation) || !ok.some(Boolean)) return
      toast(list.length > 1 ? `${list.length}개를 확인했어요` : '확인했어요', {
        label: '되돌리기',
        onPress: () => void list.forEach((s) => store.current(generation) && patch(s, { status: 'open', lane: 'review', reason: s.reason })),
      })
    },
    mute: async (s: Signal) => {
      if (await patch(s, { feedback: 'mute' })) {
        toast(`규칙을 만들었어요 · ${srcName(s.source)}의 이런 소식은 앞으로 안 보내요`)
        void refetch()
      }
    },
    urgent: async (s: Signal) => {
      if (await patch(s, { feedback: 'urgent' })) {
        toast(`규칙을 만들었어요 · ${srcName(s.source)}의 이런 소식은 바로 알려줘요`)
        void refetch()
      }
    },
    deleteRule: async (id: string) => {
      try {
        await workOps(scope).deleteRule(id)
      } catch (e) {
        toast(e instanceof UnknownWriteError ? e.message : '규칙을 지우지 못했어요')
      }
      void refetch()
    },
    clearSamples: async () => {
      try {
        await workOps(scope).clearSamples()
        toast('샘플을 지웠어요')
      } catch (e) {
        toast(e instanceof UnknownWriteError ? e.message : '샘플을 지우지 못했어요')
      }
      void refetch()
    },
  }
}

/** 오늘 메인 키와 별 누르기(웹 tasks.ts toggleMain) */
export function useMain() {
  const toast = useToast()
  const [state, setState, ready, issue] = useStored<MainState>('main', { day: '', keys: [] }, isMainState)
  const keys = mainKeysOf(state)
  // 오늘 메인을 읽지 못했으면(읽는 중·읽기 실패·깨짐) 바꾸지 않아요(규칙 E — 알림은 useStored 가 "다시 읽기"와 함께)
  const set = useCallback((next: string[]) => setState({ day: dayKey(), keys: [...new Set(next)] }), [setState])
  const toggle = useCallback(
    (key: string, title: string, openKeys: Set<string>) => {
      const next = toggleMainKey(keys, key, openKeys)
      if (!next) return toast('메인 일은 3개까지예요 · 하나를 끝내거나 빼고 다시 골라요')
      if (!set(next)) return
      if (next.length > keys.length) toast(`오늘 메인으로 골랐어요 · ${title}`)
    },
    [keys, set, toast],
  )
  // issue: 오늘 메인을 읽지 못했거나 깨졌을 때(화면이 풀릴 때까지 표시 — StoreProblemNotice)
  return { keys, set, toggle, ready, issue }
}
