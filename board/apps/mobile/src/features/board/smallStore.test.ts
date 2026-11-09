import { describe, expect, test } from 'bun:test'
import { onceOk, SmallStore } from './smallStore'

const isKeys = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
function memory(initial: Record<string, string> = {}) {
  const files = { ...initial }
  const writes: string[] = []
  let fail = false
  let gate: Promise<void> | null = null
  return {
    files, writes,
    failNext: () => (fail = true),
    hold: () => { let open!: () => void; gate = new Promise((r) => (open = r)); return () => { open(); gate = null } },
    io: {
      read: async (n: string) => files[n] ?? null,
      write: async (n: string, text: string) => {
        if (gate) await gate
        if (fail) { fail = false; throw new Error('disk') }
        writes.push(text)
        files[n] = text
      },
    },
  }
}

describe('SmallStore', () => {
  test('처음 한 번 읽고, 검사를 못 지난 값은 버려요', async () => {
    const m = memory({ a: '["x"]', b: '{"bad":1}', c: 'not json' })
    const s = new SmallStore(m.io)
    expect(s.ready('a')).toBe(false)
    await Promise.all([s.load('a', isKeys), s.load('b', isKeys), s.load('c', isKeys)])
    expect(s.get('a', [] as string[])).toEqual(['x'])
    expect(s.get('b', [] as string[])).toEqual([])
    expect(s.get('c', [] as string[])).toEqual([])
    expect(s.ready('a')).toBe(true)
  })
  test('쓰는 중 밀린 값은 마지막 것만 순서대로 써요', async () => {
    const m = memory()
    const s = new SmallStore(m.io)
    await s.load('k', isKeys)
    const open = m.hold()
    s.set('k', ['1'])
    s.set('k', ['2'])
    s.set('k', ['3'])
    open()
    await s.flush()
    expect(m.writes).toEqual(['["1"]', '["3"]'])
    expect(m.files.k).toBe('["3"]')
  })
  test('쓰기 실패는 알리고, 메모리 값은 그대로예요', async () => {
    const m = memory()
    const failed: string[] = []
    const s = new SmallStore(m.io, (n) => failed.push(n))
    await s.load('k', isKeys)
    m.failNext()
    s.set('k', ['a'])
    await s.flush()
    expect(failed).toEqual(['k'])
    expect(s.get('k', [] as string[])).toEqual(['a'])
  })
  // 규칙 E(리뷰 22): 읽기 전에는 쓰지 않아요 — 읽지 않은 파일을 새 값으로 덮지 않게(쓰기는 false, 파일 값 그대로)
  test('읽기 전에는 쓰지 않아요(false), 다 읽은 뒤 파일 값이 그대로', async () => {
    const m = memory({ k: '["old"]' })
    const s = new SmallStore(m.io)
    expect(s.set('k', ['new'])).toBe(false)
    await s.load('k', isKeys)
    expect(s.get('k', [] as string[])).toEqual(['old'])
    expect(m.files.k).toBe('["old"]')
  })
})

// 리뷰 6 P1: 읽기 실패·깨진 값을 "없음"과 나눠요(빠른 추가 복구 기록을 못 읽었는데 빈 기록으로 보고 새로 제출하면 중복이 생겨요).
// 쓰기 실패도 상태로 남겨 화면이 확인을 요청할 수 있게 해요.
describe('SmallStore 상태(리뷰 6)', () => {
  test('읽기 실패는 read, 깨진 JSON·검사 실패는 corrupt, 파일 없음은 문제 없음', async () => {
    const io = { read: async (n: string) => { if (n === 'boom') throw new Error('io'); return ({ bad: 'not json', odd: '{"x":1}' } as Record<string, string>)[n] ?? null }, write: async () => {} }
    const s = new SmallStore(io)
    await Promise.all(['boom', 'bad', 'odd', 'none'].map((n) => s.load(n, isKeys)))
    expect(['boom', 'bad', 'odd', 'none'].map((n) => s.problem(n))).toEqual(['read', 'corrupt', 'corrupt', null])
    expect(s.ready('boom')).toBe(true)
  })
  test('다시 읽기가 성공하면 문제가 풀리고 값이 올라와요', async () => {
    let fail = true
    const s = new SmallStore({ read: async () => { if (fail) throw new Error('io'); return '["k"]' }, write: async () => {} })
    await s.load('k', isKeys)
    expect(s.problem('k')).toBe('read')
    fail = false
    await s.reload('k', isKeys)
    expect([s.problem('k'), s.get('k', [] as string[])]).toEqual([null, ['k']])
  })
  test('쓰기 실패는 writeFailed 로 남고, 다음 쓰기가 성공하면 풀려요', async () => {
    const m = memory()
    const s = new SmallStore(m.io)
    await s.load('k', isKeys)
    m.failNext()
    s.set('k', ['a'])
    await s.flush()
    expect(s.writeFailed('k')).toBe(true)
    s.set('k', ['b'])
    await s.flush()
    expect(s.writeFailed('k')).toBe(false)
  })
  // 규칙 E(리뷰 22): 읽지 못했거나 깨진 값은 보통 쓰기로 덮지 않고(false·문제 그대로), 사람이 고른 버리고 새로(reset)만 덮어요
  test('깨진 값은 보통 쓰기로 덮지 않고, 버리고 새로(reset)만 문제를 풀고 덮어요', async () => {
    const files: Record<string, string> = { k: 'broken' }
    const s = new SmallStore({ read: async (n) => files[n] ?? null, write: async (n, t) => void (files[n] = t) })
    await s.load('k', isKeys)
    expect([s.status('k'), s.problem('k')]).toEqual(['corrupt', 'corrupt'])
    expect(s.set('k', [])).toBe(false)
    expect(await s.setDurable('k', [])).toBe(false)
    await s.flush()
    expect([s.problem('k'), files.k]).toEqual(['corrupt', 'broken'])
    await s.apply(await s.planReset('k', []))
    await s.flush()
    expect([s.status('k'), files.k]).toEqual(['ok', '[]'])
  })
  test('읽기 실패 뒤 저장소가 복구돼도 다시 읽기 전에는 쓰지 않고, 다시 읽으면 오류 상태가 풀려 써요', async () => {
    let fail = true
    const files: Record<string, string> = { k: '["keep"]' }
    const s = new SmallStore({ read: async (n) => { if (fail) throw new Error('io'); return files[n] ?? null }, write: async (n, t) => void (files[n] = t) })
    await s.load('k', isKeys)
    expect(s.status('k')).toBe('read')
    fail = false
    expect(s.set('k', [])).toBe(false)
    expect(files.k).toBe('["keep"]')
    await s.reload('k', isKeys)
    expect([s.status('k'), s.get('k', [] as string[])]).toEqual(['ok', ['keep']])
    expect(s.set('k', ['keep', 'new'])).toBe(true)
    await s.flush()
    expect(files.k).toBe('["keep","new"]')
  })
})

