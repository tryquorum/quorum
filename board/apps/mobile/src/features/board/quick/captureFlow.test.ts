import { describe, expect, test } from 'bun:test'
import type { CaptureEffect, CaptureResponse, Run } from '@direction-board/contracts'
import { ApiError, ConflictError, UnknownWriteError } from '../../../api/client'
import { canUndo, CaptureCenter, validCaptureStore, type CaptureApi } from './captureFlow'

const run = (id: string, p: Partial<Run> = {}): Run => ({ id, target: null, prompt: '글', provider: 'aside', model: 'm', model_name: null, effort: null, status: 'running', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: null, kind: 'capture', ...p })
const view = (id: string, status: Run['status'] = 'running'): CaptureResponse => ({ run: run(id, { status }), runs: [id], effects: [] })
function setup(api: Partial<CaptureApi>, initial = '[]') {
  const files: Record<string, string> = { 'db:captures': initial }
  const warned: string[] = []
  const calls: string[] = []
  const full: CaptureApi = {
    start: async () => run('r1'),
    effects: async (id) => view(id),
    undo: async () => ({}),
    retry: async () => run('r2'),
    stop: async () => ({}),
    caps: async () => ['runClientKey'],
    lookup: async () => null,
    scope: 'scope-A',
    ...api,
  }
  const wrapped = Object.fromEntries(Object.entries(full).map(([k, f]) => [k, typeof f === 'function' ? (...a: unknown[]) => (calls.push(k), (f as (...x: unknown[]) => unknown)(...a)) : f])) as unknown as CaptureApi
  const c = new CaptureCenter(wrapped, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'key-1', (t) => warned.push(t))
  return { c, warned, calls, files }
}
const entry = (id: string) => JSON.stringify([{ id, clientKey: 'k', text: '글', draft: null, startedAt: 1 }])

describe('다시 시도(B4)', () => {
  test('409 에 run 이 있으면(이미 다시 시도함) 칩이 그 실행으로 옮겨가요', async () => {
    const { c, warned } = setup({ retry: async () => { throw new ConflictError(409, 'already retried', false, { error: 'already retried', run: run('r9') }) } }, entry('r1'))
    await c.retry('r1')
    expect(c.entries.map((e) => e.id)).toEqual(['r9'])
    expect(warned).toEqual([])
  })
  test('409 에 run 이 없으면(다시 시도할 수 없는 실행) 칩은 그대로 두고 서버 글을 알려요', async () => {
    const { c, warned } = setup({ retry: async () => { throw new ConflictError(409, '이 실행은 다시 시도할 수 없어요', false, { error: '이 실행은 다시 시도할 수 없어요' }) } }, entry('r1'))
    await c.retry('r1')
    expect(c.entries.map((e) => e.id)).toEqual(['r1'])
    expect(warned).toEqual(['이 실행은 다시 시도할 수 없어요'])
  })
  test('성공하면 새 실행으로 옮기고 그 결과를 바로 읽어요', async () => {
    const { c, calls } = setup({}, entry('r1'))
    await c.retry('r1')
    expect(c.entries.map((e) => e.id)).toEqual(['r2'])
    expect(calls).toEqual(['retry', 'effects'])
  })
})

describe('되돌리기 단추(B4)', () => {
  const eff = (p: Partial<CaptureEffect>): CaptureEffect => ({ ref: 'item:b:1', op: 'created', title: 't', at: 1, run: 'r1', undone: false, undoable: true, now: { title: 't', type: 'todo', area: null, due: null, status: 'open' }, ...p })
  test('서버가 되돌릴 수 있다고 한 것만 보여요', () => {
    expect(canUndo(eff({}))).toBe(true)
    expect(canUndo(eff({ op: 'merged', undoable: false }))).toBe(false) // 기존 일에 덧붙임
    expect(canUndo(eff({ undoable: false }))).toBe(false) // 만든 뒤 사람이 고침
    expect(canUndo(eff({ undone: true }))).toBe(false)
    expect(canUndo(eff({ now: null }))).toBe(false)
  })
})

