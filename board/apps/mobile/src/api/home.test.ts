import { describe, expect, test } from 'bun:test'
import type { Item, Signal } from '@direction-board/contracts'
import { homeSignals, sortBoardItems } from './home'
import { normalizeOrigin } from './client'
const signal = (
  id: string,
  lane: Signal['lane'],
  task: string | null = null,
  status: Signal['status'] = 'open',
): Signal => ({
  id,
  lane,
  task,
  status,
  ref: null,
  source: 'test',
  kind: 'test',
  title: id,
  body: null,
  url: null,
  area: null,
  agent: null,
  reason: null,
  needs_ai: false,
  private: false,
  sample: false,
  due: null,
  meta: null,
  created_at: 1,
  updated_at: 1,
  resolved_at: null,
})
describe('홈 분류', () => {
  test('열린 결정과 중복 없는 진행 및 검토만 보여요', () => {
    const result = homeSignals([
      signal('a', 'now'),
      signal('b', 'decide'),
      signal('c', 'running', 'same'),
      signal('d', 'running', 'same'),
      signal('e', 'review'),
      signal('f', 'now', null, 'resolved'),
    ])
    expect(result.decisions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result.running.map((s) => s.id)).toEqual(['c'])
    expect(result.awaiting.map((s) => s.id)).toEqual(['e'])
  })
})
test('서버 원점만 허용해요', () => {
  expect(normalizeOrigin('https://example.com/')).toBe('https://example.com')
  expect(() => normalizeOrigin('https://example.com/path')).toThrow()
  expect(() => normalizeOrigin('https://user:pass@example.com')).toThrow()
})
test('모바일 목록은 시각 있는 항목 → 같은 날 날짜만 있는 항목 → 기약 없는 항목(수동 순서) → 끝낸 항목 순으로 정렬해요', () => {
  const mk = (id: string, extra: Partial<Item> = {}): Item => ({
    id,
    boardId: 'b1',
    type: 'todo',
    text: id,
    x: 0,
    y: 0,
    w: 240,
    h: 90,
    z: 1,
    done: false,
    ...extra,
  })
  const sorted = sortBoardItems([
    mk('done-item', { remindAt: '2026-11-07T08:00', done: true, z: 1 }),
    mk('undated-b', { z: 20 }),
    mk('undated-a', { z: 10 }),
    mk('date-only', { remindAt: '2026-11-07', z: 5 }),
    mk('goal-due', { type: 'goal', due: '2026-11-07', z: 6 }),
    mk('timed-late', { remindAt: '2026-11-07T15:00', z: 99 }),
    mk('timed-early', { remindAt: '2026-11-07T09:30', z: 50 }),
  ])
  expect(sorted.map((i) => i.id)).toEqual([
    'timed-early',
    'timed-late',
    'date-only',
    'goal-due',
    'undated-a',
    'undated-b',
    'done-item',
  ])
})
