import { afterEach, describe, expect, test } from 'bun:test'
import type { Draft } from '@direction-board/contracts/quick-add'
import { configureAuth, scopeIdentity, scopedClient } from '../../../api/client'
import { createScoped } from './createScoped'

// 빠른 추가 흐름을 실제 클라이언트(가짜 fetch)와 로그인 전환으로(리뷰 3 P1): 실패 → 다른 계정 → 다시 시도 → 원래 계정 → 이어서
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const token = (email: string) => `${b64({ alg: 'RS256' })}.${b64({ email, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const O = 'https://board.test'
const originalFetch = globalThis.fetch
let session: { origin: string; token: string } | null = null
let sent: string[] = []
let failTags = true
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
function setup() {
  sent = []
  session = { origin: O, token: token('a@x.test') }
  configureAuth({ session: () => session as never, expired: () => {} })
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).slice(O.length)
    sent.push(`${init?.method ?? 'GET'} ${u}`)
    if (u.endsWith('/tags') && failTags) return Response.json({ error: 'nope' }, { status: 400 })
    return Response.json({ ok: true, version: 1 })
  }, { preconnect: originalFetch.preconnect })
}
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: ['급함'], note: '', props: [] }
const saves: string[] = []
const save = async () => { saves.push(scopeIdentity(O)); return true as const }

describe('빠른 추가 재개는 시작 범위로만', () => {
  test('A 에서 태그 단계 실패 → B 로 바뀐 뒤 다시 시도는 보내지 않음 → A 로 돌아오면 같은 id 로 태그부터', async () => {
    setup()
    failTags = true
    const first = await createScoped({ scope: scopedClient(O), save, draft, id: () => 'i1' })
    expect(first).toMatchObject({ kind: 'failed', at: 'tags', scope: O + '|a@x.test', ref: 'item:b:i1' })
    session = { origin: O, token: token('b@x.test') }
    sent = []
    const other = await createScoped({ scope: scopedClient(O), save, draft, resume: { id: 'i1', from: 'tags', scope: first.scope } })
    expect(other).toMatchObject({ kind: 'scope', at: 'tags' })
    expect(sent).toEqual([])
    session = { origin: O, token: token('a@x.test') }
    failTags = false
    const back = await createScoped({ scope: scopedClient(O), save, draft, resume: { id: 'i1', from: 'tags', scope: first.scope } })
    expect(back.kind).toBe('done')
    // 이어 하기라 이미 있던 문서: 태그 전에 메타를 먼저 읽어 없는 태그만 보내요(리뷰 14)
    expect(sent).toEqual(['GET /api/docs/item%3Ab%3Ai1?view=meta', 'POST /api/docs/item%3Ab%3Ai1/tags'])
  })
  test('항목 저장 직전에 범위가 바뀌면 항목도 보내지 않아요', async () => {
    setup()
    saves.length = 0
    let view = O
    const r = await createScoped({ scope: scopedClient(O, () => view === O), save: async () => { view = 'x'; return save() }, draft: { ...draft, tags: [] }, id: () => 'i2' })
    // save 안에서 화면 범위가 바뀌어도 이 save 는 이미 보낸 것 — 다음 단계(노트 없음·태그 없음)는 없음
    expect(r.kind).toBe('done')
    view = 'x'
    const r2 = await createScoped({ scope: scopedClient(O, () => view === O), save, draft, id: () => 'i3' })
    expect(r2).toMatchObject({ kind: 'scope', at: 'item' })
  })
})
