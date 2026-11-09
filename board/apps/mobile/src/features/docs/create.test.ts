import { describe, expect, test } from 'bun:test'
import { ApiError, ConflictError, UnknownWriteError } from '../../api/client'
import { confirmKey, createDocSteps, emptyDraft, findSameDoc, gate, propsApplied, resumeOf, type DocCreateDeps, type DocDraft } from './create'

// 웹 apps/web/src/lib/doc-create.test.ts 와 같은 사례(오류만 iOS 요청 층의 분류로)
const ID = '0b6f3c1e-8a3d-4f7a-9c1e-2d4b6a8c0e1f'
const draft = (over: Partial<DocDraft> = {}): DocDraft => ({ id: ID, title: ' 회의록 템플릿 ', md: '첫 줄', area: '업무', tags: ['계약'], links: [], props: [], ...over })
const rejected = (status: number) => new ApiError(status, 'bad', false, { error: 'bad' })
const unknown = () => new UnknownWriteError(new Error('network'))
const conflict = () => new ConflictError(409, 'changed', false, { error: 'changed' })
function fake(over: Partial<DocCreateDeps> = {}) {
  const calls: string[] = []
  const deps: DocCreateDeps = {
    create: async (input) => (calls.push('create ' + JSON.stringify(input)), { ref: 'doc:' + input.id, version: 1 }),
    setProps: async (ref, body) => (calls.push('props ' + ref + ' ' + JSON.stringify(body)), { version: body.expectedVersion + 1 }),
    readMeta: async (ref) => (calls.push('meta ' + ref), { version: 1, props: [] }),
    ...over,
  }
  return { deps, calls }
}
const withProp = draft({ props: [{ key: '단계', type: 'select', value: '초안' }, { key: '', type: 'text', value: '빈 이름은 뺌' }] })

describe('createDocSteps', () => {
  test('만들기만: 제목 trim, 빈 칸은 보내지 않음, 부모가 있으면 parent', async () => {
    const { deps, calls } = fake()
    expect(await createDocSteps(draft({ area: null, tags: [] }), deps)).toEqual({ status: 'done', ref: 'doc:' + ID })
    expect(calls).toEqual([`create {"id":"${ID}","title":"회의록 템플릿","md":"첫 줄"}`])
    await createDocSteps(draft({ area: null, tags: [], parent: 'doc:p' }), deps)
    expect(calls[1]).toContain('"parent":"doc:p"')
  })
  test('속성은 만든 버전 기준으로 이어서 보냄', async () => {
    const { deps, calls } = fake()
    expect((await createDocSteps(withProp, deps)).status).toBe('done')
    expect(calls[1]).toBe(`props doc:${ID} {"set":{"단계":"초안"},"types":{"단계":"select"},"expectedVersion":1}`)
  })
  test('만들기 결과를 모르면 retry, 거절·409 는 고쳐야 함, 둘 다 props 를 보내지 않음', async () => {
    for (const [e, retry] of [[unknown(), true], [rejected(400), false], [conflict(), false]] as const) {
      const { deps, calls } = fake({ create: async () => Promise.reject(e) })
      expect(await createDocSteps(withProp, deps)).toMatchObject({ status: 'failed', step: 'doc', retry })
      expect(calls.some((c) => c.startsWith('props'))).toBe(false)
    }
  })
  test('다시 시도는 같은 id 로 만들기부터', async () => {
    const ids: string[] = []
    const { deps } = fake({ create: async (input) => { ids.push(input.id); if (ids.length === 1) throw unknown(); return { ref: 'doc:' + input.id, version: 1 } } })
    const first = await createDocSteps(withProp, deps)
    expect(first.status).toBe('failed')
    if (first.status !== 'failed') throw new Error('unreachable')
    expect(resumeOf(first)).toEqual({ step: 'doc' })
    expect((await createDocSteps(withProp, deps, { step: 'doc' })).status).toBe('done')
    expect(ids).toEqual([ID, ID])
  })
  test('속성 결과 불명 → 먼저 읽고 이미 들어갔으면 끝, 버전이 그대로면 같은 버전으로, 다른 편집이 끼었으면 conflict', async () => {
    const a = fake({ setProps: async () => Promise.reject(unknown()), readMeta: async () => ({ version: 2, props: [{ key: '단계', type: 'select', value: '초안' }] }) })
    const first = await createDocSteps(withProp, a.deps)
    expect(first).toMatchObject({ status: 'failed', step: 'props', version: 1, retry: true })
    expect(await createDocSteps(withProp, a.deps, { step: 'props', ref: 'doc:' + ID, version: 1 })).toEqual({ status: 'done', ref: 'doc:' + ID })
    let n = 0
    const b = fake({ setProps: async (_r, body) => { if (n++ === 0) throw unknown(); return { version: body.expectedVersion + 1 } } })
    expect((await createDocSteps(withProp, b.deps, { step: 'props', ref: 'doc:' + ID, version: 1 })).status).toBe('failed')
    expect(await createDocSteps(withProp, b.deps, { step: 'props', ref: 'doc:' + ID, version: 1 })).toEqual({ status: 'done', ref: 'doc:' + ID })
    let sent = 0
    const c = fake({ setProps: async () => { sent++; throw conflict() }, readMeta: async () => ({ version: 3, props: [{ key: '단계', type: 'select', value: '검토' }] }) })
    expect(await createDocSteps(withProp, c.deps)).toMatchObject({ status: 'failed', step: 'props', retry: true })
    expect(await createDocSteps(withProp, c.deps, { step: 'props', ref: 'doc:' + ID, version: 1 })).toEqual({ status: 'conflict', ref: 'doc:' + ID })
    expect(sent).toBe(1)
  })
  test('속성 거절은 고쳐야 하는 오류', async () => {
    const { deps } = fake({ setProps: async () => Promise.reject(rejected(400)) })
    expect(await createDocSteps(withProp, deps)).toMatchObject({ status: 'failed', step: 'props', retry: false })
  })
  test('propsApplied 는 서버가 저장했을 값·타입과 정확히 같을 때만', () => {
    const nfd = '단계'.normalize('NFD')
    expect(propsApplied([{ key: '단계', type: 'text', value: '초안' }], { [' ' + nfd + ' ']: '초안' }, { [' ' + nfd + ' ']: 'text' })).toBe(true)
    expect(propsApplied([{ key: '단계', type: 'text', value: ' 초안 ' }], { 단계: '초안' }, { 단계: 'text' })).toBe(false)
    expect(propsApplied([{ key: '단계', type: 'select', value: '초안' }], { 단계: ' 초안 ' }, { 단계: 'select' })).toBe(true)
    expect(propsApplied([{ key: '목록', type: 'list', value: ['a', 'b'] }], { 목록: ['a', ' b', 'a'] }, { 목록: 'list' })).toBe(true)
    expect(propsApplied([], { 단계: '초안' }, { 단계: 'text' })).toBe(false)
  })
})

