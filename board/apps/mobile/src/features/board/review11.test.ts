import { afterEach, describe, expect, test } from 'bun:test'
import type { NoteSource, Run, WriteResult } from '@direction-board/contracts'
import * as Cap from '@direction-board/contracts/capture'
import * as Q from '@direction-board/contracts/quick-add'
import type { Draft } from '@direction-board/contracts/quick-add'
import { ApiError, configureAuth, scopedClient, UnknownWriteError, type Client } from '../../api/client'
import type { Intent, Journal } from './intents'
import * as R from './replays'
import { CaptureCenter, type CaptureApi } from './quick/captureFlow'
import { createWithRecord } from './quick/createScoped'
import type { Pending } from './quick/recovery'
import { insertDraftNote } from './work/insertDraft'
import { addAnswerToNote, type NoteIO } from './work/addAnswer'

// PR #39 리뷰 9(e6f2d1f): 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않아요. 확인(읽기)만 하고, 다시 보내기는 사람이 눌렀을 때만.
// 결과 불명 기록은 사람이 "버리기" 하기 전까지 지우지 않아요(닫기는 숨기기, 정리는 확인된 끝만).
const O = 'https://board.test'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
type Route = (method: string, path: string, body: Record<string, unknown> | undefined) => Response | undefined
function serve(caps: string[] | null, route: Route) {
  const sent: string[] = []
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).slice(O.length)
    const method = init?.method ?? 'GET'
    sent.push(method + ' ' + path)
    if (method === 'GET' && path === '/api/settings') return Response.json({ me: { email: 'a', agent: false }, ...(caps ? { capabilities: caps } : {}) })
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    return route(method, path, body) ?? Response.json({ error: 'not found' }, { status: 404 })
  }, { preconnect: originalFetch.preconnect })
  return { sent, writes: () => sent.filter((x) => !x.startsWith('GET ')) }
}
const NEW = ['runClientKey', 'noteOnceKey', 'docCreateId']
const capsOf = () => fetch(O + '/api/settings').then((r) => r.json()).then((s: { capabilities?: string[] }) => s.capabilities ?? [])
const journal = () => {
  const dropped: string[] = []
  const j: Journal = { put: async () => true, drop: (k) => void dropped.push(k), release: () => {}, blocked: () => null }
  return { j, dropped }
}
const S = O + '|anon'
const runIntent: Intent = { key: 'run:k1', kind: 'run', scope: S, at: 1, label: '초안', payload: { body: { prompt: '초안 써 줘', kind: 'draft', target: 'item:b:1' } } }
const noteIntent: Intent = { key: 'note:d1:item:b:1', kind: 'note', scope: S, at: 1, label: '초안 넣기', payload: { ref: 'item:b:1', draft: { id: 'd1', output: '## 상황\n초안' } } }
const workIntent: Intent = { key: 'work:w1', kind: 'work', scope: S, at: 1, label: '새 일', payload: { a: { ref: 'item:b:1', sel: '고른 글', noteText: '노트', parentTitle: '부모', model: {} } } }
const itemIntent: Intent = { key: 'item:b:i9', kind: 'item', scope: S, at: 1, label: '새 항목', payload: { item: { id: 'i9', boardId: 'b', type: 'todo', text: '새 항목', x: 0, y: 0, w: 1, h: 1 } } }
const docIntent: Intent = { key: 'doc:11111111-1111-4111-8111-111111111111', kind: 'doc', scope: S, at: 1, label: '문서', payload: { input: { id: '11111111-1111-4111-8111-111111111111', title: '새 문서' } } }
const confirm = (i: Intent, j: Journal) => (R as unknown as { confirmIntent: (j: Journal, c: Client, i: Intent, caps: () => Promise<string[]>) => Promise<{ kind: string; remaining?: string[]; open?: string }> }).confirmIntent(j, scopedClient(O), i, capsOf)
const resend = (i: Intent, j: Journal) => (R as unknown as { resendIntent: (j: Journal, c: Client, i: Intent, caps: () => Promise<string[]>) => Promise<{ kind: string }> }).resendIntent(j, scopedClient(O), i, capsOf)

