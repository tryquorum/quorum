import { describe, expect, test } from 'bun:test'
import type { NoteSource, WriteResult } from '@direction-board/contracts'
import { ConflictError, ScopeChangedError, UnknownWriteError, type Client } from '../../../api/client'
import { insertDraftNote } from './insertDraft'
import { makeWorkFromQuote } from './makeWork'

// 머지 전 새 리뷰 2: 초안 넣기·새 일 만들기도 범위 고정 클라이언트로만 보내고, 초안 넣기는 서버 onceKey(run:<초안 id>)로 한 번만.
const REF = 'item:b:1'
type Handler = (method: string, path: string, body: Record<string, unknown> | undefined) => unknown
function client(handler: Handler) {
  const calls: string[] = []
  const c: Client = {
    origin: 'https://board.test',
    request: async (path) => { calls.push('GET ' + path); return handler('GET', path, undefined) as never },
    write: async (path, method, body) => { calls.push(`${method} ${path}`); return handler(method, path, body as Record<string, unknown>) as never },
  }
  return { c, calls }
}
const src = (p: Partial<NoteSource> = {}): NoteSource => ({ ref: REF, html: '<p>앞 글</p>', md: '앞 글', version: 3, personEdited: true, markdownEditable: true, onceKey: true, ...p })
const res = (p: Partial<WriteResult> = {}): WriteResult => ({ ref: REF, version: 4, applied: 1, warnings: [], ...p })
const draft = { id: 'd1', output: '## 상황\n초안' }

describe('초안 넣기', () => {
  test('(리뷰 11) onceKey run:<초안 id>·읽은 버전으로 append(초안만 보냄 — 서버가 기존 md·HTML 을 그대로 앞에), 뒤에 적용 표시', async () => {
    const bodies: unknown[] = []
    const t = client((m, p, b) => (m === 'GET' ? src() : (bodies.push(b), p.includes('/write') ? res() : {})))
    expect(await insertDraftNote(t.c, REF, draft)).toEqual({ saved: 'added', applied: true })
    expect(bodies[0]).toEqual({ mode: 'append', md: '## 상황\n초안', expectedVersion: 3, onceKey: 'run:d1' })
    expect(t.calls.at(-1)).toBe('PATCH /api/runs/d1')
  })
  test('(리뷰 4) 읽은 노트가 iOS 에서 고칠 수 없으면(markdownEditable false) replace 하지 않고 원본 HTML 을 보존하는 append(onceKey·버전)', async () => {
    const bodies: unknown[] = []
    const t = client((m, p, b) => (m === 'GET' ? src({ markdownEditable: false, html: '<p><u>사람 글</u></p>', md: '사람 글' }) : (bodies.push(b), p.includes('/write') ? res() : {})))
    expect((await insertDraftNote(t.c, REF, draft)).saved).toBe('added')
    expect(bodies[0]).toEqual({ mode: 'append', md: '## 상황\n초안', expectedVersion: 3, onceKey: 'run:d1' })
  })
  test('(리뷰 4) 충돌 뒤에는 다시 읽은 버전으로 다시 append', async () => {
    const bodies: Record<string, unknown>[] = []
    let n = 0
    const t = client((m, p, b) => {
      if (m === 'GET') return n === 0 ? src() : src({ markdownEditable: false, version: 5, md: '앞 글\n\n웹에서 밑줄' })
      if (!p.includes('/write')) return {}
      bodies.push(b!)
      if (n++ === 0) throw new ConflictError(409, 'changed', true, {})
      return res()
    })
    expect((await insertDraftNote(t.c, REF, draft)).saved).toBe('added')
    expect(bodies.map((x) => [x.mode, x.expectedVersion])).toEqual([['append', 3], ['append', 5]])
  })
  test('서버가 이미 받은 초안(duplicate)이면 두 번 넣지 않고 표시만', async () => {
    const t = client((m, p) => (m === 'GET' ? src({ md: '사람이 고친 노트' }) : p.includes('/write') ? res({ applied: 0, duplicate: true }) : {}))
    expect(await insertDraftNote(t.c, REF, draft)).toEqual({ saved: 'already', applied: true })
  })
  test('(리뷰 9) 409 면 다시 읽어 다시, 결과를 모르면 다시 쓰지 않고 onceKey 로 읽어 확인만(적용됐으면 넣음)', async () => {
    let n = 0
    const t = client((m, p) => {
      if (m === 'GET') return p.includes('onceKey=') ? { ...src(), onceApplied: true } : src()
      if (p.includes('/write')) { n++; if (n === 1) throw new ConflictError(409, 'changed', true, {}); throw new UnknownWriteError(new Error('net')) }
      return {}
    })
    expect((await insertDraftNote(t.c, REF, draft)).saved).toBe('added')
    expect(t.calls.filter((c) => c.includes('/write')).length).toBe(2)
    expect(t.calls).toContain('GET /api/docs/item%3Ab%3A1/note?onceKey=run%3Ad1')
  })
  test('(리뷰 3) onceKey 를 알리지 않는 옛 서버에서 결과를 모르면 자동으로 다시 보내지 않고 결과 불명', async () => {
    const t = client((m, p) => { if (m === 'GET') return src({ onceKey: undefined }); if (p.includes('/write')) throw new UnknownWriteError(new Error('net')); return {} })
    await expect(insertDraftNote(t.c, REF, draft)).rejects.toBeInstanceOf(UnknownWriteError)
    expect(t.calls.filter((c) => c.includes('/write')).length).toBe(1)
  })
  test('적용 표시가 실패해도 노트는 넣었다고 알려요(applied false)', async () => {
    const t = client((m, p) => { if (m === 'GET') return src(); if (p.includes('/write')) return res(); throw new Error('patch failed') })
    expect(await insertDraftNote(t.c, REF, draft)).toEqual({ saved: 'added', applied: false })
  })
  test('범위가 바뀌면 그 자리에서 멈춰요', async () => {
    const t = client((m) => { if (m === 'GET') return src(); throw new ScopeChangedError() })
    await expect(insertDraftNote(t.c, REF, draft)).rejects.toBeInstanceOf(ScopeChangedError)
  })
})

