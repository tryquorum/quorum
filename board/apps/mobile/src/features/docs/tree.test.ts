import { expect, test } from 'bun:test'
import type { SearchHit } from '@direction-board/contracts'
import { siblingMove, visibleLines, type Branch } from './tree'

const hit = (ref: string, parent: string | null, children = 0) => ({ ref, kind: 'doc', title: ref, status: 'open', parent, children }) as unknown as SearchHit

test('펼친 가지만 줄에 나오고 깊이가 붙어요', () => {
  const branches: Record<string, Branch> = {
    root: { items: [hit('doc:a', null, 1), hit('doc:b', null)], state: 'ok', next: 'c1' },
    'doc:a': { items: [hit('doc:a1', 'doc:a')], state: 'ok' },
  }
  expect(visibleLines(branches, new Set()).map((l) => (l.type === 'doc' ? l.hit.ref : l.type))).toEqual(['doc:a', 'doc:b', 'more'])
  const open = visibleLines(branches, new Set(['doc:a']))
  expect(open.map((l) => (l.type === 'doc' ? `${l.hit.ref}@${l.level}` : l.type))).toEqual(['doc:a@1', 'doc:a1@2', 'doc:b@1', 'more'])
})

test('읽는 중·오류인 가지의 줄은 stale, 빈 맨 위는 빈 줄', () => {
  const lines = visibleLines({ root: { items: [hit('doc:a', null)], state: 'loading' } }, new Set())
  expect(lines[0].type === 'doc' && lines[0].stale).toBe(true)
  expect(visibleLines({ root: { items: [], state: 'error' } }, new Set()).map((l) => l.type)).toEqual(['error'])
  expect(visibleLines({ root: { items: [], state: 'ok' } }, new Set()).map((l) => l.type)).toEqual(['empty'])
})

test('위로·아래로 한 칸: 같은 부모의 before/after, 끝에서는 null', () => {
  const sib = [hit('doc:a', 'doc:p'), hit('doc:b', 'doc:p'), hit('doc:c', 'doc:p')]
  expect(siblingMove(sib, 1, 'up')).toEqual({ ref: 'doc:b', parent: 'doc:p', before: 'doc:a' })
  expect(siblingMove(sib, 1, 'down')).toEqual({ ref: 'doc:b', parent: 'doc:p', after: 'doc:c' })
  expect(siblingMove(sib, 0, 'up')).toBeNull()
  expect(siblingMove(sib, 2, 'down')).toBeNull()
  expect(siblingMove([hit('doc:x', null), hit('doc:y', null)], 1, 'up')).toEqual({ ref: 'doc:y', parent: null, before: 'doc:x' })
})
