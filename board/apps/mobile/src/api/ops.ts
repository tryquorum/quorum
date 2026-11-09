// 운영 순회 요청과 훅. 서버: apps/server/server/ops.ts(GET/PUT /api/ops, POST /api/ops/run), 멈추기는 실행 멈추기와 같아요.
import { useCallback, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import type { OpsResponse, OpsSettings } from '@direction-board/contracts'
import { useAuth } from '../auth'
import { useServer } from '../server'
import { ApiError, request, type ScopedClient } from './client'
import { OpsStore, type OpsSnapshot } from './opsStore'
import { runsApi } from './runs'
import { tokenClaims } from './session'

export type OpsPatch = Partial<Pick<OpsSettings, 'text' | 'enabled' | 'every_min' | 'active_from' | 'active_to' | 'provider' | 'model' | 'effort'>> & { base_rev?: number }

export const opsApi = {
  get: (origin: string, full: boolean) => request<OpsResponse>(origin, full ? '/api/ops' : '/api/ops?lite=1'),
  put: (s: ScopedClient, patch: OpsPatch) => s.write<{ ops: OpsSettings }>('/api/ops', 'PUT', patch),
  run: (s: ScopedClient) => s.write<{ id: string }>('/api/ops/run', 'POST'),
  stop: (s: ScopedClient, id: string) => runsApi.stop(s, id),
}

let origin = ''
const store = new OpsStore({
  read: (full) => opsApi.get(origin, full),
  forbidden: (e) => e instanceof ApiError && e.status === 403,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
})
AppState.addEventListener('change', (s) => store.setActive(s === 'active'))

/**
 * 순회 상태. full 은 설정 화면(지시문 기본값·마지막 답 포함), 칩은 false.
 * 범위(서버 주소 + 로그인 주체, QueryProvider 와 같은 계산)는 저장소가 가져서, 바뀌면 그린 화면이 앞 계정 값을 보기 전에 비워요
 */
export function useOps(full = false): OpsSnapshot & { origin: string } {
  const server = useServer()
  const { session } = useAuth()
  const principal = session && session.origin === server.origin ? (tokenClaims(session.token)?.email ?? 'signed-in') : 'anon'
  origin = server.origin
  store.setScope(`${server.origin}|${principal}`)
  const subscribe = useCallback((cb: () => void) => store.subscribe(full, cb), [full])
  const snap = useSyncExternalStore(subscribe, () => store.snapshot)
  return { ...snap, origin: server.origin }
}

export const refreshOps = () => store.refresh()
/** 쓰기는 부르는 화면이 연 시점의 범위(useWriteScope)로만 보내요 */
export const putOps = (s: ScopedClient, patch: OpsPatch) => store.put(() => opsApi.put(s, patch))
export async function runSweepNow(s: ScopedClient) {
  try {
    return await opsApi.run(s)
  } finally {
    await store.refresh()
  }
}
export async function stopSweep(s: ScopedClient, id: string) {
  try {
    await opsApi.stop(s, id)
  } finally {
    await store.refresh()
  }
}
