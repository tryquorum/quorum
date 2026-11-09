// SmallStore 한 줄 대기열(PR #43 리뷰): 이름마다 읽기·쓰기·초기화를 한 줄로, 늦게 끝난 작업이 새 값을 덮지 못하게(세대 번호).
// 초기화가 끝나기 전에는 다시 읽기·새 쓰기가 닫히고, 다시 읽기를 시작하면 바로 알려요.
import { describe, expect, test } from 'bun:test'
import { SmallStore } from './smallStore'

const anyJson = (_v: unknown): _v is unknown => true
function disk(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial }
  const reads: string[] = []
  const failReads = new Set<string>()
  const failWrites = new Set<string>()
  // 다음 한 번의 읽기·쓰기만 붙잡아요(그 뒤 작업은 바로 — 먼저 시작한 작업이 늦게 끝나는 경합을 만들어요)
  const holds: { read?: Promise<void>; write?: Promise<void> } = {}
  const hold = (kind: 'read' | 'write') => {
    let open!: () => void
    holds[kind] = new Promise<void>((r) => (open = r))
    return () => { holds[kind] = undefined; open() }
  }
  return {
    files, reads, failReads, failWrites, hold,
    io: {
      read: async (n: string) => {
        reads.push(n)
        const h = holds.read
        holds.read = undefined
        if (h) await h
        if (failReads.has(n)) throw new Error('io')
        return files[n] ?? null
      },
      write: async (n: string, text: string) => {
        const h = holds.write
        holds.write = undefined
        if (h) await h
        if (failWrites.has(n)) throw new Error('disk')
        files[n] = text
      },
    },
  }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('SmallStore 한 줄 대기열(PR #43 리뷰)', () => {
  test('리뷰 재현: 읽기 실패 → 버리고 새로(쓰기 늦음) → 그동안 다시 읽기·새 쓰기는 닫혀요 → 초기화가 끝난 뒤 쓴 새 기록은 덮이지 않아요', async () => {
    const d = disk({ k: '{"old":1}' })
    d.failReads.add('k')
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    expect(s.status('k')).toBe('read')
    d.failReads.delete('k')
    // 확인창을 띄울 때 계획(지금 본 것 = 전제), 확인 뒤 그 계획만 실행(규칙 F)
    const plan = await s.planReset('k', {})
    const open = d.hold('write')
    const reset = s.apply(plan)
    await tick() // 실행이 전제를 다시 읽고 쓰기에서 멈춰요
    // 초기화 중: 다시 읽기는 읽기를 새로 시작하지 않고, 쓰기는 거절
    const readsBefore = d.reads.length
    const reread = s.reload('k', anyJson)
    await tick()
    expect(d.reads.length).toBe(readsBefore)
    expect(s.status('k')).not.toBe('ok')
    expect(s.set('k', { fresh: 1 })).toBe(false)
    expect(s.busy('k')).toBe('reset')
    open()
    expect(await reset).toBe('done')
    await reread
    expect(s.status('k')).toBe('ok')
    expect(s.get<unknown>('k', null)).toEqual({})
    // 초기화가 끝난 뒤의 새 기록은 그대로 남아요
    expect(await s.setDurable('k', { fresh: 1 })).toBe(true)
    await tick()
    expect(JSON.parse(d.files.k ?? 'null')).toEqual({ fresh: 1 })
    expect(s.get<unknown>('k', null)).toEqual({ fresh: 1 })
  })

  test('쓰기 줄과 계획 실행이 같은 줄: 계획 뒤에 늦게 끝난 쓰기가 파일을 바꿨으면 계획은 0건(changed), 계획보다 먼저 시작한 쓰기는 그대로 닿아요', async () => {
    const d = disk({ k: '{"a":0}' })
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    const plan = await s.planReset('k', { reset: true })
    const open = d.hold('write')
    s.set('k', { a: 1 })
    const run = s.apply(plan)
    open()
    expect(await run).toBe('changed')
    await s.flush()
    await tick()
    expect(JSON.parse(d.files.k ?? 'null')).toEqual({ a: 1 })
  })
  test('전제 그대로면 계획 실행 뒤 밀린 쓰기가 옛 값으로 덮지 않아요', async () => {
    const d = disk({ k: '{"a":0}' })
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    const plan = await s.planReset('k', { reset: true })
    expect(await s.apply(plan)).toBe('done')
    await s.flush()
    expect(JSON.parse(d.files.k ?? 'null')).toEqual({ reset: true })
  })

  test('다시 읽는 중에 계획을 실행하면 늦게 온 읽기 결과는 버리고(세대 번호), 전제가 바뀌었으면 0건', async () => {
    const d = disk({ k: 'not json' })
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    expect(s.status('k')).toBe('corrupt')
    const plan = await s.planReset('k', { clean: 1 })
    const openRead = d.hold('read')
    void s.reload('k', anyJson)
    const run = s.apply(plan)
    d.files.k = '{"late":1}'
    openRead()
    // 계획의 전제('not json')와 지금 파일이 달라 0건 — 늦게 온 다시 읽기 결과는 세대로 버리고, 바뀜 뒤 다시 읽어 지금 값을 보여요
    expect(await run).toBe('changed')
    await tick()
    expect(d.files.k).toBe('{"late":1}')
    expect(s.status('k')).toBe('ok')
    expect(s.get<unknown>('k', null)).toEqual({ late: 1 })
  })

  test('초기화 쓰기가 실패하면 문제 그대로(쓰기 거절) + 초기화 실패 표시', async () => {
    const d = disk({ k: 'not json' })
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    d.failWrites.add('k')
    expect(await s.apply(await s.planReset('k', {}))).toBe('failed')
    expect(s.status('k')).toBe('corrupt')
    expect(s.resetFailed('k')).toBe(true)
    expect(s.set('k', { x: 1 })).toBe(false)
    expect(d.files.k).toBe('not json')
  })

  test('다시 읽기를 시작하면 바로 알려요(옛 오류·단추가 다음 그림까지 남지 않게)', async () => {
    const d = disk()
    d.failReads.add('k')
    const s = new SmallStore(d.io)
    await s.load('k', anyJson)
    let seen = 0
    s.subscribe('k', () => seen++)
    const open = d.hold('read')
    const p = s.reload('k', anyJson)
    expect(seen).toBeGreaterThan(0)
    expect(s.busy('k')).toBe('reload')
    expect(s.retrying('k')).toBe('read')
    d.failReads.delete('k')
    open()
    await p
    expect(s.status('k')).toBe('ok')
    expect(s.busy('k')).toBeNull()
  })
})

