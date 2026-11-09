// 먼저 기록(intents.ts)의 화면 쪽: 범위별 기기 저장의 기록 목록, 보내는 중 표시, 확인(읽기만)·다시 보내기(사람이 누를 때만)·버리기.
// 기록 파일을 못 읽었거나 깨졌으면 storeGate 로 막고(새로 보내지 않음) 다시 읽기·버리고 새로를 보여요.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import * as Crypto from 'expo-crypto'
import type { Item, Run } from '@direction-board/contracts'
import { api, resumeClient, type ScopedClient } from '../../api/client'
import { useWriteScope } from '../../api/scope'
import { useServer } from '../../server'
import { useStored } from './stored'
import { useStoreGate } from './storeGate'
import { INTENTS, isIntents, listIntents, splitIntents, withIntent, type Intent, type Journal } from './intents'
import { confirmIntent, resendIntent, type ReplayResult, type RunBody } from './replays'

const EMPTY: Record<string, Intent> = {}
// 지금 보내는 중인 기록(이 앱 세션). 보내는 동안은 "끝나지 않은 요청"으로 보이지 않게 숨겨요
const sending = new Set<string>()
let version = 0
const listeners = new Set<() => void>()
const bump = () => {
  version++
  for (const l of listeners) l()
}

export type Intents = {
  journal: Journal
  /** 새 키(먼저 기록과 서버 멱등 키에 같이 써요) */
  newKey: () => string
  /** 끝나지 않은 요청(결과 불명·앱이 도중에 꺼짐) */
  pending: Intent[]
  issue: ReturnType<typeof useStoreGate>['issue']
  /** 확인 — 읽기만(리뷰 9). 들어가 있으면 기록을 지워요. 다른 계정에서 시작한 것이면 읽지 않아요 */
  confirm: (i: Intent) => Promise<ReplayResult | { kind: 'other-scope' }>
  /** 사람이 누른 다시 보내기·이어 하기: 다시 읽어 없을 때만·남은 단계만 보내요. 실패해도 기록은 남아요 */
  resend: (i: Intent) => Promise<ReplayResult | { kind: 'other-scope' }>
  drop: (key: string) => void
  /** 결과를 모를 수 있는 AI 실행 시작(대화·초안): 먼저 기록하고 clientKey 를 붙여 보내요 */
  startRun: (c: ScopedClient, body: RunBody, label: string) => Promise<Run>
  /** 새 항목(캔버스 추가·검색에서 할 일): 먼저 기록하고 저장(save = useSaveItem, 같은 범위) */
  createItem: (c: ScopedClient, save: (it: Item) => Promise<unknown>, it: Item, label: string) => Promise<unknown>
}

export function useIntents(): Intents {
  const { origin } = useServer()
  const scope = useWriteScope()
  const { store, issue } = useStoreGate(INTENTS, isIntents, EMPTY, '보낸 요청', splitIntents)
  const [all] = useStored<Record<string, Intent>>(INTENTS, EMPTY, isIntents)
  const seen = useSyncExternalStore(
    useCallback((l: () => void) => (listeners.add(l), () => void listeners.delete(l)), []),
    () => version,
  )
  const journal = useMemo<Journal>(
    () => ({
      put: async (i) => {
        sending.add(i.key)
        bump()
        return store.setDurable(INTENTS, { ...store.get<Record<string, Intent>>(INTENTS, EMPTY), [i.key]: i })
      },
      drop: (key) => {
        if (store.problem(INTENTS)) return
        const next = { ...store.get<Record<string, Intent>>(INTENTS, EMPTY) }
        delete next[key]
        store.set(INTENTS, next)
      },
      release: (key) => {
        sending.delete(key)
        bump()
      },
      blocked: () => (store.problem(INTENTS) ? '보낸 요청 기록을 읽지 못해 새로 보내지 않아요 · 홈에서 다시 읽거나 버려 주세요' : !store.ready(INTENTS) ? '보낸 요청 기록을 아직 읽는 중이에요 · 잠시 뒤 다시 해 주세요' : null),
    }),
    [store],
  )
  const run = useCallback(
    async (i: Intent, how: typeof confirmIntent) => {
      if (i.scope !== scope.scope) return { kind: 'other-scope' as const }
      const c = resumeClient(origin, i.scope, () => scope.same())
      sending.add(i.key)
      bump()
      try {
        return await how(journal, c, i, () => api.settings(origin).then((s) => s.capabilities ?? []))
      } finally {
        journal.release(i.key)
      }
    },
    [journal, origin, scope],
  )
  const confirm = useCallback((i: Intent) => run(i, confirmIntent), [run])
  const resend = useCallback((i: Intent) => run(i, resendIntent), [run])
  const startRun = useCallback(
    (c: ScopedClient, body: RunBody, label: string) => {
      const key = `run:${Crypto.randomUUID()}`
      return withIntent(journal, { key, kind: 'run', scope: c.scope, at: Date.now(), label, payload: { body } }, () => c.write<Run>('/api/runs', 'POST', { ...body, clientKey: key }))
    },
    [journal],
  )
  const createItem = useCallback(
    (c: ScopedClient, save: (it: Item) => Promise<unknown>, it: Item, label: string) =>
      withIntent(journal, { key: `item:${it.boardId}:${it.id}`, kind: 'item', scope: c.scope, at: Date.now(), label, payload: { item: it } }, () => save(it)),
    [journal],
  )
  // seen: 보내는 중 표시가 바뀌면 목록을 다시 그려요
  void seen
  return { journal, newKey: () => Crypto.randomUUID(), pending: listIntents(all, sending), issue, confirm, resend, drop: journal.drop, startRun, createItem }
}