describe('같은 제목', () => {
  const hits = [{ ref: 'doc:a', title: '회의록-템플릿!', status: 'open' }, { ref: 'doc:b', title: '회의록 템플릿', status: 'archived' }]
  test('findSameDoc: 정규화 같음, 보관 제외, 4자 미만 없음', () => {
    expect(findSameDoc(hits, '회의록 템플릿')?.ref).toBe('doc:a')
    expect(findSameDoc([hits[1]], '회의록 템플릿')).toBeNull()
    expect(findSameDoc([{ ref: 'doc:c', title: '메모', status: 'open' }], '메모')).toBeNull()
  })
  test('gate: 확인 전 기다림, 같음·확인 실패는 한 번 더', () => {
    const t = '회의록 템플릿'
    const key = '회의록템플릿'
    expect(gate('메모', null, null)).toBe('go')
    expect(gate(t, null, null)).toBe('wait')
    expect(gate(t, { key, state: 'loading' }, null)).toBe('wait')
    expect(gate(t, { key, state: 'ok', hits: [] }, null)).toBe('go')
    expect(gate(t, { key, state: 'ok', hits }, null)).toBe('same')
    expect(gate(t, { key, state: 'ok', hits }, confirmKey('same', t))).toBe('go')
    expect(gate(t, { key, state: 'error' }, confirmKey('same', t))).toBe('unknown')
    expect(gate(t, { key, state: 'error' }, confirmKey('unknown', ' 회의록  템플릿'))).toBe('go')
  })
  test('emptyDraft 는 맥락을 채우고 새 id', () => {
    expect(emptyDraft(() => 'id1', { area: '업무', links: ['doc:x'] })).toEqual({ id: 'id1', title: '', md: '', area: '업무', tags: [], links: ['doc:x'], props: [] })
    expect('parent' in emptyDraft(() => 'x', {})).toBe(false)
  })
})
