import { afterEach, describe, expect, test } from 'bun:test'
import * as Q from '@direction-board/contracts/quick-add'
import type { Call, Draft } from '@direction-board/contracts/quick-add'
import { configureAuth, scopedClient } from '../../api/client'
import { createWithRecord } from './quick/createScoped'
import * as R from './quick/recovery'
import * as Rules from './rules'
import type { Item } from '@direction-board/contracts'

// PR #39 리뷰 15(66dc2ab): (P1-1) 결과가 differs 인데 소비처가 failed 만 보고 끝으로 처리, (P1-2) 갓 만든 항목의 속성 쓰기도 앞 단계 응답이 늦는 동안
// 사람이 넣은 값을 덮음, (P2) 끝냄 되돌리기가 최신 항목을 읽어 바로 PUT. 구조: createWork 결과는 판별 유니온, 속성·태그 쓰기는 늘 "읽고 → 다르면 멈춤 → 남은 것만 버전 조건".
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: ['회의'], note: '노트 글', props: [{ key: 'phase', type: 'text', value: 'draft' }] }
type Doc = { version: number; tags: string[]; props: { key: string; value: unknown }[]; note: string | null }
function server(doc: Doc, hooks: { beforeWrite?: (path: string, doc: Doc) => void } = {}, item: Record<string, unknown> | null = null) {
  const calls: string[] = []
  const call = (async (path: string, init: { method: string; body?: string }) => {
    calls.push(init.method + ' ' + path)
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    if (init.method === 'GET' && path.includes('?view=meta')) return { version: doc.version, frontmatter: { tags: doc.tags.map((tag) => ({ tag, by: 'person' })), props: doc.props } }
    if (init.method === 'GET') {
      if (!item) throw Object.assign(new Error('nf'), { status: 404 })
      return { self: item, note: doc.note === null ? null : { text: doc.note } }
    }
    hooks.beforeWrite?.(path, doc)
    if (path.endsWith('/note')) {
      if (doc.note !== null) throw Object.assign(new Error('exists'), { status: 409 })
      doc.note = String(body?.text ?? '')
      doc.version++
      return { version: doc.version }
    }
    if (path.endsWith('/props')) {
      if (body?.expectedVersion !== undefined && body.expectedVersion !== doc.version) throw Object.assign(new Error('changed'), { status: 409 })
      for (const [key, value] of Object.entries((body?.set ?? {}) as Record<string, unknown>)) {
        const at = doc.props.findIndex((p) => p.key === key)
        if (at >= 0) doc.props[at] = { key, value }
        else doc.props.push({ key, value })
      }
      doc.version++
      return {}
    }
    if (path.endsWith('/tags')) {
      for (const t of (body?.add ?? []) as string[]) if (!doc.tags.includes(t)) doc.tags.push(t)
      return {}
    }
    return {}
  }) as Call
  return { call, calls, doc }
}
const deps = (call: Call) => ({ save: async () => true as const, call, id: () => 'q1', now: () => 1 })
const kindOf = (r: unknown) => (r as { kind?: string }).kind

describe('(리뷰 15 P1-2) 갓 만든 항목의 속성도 읽고 → 다르면 멈춤 → 남은 것만 버전 조건', () => {
  test('노트 단계 응답이 늦는 동안 다른 기기가 phase 를 넣으면, 이어진 속성 쓰기는 덮지 않고 conflict', async () => {
    const s = server({ version: 0, tags: [], props: [], note: null }, {
      beforeWrite: (path, doc) => {
        if (path.endsWith('/note')) { doc.props.push({ key: 'phase', value: 'human-updated' }); doc.version++ }
      },
    })
    const r = await Q.createWork(draft, deps(s.call))
    expect(s.doc.props.find((p) => p.key === 'phase')?.value).toBe('human-updated')
    expect([kindOf(r), (r as { at?: string }).at]).toEqual(['conflict', 'props'])
  })
  test('그사이 아무도 안 바꿨으면 읽은 버전과 함께 보내고 done', async () => {
    const s = server({ version: 0, tags: [], props: [], note: null })
    const r = await Q.createWork(draft, deps(s.call))
    expect(kindOf(r)).toBe('done')
    expect(s.calls.filter((c) => c.includes('?view=meta')).length).toBeGreaterThanOrEqual(2)
  })
  test('갓 만든 항목에서 읽기와 쓰기 사이에 다른 속성만 바뀌면(409) 다시 읽어 새 버전으로 남은 것만, 사람 값은 그대로', async () => {
    let once = true
    const s = server({ version: 0, tags: [], props: [], note: null }, {
      beforeWrite: (path, doc) => {
        if (path.endsWith('/props') && once) { once = false; doc.props.push({ key: '메모', value: '사람이 넣음' }); doc.version++ }
      },
    })
    const r = await Q.createWork(draft, deps(s.call))
    expect(kindOf(r)).toBe('done')
    expect(s.doc.props).toEqual([{ key: '메모', value: '사람이 넣음' }, { key: 'phase', value: 'draft' }])
    expect(s.calls.filter((c) => c.startsWith('POST') && c.endsWith('/props')).length).toBe(2)
  })
  test('갓 만든 항목의 태그도 먼저 읽어 그사이 사람이 단 태그는 다시 보내지 않아요', async () => {
    const sent: unknown[] = []
    const s = server({ version: 0, tags: [], props: [], note: null }, {
      beforeWrite: (path, doc) => {
        if (path.endsWith('/note')) doc.tags.push('회의')
      },
    })
    const call = (async (path: string, init: { method: string; body?: string }) => {
      if (path.endsWith('/tags')) sent.push(JSON.parse(init.body ?? '{}'))
      return s.call(path, init)
    }) as Call
    const r = await Q.createWork(draft, deps(call))
    expect(kindOf(r)).toBe('done')
    expect(sent).toEqual([])
  })
})

