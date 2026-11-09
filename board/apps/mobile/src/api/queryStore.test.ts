import { describe, expect, test } from 'bun:test'
import { QueryStore, ScopeChangedError, queueWrite } from './queryStore'

type Items = Record<string, string>
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const data = (s: QueryStore) => s.get('k').data as Items | undefined

describe('QueryStore 읽기', () => {
  test('읽는 중에 또 읽으면 요청을 겹치지 않고 끝난 뒤 한 번만 더 읽어요', async () => {
    const s = new QueryStore()
    let calls = 0
    const first = deferred<Items>()
    const loader = () => (++calls === 1 ? first.promise : Promise.resolve({ a: '2' }))
    const p1 = s.fetch('k', loader)
    const p2 = s.fetch('k', loader)
    void s.fetch('k', loader)
    expect(p1).toBe(p2)
    first.resolve({ a: '1' })
    await p1
    expect(calls).toBe(2)
    expect(data(s)).toEqual({ a: '2' })
  })

  test('다시 읽기가 실패해도 마지막 값을 지키고 오류를 알려요', async () => {
    const s = new QueryStore()
    await s.fetch('k', async () => ({ a: '1' }))
    await s.fetch('k', async () => { throw new Error('offline') })
    expect(data(s)).toEqual({ a: '1' })
    expect(s.get('k').status).toBe('error')
  })

  test('로그인 주체가 바뀌면 캐시를 비우고 그 전에 떠난 읽기 결과는 받지 않아요', async () => {
    const s = new QueryStore()
    s.setScope('https://a|me@x')
    await s.fetch('k', async () => ({ who: 'me' }))
    const late = deferred<Items>()
    const p = s.fetch('k', () => late.promise)
    s.setScope('https://a|other@x')
    expect(data(s)).toBeUndefined()
    late.resolve({ who: 'me-late' })
    await p
    expect(data(s)).toBeUndefined()
    await s.fetch('k', async () => ({ who: 'other' }))
    expect(data(s)).toEqual({ who: 'other' })
  })
})

describe('QueryStore 쓰기', () => {
  const setA = (v: string) => (d: Items) => ({ ...d, a: v })

  test('읽는 사이 쓰기가 끝나면 그 읽기는 버리고 다시 읽어요', async () => {
    const s = new QueryStore()
    await s.fetch('k', async () => ({ a: 'old' }))
    const stale = deferred<Items>()
    let calls = 0
    const reading = s.fetch('k', () => (++calls === 1 ? stale.promise : Promise.resolve({ a: 'new' })))
    await s.mutate('k', { apply: setA('new'), send: async () => null })
    stale.resolve({ a: 'old' })
    await reading
    expect(calls).toBe(2)
    expect(data(s)).toEqual({ a: 'new' })
  })

  test('진행 중인 쓰기는 첫 읽기 결과 위에도 얹혀요', async () => {
    const s = new QueryStore()
    const send = deferred<null>()
    const writing = s.mutate('k', { apply: setA('mine'), send: () => send.promise })
    await s.fetch('k', async () => ({ a: 'server', b: 'x' }))
    expect(data(s)).toEqual({ a: 'mine', b: 'x' })
    send.resolve(null)
    await writing
  })

  test('실패한 쓰기만 빠지고 뒤이어 진행 중인 쓰기는 화면에 남아요', async () => {
    const s = new QueryStore()
    await s.fetch('k', async () => ({ a: '0', b: '0' }))
    const first = deferred<null>()
    const second = deferred<null>()
    const p1 = s.mutate('k', { apply: setA('1'), send: () => first.promise })
    const p2 = s.mutate('k', { apply: (d: Items) => ({ ...d, b: '1' }), send: () => second.promise })
    expect(data(s)).toEqual({ a: '1', b: '1' })
    first.reject(new Error('nope'))
    await expect(p1).rejects.toThrow('nope')
    expect(data(s)).toEqual({ a: '0', b: '1' })
    second.resolve(null)
    await p2
    expect(data(s)).toEqual({ a: '0', b: '1' })
  })

  test('늦게 온 실패가 그 뒤 성공한 쓰기를 되돌리지 않아요', async () => {
    const s = new QueryStore()
    await s.fetch('k', async () => ({ a: '0' }))
    const slow = deferred<null>()
    const p1 = s.mutate('k', { apply: setA('1'), send: () => slow.promise })
    await s.mutate('k', { apply: setA('2'), send: async () => null })
    slow.reject(new Error('late'))
    await expect(p1).rejects.toThrow('late')
    expect(data(s)).toEqual({ a: '2' })
  })

  test('성공하면 서버가 돌려준 값으로 확정해요', async () => {
    const s = new QueryStore()
    await s.fetch('k', async () => ({ a: '0' }))
    await s.mutate('k', { apply: setA('1'), send: async () => 'server-1', commit: (d: Items, r: string) => ({ ...d, a: r }) })
    expect(data(s)).toEqual({ a: 'server-1' })
  })

  test('결과를 모르는 실패면 되돌린 뒤 다시 읽어 실제 값을 보여요', async () => {
    const s = new QueryStore()
    let server: Items = { a: '0' }
    await s.fetch('k', async () => server)
    const p = s.mutate('k', {
      apply: setA('1'),
      send: async () => { server = { a: '1' }; throw new Error('lost') },
      unknown: () => true,
    })
    await expect(p).rejects.toThrow('lost')
    await tick()
    await tick()
    expect(data(s)).toEqual({ a: '1' })
  })

  test('주체가 바뀐 뒤 끝난 쓰기는 새 캐시에 들어가지 않아요', async () => {
    const s = new QueryStore()
    s.setScope('a|me')
    await s.fetch('k', async () => ({ a: '0' }))
    const send = deferred<null>()
    const p = s.mutate('k', { apply: setA('1'), send: () => send.promise })
    s.setScope('a|other')
    await s.fetch('k', async () => ({ a: 'theirs' }))
    send.resolve(null)
    await p
    expect(data(s)).toEqual({ a: 'theirs' })
  })
})

describe('같은 항목 쓰기 줄', () => {
  test('순서대로 하나씩 보내고, 줄 서 있는 동안 로그인이 바뀌면 보내지 않아요', async () => {
    const s = new QueryStore()
    s.setScope('a|me')
    const chains = new Map<string, Promise<unknown>>()
    const first = deferred<string>()
    const sent: string[] = []
    const opened = { same: () => true }
    const p1 = queueWrite(s, chains, 'item', () => (sent.push('first'), first.promise), opened)
    const p2 = queueWrite(s, chains, 'item', async () => (sent.push('second'), 'second'), opened)
    await tick()
    expect(sent).toEqual(['first'])
    s.setScope('a|other')
    first.resolve('first')
    await p1
    await expect(p2).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual(['first'])
  })
})

describe('같은 항목 쓰기 줄과 로그인', () => {
  test('세대가 아직 그대로여도 로그인이 바뀌었으면 보내지 않아요', async () => {
    const s = new QueryStore()
    const chains = new Map<string, Promise<unknown>>()
    let who = 'me'
    const first = deferred<string>()
    const sent: string[] = []
    const opened = { same: () => who === 'me' }
    void queueWrite(s, chains, 'item', () => (sent.push('first'), first.promise), opened)
    const p2 = queueWrite(s, chains, 'item', async () => (sent.push('second'), 'second'), opened)
    await tick()
    who = 'other'
    first.resolve('first')
    await expect(p2).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual(['first'])
  })
})
