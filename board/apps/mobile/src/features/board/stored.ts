import { useCallback, useEffect, useMemo } from 'react'
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { tokenClaims } from '../../api/session'
import { useAuth } from '../../auth'
import { useServer } from '../../server'
import { useToast } from '../../ui/Toast'
import { onceOk, SmallStore } from './smallStore'
import { useStoredIn, type ProblemActions, type StoreIssueNow, type StoreProblem } from './storedHook'
import { withEul } from '@direction-board/contracts/quick-recovery'

// 범위(서버 주소 + 로그인 주체)마다 다른 폴더라 다른 서버·계정의 메인 키·칩이 섞이지 않아요. 비밀이 아닌 화면 상태예요.
const stores = new Map<string, SmallStore>()
let onError: (name: string) => void = () => {}
// 자리별 파일(quickPending.<자리>·quickEdit.<자리> — PR #43 리뷰)은 앞부분의 이름으로 알려요
const labelOf = (name: string) => LABEL[name] ?? LABEL[name.split('.')[0] ?? ''] ?? name
const LABEL: Record<string, string> = { main: '오늘 메인', list: '목록 설정', board: '지금 판', focus: '집중 모드', captures: 'AI 정리 칩', quickPending: '빠른 추가 기록', quickEdit: '쓰던 초안', intents: '보낸 요청' }

function storeFor(scope: string): SmallStore {
  let store = stores.get(scope)
  if (store) return store
  // 범위 폴더 준비(이름 해시·폴더 만들기). 실패한 준비는 기억하지 않아 다음 다시 읽기에서 다시 준비해요(onceOk)
  const folder = onceOk(() =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope).then((hash) => {
      const d = new Directory(Paths.document, 'board-state', hash.slice(0, 16))
      if (!d.exists) d.create({ intermediates: true })
      return d
    }),
  )
  store = new SmallStore(
    {
      read: async (name) => {
        const f = new File(await folder(), `${name}.json`)
        return f.exists ? f.text() : null
      },
      write: async (name, text) => {
        const f = new File(await folder(), `${name}.json`)
        if (!f.exists) f.create()
        await f.write(text)
      },
    },
    (name) => onError(name),
  )
  stores.set(scope, store)
  return store
}

/** 지금 범위의 작은 저장소. 범위 이름은 QueryProvider 와 같은 규칙(서버 + 그 서버 토큰의 이메일, 없으면 익명) */
export function useSmallStore(): SmallStore {
  const { origin } = useServer()
  const { session } = useAuth()
  const toast = useToast()
  const principal = session && session.origin === origin ? (tokenClaims(session.token)?.email ?? 'signed-in') : 'anon'
  useEffect(() => {
    onError = (name) => toast(`${labelOf(name)}을 기기에 저장하지 못했어요`)
  }, [toast])
  return useMemo(() => storeFor(`${origin}|${principal}`), [origin, principal])
}

/**
 * 이름 하나의 값. 읽기 전·읽기 실패·깨짐이면 init 을 돌려주고 ready 가 false 예요(규칙 E, 리뷰 22 — storedHook.ts).
 * 그동안 바꾸기는 쓰지 않고 알려요. 넷째 값은 지금 문제(읽기 실패·깨짐)와 다시 읽기·초기화 — 화면 설정(집중 모드·오늘 메인·목록 설정)은 그 화면이
 * 문제가 풀릴 때까지 StoreProblemNotice 로 보여요(리뷰 24 P2 — 토스트는 하나·5초라 여러 설정이 함께 깨지면 놓쳐요)
 */
export function useStored<T>(name: string, init: T, check: (value: unknown) => value is T): [T, (value: T) => boolean, boolean, StoreIssueNow | null] {
  const store = useSmallStore()
  const toast = useToast()
  const onProblem = useCallback(
    (n: string, problem: StoreProblem, actions: ProblemActions) => {
      const label = labelOf(n)
      if (problem === 'loading') return toast(`${withEul(label)} 아직 읽는 중이에요 · 잠시 뒤 다시 해 주세요`)
      toast(`${withEul(label)} 기기에서 읽지 못해 바꾸지 않았어요`, { label: '다시 읽기', onPress: actions.retry })
    },
    [toast],
  )
  return useStoredIn(store, name, init, check, onProblem)
}