describe('(리뷰 9) 홈의 끝나지 않은 요청: 확인은 읽기만', () => {
  test('AI 실행: 키로 찾아 없으면 absent — POST 0건, 기록 남김. 사람이 다시 보내기를 누르면 같은 키로 한 번', async () => {
    const posts: Record<string, unknown>[] = []
    const t = serve(NEW, (m, p, b) => (m === 'GET' && p.startsWith('/api/runs?clientKey=') ? Response.json({ runs: [] }) : m === 'POST' && p === '/api/runs' ? (posts.push(b ?? {}), Response.json({ id: 'r1', created_at: 1 }, { status: 201 })) : undefined))
    const { j, dropped } = journal()
    expect((await confirm(runIntent, j)).kind).toBe('absent')
    expect([t.writes(), dropped]).toEqual([[], []])
    expect((await resend(runIntent, j)).kind).toBe('done')
    expect(posts).toEqual([{ prompt: '초안 써 줘', kind: 'draft', target: 'item:b:1', clientKey: 'run:k1' }])
    expect(dropped).toEqual(['run:k1'])
  })
  test('AI 실행: 키의 실행이 있으면 done(기록 지움), POST 0건', async () => {
    const t = serve(NEW, (m, p) => (m === 'GET' && p.startsWith('/api/runs?clientKey=') ? Response.json({ runs: [{ id: 'r1', client_key: 'run:k1' }] }) : undefined))
    const { j, dropped } = journal()
    expect((await confirm(runIntent, j)).kind).toBe('done')
    expect([t.writes(), dropped]).toEqual([[], ['run:k1']])
  })
  test('새 일: 같은 ref 의 사건이 있으면 사건을 다시 만들지 않고 남은 단계(잇기·초안)만 알려요. 이어 하기도 사건 POST 0건', async () => {
    const t = serve(NEW, (m, p) => {
      if (m === 'GET' && p.startsWith('/api/signals')) return Response.json({ signals: [{ id: 's1', ref: 'note-quote:work:w1', status: 'resolved' }] })
      if (m === 'GET' && p.startsWith('/api/work/signal%3As1')) return Response.json({ ref: 'signal:s1', self: { title: 'x' }, links: [] })
      if (m === 'GET' && p.startsWith('/api/runs?clientKey=')) return Response.json({ runs: [] })
      if (m === 'POST' && p === '/api/work/links') return Response.json({ id: 'l1' })
      if (m === 'POST' && p === '/api/runs') return Response.json({ id: 'r2', created_at: 1 }, { status: 201 })
      return undefined
    })
    const { j, dropped } = journal()
    const seen = await confirm(workIntent, j)
    expect([seen.kind, seen.remaining, seen.open]).toEqual(['partial', ['link', 'draft'], 'signal:s1'])
    expect([t.writes(), dropped]).toEqual([[], []])
    expect((await resend(workIntent, j)).kind).toBe('done')
    expect(t.writes()).toEqual(['POST /api/work/links', 'POST /api/runs'])
    expect(t.writes()).not.toContain('POST /api/signals')
  })
  test('새 일: 사건이 없으면 absent — 아무것도 보내지 않아요', async () => {
    const t = serve(NEW, (m, p) => (m === 'GET' && p.startsWith('/api/signals') ? Response.json({ signals: [] }) : undefined))
    const { j, dropped } = journal()
    expect((await confirm(workIntent, j)).kind).toBe('absent')
    expect([t.writes(), dropped]).toEqual([[], []])
  })
  test('초안 넣기: 노트를 onceKey 로 읽어 적용됐으면 done, 아니면 absent — 노트 쓰기 0건', async () => {
    let applied = false
    const t = serve(NEW, (m, p) => (m === 'GET' && p.startsWith('/api/docs/item%3Ab%3A1/note') ? Response.json({ ref: 'item:b:1', html: '', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true, ...(p.includes('onceKey=run%3Ad1') ? { onceApplied: applied } : {}) }) : undefined))
    const { j, dropped } = journal()
    expect((await confirm(noteIntent, j)).kind).toBe('absent')
    applied = true
    expect((await confirm(noteIntent, j)).kind).toBe('done')
    expect([t.writes(), dropped]).toEqual([[], ['note:d1:item:b:1']])
  })
  test('초안 넣기(onceKey 를 모르는 옛 서버): 본문으로만 확인 — 노트 쓰기 0건', async () => {
    const t = serve(null, (m, p) => (m === 'GET' && p.startsWith('/api/docs/item%3Ab%3A1/note') ? Response.json({ ref: 'item:b:1', html: '', md: '앞 글\n\n## 상황\n초안', version: 4, personEdited: true }) : undefined))
    const { j } = journal()
    expect((await confirm(noteIntent, j)).kind).toBe('done')
    expect(t.writes()).toEqual([])
  })
  test('새 항목: 없으면(404) absent — PUT 0건. 사람이 다시 보내기를 누르면 다시 읽고 없을 때만 PUT', async () => {
    const t = serve(NEW, (m, p) => (m === 'PUT' && p.startsWith('/api/boards/b/items/i9') ? Response.json({ id: 'i9' }) : undefined))
    const { j, dropped } = journal()
    expect((await confirm(itemIntent, j)).kind).toBe('absent')
    expect(t.writes()).toEqual([])
    expect((await resend(itemIntent, j)).kind).toBe('done')
    expect(t.writes()).toEqual(['PUT /api/boards/b/items/i9'])
    expect(dropped).toEqual(['item:b:i9'])
  })
  test('문서: 없으면 absent — POST 0건', async () => {
    const t = serve(NEW, () => undefined)
    const { j } = journal()
    expect((await confirm(docIntent, j)).kind).toBe('absent')
    expect(t.writes()).toEqual([])
  })
  test('사람이 누른 다시 보내기가 거절돼도 기록은 남아요(버리기는 사람이)', async () => {
    serve(NEW, (m, p) => (m === 'GET' && p.startsWith('/api/runs?clientKey=') ? Response.json({ runs: [] }) : m === 'POST' ? Response.json({ error: 'unknown model' }, { status: 400 }) : undefined))
    const { j, dropped } = journal()
    expect((await resend(runIntent, j)).kind).toBe('failed')
    expect(dropped).toEqual([])
  })
})

