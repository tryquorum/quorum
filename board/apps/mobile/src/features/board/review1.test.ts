import { describe, expect, test } from 'bun:test'
import type { CaptureResponse, Item, Run, StateResponse } from '@direction-board/contracts'
import { ApiError, ScopeChangedError, UnknownWriteError } from '../../api/client'
import { freshItem } from './rules'
import { CaptureCenter, type CaptureApi } from './quick/captureFlow'
import { centerFor } from './quick/centers'
import { SmallStore } from './smallStore'
import { makeWorkNotice, outcomeOf } from './work/noteQuote'

// 코드 리뷰 1차 막힘 1~5(devlog/_plan/261107_ios_parity/work/006_review1_fix.md)

const item = (p: Partial<Item>): Item => ({ id: 'i1', boardId: 'b', type: 'todo', text: '할 일', x: 0, y: 0, w: 1, h: 1, done: true, ...p })
const state = (items: Item[]): StateResponse => ({ me: null, seq: 1, boards: [], items }) as unknown as StateResponse

describe('막힘 1: 되돌리기는 새로 읽은 값에서만', () => {
  test('최신 상태를 못 읽으면 되돌리지 않아요(캐시로 덮지 않음)', async () => {
    const r = await freshItem(async () => { throw new ApiError(503, 'down', false) }, item({}))
    expect(r).toEqual({ ok: false, reason: 'read' })
  })
  test('새로 읽은 항목(다른 곳에서 고친 제목·날짜 포함)을 돌려줘요', async () => {
    const r = await freshItem(async () => state([item({ text: '다른 기기에서 고친 제목', remindAt: '2026-12-01T09:00' })]), item({}))
    expect(r).toEqual({ ok: true, item: item({ text: '다른 기기에서 고친 제목', remindAt: '2026-12-01T09:00' }) })
  })
  test('목록에 없으면 missing', async () => {
    expect(await freshItem(async () => state([]), item({}))).toEqual({ ok: false, reason: 'missing' })
  })
})

const run = (id: string, p: Partial<Run> = {}): Run => ({ id, target: null, prompt: '글', provider: 'aside', model: 'm', model_name: null, effort: null, status: 'done', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: 2, kind: 'capture', ...p })
const eff = (undone: boolean) => ({ ref: 'item:b:1', op: 'created', title: 't', at: 1, run: 'r1', undone, undoable: !undone, now: { title: 't', type: 'todo', area: null, due: null, status: 'open' } })
const view = (undone: boolean): CaptureResponse => ({ run: run('r1'), runs: ['r1'], effects: [eff(undone)] }) as unknown as CaptureResponse
const defer = <T>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => (resolve = r)); return { p, resolve } }

describe('막힘 3: 늦게 온 옛 조회는 버려요', () => {
  test('되돌리기 전에 시작한 느린 조회가 되돌린 뒤에 끝나도 되돌린 결과가 남아요', async () => {
    const slow = defer<CaptureResponse>()
    let n = 0
    const api: CaptureApi = {
      start: async () => run('r1'),
      effects: () => (++n === 1 ? slow.p : Promise.resolve(view(true))),
      undo: async () => ({}),
      retry: async () => run('r2'),
      stop: async () => ({}),
      caps: async () => [],
      lookup: async () => null,
      scope: 's',
    }
    const files: Record<string, string> = { 'db:captures': JSON.stringify([{ id: 'r1', clientKey: 'k', text: '글', draft: null, startedAt: 1 }]) }
    const c = new CaptureCenter(api, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'k', () => {})
    const first = c.refresh('r1') // 느린 조회(되돌리기 전 상태)
    await c.undo('r1', 'item:b:1') // 되돌리기 + 새 조회(되돌린 상태)
    slow.resolve(view(false)) // 옛 응답이 늦게 도착
    await first
    expect(c.views.r1?.effects[0]?.undone).toBe(true)
  })
  test('(2차 막힘 1) 조회가 2초보다 늘 느려도 결과가 들어와요: 도는 동안 같은 실행 조회는 하나만', async () => {
    const pending: ReturnType<typeof defer<CaptureResponse>>[] = []
    const api: CaptureApi = {
      start: async () => run('r1'),
      effects: () => { const d = defer<CaptureResponse>(); pending.push(d); return d.p },
      undo: async () => ({}),
      retry: async () => run('r2'),
      stop: async () => ({}),
      caps: async () => [],
      lookup: async () => null,
      scope: 's',
    }
    const files: Record<string, string> = { 'db:captures': JSON.stringify([{ id: 'r1', clientKey: 'k', text: '글', draft: null, startedAt: 1 }]) }
    const c = new CaptureCenter(api, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'k', () => {})
    c.tick() // 2초 타이머
    c.tick() // 다음 2초: 앞 조회가 아직 안 끝남
    c.tick()
    expect(pending.length).toBe(1)
    pending[0]!.resolve(view(false))
    await pending[0]!.p
    await Promise.resolve()
    expect(c.views.r1?.effects.length).toBe(1)
  })
})

