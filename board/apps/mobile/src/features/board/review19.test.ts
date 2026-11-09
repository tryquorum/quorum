import { afterEach, describe, expect, test } from 'bun:test'
import type { Draft } from '@direction-board/contracts/quick-add'
import * as R from '@direction-board/contracts/quick-recovery'
import { configureAuth, scopedClient } from '../../api/client'
import { createScoped } from './quick/createScoped'
import { SmallStore } from './smallStore'

// PR #39 리뷰 17: (P1-1) 범위 고정 클라이언트의 모든 쓰기에 시작 범위의 주체를 밝히고, 서버가 409 scope-changed 면 ScopeChangedError(기록 유지).
// (P1-2) 편집 중 초안은 제출 기록과 따로 범위별 저장 — 다시 열면 편집 초안이 먼저, 잠긴 기록이면 기록의 초안.
const O = 'https://board.test'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const tok = (email: string) => b64({ alg: 'RS256' }) + '.' + b64({ email, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig'
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: 'A 의 노트', props: [] }

describe('(리뷰 17 P1-1) iOS 쓰기는 시작 범위의 주체를 밝혀요', () => {
  test('항목·노트 쓰기에 X-Direction-Expect-User, 서버가 409 scope-changed 면 범위 바뀜으로 멈추고 기록(노트) 유지', async () => {
    configureAuth({ session: () => ({ origin: O, token: tok('a@x.test') }) as never, expired: () => {} })
    const sent: { method: string; path: string; who: string | null }[] = []
    globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).slice(O.length)
      const method = init?.method ?? 'GET'
      const who = (init?.headers as Record<string, string> | undefined)?.['X-Direction-Expect-User'] ?? null
      sent.push({ method, path, who })
      if (method === 'GET') return Response.json({ error: 'not found' }, { status: 404 })
      // 서버 쪽 지금 주체는 항목 저장 뒤 B 로 바뀌었다고 쳐요(쿠키 교체). 헤더가 A 라 노트 PUT 은 409 scope-changed
      if (path.endsWith('/note')) return Response.json({ error: 'scope-changed' }, { status: 409 })
      return Response.json({ id: 'q1' })
    }, { preconnect: originalFetch.preconnect })
    const r = await createScoped({ scope: scopedClient(O), save: async () => true, draft, id: () => 'q1' })
    const writes = sent.filter((x) => x.method !== 'GET')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((x) => x.who === 'a@x.test')).toBe(true)
    expect([r.kind, (r as { at?: string }).at]).toEqual(['scope', 'note'])
    const p = R.pendingFrom(r as R.NotDone & { scope: string }, draft, '')
    expect([p.stopped, p.draft.note]).toEqual(['scope', 'A 의 노트'])
  })
  test('로그인 없이 붙는 로컬 서버(anon)면 밝히지 않아요(서버가 정한 주체 그대로)', async () => {
    const seen: (string | null)[] = []
    globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.['X-Direction-Expect-User'] ?? null)
      return Response.json({ id: 'q2' })
    }, { preconnect: originalFetch.preconnect })
    await scopedClient(O).write('/api/x', 'POST', {})
    expect(seen).toEqual([null])
  })
})

describe('(리뷰 17 P1-2) 편집 중 초안', () => {
  const edit = (text: string, note: string): R.QuickEdit => ({ text, note, kind: 'todo', tags: [], props: [] })
  test('확실한 거절 뒤 노트를 A→A+B 로 고치고 닫기 → 다시 열면 A+B(편집 초안이 먼저)', async () => {
    const files: Record<string, string> = {}
    const io = { read: async (n: string) => files[n] ?? null, write: async (n: string, t: string) => void (files[n] = t) }
    const s1 = new SmallStore(io)
    await s1.load(R.EDITS, R.isEdits)
    s1.set(R.EDITS, R.putEdit(s1.get(R.EDITS, {}), 'sheet', edit('회의 준비', 'A+B')))
    await s1.flush()
    const s2 = new SmallStore(io)
    await s2.load(R.EDITS, R.isEdits)
    const again = s2.get<Record<string, R.QuickEdit>>(R.EDITS, {}).sheet ?? null
    const failed = R.pendingFrom({ kind: 'failed', ref: null, id: 'q1', at: 'item', scope: 's' }, { ...draft, note: 'A' }, '')
    expect(R.restoreSource(failed, again)).toEqual({ from: 'edit', edit: edit('회의 준비', 'A+B') })
  })
  test('결과 불명(잠긴 기록) 중에는 기록의 초안 — 편집 초안이 있어도 편집 불가', () => {
    const locked = R.pendingFrom({ kind: 'unknown', ref: null, id: 'q1', at: 'item', scope: 's' }, draft, '')
    expect(R.restoreSource(locked, edit('다른 글', 'B'))).toEqual({ from: 'record', draft })
  })
  test('제출 전 초안(기록 없음)도 남고, 사람이 칸을 다 비우면 그 자리를 비워요', () => {
    expect(R.restoreSource(null, edit('처음 쓰던 글', ''))).toEqual({ from: 'edit', edit: edit('처음 쓰던 글', '') })
    expect(R.putEdit({ sheet: edit('x', '') }, 'sheet', edit('', ''))).toEqual({})
  })
})
