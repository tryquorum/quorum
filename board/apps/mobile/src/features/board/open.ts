// 판 화면에서 일·사건·대화를 열 때의 길(웹 home.tsx setOpenId, App.tsx openWork 와 같은 판단).
import type { Signal } from '@direction-board/contracts'
import type { StackParams } from '../../navigation/routes'

// 탭 쌓기·루트 쌓기 어느 내비게이션이든 받게 필요한 두 가지만 봐요
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Nav = { navigate: (...args: any[]) => void; push?: (...args: any[]) => void; getState: () => { routeNames: readonly string[] } | undefined }
/** 사건의 일 화면 주소: 연결된 일이 있으면 그 일, 아니면 사건 */
export const signalRef = (s: Signal) => (s.meta as { work?: string } | null)?.work || `signal:${s.id}`
const has = (nav: Nav, name: keyof StackParams) => !!nav.getState()?.routeNames.includes(name)
/**
 * 일·문서 화면은 쌓아요. navigate 는 같은 이름의 화면이 맨 위면 그 화면의 인자만 바꿔서, 일 화면에서 연결된 일을 열면
 * 갈래 상태가 남고 뒤로 가기로 원래 일에 돌아갈 수 없어요. 쌓기가 없는 내비게이션(탭 묶음 등)만 navigate
 */
const open = (nav: Nav, name: 'Work' | 'Doc', params: StackParams['Work']) => (nav.push ? nav.push(name, params) : nav.navigate(name, params))

/** 대화(run:<thread>) 열기: AI 대화 화면(레인 3)이 있으면 그것, 아니면 문서 페이지로 대화 기록을 읽어요 */
export function openThread(nav: Nav, thread: string, target?: string) {
  if (has(nav, 'Thread')) nav.navigate('Thread', { thread, ...(target ? { target } : {}) })
  else nav.navigate('Doc', { ref: `run:${thread}` })
}

/** 사건 열기. AI 대화 결과면 그 대화(연결된 일이 있으면 그 일), 확인 기다림이면 열면서 조용히 확인해요 */
export function openSignal(nav: Nav, s: Signal, confirmQuiet?: (s: Signal) => void) {
  const work = (s.meta as { work?: string } | null)?.work
  if (s.ref?.startsWith('run:')) {
    if (work) return open(nav, 'Work', { ref: work, title: s.title })
    if (s.lane === 'review' && s.status === 'open') confirmQuiet?.(s)
    return openThread(nav, s.ref.slice(4))
  }
  open(nav, 'Work', { ref: work || `signal:${s.id}`, title: s.title })
}

/** 일 ref 열기(목표도 같은 Work 화면에서 목표 요약이 위에 떠요) */
export function openRef(nav: Nav, ref: string, title?: string) {
  if (ref.startsWith('run:')) return openThread(nav, ref.slice(4))
  if (ref.startsWith('doc:')) return open(nav, 'Doc', { ref, title })
  open(nav, 'Work', { ref, title })
}
