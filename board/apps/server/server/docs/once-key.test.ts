import { test, expect } from 'bun:test'
import { legacyDb } from './storage.test.ts'
import { initDocs, setHtmlToMarkdown, setStrictHtmlToMarkdown, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'
import { docsApi } from './api.ts'
import { htmlToMarkdown, noteHtmlToMarkdown } from '../vault/index.ts'

// 구조 2(머지 전 새 리뷰 2, P2): docs write 의 선택 필드 onceKey(예: run:<id>). 같은 (owner, ref, onceKey) 는 노트 쓰기와 같은 트랜잭션에
// 한 번만 적용되고, 다시 오면 버전 검사보다 먼저 applied:0·duplicate:true. 키가 없을 때만 지금처럼 본문 포함으로 duplicate 를 봐요.
// 기존 idempotencyKey(같은 요청 영수증 다시 주기, 본문이 다르면 400)와 따로예요.
function setup() {
  const db = legacyDb()
  initDocs(db)
  setHtmlToMarkdown(db, noteHtmlToMarkdown)
  setStrictHtmlToMarkdown(db, htmlToMarkdown)
  const ops = createDocsOps(db, { act: () => ({ results: [] }) })
  const { ref } = ops.create('a', { title: 'n' + Math.random(), md: '앞 글' }, 'person')
  return { db, ops, ref }
}

test('append: 같은 onceKey 는 한 번만, 그 뒤 옛 버전으로 와도 409 가 아니라 duplicate', () => {
  const { db, ops, ref } = setup()
  try {
    const v = ops.note('a', ref).version
    const first = ops.write('a', { ref, mode: 'append', md: '### 질문\n\n답', expectedVersion: v, onceKey: 'run:r1' }, 'person')
    expect(first.applied).toBe(1)
    expect(first.duplicate).toBeUndefined()
    const again = ops.write('a', { ref, mode: 'append', md: '### 질문\n\n답', expectedVersion: v, onceKey: 'run:r1' }, 'person')
    expect(again).toMatchObject({ applied: 0, duplicate: true, version: first.version })
    expect(ops.note('a', ref).md.match(/### 질문/g)?.length).toBe(1)
  } finally { stopDocsRefresh(db); db.close() }
})

test('onceKey 가 있으면 본문 포함으로 판정하지 않아요(비슷한 글이 있어도 이 실행의 첫 쓰기는 들어가요)', () => {
  const { db, ops, ref } = setup()
  try {
    ops.write('a', { ref, mode: 'append', md: '답' }, 'person')
    const r = ops.write('a', { ref, mode: 'append', md: '답', onceKey: 'run:r2' }, 'person')
    expect(r.applied).toBe(1)
  } finally { stopDocsRefresh(db); db.close() }
})

test('replace 도 같은 onceKey 는 한 번만(결과를 모른 뒤 다시 보내도 두 번 붙지 않음)', () => {
  const { db, ops, ref } = setup()
  try {
    const v = ops.note('a', ref).version
    const r1 = ops.write('a', { ref, mode: 'replace', md: '앞 글\n\n초안', expectedVersion: v, onceKey: 'run:d1' }, 'person')
    expect(r1.applied).toBe(1)
    const now = ops.note('a', ref)
    const r2 = ops.write('a', { ref, mode: 'replace', md: now.md + '\n\n초안', expectedVersion: now.version, onceKey: 'run:d1' }, 'person')
    expect(r2).toMatchObject({ applied: 0, duplicate: true })
    expect(ops.note('a', ref).md).toBe('앞 글\n\n초안')
  } finally { stopDocsRefresh(db); db.close() }
})

test('다른 노트·다른 사람의 같은 키는 따로예요, 롤백되면 기록도 남지 않아요', () => {
  const { db, ops, ref } = setup()
  try {
    const other = ops.create('a', { title: 'm' + Math.random(), md: 'x' }, 'person').ref
    expect(ops.write('a', { ref, mode: 'append', md: '하나', onceKey: 'run:k' }, 'person').applied).toBe(1)
    expect(ops.write('a', { ref: other, mode: 'append', md: '하나', onceKey: 'run:k' }, 'person').applied).toBe(1)
    expect(() => db.transaction(() => { ops.write('a', { ref, mode: 'append', md: '둘', onceKey: 'run:roll' }, 'person'); throw Error('rollback') })()).toThrow('rollback')
    expect(ops.write('a', { ref, mode: 'append', md: '둘', onceKey: 'run:roll' }, 'person').applied).toBe(1)
  } finally { stopDocsRefresh(db); db.close() }
})

test('REST 는 onceKey 를 받고(문자열 200자까지), 틀린 모양은 400', async () => {
  const { db, ops, ref } = setup()
  try {
    const call = async (body: unknown) => {
      const url = new URL('http://local/api/docs/' + encodeURIComponent(ref) + '/write')
      const res = (await docsApi(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), url, { email: 'a', agent: false }, url.pathname.split('/').filter(Boolean), ops))!
      return { status: res.status, body: await res.json() as Record<string, unknown> }
    }
    expect((await call({ mode: 'append', md: 'r', onceKey: 'run:x' })).body.applied).toBe(1)
    expect((await call({ mode: 'append', md: 'r', onceKey: 'run:x' })).body).toMatchObject({ applied: 0, duplicate: true })
    expect((await call({ mode: 'append', md: 'r', onceKey: 5 })).status).toBe(400)
    expect((await call({ mode: 'append', md: 'r', onceKey: 'k'.repeat(201) })).status).toBe(400)
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 3) onceKey 와 idempotencyKey 는 섞이지 않아요: 영수증 키가 내부 이름과 같아도 onceKey 는 따로 판정', () => {
  const { db, ops, ref } = setup()
  try {
    // 기존 영수증(idempotencyKey) — 같은 요청은 첫 결과를 다시 줘요(호환)
    const r1 = ops.write('a', { ref, mode: 'append', md: '영수증', idempotencyKey: 'once\u0000run:z' }, 'person')
    expect(ops.write('a', { ref, mode: 'append', md: '영수증', idempotencyKey: 'once\u0000run:z' }, 'person')).toEqual(r1)
    // 같은 글자의 onceKey 는 그 영수증과 상관없이 처음이라 적용돼요
    const o = ops.write('a', { ref, mode: 'append', md: '한 번', onceKey: 'run:z' }, 'person')
    expect(o.applied).toBe(1)
    expect(o.duplicate).toBeUndefined()
    // 반대로 onceKey 기록이 영수증 조회에 걸리지 않아요
    const r2 = ops.write('a', { ref, mode: 'append', md: '다른 영수증', idempotencyKey: 'run:z' }, 'person')
    expect(r2.applied).toBe(1)
  } finally { stopDocsRefresh(db); db.close() }
})

test('(리뷰 3) 노트 원문 응답이 onceKey 지원을 알려요(앱은 이것이 없으면 결과 불명 뒤 자동으로 다시 보내지 않아요)', () => {
  const { db, ops, ref } = setup()
  try {
    expect(ops.note('a', ref).onceKey).toBe(true)
  } finally { stopDocsRefresh(db); db.close() }
})
