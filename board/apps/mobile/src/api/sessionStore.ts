import type { AccessSession } from './session'

// 로그인 세션의 메모리 상태와 키체인 저장을 한 곳에서 순서대로 다뤄요. RN 없이 시험할 수 있게 저장 방법은 밖에서 받아요.
export type Persist = { save: (session: AccessSession) => Promise<void>; remove: () => Promise<void> }
export type SessionState = { session: AccessSession | null; warning: string }
export const SAVE_FAILED = '로그인을 이 기기에 저장하지 못했어요. 앱을 다시 열면 다시 로그인해야 해요'
export const REMOVE_FAILED = '이 기기에 남은 로그인을 지우지 못했어요. 앱을 다시 열면 지난 로그인이 돌아올 수 있어요'

export function createSessionStore(persist: Persist, onChange: (state: SessionState) => void) {
  let state: SessionState = { session: null, warning: '' }
  let queue: Promise<void> = Promise.resolve()
  const emit = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch }
    onChange(state)
  }
  // 저장·삭제는 앞의 작업이 끝난 뒤에 해요. 마지막 작업이 성공하면 키체인이 메모리와 같아져 경고를 지워요
  const enqueue = (op: () => Promise<void>, failure: string) => {
    queue = queue.then(op).then(
      () => emit({ warning: '' }),
      () => emit({ warning: failure }),
    )
    return queue
  }
  const remove = () => enqueue(() => persist.remove(), REMOVE_FAILED)
  return {
    current: () => state.session,
    restore: (session: AccessSession | null) => emit({ session }),
    login(session: AccessSession) {
      emit({ session })
      return enqueue(() => persist.save(session), SAVE_FAILED)
    },
    /** 실패한 요청이 쓴 세션 객체가 지금 세션일 때만 지워요. 다시 로그인했다면 같은 토큰이어도 새 객체라 남아요. */
    expire(session: AccessSession): boolean {
      if (state.session !== session) return false
      emit({ session: null })
      void remove()
      return true
    },
    logout() {
      emit({ session: null })
      return remove()
    },
  }
}