describe('(리뷰 9) 흐름 안에서도 결과 불명 뒤 다시 쓰지 않아요', () => {
  const REF = 'item:b:1'
  const src = (p: Partial<NoteSource & { onceApplied: boolean }> = {}) => ({ ref: REF, html: '<p>앞 글</p>', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true, ...p })
  const res = (p: Partial<WriteResult> = {}): WriteResult => ({ ref: REF, version: 4, applied: 1, warnings: [], ...p })
  function client(handler: (m: string, p: string) => unknown) {
    const calls: string[] = []
    const c: Client = {
      origin: O,
      request: async (path) => { calls.push('GET ' + path); return handler('GET', path) as never },
      write: async (path, method) => { calls.push(method + ' ' + path); return handler(method, path) as never },
    }
    return { c, calls }
  }
  test('초안 넣기: 쓰기 결과를 모르면 onceKey 로 읽어 확인만(적용됐으면 넣음) — 쓰기는 한 번', async () => {
    let n = 0
    const t = client((m, p) => {
      if (m === 'GET') return src(p.includes('onceKey=') ? { onceApplied: true } : {})
      if (p.includes('/write')) { if (n++ === 0) throw new UnknownWriteError(new Error('net')); return res({ applied: 0, duplicate: true }) }
      return {}
    })
    expect((await insertDraftNote(t.c, REF, { id: 'd1', output: '초안' })).saved).toBe('added')
    expect(t.calls.filter((x) => x.includes('/write')).length).toBe(1)
  })
  test('초안 넣기: 확인해도 적용되지 않았으면 결과 불명 그대로 — 쓰기는 한 번', async () => {
    const t = client((m, p) => { if (m === 'GET') return src(p.includes('onceKey=') ? { onceApplied: false } : {}); if (p.includes('/write')) throw new UnknownWriteError(new Error('net')); return {} })
    await expect(insertDraftNote(t.c, REF, { id: 'd1', output: '초안' })).rejects.toBeInstanceOf(UnknownWriteError)
    expect(t.calls.filter((x) => x.includes('/write')).length).toBe(1)
  })
  test('대화 답 넣기: 결과를 모르면 확인만 — 쓰기 한 번', async () => {
    const calls: string[] = []
    const io = {
      scope: S,
      source: async () => (calls.push('source'), src()),
      seen: async () => (calls.push('seen'), src({ onceApplied: true })),
      append: async () => { calls.push('append'); throw new UnknownWriteError(new Error('net')) },
      start: async () => ({}),
      markApplied: async () => (calls.push('applied'), {}),
    } as unknown as NoteIO
    expect(await addAnswerToNote(io, REF, { id: 'ra1', prompt: '질문', output: '답', target: REF })).toBe('added')
    expect(calls.filter((x) => x === 'append').length).toBe(1)
  })
})