describe('고른 부분으로 새 일', () => {
  const args = { ref: REF, sel: '첫 줄\n둘째 줄', noteText: '노트 글', parentTitle: '부모', model: {} }
  test('만들고, 잇고, 초안 실행을 시작해요(각 결과를 알려요)', async () => {
    const t = client((m, p) => (p === '/api/signals' ? { id: 's9' } : {}))
    expect(await makeWorkFromQuote(t.c, args)).toEqual({ kind: 'made', next: 'signal:s9', title: '첫 줄', linked: 'ok', drafted: 'ok' })
    expect(t.calls).toEqual(['POST /api/signals', 'POST /api/work/links', 'POST /api/runs'])
  })
  test('만든 뒤 범위가 바뀌면 잇기·초안은 보내지 않고 scope 로 알려요', async () => {
    let made = false
    const t = client((m, p) => { if (p === '/api/signals') { made = true; return { id: 's9' } } if (made) throw new ScopeChangedError(); return {} })
    expect(await makeWorkFromQuote(t.c, args)).toMatchObject({ kind: 'made', linked: 'scope', drafted: 'scope' })
  })
  test('만들기 결과를 모르면 다시 만들라 하지 않고 unknown', async () => {
    const t = client(() => { throw new UnknownWriteError(new Error('net')) })
    expect(await makeWorkFromQuote(t.c, args)).toEqual({ kind: 'unknown' })
  })
  test('처음부터 범위가 바뀌었으면 아무것도 보내지 않아요', async () => {
    const t = client(() => { throw new ScopeChangedError() })
    expect((await makeWorkFromQuote(t.c, args)).kind).toBe('scope')
  })
})