// P2(PR #43 리뷰 2): 입출력이 끝나지 않으면 같은 이름의 초기화·다시 읽기가 영원히 기다렸어요. 입출력마다 시간 상한을 두고 넘으면 그 작업은 실패,
// 늦게 끝난 결과는 버려요(읽기는 세대로, 쓰기는 끝나지 않은 쓰기가 끝날 때까지 다음 쓰기를 보내지 않아 늦은 쓰기가 새 값을 덮지 않아요)
describe('입출력 시간 상한(PR #43 리뷰 2 P2)', () => {
  test('읽기가 끝나지 않으면 상한 뒤 읽기 실패, 늦게 온 결과는 버려요 · 그 뒤 다시 읽기는 끝나요', async () => {
    let release!: (t: string | null) => void
    let hang = true
    const s = new SmallStore({ read: (n) => (hang ? new Promise((r) => (release = r)) : Promise.resolve(n === 'k' ? '["fresh"]' : null)), write: async () => {} }, () => {}, { timeoutMs: 30 })
    await s.load('k', anyJson)
    expect(s.status('k')).toBe('read')
    hang = false
    release('["late"]')
    await tick()
    expect(s.status('k')).toBe('read')
    await s.reload('k', anyJson)
    expect(s.get<unknown>('k', null)).toEqual(['fresh'])
  }, 2000)
  test('쓰기가 끝나지 않으면 상한 뒤 쓰기 실패, 그 쓰기가 끝나기 전에는 다음 쓰기를 보내지 않아 늦은 쓰기가 새 값을 덮지 않아요', async () => {
    const files: Record<string, string> = {}
    let releaseFirst!: () => void
    let first = true
    const s = new SmallStore({
      read: async () => null,
      write: (n, text) => {
        if (first) { first = false; return new Promise<void>((r) => (releaseFirst = () => { files[n] = text; r() })) }
        files[n] = text
        return Promise.resolve()
      },
    }, () => {}, { timeoutMs: 30 })
    await s.load('k', anyJson)
    expect(await s.setDurable('k', { v: 'old' })).toBe(false)
    expect(s.writeFailed('k')).toBe(true)
    // 끝나지 않은 쓰기가 있는 동안 새 쓰기는 보내지 않아요(실패) — 늦은 쓰기가 새 값을 덮는 순서가 생기지 않게
    expect(await s.setDurable('k', { v: 'new' })).toBe(false)
    expect(files.k).toBeUndefined()
    releaseFirst()
    await tick()
    expect(await s.setDurable('k', { v: 'new' })).toBe(true)
    expect(JSON.parse(files.k ?? 'null')).toEqual({ v: 'new' })
  }, 2000)
})