describe('(리뷰 15 P1-1) 결과는 판별 유니온: differs·conflict 는 done 이 아니에요', () => {
  test('항목 결과 불명 → 재개 → 다른 기기가 제목을 바꿈: kind differs, 아직 안 보낸 노트가 남은 단계(left)', async () => {
    const s = server({ version: 0, tags: [], props: [], note: null }, {}, { title: '사람이 고친 제목', type: 'todo', when: null })
    const r = await Q.createWork(draft, deps(s.call), { id: 'q1', from: 'item' })
    expect([kindOf(r), (r as { left?: string | null }).left]).toEqual(['differs', 'note'])
    expect(s.calls.filter((c) => !c.startsWith('GET '))).toEqual([])
  })
  test('iOS 기록: differs 에 남은 단계가 없어도(항목만 있는 초안) 기록을 지우지 않아요', () => {
    const only: Draft = { ...draft, note: '', tags: [], props: [] }
    const p = R.pendingFrom({ kind: 'differs', ref: 'item:b:q1', id: 'q1', at: 'item', left: null, scope: 's' } as never, only, '회의 준비')
    expect(p).not.toBeNull()
    // 누르면 다시 확인(읽기)만 하고, 닫기·✦·새 글로 지워지지 않아요(버리기는 사람이)
    expect([p.from, p.checked, R.checkOnly(p), R.retryLabel(p), R.inputLocked(p), R.aiAllowed(p)]).toEqual(['item', 'differs', true, '다시 확인', true, false])
  })
  test('iOS 기록: 모든 kind 가 done 이 아니면 기록으로(differs 는 남은 노트부터 사람이, conflict·unknown 은 확인만)', () => {
    const base = { ref: 'item:b:q1', id: 'q1', scope: 's' }
    expect(R.pendingFrom({ ...base, kind: 'differs', at: 'item', left: 'note' }, draft, 'x')).toMatchObject({ from: 'note', checked: 'differs' })
    expect(R.checkOnly(R.pendingFrom({ ...base, kind: 'differs', at: 'item', left: 'note' }, draft, 'x'))).toBe(false)
    expect(R.checkOnly(R.pendingFrom({ ...base, kind: 'conflict', at: 'props' }, draft, 'x'))).toBe(true)
    expect(R.checkOnly(R.pendingFrom({ ...base, kind: 'unknown', at: 'note' }, draft, 'x'))).toBe(true)
    expect(R.pendingFrom({ ...base, kind: 'scope', at: 'tags' }, draft, 'x')).toMatchObject({ from: 'tags', stopped: 'scope' })
    expect(R.pendingFrom({ ...base, kind: 'failed', at: 'props' }, draft, 'x')).toMatchObject({ from: 'props' })
  })
})

// 화면이 받는 결과(createWithRecord): 확인(읽기)에서 항목이 사람 손으로 바뀌어 있으면, 보낼 단계가 없어도 done 이 아니라 기록으로(쓰기 0건)
const O = 'https://board.test'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  configureAuth({ session: () => null, expired: () => {} })
})
describe('(리뷰 15 P1-1) 확인 결과 differs 는 보낼 것이 없어도 기록으로 남아요', () => {
  test('항목만 있는 초안의 결과 불명 → 확인했더니 제목이 바뀌어 있음: pending(다시 확인), 쓰기 0건', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const tok = b64({ alg: 'RS256' }) + '.' + b64({ email: 'a@x.test', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig'
    configureAuth({ session: () => ({ origin: O, token: tok }) as never, expired: () => {} })
    const sent: string[] = []
    globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).slice(O.length)
      sent.push((init?.method ?? 'GET') + ' ' + path)
      if ((init?.method ?? 'GET') === 'GET' && path.startsWith('/api/work/')) return Response.json({ self: { title: '사람이 고친 제목', type: 'todo', when: null }, note: null })
      return Response.json({ error: 'not found' }, { status: 404 })
    }, { preconnect: originalFetch.preconnect })
    const only: Draft = { ...draft, note: '', tags: [], props: [] }
    const scope = scopedClient(O)
    const left: R.Pending = { id: 'q9', from: 'item', draft: only, text: '회의 준비', ref: null, unknown: true, scope: scope.scope }
    const r = await createWithRecord({ text: '', makeDraft: () => only, pending: left, writeAhead: async () => true, scope, save: async () => true as const })
    expect(r.kind).toBe('pending')
    const p = (r as { pending: R.Pending }).pending
    expect([p.from, p.checked, R.retryLabel(p)]).toEqual(['item', 'differs', '다시 확인'])
    expect(sent.filter((x) => !x.startsWith('GET '))).toEqual([])
  })
})

describe('(리뷰 15 P2) 끝냄 되돌리기: 다시 읽은 항목이 내가 끝낸 그 상태 그대로일 때만', () => {
  const mine: Item = { id: 'i1', boardId: 'b', type: 'todo', text: '회의 준비', x: 0, y: 0, w: 1, h: 1, done: true }
  const undoTarget = (Rules as unknown as { undoTarget: (fresh: Item, mine: Item) => boolean }).undoTarget
  test('그사이 제목이 바뀌었으면 되돌리지 않아요', () => {
    expect(undoTarget({ ...mine, text: '다른 기기에서 고친 제목' }, mine)).toBe(false)
    expect(undoTarget({ ...mine, done: false }, mine)).toBe(false)
  })
  test('그대로면 되돌려요(서버가 붙이는 updatedAt·by 는 보지 않음)', () => {
    expect(undoTarget({ ...mine, updatedAt: 99, by: 'x' } as Item, mine)).toBe(true)
  })
})