describe('(리뷰 9) AI 정리 칩', () => {
  const run = (id: string, p: Partial<Run> = {}): Run => ({ id, target: null, prompt: '글', provider: 'aside', model: 'm', model_name: null, effort: null, status: 'running', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: null, kind: 'capture', ...p })
  function setup(api: Partial<CaptureApi> & Record<string, unknown>, initial = '[]') {
    const files: Record<string, string> = { 'db:captures': initial }
    const warned: string[] = []
    const calls: string[] = []
    const full = { start: async () => run('r1'), effects: async (id: string) => ({ run: run(id), runs: [id], effects: [] }), undo: async () => ({}), retry: async () => run('r2'), stop: async () => ({}), caps: async () => NEW, lookup: async () => null, scope: 'scope-A', ...api }
    const wrapped = Object.fromEntries(Object.entries(full).map(([k, f]) => [k, typeof f === 'function' ? (...a: unknown[]) => (calls.push(k), (f as (...x: unknown[]) => unknown)(...a)) : f])) as unknown as CaptureApi
    const c = new CaptureCenter(wrapped, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'key-1', (t) => warned.push(t))
    return { c, warned, calls, files }
  }
  const unsent = (p: Record<string, unknown> = {}) => ({ id: 'unsent:u1', clientKey: 'u1', text: '글', draft: null, startedAt: 1, scope: 'scope-A', ...p })
  test('(P1-5) 첫 응답을 잃으면 바로 다시 보내지 않고 칩으로 남겨요(시작 요청 한 번)', async () => {
    const { c, calls } = setup({ start: async () => { throw new UnknownWriteError(new Error('lost')) } })
    expect(await c.start('글', null, undefined)).toEqual({ ok: true, unsent: true })
    expect(calls.filter((x) => x === 'start').length).toBe(1)
    expect(c.entries.map((e) => e.id)).toEqual(['unsent:key-1'])
  })
  test('(P1-6) 보냈는지 모르는 칩은 닫혀(숨겨져) 있어도 개수 제한이 지우지 않아요', async () => {
    const done = Array.from({ length: 10 }, (_, n) => ({ id: 'd' + n, clientKey: 'k' + n, text: 't', draft: null, startedAt: 1 }))
    const { c, files } = setup({ effects: async (id: string) => ({ run: run(id, { status: 'done' }), runs: [id], effects: [] }) }, JSON.stringify([unsent({ dismissed: true }), ...done]))
    for (const e of done) await c.refresh(e.id)
    expect((await c.start('새 글', null, undefined)).ok).toBe(true)
    expect((JSON.parse(files['db:captures'] ?? '[]') as { id: string }[]).map((e) => e.id)).toContain('unsent:u1')
  })
  test('(P1-1) 닫기는 숨기기: 끝났다고 확인되지 않은 닫힌 칩은 정리하지 않아요', async () => {
    const hidden = Array.from({ length: 11 }, (_, n) => ({ id: 'h' + n, clientKey: 'k' + n, text: 't', draft: null, startedAt: 1, dismissed: true }))
    const { c, files } = setup({ effects: async () => { throw new UnknownWriteError(new Error('net')) } }, JSON.stringify(hidden))
    expect((await c.start('하나 더', null, undefined)).ok).toBe(true)
    expect((JSON.parse(files['db:captures'] ?? '[]') as unknown[]).length).toBe(12)
  })
  test('다시 확인은 읽기만: 서버가 키 조회를 지원하면 키로 찾고(시작 요청 0건), 없으면 칩을 남겨 "다시 보내기"를 보여요', async () => {
    const { c, calls } = setup({}, JSON.stringify([unsent()]))
    await c.confirm('unsent:u1')
    expect(calls).not.toContain('start')
    expect(calls).toContain('lookup')
    expect(c.entries.map((e) => e.id)).toEqual(['unsent:u1'])
    expect((c as unknown as { check: (id: string) => string | undefined }).check('unsent:u1')).toBe('absent')
    await (c as unknown as { resend: (id: string) => Promise<void> }).resend('unsent:u1')
    expect(calls.filter((x) => x === 'start').length).toBe(1)
    expect(c.entries.map((e) => e.id)).toEqual(['r1'])
  })
  test('다시 확인: 키의 실행이 있으면 그 실행으로 옮겨요(시작 요청 0건)', async () => {
    const { c, calls } = setup({ lookup: async () => run('r5') }, JSON.stringify([unsent()]))
    await c.confirm('unsent:u1')
    expect(calls).not.toContain('start')
    expect(c.entries.map((e) => e.id)).toEqual(['r5'])
  })
  test('키 조회를 지원하지 않는 서버: 보내지 않고 확인할 수 없다고 알려요(칩 남김)', async () => {
    const { c, calls, warned } = setup({ caps: async () => [] }, JSON.stringify([unsent()]))
    await c.confirm('unsent:u1')
    expect(calls).not.toContain('start')
    expect(calls).not.toContain('lookup')
    expect(c.entries.map((e) => e.id)).toEqual(['unsent:u1'])
    expect(warned.join(' ')).toContain('확인할 수 없')
  })
  test('조회가 실패하거나 사람이 누른 다시 보내기가 거절돼도 칩은 남아요', async () => {
    const { c } = setup({ lookup: async () => { throw new UnknownWriteError(new Error('net')) }, start: async () => { throw new ApiError(400, 'unknown model', false, { error: 'unknown model' }) } }, JSON.stringify([unsent()]))
    await c.confirm('unsent:u1')
    await (c as unknown as { resend: (id: string) => Promise<void> }).resend('unsent:u1')
    expect(c.entries.map((e) => e.id)).toEqual(['unsent:u1'])
  })
  test('(P2-7) 칩 검사: 빈 키·id 와 키가 다른 보냈는지 모르는 칩·잘못된 초안·힌트·표시는 깨짐', () => {
    expect(Cap.isCaptureEntry({ id: 'r1', clientKey: 'k', text: '글', draft: null, startedAt: 1, ended: true })).toBe(true)
  })
  test('끝났다고 확인된 칩도 앱을 다시 연 뒤 한 번은 읽어요(결과를 보여 주게)', async () => {
    const { c, calls } = setup({ effects: async (id: string) => ({ run: run(id, { status: 'done' }), runs: [id], effects: [] }) }, JSON.stringify([{ id: 'r1', clientKey: 'k', text: '글', draft: null, startedAt: 1, ended: true }]))
    c.tick()
    await Promise.resolve()
    expect(calls).toContain('effects')
    calls.length = 0
    await c.refresh('r1')
    calls.length = 0
    c.tick()
    expect(calls).toEqual([])
  })
  test('(P2-7 원래) 칩 검사 사례', () => {
    const ok = { id: 'r1', clientKey: 'k', text: '글', draft: null, startedAt: 1 }
    expect(Cap.isCaptureEntry(ok)).toBe(true)
    expect(Cap.isCaptureEntry(unsent())).toBe(true)
    expect(Cap.isCaptureEntry({ ...ok, id: '' })).toBe(false)
    expect(Cap.isCaptureEntry(unsent({ id: 'unsent:', clientKey: '' }))).toBe(false)
    expect(Cap.isCaptureEntry(unsent({ clientKey: 'other' }))).toBe(false)
    expect(Cap.isCaptureEntry({ ...ok, draft: 5 })).toBe(false)
    expect(Cap.isCaptureEntry({ ...ok, hints: 'x' })).toBe(false)
    expect(Cap.isCaptureEntry({ ...ok, dismissed: 'yes' })).toBe(false)
    expect(Cap.isCaptureEntry({ ...ok, scope: 3 })).toBe(false)
  })
})

