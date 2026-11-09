import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useQuery } from '../../../api/query'
import { workApi } from '../../../api/work'
import { useServer } from '../../../server'
import { useToast } from '../../../ui/Toast'
import { useStoreGate, type StoreIssue } from '../storeGate'
import type { SmallStore } from '../smallStore'
import { centerFor } from './centers'
import { captureApiFor } from './captureApi'
import { useWriteScope } from '../../../api/scope'
import { CaptureCenter, splitCaptureStore, validCaptureStore } from './captureFlow'

// 범위(서버·로그인)마다 하나. 홈·전체의 입력줄과 트레이, 홈 결정 칸이 같은 칩 목록을 봐요(웹은 Provider 하나).
const centers = new WeakMap<SmallStore, CaptureCenter>()
const polls = new WeakMap<CaptureCenter, { users: number; timer: ReturnType<typeof setInterval> | undefined }>()
/** 칩 목록 파일: JSON 배열이고 모든 항목이 칩 모양이어야 해요. 아니면 깨짐("없음"으로 보지 않고 새 정리를 막아요, 규칙 B) */
const isText = validCaptureStore
const NAME = 'captures'

export function useCaptures(): { center: CaptureCenter | null; available: boolean; issue: StoreIssue | null } {
  const { origin } = useServer()
  // 칩 기록을 못 읽었거나 깨졌으면 칩 목록(center)을 만들지 않아요: 새 정리를 막고 다시 읽기·버리고 새로를 보여요
  const { store, ready, problem, issue } = useStoreGate(NAME, isText, '[]', 'AI 정리', splitCaptureStore)
  const toast = useToast()
  const scope = useWriteScope()
  // 웹 useCatalog 와 같은 판정: 모델 목록이 열리면(이 맥 주인) AI 정리를 쓸 수 있어요
  const models = useQuery('runs/models', () => workApi.models(origin))
  // 준비 여부는 지금 범위의 store 에 물어요(범위가 바뀐 첫 그림에서 앞 범위의 준비 상태를 쓰지 않게)
  const center = useMemo(
    () =>
      problem
        ? null
        : centerFor(centers, store, NAME, (s) =>
        new CaptureCenter(
          // 칩 목록은 범위(SmallStore)마다 하나라, 요청도 그 범위를 고정한 클라이언트로 만들어요
          captureApiFor(scope),
          { getItem: () => s.get<string | null>(NAME, null), setItem: (_k, v) => s.set(NAME, v), durable: () => s.settled(NAME) },
          () => Crypto.randomUUID(),
          (t) => toast(t),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, problem, store, scope, toast],
  )
  useSyncExternalStore(
    (l) => (center ? center.subscribe(l) : () => {}),
    () => center?.version ?? -1,
  )
  // 도는 칩은 2초마다, 앱이 앞에 있을 때만 다시 읽어요. 여러 화면이 같이 써도 범위마다 타이머는 하나예요
  const running = center?.running ?? false
  useEffect(() => {
    if (!center) return
    center.tick()
    if (!running) return
    const p = polls.get(center) ?? { users: 0, timer: undefined as ReturnType<typeof setInterval> | undefined }
    p.users++
    p.timer ??= setInterval(() => AppState.currentState === 'active' && center.tick(), 2000)
    polls.set(center, p)
    return () => {
      p.users--
      if (p.users <= 0 && p.timer) {
        clearInterval(p.timer)
        p.timer = undefined
      }
    }
  }, [center, running])
  return { center, available: models.status === 'ok' && !!models.data, issue }
}