describe('다시 그리기', () => {
  test('결과 하나가 되돌려져 개수가 같아도 version 이 올라요', async () => {
    let undone = false
    const eff = { ref: 'item:b:1', op: 'created' as const, title: 't', at: 1, run: 'r1', undone: false, undoable: true, now: { title: 't', type: 'todo', area: null, due: null, status: 'open' } }
    const { c } = setup({ effects: async (id) => ({ ...view(id, 'done'), effects: [{ ...eff, undone, undoable: !undone }] }), undo: async () => { undone = true; return {} } }, entry('r1'))
    await c.refresh('r1')
    const before = c.version
    await c.undo('r1', 'item:b:1')
    expect(c.version).toBeGreaterThan(before)
    expect(c.views.r1?.effects[0].undone).toBe(true)
  })
})

describe('시작', () => {
  test('(리뷰 9) 결과 불명이면 다시 보내지 않고 같은 키의 칩으로 남겨요', async () => {
    const keys: string[] = []
    const { c } = setup({ start: async (b) => { keys.push(b.clientKey); throw new UnknownWriteError(new Error('lost')) } })
    expect(await c.start('글', null, undefined)).toEqual({ ok: true, unsent: true })
    expect(keys).toEqual(['key-1'])
    expect(c.entries.map((e) => e.id)).toEqual(['unsent:key-1'])
  })
  test('서버가 거절하면 다시 보내지 않아요', async () => {
    let n = 0
    const { c } = setup({ start: async () => { n++; throw new ApiError(400, 'prompt required', false, { error: 'prompt required' }) } })
    expect(await c.start('글', null, undefined)).toEqual({ ok: false, error: 'prompt required' })
    expect(n).toBe(1)
  })
  test('같은 글이 이미 정리 중(409 + run)이면 그 칩에 붙어요', async () => {
    const { c } = setup({ start: async () => { throw new ConflictError(409, '같은 글', false, { error: '같은 글', run: run('r7', { prompt: '글' }) }) } })
    expect(await c.start('글', null, undefined)).toEqual({ ok: true, existing: true })
    expect(c.entries.map((e) => e.id)).toEqual(['r7'])
  })
  test('결과를 볼 수 없는 칩(404)은 접어요', async () => {
    const { c } = setup({ effects: async () => { throw new ApiError(404, 'gone', false, { error: 'gone' }) } }, entry('r1'))
    await c.refresh('r1')
    expect(c.entries[0].dismissed).toBe(true)
  })
})

// 리뷰 8 P1: 칩 개수 제한(10)이 보냈는지 모르는 칩·진행 중 칩을 지우지 않아요(끝난 것만 정리). 저장 파일은 모든 항목을 검사해요
describe('(리뷰 8) 칩 개수 제한과 저장 검사', () => {
  const chip = (id: string) => ({ id, clientKey: 'k' + id, text: '글 ' + id, draft: null, startedAt: 1 })
  test('끝난 칩 10개 + 보냈는지 모르는 칩 1개에서 새 칩을 더해도 보냈는지 모르는 칩은 남아요', async () => {
    const done = Array.from({ length: 10 }, (_, n) => chip('d' + n))
    const initial = JSON.stringify([{ ...chip('unsent:u1'), clientKey: 'u1', scope: 'scope-A' }, ...done])
    const { c, files } = setup({ effects: async (id) => view(id, 'done') }, initial)
    for (const e of done) await c.refresh(e.id)
    expect((await c.start('새 글', null, undefined)).ok).toBe(true)
    const kept = (JSON.parse(files['db:captures'] ?? '[]') as { id: string }[]).map((e) => e.id)
    expect(kept).toContain('unsent:u1')
    expect(kept).toContain('r1')
    expect(kept.length).toBeLessThanOrEqual(11)
  })
  test('진행 중인 칩은 개수가 넘어도 지우지 않아요(끝난 것부터 정리)', async () => {
    const running = Array.from({ length: 12 }, (_, n) => chip('run' + n))
    const { c, files } = setup({ effects: async (id) => view(id, 'running') }, JSON.stringify(running))
    expect((await c.start('하나 더', null, undefined)).ok).toBe(true)
    const kept = (JSON.parse(files['db:captures'] ?? '[]') as { id: string }[]).map((e) => e.id)
    expect(kept.length).toBe(13)
  })
  test('저장 파일 검사: 배열이어도 항목 하나가 깨졌으면 깨짐(조용히 거르지 않아요)', () => {
    expect(validCaptureStore(JSON.stringify([chip('a')]))).toBe(true)
    expect(validCaptureStore(JSON.stringify([chip('a'), { id: 1 }]))).toBe(false)
    expect(validCaptureStore('{}')).toBe(false)
    expect(validCaptureStore('[]')).toBe(true)
  })
})
