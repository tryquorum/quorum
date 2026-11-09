import { describe, expect, test } from 'bun:test'
import type { OpsResponse } from '@direction-board/contracts'
import { OPS_FAST, OPS_SLOW, OpsStore } from './opsStore'

const ops = { owner: 'me', text: 't', enabled: true, every_min: 60, active_from: 8, active_to: 23, provider: null, model: null, effort: null, updated_at: 1, last_run_at: null, last_run_id: null, rev: 1 }
const resp = (extra: Partial<OpsResponse> = {}): OpsResponse => ({ ops, runs: [], next_at: null, in_window: true, ...extra })
class Forbidden extends Error {}
function harness(reads: ((full: boolean) => Promise<OpsResponse>)[]) {
  const timers: { fn: () => void; ms: number; id: number }[] = []
  let n = 0
  const calls: boolean[] = []
  const store = new OpsStore({
    read: (full) => {
      calls.push(full)
      const r = reads[Math.min(n++, reads.length - 1)]
      return r ? r(full) : Promise.resolve(resp())
    },
    forbidden: (e) => e instanceof Forbidden,
    setTimer: (fn, ms) => {
      const id = timers.length
      timers.push({ fn, ms, id })
      return id
    },
    clearTimer: (id) => {
      const t = timers.find((x) => x.id === id)
      if (t) t.ms = -1
    },
  })
  const live = () => timers.filter((t) => t.ms >= 0)
  return { store, calls, live }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('운영 순회 폴러', () => {
  test('칩은 가벼운 모양, 설정을 열면 전체로 바로 읽고, 아무도 안 보면 멈춰요', async () => {
    const h = harness([async () => resp()])
    const off = h.store.subscribe(false, () => {})
    await tick()
    expect(h.calls).toEqual([false])
    expect(h.live().map((t) => t.ms)).toEqual([OPS_SLOW])
    const off2 = h.store.subscribe(true, () => {})
    await tick()
    expect(h.calls).toEqual([false, true])
    off()
    off2()
    expect(h.live()).toEqual([])
  })
  test('도는 순회가 있으면 4초', async () => {
    const h = harness([async () => resp({ runs: [{ id: 'r', status: 'running', model_name: null, effort: null, session_id: null, error: null, created_at: 1, finished_at: null, report: null }] })])
    h.store.subscribe(false, () => {})
    await tick()
    expect(h.live().map((t) => t.ms)).toEqual([OPS_FAST])
  })
  test('403 이면 멈추고, 설정을 열면 한 번 더 확인해요', async () => {
    const h = harness([async () => { throw new Forbidden() }, async () => resp()])
    h.store.subscribe(false, () => {})
    await tick()
    expect(h.store.snapshot.status).toBe('forbidden')
    expect(h.live()).toEqual([])
    h.store.subscribe(true, () => {})
    await tick()
    expect(h.store.snapshot.status).toBe('ok')
  })
  test('앱이 뒤로 가면 타이머를 멈추고 앞으로 오면 바로 읽어요', async () => {
    const h = harness([async () => resp()])
    h.store.subscribe(false, () => {})
    await tick()
    h.store.setActive(false)
    expect(h.live()).toEqual([])
    h.store.setActive(true)
    await tick()
    expect(h.calls.length).toBe(2)
  })
  test('가벼운 응답은 전체가 가진 기본 지시문을 지우지 않아요', async () => {
    const h = harness([async () => resp({ default_text: '기본' }), async () => resp()])
    const off = h.store.subscribe(true, () => {})
    await tick()
    off()
    h.store.subscribe(false, () => {})
    await tick()
    expect(h.store.snapshot.data?.default_text).toBe('기본')
  })
  test('쓰는 중에 시작한 읽기 결과는 버리고, 쓰기 뒤 다시 읽어요', async () => {
    let release: (v: OpsResponse) => void = () => {}
    const slow = new Promise<OpsResponse>((r) => (release = r))
    const h = harness([async () => resp(), () => slow, async () => resp({ ops: { ...ops, text: '저장 뒤' } })])
    h.store.subscribe(true, () => {})
    await tick()
    const reading = h.store.refresh()
    const put = h.store.put(async () => ({ ops: { ...ops, text: '새 글', rev: 2 } }))
    release(resp({ ops: { ...ops, text: '옛 글' } }))
    await reading
    await put
    await tick()
    await tick()
    expect(h.store.snapshot.data?.ops.text).toBe('저장 뒤')
  })
  test('계정이 바뀌면 비우고 그 전 읽기 결과는 받지 않아요', async () => {
    let release: (v: OpsResponse) => void = () => {}
    const slow = new Promise<OpsResponse>((r) => (release = r))
    const h = harness([() => slow, async () => resp({ ops: { ...ops, owner: 'b' } })])
    h.store.subscribe(true, () => {})
    h.store.resetScope()
    release(resp({ ops: { ...ops, owner: 'a' } }))
    await tick()
    await tick()
    expect(h.store.snapshot.data?.ops.owner).toBe('b')
  })
  test('그리기에서 알린 범위가 바뀌면 바로 비우고(앞 계정 값 없음) 다음 틱에 다시 읽어요', async () => {
    const h = harness([async () => resp({ ops: { ...ops, owner: 'a' } }), async () => resp({ ops: { ...ops, owner: 'b' } })])
    h.store.setScope('o|a')
    h.store.subscribe(false, () => {})
    await tick()
    expect(h.store.snapshot.data?.ops.owner).toBe('a')
    h.store.setScope('o|a')
    expect(h.store.snapshot.data?.ops.owner).toBe('a')
    h.store.setScope('o|b')
    expect(h.store.snapshot.data).toBeNull()
    await tick()
    await tick()
    expect(h.store.snapshot.data?.ops.owner).toBe('b')
  })
})
