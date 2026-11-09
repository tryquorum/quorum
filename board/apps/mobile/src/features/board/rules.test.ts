import { describe, expect, test } from 'bun:test'
import type { Board, Collector, Item, Signal } from '@direction-board/contracts'
import { toTasks } from '@direction-board/contracts/tasks'
import { collectorState, currentBoard, filterTasks, groupTasks, homeGroups, mainCandidates, mainKeysOf, toggleMainKey, upcoming } from './rules'

const NOW = new Date(2026, 10, 7, 10, 0).getTime() // 토 10:00
const item = (p: Partial<Item>): Item => ({ id: 'i', boardId: 'b', type: 'todo', text: '할 일', x: 0, y: 0, w: 1, h: 1, done: false, ...p })
const sig = (p: Partial<Signal>): Signal => ({ id: 's', ref: null, source: 'github', kind: 'info', title: '사건', body: null, url: null, area: null, task: null, agent: null, lane: 'decide', reason: null, needs_ai: false, status: 'open', private: false, sample: false, due: null, meta: null, created_at: 1, updated_at: NOW - 1000, resolved_at: null, ...p })
const board = (p: Partial<Board>): Board => ({ id: 'b', name: '개인', kind: 'personal', mine: true, deleted: false, areas: [{ id: 'a1', name: '업무', color: '#0a0' }], ...p })

describe('오늘 메인', () => {
  test('날짜가 바뀌면 비어요', () => {
    expect(mainKeysOf({ day: new Date(NOW).toDateString(), keys: ['i:b:1'] }, new Date(NOW).toDateString())).toEqual(['i:b:1'])
    expect(mainKeysOf({ day: 'Fri Nov 06 2026', keys: ['i:b:1'] }, new Date(NOW).toDateString())).toEqual([])
  })
  test('안 끝난 메인이 3개면 더 못 골라요, 끝낸 것은 세지 않아요', () => {
    const open = new Set(['a', 'b', 'c', 'd'])
    expect(toggleMainKey(['a', 'b', 'c'], 'd', open)).toBeNull()
    expect(toggleMainKey(['a', 'b', 'x'], 'd', open)).toEqual(['a', 'b', 'x', 'd'])
    expect(toggleMainKey(['a', 'b', 'c'], 'b', open)).toEqual(['a', 'c'])
  })
  test('후보: 오늘까지 알림 할 일·2일 안 목표·main 칸 사건, 이미 메인과 끝낸 것은 빼요', () => {
    const items = [
      item({ id: '1', text: '오늘 밤', remindAt: '2026-11-07T23:00' }),
      item({ id: '2', text: '내일', remindAt: '2026-11-08T09:00' }),
      item({ id: '3', type: 'goal', text: '모레 목표', due: '2026-11-08' }),
      item({ id: '4', type: 'goal', text: '먼 목표', due: '2026-11-09' }), // 그날 끝(23:59)이 48시간 밖
      item({ id: '5', text: '끝낸 일', remindAt: '2026-11-07T08:00', done: true }),
      item({ id: '6', text: '고른 일', remindAt: '2026-11-07T08:00' }),
    ]
    const c = mainCandidates(items, [sig({ id: 'm', lane: 'main', title: '메인 후보 사건' })], ['i:b:6'], NOW)
    expect(c.map((x) => x.title).sort()).toEqual(['메인 후보 사건', '모레 목표', '오늘 밤'].sort())
  })
})

