import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../auth'
import { useServer } from '../server'
import { tokenClaims } from './session'
import { QueryStore, type QueryState } from './queryStore'

// 화면이 쓰는 읽기 훅. 캐시 규칙은 queryStore.ts, 이유는 docs/internals/mobile-ia.md 의 "데이터".
const StoreContext = createContext<QueryStore | null>(null)

/** 캐시 범위 = 서버 주소 + 로그인 주체(그 서버에 붙는 토큰의 이메일, 없으면 익명) */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => new QueryStore())
  const { origin } = useServer()
  const { session } = useAuth()
  const principal = session && session.origin === origin ? (tokenClaims(session.token)?.email ?? 'signed-in') : 'anon'
  // 자식이 그리기 전에 범위를 맞춰요. 범위가 바뀌면 캐시가 비고 구독한 화면이 다시 읽어요
  const scope = `${origin}|${principal}`
  // 범위가 바뀔 때마다 오르는 세대(A→B→A 로 돌아와도 앞 A 의 늦은 결과를 받지 않게 문자열 대신 세대로 비교해요)
  const gen = useRef({ scope, value: 0 })
  if (gen.current.scope !== scope) gen.current = { scope, value: gen.current.value + 1 }
  useLayoutEffect(() => store.setScope(scope), [store, scope])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') store.refreshWatched()
    })
    return () => sub.remove()
  }, [store])
  // 범위가 바뀌면 화면 나무를 새로 그려요(key = 세대): 모든 화면·시트가 새 범위로 다시 열려 쓰기 범위를 다시 잡고(api/scope.ts useWriteScope),
  // 바뀌기 전에 만든 콜백(열려 있던 확인창·늦게 오는 입력)은 앞 범위를 잡은 채라 보내지 않아요(규칙 A, 014_write_inventory.md)
  return React.createElement(
    StoreContext.Provider,
    { value: store },
    React.createElement(ScopeContext.Provider, { value: gen.current.value }, React.createElement(React.Fragment, { key: gen.current.value }, children)),
  )
}

const ScopeContext = createContext(0)
/**
 * 캐시 밖의 화면 상태(이어 읽은 쪽, 진행 중인 AI 실행 등)용. generation 이 바뀌면 화면 상태를 비우고,
 * 비동기 결과는 시작할 때의 generation 과 지금이 같을 때만 반영해요(isCurrent).
 */
export function useScope(): { generation: number; isCurrent: (generation: number) => boolean } {
  const generation = useContext(ScopeContext)
  const ref = useRef(generation)
  ref.current = generation
  const isCurrent = useCallback((value: number) => value === ref.current, [])
  return { generation, isCurrent }
}

export function useQueryStore(): QueryStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('QueryProvider 밖에서 쿼리를 썼어요')
  return store
}

export type Query<T> = QueryState<T> & { refresh: () => Promise<void> }

/** 키 하나를 읽어요. 처음 그릴 때, 화면에 다시 들어올 때, 앱이 앞으로 돌아올 때 다시 읽어요 */
export function useQuery<T>(key: string, loader: () => Promise<T>): Query<T> {
  const store = useQueryStore()
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]),
    () => store.get(key),
  ) as QueryState<T>
  const refresh = useCallback(() => store.fetch(key, () => loaderRef.current()), [store, key])
  useEffect(() => {
    if (state.status === 'idle' && !state.fetching) void refresh()
  }, [state.status, state.fetching, refresh])
  const focused = useRef(false)
  useFocusEffect(
    useCallback(() => {
      // 첫 포커스는 위의 첫 읽기가 맡아요
      if (focused.current && store.get(key).status !== 'idle') void refresh()
      focused.current = true
    }, [store, key, refresh]),
  )
  return { ...state, refresh }
}
