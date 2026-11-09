import { describe, expect, test } from 'bun:test'
import { createWork, type Call, type Draft } from '@direction-board/contracts/quick-add'

// PR #39 리뷰 14 P1: 빠른 추가 재개의 속성 단계가 읽고 비교한 뒤 버전 없이 초안 속성 전부를 보내 사람이 그사이 고친 값을 되돌렸어요.
// 이제 읽은 문서 버전을 함께 보내고(서버 409), 이미 같은 값은 다시 보내지 않고 남은 것만, 409 면 다시 읽어 사람 값과 다르면 멈춰요(덮지 않음).
// 태그 단계도 이어 하기면 먼저 읽어 없는 것만 보내요(태그는 서버에 버전이 없어 이미 있는 태그를 건드리지 않는 것까지가 보장이에요).
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: ['회의', '준비'], note: '', props: [{ key: 'phase', type: 'text', value: 'draft' }, { key: '담당', type: 'text', value: '나' }] }
type Doc = { version: number; tags: string[]; props: { key: string; value: unknown }[] }
function server(doc: Doc, onWrite?: (doc: Doc) => void) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = []
  const call = (async (path: string, init: { method: string; body?: string }) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ method: init.method, path, ...(body ? { body } : {}) })
    if (init.method === 'GET') return { ref: 'item:b:q1', version: doc.version, frontmatter: { tags: doc.tags.map((tag) => ({ tag, by: 'person' })), props: doc.props } }
    onWrite?.(doc)
    if (path.endsWith('/props')) {
      if (body?.expectedVersion !== undefined && body.expectedVersion !== doc.version) throw Object.assign(new Error('Document changed'), { status: 409 })
      for (const [key, value] of Object.entries((body?.set ?? {}) as Record<string, unknown>)) {
        const at = doc.props.findIndex((p) => p.key === key)
        if (at >= 0) doc.props[at] = { key, value }
        else doc.props.push({ key, value })
      }
      doc.version++
      return { ref: 'item:b:q1', version: doc.version, props: doc.props }
    }
    if (path.endsWith('/tags')) {
      for (const t of (body?.add ?? []) as string[]) if (!doc.tags.includes(t)) doc.tags.push(t)
      return { ref: 'item:b:q1', tags: doc.tags }
    }
    return {}
  }) as Call
  return { call, calls, doc }
}
const deps = (call: Call) => ({ save: async () => true as const, call, id: () => 'q1', now: () => 1 })

describe('(리뷰 14 P1) 빠른 추가 재개: 읽은 버전으로 남은 속성만, 사람 값은 덮지 않아요', () => {
  test('읽은 뒤 다른 기기가 phase 를 바꾸면(409) 다시 읽고 사람 값과 다르니 멈춰요 — phase 는 사람 값 그대로', async () => {
    // 읽을 때는 phase=draft(우리 값)만 있고 담당은 없어요 → 앱이 쓰기 전에 다른 기기가 phase=human-updated 로
    let first = true
    const s = server({ version: 5, tags: [], props: [{ key: 'phase', value: 'draft' }] }, (doc) => {
      if (!first) return
      first = false
      doc.props[0] = { key: 'phase', value: 'human-updated' }
      doc.version++
    })
    const r = await createWork(draft, deps(s.call), { id: 'q1', from: 'props' })
    expect(s.doc.props.find((p) => p.key === 'phase')?.value).toBe('human-updated')
    expect(r).toMatchObject({ kind: 'conflict', at: 'props' })
    const posts = s.calls.filter((c) => c.method === 'POST')
    expect(posts.length).toBe(1)
    expect(posts[0]?.body).toEqual({ set: { 담당: '나' }, types: { 담당: 'text' }, expectedVersion: 5 })
  })
  test('이미 같은 값인 속성은 다시 보내지 않고 남은 것만, 읽은 버전과 함께', async () => {
    const s = server({ version: 7, tags: [], props: [{ key: 'phase', value: 'draft' }] })
    const r = await createWork(draft, deps(s.call), { id: 'q1', from: 'props' })
    expect(r.kind).toBe('done')
    expect(s.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ set: { 담당: '나' }, types: { 담당: 'text' }, expectedVersion: 7 }])
  })
  test('409 뒤 다시 읽었더니 사람 값과 부딪치지 않으면(다른 속성이 바뀜) 새 버전으로 남은 것만 다시', async () => {
    let first = true
    const s = server({ version: 3, tags: [], props: [] }, (doc) => {
      if (!first) return
      first = false
      doc.props.push({ key: '메모', value: '사람이 넣음' })
      doc.version++
    })
    const r = await createWork(draft, deps(s.call), { id: 'q1', from: 'props' })
    expect(r.kind).toBe('done')
    expect(s.calls.filter((c) => c.method === 'POST').map((c) => c.body?.expectedVersion)).toEqual([3, 4])
    expect(s.doc.props.find((p) => p.key === '메모')?.value).toBe('사람이 넣음')
  })
  test('태그 이어 하기: 먼저 읽어 없는 태그만 보내요', async () => {
    const s = server({ version: 1, tags: ['회의'], props: [{ key: 'phase', value: 'draft' }, { key: '담당', value: '나' }] })
    const r = await createWork(draft, deps(s.call), { id: 'q1', from: 'tags' })
    expect(r.kind).toBe('done')
    expect(s.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tags')).map((c) => c.body)).toEqual([{ add: ['준비'] }])
    expect(s.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/props'))).toEqual([])
  })
})
