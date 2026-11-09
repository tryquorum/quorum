import { expect, test } from 'bun:test'
import type { RelatedResult } from '@direction-board/contracts'
import { buildColumns, type DocLite } from './columns'

const doc = (ref: string, kind: string, area: string | null, tags: string[] = []): DocLite => ({ ref, kind: kind as DocLite['kind'], title: ref, status: 'open', area, tags: tags.map((tag) => ({ tag, by: 'person' })) })
const docs = [doc('doc:a', 'doc', '업무', ['프로젝트/방향판']), doc('doc:b', 'doc', null, ['프로젝트']), doc('item:x:1', 'todo', '업무'), doc('doc:c', 'doc', '가족')]

test('종류 → 영역 → 문서, 고른 문서는 미리보기 열', () => {
  const r = buildColumns('kind', docs, ['kind:doc', 'area:', 'doc:doc:b'], {})
  const labels = r.columns.map((c) => c.label)
  expect(labels).toEqual(['종류', '문서의 영역', '영역 없음의 문서', 'doc:b 미리보기'])
  const first = r.columns[0]
  expect(first.type === 'list' && first.entries.map((e) => [e.label, e.count])).toEqual([['할 일', 1], ['문서', 3]])
  const areas = r.columns[1]
  expect(areas.type === 'list' && areas.entries.map((e) => e.label)).toEqual(['가족', '업무', '영역 없음'])
})

test('태그 계층: / 단계와 문서 수, 태그 없음', () => {
  const r = buildColumns('tag', docs, ['tag:프로젝트'], {})
  const root = r.columns[0]
  expect(root.type === 'list' && root.entries.map((e) => [e.label, e.count])).toEqual([['프로젝트', 2], ['태그 없음', 2]])
  const second = r.columns[1]
  expect(second.type === 'list' && second.entries.map((e) => e.label)).toEqual(['방향판', 'doc:b'])
})

test('링크 축: 나가는 링크·역링크 절, 지나온 문서는 순환 표시, 잘림', () => {
  const rel: RelatedResult = { edges: [{ label: '언급', direction: 'out', node: { ref: 'doc:c', kind: 'doc', title: 'C', status: 'open' } }, { label: '언급', direction: 'in', node: { ref: 'doc:a', kind: 'doc', title: 'A', status: 'open' } }], truncated: true }
  const r = buildColumns('link', docs, ['doc:doc:a', 'in:doc:a'], { 'doc:a': rel })
  const links = r.columns[1]
  expect(links.type === 'list' && links.entries.map((e) => [e.section, e.label, !!e.cycle])).toEqual([['나가는 링크', 'C', false], ['역링크', 'A', true]])
  expect(links.type === 'list' && links.truncated).toBe(true)
})

test('맞지 않는 경로 key 부터 뒤는 버려요', () => {
  const r = buildColumns('kind', docs, ['kind:goal', 'area:업무'], {})
  expect(r.path).toEqual([])
  expect(r.columns).toHaveLength(1)
})

test('폴더 축: 자식이 있는 문서는 미리보기 대신 자식 열, 다음 쪽 표시', () => {
  const root = { results: [{ ...doc('doc:p', 'doc', null), children: 2, snippet: '', personEdited: true, due: null, props: [], updatedAt: 1, path: null }], total: 3, nextCursor: 'n' }
  const r = buildColumns('folder', [], ['doc:doc:p'], {}, { root: root as never, 'doc:p': 'loading' })
  expect(r.columns.map((c) => c.type === 'list' && [c.label, c.state ?? 'ok', c.more ?? ''])).toEqual([['맨 위', 'ok', 'root'], ['doc:p', 'loading', '']])
})
