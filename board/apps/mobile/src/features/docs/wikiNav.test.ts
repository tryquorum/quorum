import { expect, test } from 'bun:test'
import type { SearchHit } from '@direction-board/contracts'
import type { DocFilters } from '../../api/docs'
import { resolveWiki } from './wikiNav'

const hit = (ref: string, title: string) => ({ ref, title, kind: 'doc', status: 'open' }) as unknown as SearchHit
const search = (pages: Record<string, { results: SearchHit[]; nextCursor?: string }[]>) => async (f: DocFilters) => {
  const list = pages[f.status || 'open'] ?? [{ results: [] }]
  return list[f.cursor ? Number(f.cursor) : 0] ?? { results: [] }
}

test('ref 모양은 찾지 않고 바로 열어요', async () => {
  expect(await resolveWiki(' doc:abc ', async () => { throw new Error('no search') })).toEqual({ type: 'open', ref: 'doc:abc', title: 'doc:abc' })
})
test('정확히 하나면 열고, 둘이면 고르기, 비슷한 제목은 세지 않아요', async () => {
  expect(await resolveWiki('회의', search({ open: [{ results: [hit('doc:a', '회의'), hit('doc:b', '회의록')] }] }))).toMatchObject({ type: 'open', ref: 'doc:a' })
  const two = await resolveWiki('회의', search({ open: [{ results: [hit('doc:a', '회의')] }], archived: [{ results: [hit('doc:z', '회의')] }] }))
  expect(two.type === 'choose' && two.hits.map((h) => h.ref)).toEqual(['doc:a', 'doc:z'])
})
test('5쪽 넘게 이어지면 일부만 확인했다고 알려요(하나여도 바로 열지 않음)', async () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({ results: i === 0 ? [hit('doc:a', '회의')] : [], nextCursor: String(i + 1) }))
  expect(await resolveWiki('회의', search({ open: pages }))).toMatchObject({ type: 'choose', partial: true })
  expect(await resolveWiki('없음', search({}))).toEqual({ type: 'none', partial: false })
})