describe('막힘 2: 칩 목록은 그 범위의 파일을 다 읽은 뒤에만 만들어요', () => {
  test('읽기 전에는 null, 읽은 뒤 만든 칩 목록은 파일의 칩을 가져요', async () => {
    const files: Record<string, string> = { captures: JSON.stringify(JSON.stringify([{ id: 'r7', clientKey: 'k', text: '글', draft: null, startedAt: 1 }])) }
    const store = new SmallStore({ read: async (n) => files[n] ?? null, write: async (n, t) => void (files[n] = t) })
    const cache = new WeakMap<SmallStore, { entries: { id: string }[] }>()
    const make = (s: SmallStore) => ({ entries: (JSON.parse(s.get<string | null>('captures', null) ?? '[]') as { id: string }[]) })
    expect(centerFor(cache, store, 'captures', make)).toBeNull()
    await store.load('captures', (v): v is string => typeof v === 'string')
    expect(centerFor(cache, store, 'captures', make)?.entries.map((e) => e.id)).toEqual(['r7'])
  })
})

// 막힘 4(초안 넣기 다시 하기)는 기기 기록 대신 서버 onceKey(run:<초안 id>)로 바뀌었어요: work/flows.test.ts 의 '초안 넣기'

describe('막힘 5: 새 일 만들기의 부분 실패를 알려요', () => {
  test('연결·초안이 다 되면 성공만', () => {
    expect(makeWorkNotice({ linked: 'ok', drafted: 'ok' })).toBe('새 일로 만들었어요 · AI가 노트 초안을 쓰는 중')
  })
  test('연결이나 초안이 실패하면 무엇을 못 했는지와 할 일', () => {
    expect(makeWorkNotice({ linked: 'failed', drafted: 'ok' })).toBe('새 일로 만들었어요 · 이 일과 잇지 못했어요(연결 갈래에서 다시 이어 주세요) · AI가 노트 초안을 쓰는 중')
    expect(makeWorkNotice({ linked: 'ok', drafted: 'failed' })).toBe('새 일로 만들었어요 · AI 초안을 시작하지 못했어요(새 일에서 ✦ AI로 초안 쓰기)')
  })
  test('(2차 막힘 3) 결과를 모르면 실패라 하지 않고 확인할 곳을 알려요', () => {
    expect(makeWorkNotice({ linked: 'unknown', drafted: 'unknown' })).toBe('새 일로 만들었어요 · 이 일과 이어졌는지 확인하지 못했어요(연결 갈래에서 확인해 주세요) · AI 초안이 시작됐는지 확인하지 못했어요(새 일 노트에서 확인한 뒤 필요하면 ✦ AI로 초안 쓰기)')
    expect(outcomeOf(new UnknownWriteError('x'))).toBe('unknown')
    expect(outcomeOf(new ApiError(400, 'bad', false))).toBe('failed')
    expect(outcomeOf(new ScopeChangedError())).toBe('scope')
    expect(makeWorkNotice({ linked: 'scope', drafted: 'scope' })).toBe('새 일로 만들었어요 · 로그인이 바뀌어 잇기는 하지 않았어요(원래 계정에서 연결 갈래로 이어 주세요) · 로그인이 바뀌어 AI 초안은 시작하지 않았어요')
  })
})
