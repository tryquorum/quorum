import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Item } from '@direction-board/contracts'
import type { Draft } from '@direction-board/contracts/quick-add'
import { api, configureAuth, scopedClient, UnknownWriteError, ApiError } from './api/client'
import { QueryStore, queueWrite, ScopeChangedError } from './api/queryStore'
import { workOps } from './api/work'
import { withIntent, WriteAheadError, type Intent, type Journal } from './features/board/intents'
import { createWithRecord } from './features/board/quick/createScoped'
import { CaptureCenter } from './features/board/quick/captureFlow'
import type { Pending } from './features/board/quick/recovery'
import { confirmIntent } from './features/board/replays'

// PR #39 리뷰 7: 앱의 모든 쓰기에 두 규칙(devlog/_plan/261107_ios_parity/work/014_write_inventory.md).
// 규칙 A(범위): 화면·시트·확인창을 연 시점의 범위로만 보내고, 보내기 직전에 다르면 보내지 않아요.
// 규칙 B(먼저 기록): 결과를 모를 수 있는 생성·AI 실행은 기기에 기록이 닿은 뒤에만 보내요.
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const token = (email: string) => b64({ alg: 'RS256' }) + '.' + b64({ email, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig'
const O = 'https://board.test'
const originalFetch = globalThis.fetch
let sent: string[] = []
let session: { origin: string; token: string } | null = null
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
function setup(email: string, reply: (url: string, method: string) => Response = () => Response.json({ ok: true, id: 'x', version: 1 })) {
  sent = []
  session = { origin: O, token: token(email) }
  configureAuth({ session: () => session as never, expired: () => {} })
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).slice(O.length)
    const m = init?.method ?? 'GET'
    sent.push(m + ' ' + u)
    return reply(u, m)
  }, { preconnect: originalFetch.preconnect })
}
const item: Item = { id: 'i1', boardId: 'b', type: 'goal', text: '목표', x: 0, y: 0, w: 1, h: 1 }

describe('규칙 A: 연 시점의 범위', () => {
  test('시트를 A 에서 열고, 늦게 온 기한 입력(Alert.prompt 콜백)이 B 로 바뀐 뒤 저장되면 보내지 않아요', async () => {
    setup('a@x.test')
    const opened = scopedClient(O) // 시트(편집 시트를 그린 화면)를 연 때
    session = { origin: O, token: token('b@x.test') } // 입력하는 동안 다른 계정으로
    const store = new QueryStore()
    await expect(queueWrite(store, new Map(), 'b:i1', () => api.saveItem(opened, { ...item, due: '2026-12-01' }), opened)).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual([])
  })
  test('A 에서 연 삭제 확인을 B 로 바뀐 뒤 누르면 지우지 않아요', async () => {
    setup('a@x.test')
    const opened = scopedClient(O)
    session = { origin: O, token: token('b@x.test') }
    await expect(workOps(opened).deleteItem('b', 'i1')).rejects.toBeInstanceOf(ScopeChangedError)
    expect(sent).toEqual([])
  })
  test('같은 범위면 보내요(줄 서 있는 동안 바뀌면 그 뒤 것은 안 보냄)', async () => {
    setup('a@x.test', () => Response.json(item))
    const opened = scopedClient(O)
    const store = new QueryStore()
    await queueWrite(store, new Map(), 'b:i1', () => api.saveItem(opened, item), opened)
    expect(sent).toEqual(['PUT /api/boards/b/items/i1'])
  })
})

// 소스로 고정: 앱 코드(시험 제외)를 훑어요
const SRC = join(import.meta.dir)
const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p)
  }
}
walk(SRC)
const rel = (p: string) => relative(SRC, p)
const lines = (re: RegExp) => files.flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i) => ({ file: rel(p), n: i + 1, l })).filter((x) => re.test(x.l) && !/^\s*(\/\/|\*|\/\*\*)/.test(x.l)))
const only = (re: RegExp, allowed: string[]) => lines(re).filter((x) => !allowed.includes(x.file)).map((x) => x.file + ':' + x.n)

