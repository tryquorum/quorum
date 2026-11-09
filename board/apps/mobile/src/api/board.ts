import { useCallback } from 'react'
import type { Item, StateResponse } from '@direction-board/contracts'
import { useServer } from '../server'
import { api, UnknownWriteError } from './client'
import { useQuery, useQueryStore } from './query'
import { queueWrite, type QueryStore } from './queryStore'
import { useWriteScope } from './scope'

// 판(할 일·목표·영역)과 사건 읽기, 할 일 저장. 홈·전체·일 상세·검색이 같은 캐시를 나눠 써요.
export const BOARD_KEY = 'board/state'
export const SIGNALS_KEY = 'board/signals'

export function useBoardState() {
  const { origin } = useServer()
  return useQuery(BOARD_KEY, () => api.state(origin))
}
export function useSignals() {
  const { origin } = useServer()
  return useQuery(SIGNALS_KEY, () => api.signals(origin))
}

const same = (a: Item, b: Item) => a.boardId === b.boardId && a.id === b.id
const replace = (state: StateResponse, item: Item): StateResponse => ({
  ...state,
  items: state.items.some((i) => same(i, item)) ? state.items.map((i) => (same(i, item) ? item : i)) : [...state.items, item],
})

// 같은 항목의 PUT 은 바꾼 순서대로 하나씩(웹 useBoard 의 putChain 과 같음)
const chains = new WeakMap<QueryStore, Map<string, Promise<unknown>>>()

/** 할 일·목표 저장. 화면에 바로 반영하고, 실패하면 그 변경만 되돌려요. 결과를 모르면 다시 읽어요. 범위는 이 훅을 쓴 화면·시트를 연 시점 */
export function useSaveItem() {
  const store = useQueryStore()
  const scope = useWriteScope()
  return useCallback(
    (item: Item) => {
      let byItem = chains.get(store)
      if (!byItem) chains.set(store, (byItem = new Map()))
      const put = queueWrite(store, byItem, `${item.boardId}:${item.id}`, () => api.saveItem(scope, item), scope)
      return store.mutate<StateResponse, Item>(BOARD_KEY, {
        apply: (state) => replace(state, item),
        send: () => put,
        commit: (state, saved) => replace(state, saved),
        unknown: (error) => error instanceof UnknownWriteError,
      })
    },
    [store, scope],
  )
}
/** 캐시에 있는 그 항목의 지금 값(되돌리기처럼 시간이 지난 뒤의 쓰기는 이 값에서 바꿔요) */
export function latestItem(store: QueryStore, item: Item): Item | undefined {
  const state = store.get(BOARD_KEY).data as StateResponse | undefined
  return state?.items.find((i) => same(i, item))
}