// 머지 뒤 P2(리뷰 23): 범위 폴더 준비가 한 번 실패하면 실패한 Promise 가 남아, 장애가 풀려도 "다시 읽기"가 계속 읽기 실패였어요
describe('준비 기억(onceOk) — 실패는 기억하지 않아요', () => {
  test('성공한 준비는 한 번만 하고, 같이 들어온 호출은 진행 중인 준비를 나눠 써요', async () => {
    let made = 0
    const get = onceOk(async () => { made++; return 'dir' })
    expect(await Promise.all([get(), get()])).toEqual(['dir', 'dir'])
    expect(await get()).toBe('dir')
    expect(made).toBe(1)
  })
  test('실패한 준비는 잊고 다음 호출에서 다시 준비해요', async () => {
    let fail = true
    let made = 0
    const get = onceOk(async () => { made++; if (fail) throw new Error('no disk'); return 'dir' })
    expect(await get().catch((e: Error) => e.message)).toBe('no disk')
    fail = false
    expect(await get()).toBe('dir')
    expect(made).toBe(2)
  })
  test('폴더 준비가 실패해 읽기 실패였던 이름도, 장애가 풀린 뒤 다시 읽기로 풀려요(SmallStore + onceOk)', async () => {
    let fail = true
    const files: Record<string, string> = { focus: 'false' }
    const folder = onceOk(async () => { if (fail) throw new Error('no disk'); return files })
    const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
    const s = new SmallStore({ read: async (n) => (await folder())[n] ?? null, write: async (n, t) => void ((await folder())[n] = t) })
    await s.load('focus', isBool)
    expect(s.status('focus')).toBe('read')
    fail = false
    await s.reload('focus', isBool)
    expect([s.status('focus'), s.get('focus', true)]).toEqual(['ok', false])
  })
})

// 머지 뒤 P2(리뷰 25): 다시 읽는 동안 직전 문제를 기억하고(화면이 다시 그려져도 안내 유지), 초기화는 쓰기가 닿은 뒤에만 문제를 지워요
describe('다시 읽는 중·초기화 실패(리뷰 25 P2)', () => {
  test('다시 읽는 동안 상태는 loading 이지만 직전 문제(retrying)를 기억하고, 끝나면 지워요', async () => {
    let mode: 'fail' | 'gate' = 'fail'
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const s = new SmallStore({ read: async () => { if (mode === 'fail') throw new Error('io'); await gate; return 'true' }, write: async () => {} })
    const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
    await s.load('focus', isBool)
    expect([s.status('focus'), s.retrying('focus')]).toEqual(['read', null])
    mode = 'gate'
    const p = s.reload('focus', isBool)
    expect([s.status('focus'), s.retrying('focus')]).toEqual(['loading', 'read'])
    open()
    await p
    expect([s.status('focus'), s.retrying('focus')]).toEqual(['ok', null])
  })
  test('초기화 쓰기가 실패하면 문제 상태 그대로 + 초기화 실패 표시, 성공하면 그때 풀려요', async () => {
    const files: Record<string, string> = { focus: '"깨짐"' }
    let failWrite = true
    const s = new SmallStore({ read: async (n) => files[n] ?? null, write: async (n, t) => { if (failWrite) throw new Error('disk'); files[n] = t } })
    const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
    await s.load('focus', isBool)
    expect(await s.apply(await s.planReset('focus', true))).toBe('failed')
    expect([s.status('focus'), s.resetFailed('focus'), files.focus]).toEqual(['corrupt', true, '"깨짐"'])
    failWrite = false
    expect(await s.apply(await s.planReset('focus', true))).toBe('done')
    expect([s.status('focus'), s.resetFailed('focus'), files.focus, s.get('focus', false)]).toEqual(['ok', false, 'true', true])
  })
})