describe('규칙 A 소스: 전역 범위 쓰기 금지', () => {
  test('범위 고정 클라이언트는 api/client.ts·api/scope.ts(useWriteScope, 연 시점)에서만 만들어요', () => {
    expect(only(/\bscopedClient\(/, ['api/client.ts', 'api/scope.ts'])).toEqual([])
    expect(only(/\buseScopedClient\b/, [])).toEqual([])
  })
  test('기록의 시작 범위로 잇는 resumeClient 는 복구 경로에서만', () => {
    expect(only(/\bresumeClient\(/, ['api/client.ts', 'features/board/quick/createScoped.ts', 'features/board/useIntents.ts'])).toEqual([])
  })
  test('전역 클라이언트와 request 의 쓰기 메서드는 쓰지 않아요', () => {
    expect(only(/\bglobalClient\(/, ['api/client.ts'])).toEqual([])
    expect(only(/request(<[^>]*>)?\([^)]*method:\s*'(POST|PUT|PATCH|DELETE)'/, [])).toEqual([])
  })
  test('범위가 바뀌면 화면 나무를 새로 그려 모든 화면이 새 범위를 잡아요', () => {
    expect(readFileSync(join(SRC, 'api/query.ts'), 'utf8')).toContain('key: gen.current.value')
  })
})

describe('규칙 B 소스: 먼저 기록 없는 생성 금지', () => {
  // 결과를 모를 수 있는 생성·AI 실행을 부르는 줄은 먼저 기록(withIntent·intents.startRun·writeAhead 를 거치는 createWithRecord) 안이거나, 다시 확인(REPLAY) 자리예요
  const CREATES: [RegExp, string[]][] = [
    [/\.startRun\(/, ['features/board/useIntents.ts', 'features/board/work/makeWork.ts', 'features/board/replays.ts']],
    [/\brunsApi\.start\(/, []],
    [/\bdocsApi\.create\(/, ['features/board/replays.ts']],
    [/\binsertDraftNote\(/, ['features/board/replays.ts']],
    [/\banswerToNoteWith\(/, ['features/board/replays.ts']],
    [/\bmakeWorkFromQuote\(/, ['features/board/replays.ts']],
    [/\bcreateScoped\(/, ['features/board/quick/createScoped.ts']],
    [/\bstartCapture\(/, ['features/board/quick/captureApi.ts']],
  ]
  for (const [re, allowed] of CREATES)
    test(String(re), () => {
      const bad = lines(re).filter((x) => !allowed.includes(x.file) && !/withIntent\(|intents\.startRun\(|export (async )?function|=>\s*c\.write|startRun: \(/.test(x.l)).map((x) => x.file + ':' + x.n)
      expect(bad).toEqual([])
    })
  test('새 항목을 만드는 화면(캔버스 추가·검색에서 할 일)은 intents.createItem 으로 먼저 기록해요', () => {
    for (const f of files.filter((p) => /newCanvasItem\(|type: 'todo', text: title/.test(readFileSync(p, 'utf8')) && !p.endsWith('geometry.ts')))
      expect([rel(f), readFileSync(f, 'utf8').includes('intents.createItem(')]).toEqual([rel(f), true])
  })
})

describe('규칙 B: 먼저 기록', () => {
  const journal = (put: boolean, blocked: string | null = null) => {
    const log: string[] = []
    const j: Journal = { put: async (i) => (log.push('put ' + i.key), put), drop: (k) => void log.push('drop ' + k), release: (k) => void log.push('release ' + k), blocked: () => blocked }
    return { j, log }
  }
  const intent: Intent = { key: 'run:k1', kind: 'run', scope: O + '|a@x.test', at: 1, label: '질문', payload: { body: { prompt: '질문' } } }
  test('기록이 기기에 닿지 않으면 보내지 않아요', async () => {
    const { j, log } = journal(false)
    let called = false
    await expect(withIntent(j, intent, async () => { called = true })).rejects.toBeInstanceOf(WriteAheadError)
    expect(called).toBe(false)
    expect(log).toEqual(['put run:k1', 'release run:k1'])
  })
  test('기록 파일을 못 읽었으면(막힘) 기록도 요청도 하지 않아요', async () => {
    const { j, log } = journal(true, '못 읽음')
    await expect(withIntent(j, intent, async () => 1)).rejects.toBeInstanceOf(WriteAheadError)
    expect(log).toEqual([])
  })
  test('기록 → 보내기 → 성공이면 지워요, 확실한 거절도 지워요, 결과 불명이면 남겨요', async () => {
    const order: string[] = []
    const ok = journal(true)
    ok.j.put = async (i) => (order.push('put'), ok.log.push('put ' + i.key), true)
    await withIntent(ok.j, intent, async () => void order.push('send'))
    expect(order).toEqual(['put', 'send'])
    expect(ok.log).toEqual(['put run:k1', 'drop run:k1', 'release run:k1'])
    const no = journal(true)
    await expect(withIntent(no.j, intent, async () => { throw new ApiError(400, 'nope', false, { error: 'nope' }) })).rejects.toBeInstanceOf(ApiError)
    expect(no.log).toContain('drop run:k1')
    const unk = journal(true)
    await expect(withIntent(unk.j, intent, async () => { throw new UnknownWriteError(new Error('lost')) })).rejects.toBeInstanceOf(UnknownWriteError)
    expect(unk.log).toEqual(['put run:k1', 'release run:k1'])
  })
  test('빠른 추가: 기록이 닿기 전에는 아무것도 보내지 않고, 기록에는 같은 id·결과 불명·시작 범위가 먼저 남아요', async () => {
    setup('a@x.test')
    const scope = scopedClient(O)
    const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '', props: [] }
    const saved: string[] = []
    const save = async (it: Item) => (saved.push(it.id), true as const)
    const refused = await createWithRecord({ text: '회의 준비', makeDraft: () => draft, pending: null, writeAhead: async () => false, scope, save, id: () => 'id1' })
    expect(refused.kind).toBe('not-sent')
    expect([saved, sent]).toEqual([[], []])
    const records: Pending[] = []
    const done = await createWithRecord({ text: '회의 준비', makeDraft: () => draft, pending: null, writeAhead: async (p) => (records.push(p), saved.length === 0), scope, save, id: () => 'id2' })
    expect(done.kind).toBe('done')
    expect(records).toEqual([{ id: 'id2', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: O + '|a@x.test' }])
    expect(saved).toEqual(['id2'])
  })
  test('빠른 추가: 앱이 꺼진 뒤 남은 기록으로 이어 하면 같은 id 로 서버를 먼저 확인해요', async () => {
    setup('a@x.test', (u, m) => (m === 'GET' ? Response.json({ self: { title: '회의 준비', type: 'todo', when: null }, note: null }) : Response.json({ ok: true })))
    const scope = scopedClient(O)
    const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '', props: [] }
    const left: Pending = { id: 'id3', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: O + '|a@x.test' }
    const saved: string[] = []
    const r = await createWithRecord({ text: '', makeDraft: () => draft, pending: left, writeAhead: async () => true, scope, save: async (it) => (saved.push(it.id), true as const) })
    expect(r.kind).toBe('done')
    expect(sent).toEqual(['GET /api/work/item%3Ab%3Aid3'])
    expect(saved).toEqual([])
  })
  test('AI 정리: 칩 기록이 기기에 닿지 않으면 보내지 않고, 닿으면 보내는 동안 같은 키의 칩이 남아 있어요', async () => {
    const mem: Record<string, string> = {}
    let durable = false
    const starts: string[] = []
    let duringSend = ''
    const center = new CaptureCenter(
      { scope: 's', start: async (b) => { starts.push(b.clientKey); duringSend = Object.values(mem).join(' '); return { id: 'r1', created_at: 1 } as never }, effects: async () => ({}) as never, undo: async () => 0, retry: async () => ({}) as never, stop: async () => 0, caps: async () => [], lookup: async () => null },
      { getItem: (k) => mem[k] ?? null, setItem: (k, v) => void (mem[k] = v), durable: async () => durable },
      () => 'key1',
      () => {},
    )
    expect((await center.start('회의 준비', null, undefined)).ok).toBe(false)
    expect(starts).toEqual([])
    expect(center.entries).toEqual([])
    durable = true
    expect((await center.start('회의 준비', null, undefined)).ok).toBe(true)
    expect(duringSend).toContain('unsent:key1')
    expect(center.entries.map((e) => e.id)).toEqual(['r1'])
  })
})

// PR #39 리뷰 9: 결과가 불명인 쓰기는 앱이 스스로 다시 쓰지 않아요. 복구 경로(확인)는 읽기만, 보내기는 사람이 누른 단추에서만
describe('복구 경로는 사람 동작 없이 POST/PUT 하지 않아요', () => {
  const S = O + '|a@x.test'
  const all: Intent[] = [
    { key: 'run:k1', kind: 'run', scope: S, at: 1, label: 'AI', payload: { body: { prompt: '질문' } } },
    { key: 'work:w1', kind: 'work', scope: S, at: 1, label: '새 일', payload: { a: { ref: 'item:b:1', sel: '글', noteText: '노트', parentTitle: '부모', model: {} } } },
    { key: 'note:d1', kind: 'note', scope: S, at: 1, label: '초안', payload: { ref: 'item:b:1', draft: { id: 'd1', output: '초안' } } },
    { key: 'answer:a1', kind: 'answer', scope: S, at: 1, label: '답', payload: { ref: 'item:b:1', run: { id: 'a1', prompt: '질문', output: '답', target: 'item:b:1' } } },
    { key: 'doc:x', kind: 'doc', scope: S, at: 1, label: '문서', payload: { input: { id: '11111111-1111-4111-8111-111111111111', title: '문서' } } },
    { key: 'item:b:i1', kind: 'item', scope: S, at: 1, label: '항목', payload: { item } },
  ]
  const j: Journal = { put: async () => true, drop: () => {}, release: () => {}, blocked: () => null }
  // 있음·없음·부분·읽기 실패 네 가지 서버에서 여섯 종류를 모두 확인해도 쓰기 0건
  const servers: [string, (u: string) => Response][] = [
    ['없음', () => Response.json({ error: 'nf' }, { status: 404 })],
    ['비어 있음', (u) => (u.startsWith('/api/signals') ? Response.json({ signals: [] }) : u.startsWith('/api/runs') ? Response.json({ runs: [] }) : Response.json({ error: 'nf' }, { status: 404 }))],
    ['있음', (u) => (u.startsWith('/api/signals') ? Response.json({ signals: [{ id: 's1', ref: 'note-quote:work:w1' }] }) : u.startsWith('/api/runs') ? Response.json({ runs: [{ id: 'r1', client_key: u.split('clientKey=')[1] ? decodeURIComponent(u.split('clientKey=')[1]!) : '' }] }) : u.includes('/note') ? Response.json({ ref: 'item:b:1', md: '', html: '', version: 1, personEdited: false, onceKey: true, onceApplied: true }) : Response.json({ ref: 'x', links: [], self: {} }))],
    ['읽기 실패', () => new Response('bad', { status: 502, headers: { 'content-type': 'text/html' } })],
  ]
  for (const [name, get] of servers)
    test('확인(confirmIntent) 여섯 종류 × ' + name, async () => {
      setup('a@x.test', (u, m) => (m === 'GET' ? (u === '/api/settings' ? Response.json({ capabilities: ['runClientKey', 'noteOnceKey', 'docCreateId'] }) : get(u)) : Response.json({ ok: true })))
      for (const i of all) await confirmIntent(j, scopedClient(O), i, async () => ['runClientKey', 'noteOnceKey', 'docCreateId'])
      expect(sent.filter((x) => !x.startsWith('GET '))).toEqual([])
    })
  test('AI 정리 칩의 확인은 키로 찾기만(시작 요청 0건)', async () => {
    const starts: string[] = []
    const files: Record<string, string> = { 'db:captures': JSON.stringify([{ id: 'unsent:u1', clientKey: 'u1', text: '글', draft: null, startedAt: 1, scope: 's' }]) }
    const c = new CaptureCenter({ scope: 's', start: async (b) => (starts.push(b.clientKey), { id: 'r1', created_at: 1 }) as never, effects: async () => ({}) as never, undo: async () => 0, retry: async () => ({}) as never, stop: async () => 0, caps: async () => ['runClientKey'], lookup: async () => null }, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'k', () => {})
    await c.confirm('unsent:u1')
    expect(starts).toEqual([])
  })
  test('빠른 추가의 결과 불명 기록을 다시 눌러도 확인만(쓰기 0건)', async () => {
    setup('a@x.test', () => Response.json({ error: 'nf' }, { status: 404 }))
    const scope = scopedClient(O)
    const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '메모', props: [] }
    const saved: string[] = []
    await createWithRecord({ text: '', makeDraft: () => draft, pending: { id: 'q1', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: scope.scope }, writeAhead: async () => true, scope, save: async (it) => (saved.push(it.id), true as const) })
    await createWithRecord({ text: '', makeDraft: () => draft, pending: { id: 'q1', from: 'note', draft, text: '회의 준비', ref: 'item:b:q1', unknown: true, scope: scope.scope }, writeAhead: async () => true, scope, save: async (it) => (saved.push(it.id), true as const) })
    expect([saved, sent.filter((x) => !x.startsWith('GET '))]).toEqual([[], []])
  })
  // 소스: 확인 모듈에는 쓰기가 없고, 다시 보내기는 사람이 누르는 단추(onPress)에서만 불려요
  test('confirm.ts(확인 모듈)에는 쓰기 호출이 없어요', () => {
    const src = readFileSync(join(SRC, 'features/board/confirm.ts'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
    expect(src.match(/\.write\(|\.upload\(|saveItem|docsApi|\.startRun\(|createSignal|\.link\(|startCapture|insertDraftNote|answerToNoteWith|makeWorkFromQuote|createWork\(|patchSignal|appendNote|\.replace\(|markApplied|startNote/g)).toBeNull()
  })
  test('AI 정리 칩의 confirm 은 시작 요청을 부르지 않아요(start 는 처음 보내기와 사람이 누른 resend 에만)', () => {
    const src = readFileSync(join(SRC, 'features/board/quick/captureFlow.ts'), 'utf8')
    const body = src.slice(src.indexOf('  async confirm('), src.indexOf('  async resend('))
    expect(body.length).toBeGreaterThan(100)
    expect(body.includes('api.start(')).toBe(false)
  })
  test('다시 보내기(resendIntent·칩 resend)는 사람이 누르는 단추에서만', () => {
    expect(only(/\bresendIntent\b/, ['features/board/replays.ts', 'features/board/useIntents.ts'])).toEqual([])
    expect(lines(/\.resend\(/).map((x) => x.file + ':' + (/onPress/.test(x.l) ? 'onPress' : x.l.trim()))).toEqual(['features/board/quick/CaptureTray.tsx:onPress'])
    expect(lines(/act\([^)]*'resend'\)/).map((x) => x.file + ':' + (/onPress/.test(x.l) ? 'onPress' : x.l.trim()))).toEqual(['features/board/IntentsNotice.tsx:onPress'])
  })
})
