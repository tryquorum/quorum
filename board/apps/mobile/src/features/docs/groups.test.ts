import { expect, test } from 'bun:test'
import { gridRows, groupDocs } from './groups'

const d = (kind: string, status: string, area: string | null) => ({ kind, status, area })

test('종류·상태는 고정 순서, 영역은 가나다·영역 없음 맨 뒤', () => {
  const docs = [d('doc', 'done', null), d('todo', 'open', '업무'), d('signal', 'archived', '가족'), d('goal', 'open', '업무')]
  expect(groupDocs(docs, 'kind').map((g) => g.label)).toEqual(['할 일', '목표', '사건', '문서'])
  expect(groupDocs(docs, 'status').map((g) => g.label)).toEqual(['열림', '끝남', '보관'])
  expect(groupDocs(docs, 'area').map((g) => [g.label, g.items.length])).toEqual([['가족', 1], ['업무', 2], ['영역 없음', 1]])
  expect(groupDocs(docs, 'none')[0].items).toHaveLength(4)
})

test('격자 줄: 묶음 머리와 열 수만큼 카드', () => {
  const groups = [{ key: 'a', label: 'A', items: [1, 2, 3] }, { key: 'b', label: 'B', items: [4] }]
  expect(gridRows(groups, 2, true).map((r) => (r.type === 'head' ? r.label : r.items))).toEqual(['A', [1, 2], [3], 'B', [4]])
  expect(gridRows(groups, 3, false).map((r) => (r.type === 'cards' ? r.items : r.label))).toEqual([[1, 2, 3], [4]])
})