describe('(리뷰 9) 빠른 추가: 결과 불명이면 먼저 확인만, 남은 단계는 사람이 눌렀을 때만', () => {
  const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: ['회의'], note: '', props: [{ key: '담당', type: 'text', value: '나' }] }
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const tok = () => b64({ alg: 'RS256' }) + '.' + b64({ email: 'a@x.test', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig'
  test('항목 결과 불명 기록: 다시 누르면 GET 으로 확인만(PUT 0건), 없으면 "다시 보내기" 상태로 남아요', async () => {
    const session = { origin: O, token: tok() }
    configureAuth({ session: () => session as never, expired: () => {} })
    const t = serve(NEW, () => undefined)
    const scope = scopedClient(O)
    const left: Pending = { id: 'q1', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: scope.scope }
    const saved: string[] = []
    const r = await createWithRecord({ text: '', makeDraft: () => draft, pending: left, writeAhead: async () => true, scope, save: async (it) => (saved.push(it.id), true as const) })
    expect(saved).toEqual([])
    expect(t.writes()).toEqual([])
    expect(r.kind).toBe('pending')
    const p = (r as { pending: Pending & { checked?: string } }).pending
    expect([p.unknown, p.checked, p.id]).toEqual([undefined, 'absent', 'q1'])
  })
  test('확인 함수(contracts checkCreate)는 읽기만: 항목이 있고 같으면 다음 단계부터, 바뀌었으면 differs', async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(init.method + ' ' + path)
      if (path.endsWith('?view=meta')) return { frontmatter: { tags: [], props: [] } }
      return { self: { title: '회의 준비', type: 'todo', when: null }, note: null }
    }) as Q.Call
    const check = (Q as unknown as { checkCreate: (d: Draft, call: Q.Call, at: { id: string; from: Q.Step }) => Promise<{ state: string; from?: Q.Step }> }).checkCreate
    expect(await check(draft, call, { id: 'q1', from: 'item' })).toEqual({ state: 'partial', from: 'note' })
    expect(calls.every((x) => x.startsWith('GET '))).toBe(true)
    const changed = (async () => ({ self: { title: '사람이 고친 제목', type: 'todo', when: null }, note: null })) as Q.Call
    expect((await check(draft, changed, { id: 'q1', from: 'item' })).state).toBe('differs')
  })
  test('이어 하기의 속성 단계: 사람이 그 속성을 다른 값으로 바꿔 두었으면 덮지 않고 멈춰요', async () => {
    const calls: string[] = []
    const call = (async (path: string, init: { method: string }) => {
      calls.push(init.method + ' ' + path)
      if (init.method === 'GET') return { ref: 'item:b:q1', frontmatter: { tags: [{ tag: '회의', by: 'person' }], props: [{ key: '담당', type: 'text', value: '다른 사람' }] } }
      return {}
    }) as Q.Call
    const r = await Q.createWork(draft, { save: async () => true, call, id: () => 'q1', now: () => 1 }, { id: 'q1', from: 'props' })
    expect(calls.filter((x) => !x.startsWith('GET '))).toEqual([])
    expect(r).toMatchObject({ kind: 'conflict', at: 'props' })
  })
})
