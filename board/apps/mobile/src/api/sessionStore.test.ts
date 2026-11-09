import { expect, test } from 'bun:test'
import { createSessionStore, REMOVE_FAILED, SAVE_FAILED, type SessionState } from './sessionStore'

function setup() {
  const calls: string[] = []
  const pending: { resolve: () => void; reject: () => void }[] = []
  const states: SessionState[] = []
  const wait = (name: string) => () => {
    calls.push(name)
    return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }))
  }
  const store = createSessionStore({ save: wait('save'), remove: wait('remove') }, (s) => states.push(s))
  const last = () => states[states.length - 1]
  return { store, calls, pending, last }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

test('같은 토큰으로 다시 로그인한 세션은 이전 요청의 늦은 401 로 지워지지 않아요', async () => {
  const { store, pending } = setup()
  const first = { origin: 'https://a.test', token: 't' }
  void store.login(first)
  await flush()
  pending.shift()!.resolve()
  const again = { origin: 'https://a.test', token: 't' }
  void store.login(again)
  expect(store.expire(first)).toBe(false)
  expect(store.current()).toBe(again)
  expect(store.expire(again)).toBe(true)
  expect(store.current()).toBeNull()
})
test('저장 중에 만료되면 저장이 끝난 뒤 삭제해 키체인도 비어요', async () => {
  const { store, calls, pending, last } = setup()
  const session = { origin: 'https://a.test', token: 't' }
  void store.login(session)
  store.expire(session)
  await flush()
  expect(calls).toEqual(['save'])
  pending.shift()!.resolve()
  await flush()
  expect(calls).toEqual(['save', 'remove'])
  pending.shift()!.resolve()
  await flush()
  expect(last()).toEqual({ session: null, warning: '' })
})
test('저장·삭제 실패는 경고로 남고, 다음 작업이 성공하면 사라져요', async () => {
  const { store, pending, last } = setup()
  const done = store.login({ origin: 'https://a.test', token: 't' })
  await flush()
  pending.shift()!.reject()
  await done
  expect(last().warning).toBe(SAVE_FAILED)
  expect(last().session).not.toBeNull()
  const out = store.logout()
  await flush()
  pending.shift()!.reject()
  await out
  expect(last()).toEqual({ session: null, warning: REMOVE_FAILED })
  const retry = store.logout()
  await flush()
  pending.shift()!.resolve()
  await retry
  expect(last().warning).toBe('')
})
