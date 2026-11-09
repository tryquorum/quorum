// 화면에서 범위 고정 클라이언트 만들기(규칙 A, devlog/_plan/261107_ios_parity/work/014_write_inventory.md).
// useWriteScope: 그 화면·시트·확인창(그것을 그린 컴포넌트)이 **처음 그려진 때**의 서버·계정을 잡아요. 모든 쓰기는 이 클라이언트로 보내고,
// 보내기 직전에 지금 범위와 비교해 다르면 보내지 않아요(ScopeChangedError). 범위가 바뀌면 QueryProvider 가 화면 나무를 새로 그려서
// (api/query.ts) 새로 그린 화면은 새 범위를 잡고, 바뀌기 전에 만든 콜백(열려 있던 확인창, 늦게 오는 기한 입력)은 앞 범위로 막혀요.
import { useRef } from 'react'
import { useServer } from '../server'
import { scopedClient, type ScopedClient } from './client'

export function useWriteScope(): ScopedClient {
  const { origin } = useServer()
  const now = useRef(origin)
  now.current = origin
  const pinned = useRef<ScopedClient | null>(null)
  pinned.current ??= scopedClient(origin, () => now.current === origin)
  return pinned.current
}
