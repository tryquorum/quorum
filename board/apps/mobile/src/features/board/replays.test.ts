import { afterEach, describe, expect, test } from 'bun:test'
import { configureAuth, scopedClient } from '../../api/client'
import type { Intent, Journal } from './intents'
import { confirmIntent, resendIntent } from './replays'

// 홈의 끝나지 않은 요청(리뷰 8 → 리뷰 9): 확인은 읽기만, 다시 보내기는 사람이 눌렀을 때만.
// 이 파일은 옛 서버(capabilities·clientKey·onceKey 를 모름)를 흉내 내요 — 자동으로든 사람이 눌러서든 키로 판정할 수 없는 쓰기는 보내지 않아요.
// 새 서버의 확인·다시 보내기는 review11.test.ts.
const O = 'https://board.test'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
type Server = { caps?: string[] | null; get?: (path: string) => Response }
function serve(s: Server) {
  const sent: string[] = []
  let runs = 0
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).slice(O.length)
    const method = init?.method ?? 'GET'
    sent.push(method + ' ' + path)
    if (method === 'GET' && path === '/api/settings') return s.caps === null ? Response.json({ error: 'no' }, { status: 500 }) : Response.json({ me: { email: 'a', agent: false }, ...(s.caps ? { capabilities: s.caps } : {}) })
    if (method === 'GET') return s.get ? s.get(path) : Response.json({ error: 'not found' }, { status: 404 })
    // 옛 서버는 clientKey 를 모르고 매번 새 실행을 만들어요
    return Response.json({ id: 'r' + ++runs, created_at: 1 }, { status: 201 })
  }, { preconnect: originalFetch.preconnect })
  return { sent, writes: () => sent.filter((x) => !x.startsWith('GET ')) }
}
const journal = () => {
  const dropped: string[] = []
  const j: Journal = { put: async () => true, drop: (k) => void dropped.push(k), release: () => {}, blocked: () => null }
  return { j, dropped }
}
const caps = () => fetch(O + '/api/settings').then((r) => r.json()).then((s: { capabilities?: string[] }) => s.capabilities ?? [])
const runIntent: Intent = { key: 'run:k1', kind: 'run', scope: O + '|anon', at: 1, label: '초안', payload: { body: { prompt: '초안 써 줘', kind: 'draft', target: 'item:b:1' } } }
const noteIntent: Intent = { key: 'note:d1:item:b:1', kind: 'note', scope: O + '|anon', at: 1, label: '초안 넣기', payload: { ref: 'item:b:1', draft: { id: 'd1', output: '## 상황\n초안' } } }

describe('옛 서버(capabilities 없음)', () => {
  test('AI 실행: 키로 찾을 수 없어 확인도 다시 보내기도 unsupported — POST 0건, 기록 남김(옛 서버는 매번 새 실행을 만들어요)', async () => {
    const t = serve({ get: () => Response.json({ runs: [{ id: 'old1' }] }) })
    const { j, dropped } = journal()
    expect(await confirmIntent(j, scopedClient(O), runIntent, caps)).toEqual({ kind: 'unsupported' })
    expect(await resendIntent(j, scopedClient(O), runIntent, caps)).toEqual({ kind: 'unsupported' })
    expect([t.writes(), dropped]).toEqual([[], []])
  })
  test('서버 약속을 읽지 못하면(설정 실패) 약속이 없는 것으로 봐요', async () => {
    serve({ caps: null })
    const { j } = journal()
    expect((await confirmIntent(j, scopedClient(O), runIntent, caps)).kind).toBe('unsupported')
  })
  test('노트에 넣기: 노트를 읽어 본문으로만 확인 — 없으면 absent, 노트 쓰기 0건', async () => {
    const t = serve({ get: (p) => (p.startsWith('/api/docs/item%3Ab%3A1/note') ? Response.json({ ref: 'item:b:1', html: '', md: '앞 글', version: 3, personEdited: true }) : Response.json({ error: 'x' }, { status: 404 })) })
    const { j, dropped } = journal()
    expect((await confirmIntent(j, scopedClient(O), noteIntent, caps)).kind).toBe('absent')
    expect([t.writes(), dropped]).toEqual([[], []])
  })
  test('읽기가 결과 불명이면 unknown — 기록 남김', async () => {
    serve({ get: () => new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/html' } }) })
    const { j, dropped } = journal()
    expect((await confirmIntent(j, scopedClient(O), noteIntent, caps)).kind).toBe('unknown')
    expect(dropped).toEqual([])
  })
})
