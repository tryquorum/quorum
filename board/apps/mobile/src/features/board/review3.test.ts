import { describe, expect, test } from 'bun:test'
import type { CaptureResponse, Run } from '@direction-board/contracts'
import { ApiError, ScopeChangedError, UnknownWriteError } from '../../api/client'
import { CaptureCenter, type CaptureApi } from './quick/captureFlow'

// 새 독립 리뷰(34e9584) P2 두 건 → 리뷰 9 원칙으로 바뀜: 결과를 모르는 시작은 다시 보내지 않고 칩으로 남겨요.
// "확인"은 읽기만(같은 clientKey 의 실행 찾기), 서버에 없다고 확인된 뒤 사람이 누른 "다시 보내기"만 보내요.

const run = (id: string, p: Partial<Run> = {}): Run => ({ id, target: null, prompt: '글', provider: 'aside', model: 'm', model_name: null, effort: null, status: 'running', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: null, kind: 'capture', ...p })
const view = (id: string): CaptureResponse => ({ run: run(id), runs: [id], effects: [] })
const draft = { boardId: 'b', kind: 'todo' as const, title: '회의 준비', at: null, areaId: null, tags: ['급함'], note: '노트', props: [] }
function setup(start: CaptureApi['start'], over: Partial<CaptureApi> = {}, files: Record<string, string> = {}) {
  const calls: string[] = []
  const bodies: unknown[] = []
  const warned: string[] = []
  const api: CaptureApi = {
    start: (b) => { bodies.push(b); return start(b) },
    effects: async (id) => { calls.push('effects:' + id); return view(id) },
    undo: async () => ({}), retry: async () => run('r2'), stop: async () => ({}), scope: 'scope-A',
    caps: async () => ['runClientKey'], lookup: async () => null,
    ...over,
  }
  const c = new CaptureCenter(api, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'key-1', (w) => warned.push(w))
  return { c, calls, bodies, warned, files }
}
const net = () => new UnknownWriteError(new Error('net'))

describe('AI 정리 시작 응답을 잃으면', () => {
  test('바로 다시 보내지 않고 보냈는지 모르는 칩으로 남겨요(원래 clientKey·초안·힌트·범위 유지), 결과를 묻지 않아요', async () => {
    const t = setup(async () => { throw net() })
    const r = await t.c.start('회의 준비 #급함', draft, { tags: ['급함'] })
    expect(r).toEqual({ ok: true, unsent: true })
    expect(t.bodies.length).toBe(1)
    const e = t.c.entries[0]!
    expect([t.c.isUnsent(e), e.clientKey, e.draft, e.hints, e.scope]).toEqual([true, 'key-1', draft, { tags: ['급함'] }, 'scope-A'])
    t.c.tick()
    expect(t.calls).toEqual([])
    expect(t.c.running).toBe(false)
    expect(JSON.parse(t.files['db:captures']!)[0].clientKey).toBe('key-1') // 앱을 다시 열어도 남아요
  })
  test('확인은 같은 clientKey 로 찾기만: 서버에 그 실행이 있으면 칩이 그 실행으로 옮겨가요(시작 요청 없음)', async () => {
    const keys: string[] = []
    const t = setup(async () => { throw net() }, { lookup: async (k) => (keys.push(k), run('r5')) })
    await t.c.start('회의 준비 #급함', draft, { tags: ['급함'] })
    await t.c.confirm(t.c.entries[0]!.id)
    expect([t.bodies.length, keys]).toEqual([1, ['key-1']])
    expect(t.c.entries.map((e) => e.id)).toEqual(['r5'])
    expect(t.calls).toEqual(['effects:r5'])
  })
  test('없다고 확인된 뒤 사람이 다시 보내기를 누르면 같은 clientKey·같은 글·같은 힌트로, 결과를 또 모르면 칩 그대로 확인 전으로', async () => {
    let n = 0
    const t = setup(async () => { n++; if (n === 1 || n === 2) throw net(); return run('r6') })
    await t.c.start('회의 준비 #급함', draft, { tags: ['급함'] })
    const id = t.c.entries[0]!.id
    await t.c.confirm(id)
    expect(t.c.check(id)).toBe('absent')
    await t.c.resend(id)
    expect(t.bodies.at(-1)).toEqual({ kind: 'capture', prompt: '회의 준비 #급함', clientKey: 'key-1', hints: { tags: ['급함'] } })
    expect([t.c.isUnsent(t.c.entries[0]!), t.c.check(id)]).toEqual([true, undefined])
    expect(t.warned.at(-1)).toBe('보냈는지 아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요')
    await t.c.resend(id) // 확인 전 상태에서는 보내지 않아요
    expect(t.bodies.length).toBe(2)
    await t.c.confirm(id)
    await t.c.resend(id)
    expect(t.c.entries.map((e) => e.id)).toEqual(['r6'])
  })
})

describe('AI 정리 시작 중 범위가 바뀌면(구조 1)', () => {
  test('처음부터 바뀌었으면 보내지 않고 알려요(칩 없음)', async () => {
    const t = setup(async () => { throw new ScopeChangedError() })
    expect((await t.c.start('회의 준비', draft, undefined)).ok).toBe(false)
    expect(t.c.entries).toEqual([])
  })
  test('다시 보내기가 범위가 바뀌어 막혀도 칩은 그대로', async () => {
    let n = 0
    const t = setup(async () => { if (n++ === 0) throw net(); throw new ScopeChangedError() })
    await t.c.start('회의 준비', draft, undefined)
    const id = t.c.entries[0]!.id
    await t.c.confirm(id)
    await t.c.resend(id)
    expect(t.c.isUnsent(t.c.entries[0]!)).toBe(true)
    expect(t.warned.at(-1)).toBe('서버나 로그인이 바뀌어 저장하지 않았어요')
  })
})

describe('(리뷰 3) 한 번이라도 결과 불명이면 키를 잃지 않아요', () => {
  test('사람이 누른 다시 보내기가 401 로 거절돼도 원래 키·초안·범위의 칩이 남아요(버리기는 사람이)', async () => {
    let n = 0
    const t = setup(async () => { if (n++ === 0) throw net(); throw new ApiError(401, '로그인이 필요해요') })
    await t.c.start('회의 준비', draft, { tags: ['급함'] })
    const id = t.c.entries[0]!.id
    await t.c.confirm(id)
    await t.c.resend(id)
    const e = t.c.entries[0]!
    expect([t.c.isUnsent(e), e.clientKey, e.draft?.title, e.scope]).toEqual([true, 'key-1', '회의 준비', 'scope-A'])
    t.c.dismiss(id) // 닫기로 지울 수 없어요
    expect(t.c.live().map((x) => x.id)).toEqual([id])
    t.c.discard(id)
    expect(t.c.entries).toEqual([])
  })
  test('확인은 칩의 범위가 지금 범위와 같을 때만 읽어요(앱을 다시 연 뒤 저장된 칩)', async () => {
    const looked: string[] = []
    const files = { 'db:captures': JSON.stringify([{ id: 'unsent:k9', clientKey: 'k9', text: '회의 준비', draft, startedAt: 1, scope: 'scope-B' }]) }
    const t = setup(async () => run('r7'), { lookup: async (k) => (looked.push(k), null) }, files)
    await t.c.confirm('unsent:k9')
    expect([t.bodies, looked]).toEqual([[], []])
    expect(t.warned).toEqual(['다른 계정에서 시작한 AI 정리예요 · 그 계정으로 돌아가면 확인해요'])
    expect(t.c.isUnsent(t.c.entries[0]!)).toBe(true)
  })
})