describe('홈 묶음', () => {
  test('칸별로 나누고 하는 중은 task 로 한 번만, AI가 처리함은 24시간', () => {
    const g = homeGroups([
      sig({ id: '1', lane: 'now' }), sig({ id: '2', lane: 'decide' }), sig({ id: 'h', lane: 'decide' }),
      sig({ id: '3', lane: 'running', task: 't' }), sig({ id: '4', lane: 'running', task: 't' }),
      sig({ id: '5', lane: 'review', updated_at: NOW - 10 }), sig({ id: '6', lane: 'review', updated_at: NOW - 5 }),
      sig({ id: '7', lane: 'auto', updated_at: NOW - 3600e3 }), sig({ id: '8', lane: 'auto', updated_at: NOW - 25 * 3600e3 }),
      sig({ id: '9', lane: 'decide', status: 'resolved' }),
    ], new Set(['h']), NOW)
    expect([g.now.map((s) => s.id), g.decide.map((s) => s.id), g.running.map((s) => s.id), g.review.map((s) => s.id), g.autoDone.map((s) => s.id)]).toEqual([['1'], ['2'], ['3'], ['6', '5'], ['7']])
  })
  test('마감: 마감 사건과 기한 있는 목표, 하루 지난 것까지, 6개', () => {
    const list = upcoming(
      [sig({ id: 'd', kind: 'deadline', lane: 'info', due: NOW + 3600e3, title: '과제' }), sig({ id: 'o', kind: 'deadline', lane: 'info', due: NOW - 3 * 864e5, title: '오래됨' })],
      [item({ id: 'g', type: 'goal', text: '목표', due: '2026-11-10' }), item({ id: 'x', type: 'goal', text: '끝난 목표', due: '2026-11-10', done: true })],
      NOW,
    )
    expect(list.map((x) => x.title)).toEqual(['과제', '목표'])
  })
  test('수집기: 실패이거나 주기의 3배 동안 조용하면 문제', () => {
    const c = (p: Partial<Collector>): Collector => ({ name: 'gmail', ok: 1, note: null, last_seen: NOW - 60e3, last_ok: null, every_min: 10, sample: 0, ...p })
    expect(collectorState(c({}), NOW)).toEqual({ bad: false, note: '정상' })
    expect(collectorState(c({ last_seen: NOW - 31 * 60e3 }), NOW)).toEqual({ bad: true, note: '소식 없음' })
    expect(collectorState(c({ ok: 0, note: '토큰 만료' }), NOW)).toEqual({ bad: true, note: '토큰 만료' })
  })
})

describe('전체 목록', () => {
  const items = [
    item({ id: '1', text: '지난 일', remindAt: '2026-11-06T09:00' }),
    item({ id: '2', text: '오늘 일', remindAt: '2026-11-07T23:00', area: 'a1' }),
    item({ id: '3', text: '이번 주', remindAt: '2026-11-13T09:00' }),
    item({ id: '4', text: '나중', remindAt: '2026-11-20T09:00' }),
    item({ id: '5', text: '날짜 없음' }),
    item({ id: '6', text: '끝낸 일', done: true }),
  ]
  const all = toTasks({ items, signals: [], boards: [board({})], boardId: 'b', mainKeys: ['i:b:3'], withDone: true })
  test('시간 묶음은 자정과 7일 경계로 나눠요', () => {
    const g = groupTasks(all, NOW)
    expect([g['지남'], g['오늘'], g['이번 주'], g['나중'], g['날짜 없음']].map((x) => x.map((t) => t.title))).toEqual([['지난 일'], ['오늘 일'], ['이번 주'], ['나중'], ['날짜 없음']])
  })
  test('종류·영역·찾기로 걸러요', () => {
    expect(filterTasks(all, { kind: 'main', area: 'all', q: '' }).map((t) => t.title)).toEqual(['이번 주'])
    expect(filterTasks(all, { kind: 'all', area: '업무', q: '' }).map((t) => t.title)).toEqual(['오늘 일'])
    expect(filterTasks(all, { kind: 'all', area: 'none', q: '나' }).map((t) => t.title)).toEqual(['나중'])
  })
})

describe('지금 판', () => {
  const p = board({ id: 'p' })
  const c = board({ id: 'c', kind: 'company', mine: false, name: '회사' })
  test('고른 판, 없으면 내 개인 판, 그것도 없으면 첫 판', () => {
    expect(currentBoard([c, p], 'c')?.id).toBe('c')
    expect(currentBoard([c, p], 'gone')?.id).toBe('p')
    expect(currentBoard([c], null)?.id).toBe('c')
    expect(currentBoard([], null)).toBeUndefined()
  })
})