// PR #43 리뷰 3: 원자적 비교-후-쓰기(compareAndWrite). 같은 이름 줄 안에서 "앞선 쓰기(시간 초과 포함)가 끝난 뒤 → 전제 다시 읽기 → 같으면 쓰기"가 한 임계 구역
describe('compareAndWrite 경합 표(PR #43 리뷰 3)', () => {
  const seenOf = (t: string | null) => (t === null ? { s: 'absent' as const } : { s: 'text' as const, text: t })
  test('리뷰 3 P1-2 재현: old 전제의 삭제 계획 → 시간 초과된 new 쓰기가 전제 검사 직후 끝나도 새 기록을 지우지 않아요', async () => {
    const files: Record<string, string> = { k: '"old"' }
    let finishNew!: () => void
    let first = true
    const s = new SmallStore({
      read: async (n) => files[n] ?? null,
      write: (n, text) => {
        if (first) { first = false; return new Promise<void>((r) => (finishNew = () => { files[n] = text; r() })) }
        files[n] = text
        return Promise.resolve()
      },
    }, () => {}, { timeoutMs: 30 })
    await s.load('k', anyJson)
    const plan = await s.planReset('k', null) // 확인창: 지금 본 것 = "old"
    expect(await s.setDurable('k', 'new')).toBe(false) // new 쓰기는 시간 초과(아직 안 끝남)
    const run = s.apply(plan) // 계획 실행(= compareAndWrite)
    await tick()
    finishNew() // 시간 초과됐던 new 쓰기가 이제 끝남
    const r = await run
    expect(r === 'changed' || r === 'busy').toBe(true)
    expect(files.k).toBe('"new"')
  }, 2000)
  test('끝나지 않은 쓰기가 상한을 넘겨도 안 끝나면 busy(0건)', async () => {
    const files: Record<string, string> = { k: '"old"' }
    let first = true
    const s = new SmallStore({ read: async (n) => files[n] ?? null, write: (n, text) => { if (first) { first = false; return new Promise<void>(() => {}) } files[n] = text; return Promise.resolve() } }, () => {}, { timeoutMs: 30 })
    await s.load('k', anyJson)
    const plan = await s.planReset('k', null)
    await s.setDurable('k', 'new')
    expect(await s.compareAndWrite({ premises: plan.premises, write: plan.write })).toBe('busy')
    expect(files.k).toBe('"old"')
  }, 2000)
  for (const c of [
    { name: '전제 그대로 → 씀', premise: '"a"', now: '"a"', want: 'done', disk: 'null' },
    { name: '전제와 다름 → 0건', premise: '"a"', now: '"b"', want: 'changed', disk: '"b"' },
    { name: '전제 원문인데 지금 못 읽음 → 0건', premise: '"a"', now: 'UNREADABLE', want: 'changed', disk: '"a"' },
    { name: '전제 없음인데 지금 생김 → 0건', premise: null, now: '"x"', want: 'changed', disk: '"x"' },
  ] as const)
    test('경합 표: ' + c.name, async () => {
      const files: Record<string, string> = {}
      if (c.now !== 'UNREADABLE' && c.now !== null) files.k = c.now
      if (c.now === 'UNREADABLE') files.k = c.premise ?? ''
      const s = new SmallStore({ read: async (n) => { if (c.now === 'UNREADABLE') throw new Error('io'); return files[n] ?? null }, write: async (n, t) => void (files[n] = t) })
      const r = await s.compareAndWrite({ premises: [{ key: 'k', seen: seenOf(c.premise) }], write: { key: 'k', value: null } })
      expect(r).toBe(c.want)
      expect(files.k).toBe(c.disk)
    })
  test('P2: 바뀜 뒤 다시 읽기는 메모리 값이 있어도 새 디스크 값을 반영해요', async () => {
    const files: Record<string, string> = { k: '"old"' }
    const s = new SmallStore({ read: async (n) => files[n] ?? null, write: async (n, t) => void (files[n] = t) })
    await s.load('k', anyJson)
    expect(s.get<unknown>('k', null)).toBe('old')
    const plan = await s.planReset('k', null)
    files.k = '"disk-new"'
    expect(await s.apply(plan)).toBe('changed')
    await tick()
    await tick()
    expect(s.get<unknown>('k', null)).toBe('disk-new')
  })
})
