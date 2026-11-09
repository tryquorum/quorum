import { test, expect } from 'bun:test'
import { firstImage, plainExcerpt } from './preview.ts'
import { legacyDb } from './storage.test.ts'
import { initDocs, stopDocsRefresh } from './storage.ts'
import { createDocsOps } from './ops.ts'

test('plain excerpt drops markdown syntax, code and images and keeps link labels', () => {
  const md = '# 계약 정리\n\n- [ ] **서명본** 받기 [[doc:1|계약서]]와 [[회의록]]\n> 인용 `코드` [링크](https://x.y)\n![그림](/api/files/a.png)\n```ts\nconst secret = 1\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n<b>굵게</b>'
  expect(plainExcerpt(md)).toBe('계약 정리 서명본 받기 계약서와 회의록 인용 코드 링크 a b 1 2 굵게')
  expect(plainExcerpt('')).toBe('')
})

test('plain excerpt is at most 160 characters without splitting emoji', () => {
  const long = '😀'.repeat(200)
  const out = plainExcerpt(long)
  expect(Array.from(out).length).toBe(160)
  expect(out.endsWith('\ud83d')).toBe(false)
})

test('first image accepts http(s) and server paths only, skipping code blocks', () => {
  expect(firstImage('글\n```\n![x](https://code.example/a.png)\n```\n![a](/api/files/b.png "제목") ![c](https://c.example/c.png)')).toBe('/api/files/b.png')
  expect(firstImage('![a](data:image/png;base64,AAAA) ![b](//evil.example/x.png) ![c](javascript:alert(1)) ![d](rel.png)')).toBeNull()
  expect(firstImage('<img alt="x" src="https://img.example/p.jpg">')).toBe('https://img.example/p.jpg')
  expect(firstImage('그림 없음')).toBeNull()
})

test('search hits carry excerpt and cover while keeping existing fields', () => {
  const db = legacyDb(); initDocs(db); const ops = createDocsOps(db, { act: () => ({ results: [] }) })
  const withImage = ops.create('a', { title: '사진 문서', md: '## 첫 줄\n![표지](/api/files/cover.png)\n본문 내용' }, 'person')
  const plain = ops.create('a', { title: '글 문서', md: '그냥 **글**' }, 'person')
  const hits = ops.search('a', {}).results
  const a = hits.find((h) => h.ref === withImage.ref), b = hits.find((h) => h.ref === plain.ref)
  expect(a?.excerpt).toBe('첫 줄 본문 내용')
  expect(a?.cover).toBe('/api/files/cover.png')
  expect(b?.excerpt).toBe('그냥 글')
  expect(b?.cover).toBeNull()
  expect(Object.keys(a ?? {})).toEqual(expect.arrayContaining(['ref', 'kind', 'title', 'snippet', 'tags', 'personEdited', 'area', 'status', 'due', 'props', 'updatedAt', 'path']))
  stopDocsRefresh(db); db.close()
})
