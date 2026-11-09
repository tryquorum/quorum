import { afterEach, describe, expect, test } from 'bun:test'
import type { NoteSource, Run, WriteResult } from '@direction-board/contracts'
import type { Draft } from '@direction-board/contracts/quick-add'
import { configureAuth, scopedClient, UnknownWriteError, type Client } from '../../api/client'
import { CaptureCenter, type CaptureApi } from './quick/captureFlow'
import { createWithRecord } from './quick/createScoped'
import type { Pending } from './quick/recovery'
import { addAnswerToNote, type NoteIO } from './work/addAnswer'
import { insertDraftNote } from './work/insertDraft'
import { mdHasAngle, planNoteAdd } from './work/noteJoin'

// PR #39 리뷰 10(f960663): 사람 글 보존 두 건 + P2 두 건.
// 1) 결과 불명 빠른 추가의 "확인"이 differs 를 완료로 보고 아직 보내지 않은 노트·기록을 지움 → differs 는 완료가 아니에요.
// 2) 답·초안 넣기가 기존 마크다운을 바꿈(끝 공백 삭제, 열린 코드 펜스 안으로) → 기존 md 는 한 글자도 바꾸지 않아요.
// P2) 확인 뒤 자동 적용 표시(PATCH) 금지, AI 정리 다시 보내기는 누르는 순간 다시 읽기.
const O = 'https://board.test'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
function serve(route: (m: string, p: string) => Response | undefined) {
  const sent: string[] = []
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).slice(O.length)
    const method = init?.method ?? 'GET'
    sent.push(method + ' ' + path)
    return route(method, path) ?? Response.json({ error: 'not found' }, { status: 404 })
  }, { preconnect: originalFetch.preconnect })
  return { sent, writes: () => sent.filter((x) => !x.startsWith('GET ')) }
}
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const tok = () => b64({ alg: 'RS256' }) + '.' + b64({ email: 'a@x.test', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig'
const login = () => configureAuth({ session: () => ({ origin: O, token: tok() }) as never, expired: () => {} })

describe('(리뷰 10 P1) 빠른 추가: differs 는 완료가 아니에요', () => {
  const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '아직 안 보낸 사람 노트', props: [] }
  const changed = () => Response.json({ self: { title: '사람이 고친 제목', type: 'todo', when: null }, note: null })
  test('항목 결과 불명 → 확인했더니 항목이 사람 손으로 바뀜: 기록·초안(보내지 않은 노트) 유지, 남은 노트 단계로', async () => {
    login()
    const t = serve((m, p) => (m === 'GET' && p.startsWith('/api/work/') ? changed() : undefined))
    const scope = scopedClient(O)
    const left: Pending = { id: 'q1', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: scope.scope }
    const r = await createWithRecord({ text: '', makeDraft: () => draft, pending: left, writeAhead: async () => true, scope, save: async () => true as const })
    expect(r.kind).toBe('pending')
    const p = (r as { pending: Pending }).pending
    expect([p.id, p.from, p.draft.note, p.ref, (p as { checked?: string }).checked]).toEqual(['q1', 'note', '아직 안 보낸 사람 노트', 'item:b:q1', 'differs'])
    expect(t.writes()).toEqual([])
  })
  test('다시 보내기에서 항목이 이미 있고 바뀌어 있어도(createWork differs) 남은 노트가 있으면 기록 유지', async () => {
    login()
    serve((m, p) => (m === 'GET' && p.startsWith('/api/work/') ? changed() : undefined))
    const scope = scopedClient(O)
    const left = { id: 'q2', from: 'item', draft, text: '회의 준비', ref: null, checked: 'absent', scope: scope.scope } as Pending
    const r = await createWithRecord({ text: '', makeDraft: () => draft, pending: left, writeAhead: async () => true, scope, save: async () => true as const })
    expect(r.kind).toBe('pending')
    expect((r as { pending: Pending }).pending.draft.note).toBe('아직 안 보낸 사람 노트')
  })
  test('노트 단계 결과 불명 → 서버 노트가 다른 글: 덮지 않고 기록 유지, 다시 눌러도 쓰기 0건(다시 확인만)', async () => {
    login()
    const t = serve((m, p) => (m === 'GET' && p.startsWith('/api/work/') ? Response.json({ self: { title: '회의 준비', type: 'todo', when: null }, note: { text: '사람이 먼저 쓴 다른 노트' } }) : undefined))
    const scope = scopedClient(O)
    const left: Pending = { id: 'q3', from: 'note', draft, text: '회의 준비', ref: 'item:b:q3', unknown: true, scope: scope.scope }
    const r = await createWithRecord({ text: '', makeDraft: () => draft, pending: left, writeAhead: async () => true, scope, save: async () => true as const })
    expect(r.kind).toBe('pending')
    const p = (r as { pending: Pending }).pending
    expect([p.from, p.draft.note]).toEqual(['note', '아직 안 보낸 사람 노트'])
    const again = await createWithRecord({ text: '', makeDraft: () => draft, pending: p, writeAhead: async () => true, scope, save: async () => true as const })
    expect(again.kind).toBe('pending')
    expect(t.writes()).toEqual([])
  })
})

describe('(리뷰 10 P1) 답·초안 넣기는 기존 마크다운을 한 글자도 바꾸지 않아요', () => {
  const REF = 'item:b:1'
  const src = (md: string, p: Partial<NoteSource> = {}): NoteSource => ({ ref: REF, html: '<p>x</p>', md, version: 3, personEdited: true, markdownEditable: true, onceKey: true, ...p })
  const res = (p: Partial<WriteResult> = {}): WriteResult => ({ ref: REF, version: 4, applied: 1, warnings: [], ...p })
  function io(md: string) {
    const calls: { kind: string; md: string }[] = []
    const o: NoteIO = {
      scope: 's',
      source: async () => src(md),
      seen: async () => src(md, { onceApplied: false }),
      append: async (m) => (calls.push({ kind: 'append', md: m }), res()),
      start: async () => ({}),
      markApplied: async () => (calls.push({ kind: 'applied', md: '' }), {}),
    }
    return { o, calls }
  }
  let n = 0
  const run = () => ({ id: 'r' + ++n, prompt: '질문', output: '답이에요', target: REF })
  test('(리뷰 11) 끝 공백 두 칸(줄바꿈 표시)도 그대로: 늘 원본을 지키는 append(새 답만 보냄 — 서버가 기존 md·HTML 뒤에 붙임)', async () => {
    const md = '첫 줄  '
    const t = io(md)
    await addAnswerToNote(t.o, REF, run())
    expect(t.calls[0]?.kind).toBe('append')
    expect(t.calls[0]?.md.includes(md)).toBe(false)
  })
  test('닫히지 않은 코드 펜스로 끝나면 넣지 않아요(답이 코드 블록 안으로 들어가지 않게) — 쓰기 0건', async () => {
    const t = io('설명\n\n~~~js\nconst a = 1\n')
    await expect(addAnswerToNote(t.o, REF, run())).rejects.toThrow()
    expect(t.calls).toEqual([])
  })
  test('목록으로 끝나면 이어 붙이지 않고 원본을 지키는 append(서버가 가로줄로 나눠요)', async () => {
    const t = io('할 일\n\n- 하나\n- 둘')
    await addAnswerToNote(t.o, REF, run())
    expect(t.calls[0]?.kind).toBe('append')
  })
  test('인용으로 끝나면 append', async () => {
    const t = io('> 인용한 글')
    await addAnswerToNote(t.o, REF, run())
    expect(t.calls[0]?.kind).toBe('append')
  })
  function client(md: string) {
    const writes: { path: string; body: Record<string, unknown> }[] = []
    const c: Client = {
      origin: O,
      request: async (path) => (path.includes('onceKey=') ? { ...src(md), onceApplied: true } : src(md)) as never,
      write: async (path, _m, body) => (writes.push({ path, body: body as Record<string, unknown> }), (path.includes('/write') ? res() : {}) as never),
    }
    return { c, writes }
  }
  test('초안 넣기: 끝 공백 두 칸이어도 초안만 append(기존 md 를 보내지 않음)·열린 펜스 멈춤·인용 끝 append', async () => {
    const a = client('줄  ')
    await insertDraftNote(a.c, REF, { id: 'd1', output: '## 상황\n초안' })
    expect([a.writes[0]?.body.mode, a.writes[0]?.body.md]).toEqual(['append', '## 상황\n초안'])
    const b = client('\u0060\u0060\u0060\n코드')
    await expect(insertDraftNote(b.c, REF, { id: 'd2', output: '초안' })).rejects.toThrow()
    expect(b.writes).toEqual([])
    const q = client('> 인용')
    await insertDraftNote(q.c, REF, { id: 'd3', output: '초안' })
    expect(q.writes[0]?.body.mode).toBe('append')
  })
})

describe('(리뷰 10 P2) 확인 뒤 자동 적용 표시 금지·다시 보내기 직전 다시 읽기', () => {
  const REF = 'item:b:1'
  test('대화 답: 결과 불명 → onceKey 로 확인됐어도 적용 표시(PATCH)는 보내지 않아요', async () => {
    const calls: string[] = []
    const s = { ref: REF, html: '', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true }
    const o: NoteIO = {
      scope: 's', source: async () => s, seen: async () => ({ ...s, onceApplied: true }),
      append: async () => { calls.push('append'); throw new UnknownWriteError(new Error('net')) },
      start: async () => ({}), markApplied: async () => (calls.push('applied'), {}),
    }
    expect(await addAnswerToNote(o, REF, { id: 'z1', prompt: '질문', output: '답', target: REF })).toBe('added')
    expect(calls).toEqual(['append'])
  })
  test('초안: 결과 불명 → 확인됐어도 PATCH /api/runs 없음', async () => {
    const writes: string[] = []
    const s = { ref: REF, html: '', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true }
    const c: Client = {
      origin: O,
      request: async (path) => (path.includes('onceKey=') ? { ...s, onceApplied: true } : s) as never,
      write: async (path, m) => { writes.push(m + ' ' + path); throw new UnknownWriteError(new Error('net')) },
    }
    expect((await insertDraftNote(c, REF, { id: 'd9', output: '초안' })).saved).toBe('added')
    expect(writes.filter((w) => w.startsWith('PATCH'))).toEqual([])
  })
  test('AI 정리 다시 보내기: 누르는 순간 다시 읽어 그사이 실행이 생겼으면 보내지 않고 그 실행으로', async () => {
    const run = (id: string): Run => ({ id, target: null, prompt: '글', provider: 'a', model: 'm', model_name: null, effort: null, status: 'running', session_id: null, parent: null, output: '', error: null, error_kind: null, retry_of: null, last_activity_at: null, created_at: 1, finished_at: null, kind: 'capture' })
    let found: Run | null = null
    const starts: string[] = []
    const files: Record<string, string> = { 'db:captures': JSON.stringify([{ id: 'unsent:u1', clientKey: 'u1', text: '글', draft: null, startedAt: 1, scope: 's' }]) }
    const api: CaptureApi = { scope: 's', start: async (b) => (starts.push(b.clientKey), run('rX')), effects: async (id) => ({ run: run(id), runs: [id], effects: [] }), undo: async () => 0, retry: async () => run('r2'), stop: async () => 0, caps: async () => ['runClientKey'], lookup: async () => found }
    const c = new CaptureCenter(api, { getItem: (k) => files[k] ?? null, setItem: (k, v) => void (files[k] = v) }, () => 'k', () => {})
    await c.confirm('unsent:u1')
    expect(c.check('unsent:u1')).toBe('absent')
    found = run('rLate') // 확인과 누름 사이에 서버에 들어감
    await c.resend('unsent:u1')
    expect(starts).toEqual([])
    expect(c.entries.map((e) => e.id)).toEqual(['rLate'])
  })
})

describe('(리뷰 10~13) noteJoin: 열린 펜스·펜스 밖 "<" 이면 멈춤, 아니면 append(HTML 은 서버 판정)', () => {
  test('펜스: 닫힌 것은 붙이고, 열린 것(백틱·물결·더 긴 여는 줄)은 멈춰요', () => {
    expect(planNoteAdd('\u0060\u0060\u0060\n코드\n\u0060\u0060\u0060').kind).toBe('append')
    expect(planNoteAdd('\u0060\u0060\u0060\n코드').kind).toBe('stop')
    expect(planNoteAdd('~~~~\n코드\n~~~').kind).toBe('stop')
    for (const md of ['- 하나', '1. 하나', '> 인용', '    코드', '글  ', '글\r\n', '| a |\n|---|\n| 1 |', '3 > 2']) expect([md, planNoteAdd(md).kind]).toEqual([md, 'append'])
  })
  test('(리뷰 13) 펜스·인라인 코드 밖에 "<" 가 하나라도 있으면 이스케이프 여부와 상관없이 멈춰요', () => {
    for (const md of ['<div>\n사람 글', '\\<pre> 글', '\\\\<pre>\n사람 글', '\\\\\\<div>', '<https://example.com>', '1 < 2', '<!-- 메모 -->', '글 </b>'])
      expect([md, mdHasAngle(md)]).toEqual([md, true])
    for (const md of ['\u0060\u0060\u0060\n<pre>\n\u0060\u0060\u0060', '~~~\n<script>\n~~~', '글 \u0060<div>\u0060 글', '글 \u0060\u0060a<b\u0060\u0060 글', '3 > 2'])
      expect([md, mdHasAngle(md)]).toEqual([md, false])
  })
})
