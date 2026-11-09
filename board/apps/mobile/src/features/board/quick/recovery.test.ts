import { describe, expect, test } from 'bun:test'
import type { Draft, Step } from '@direction-board/contracts/quick-add'
import { pendingFrom, retryPlan, inputLocked, type NotDone } from './recovery'

// 빠른 추가 화면(한 줄·시트·목표 할 일)의 실패 기록과 다시 시도 판단(리뷰 3): 시작 범위를 같이 저장하고 그 범위에서만 이어요,
// 결과 불명이면 내용을 고정해요(바꾼 제목이 이미 저장된 항목에 조용히 무시되지 않게).
const A = 'https://board.test|a@x.test'
const B = 'https://board.test|b@x.test'
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '', props: [] }
const res = (p: { kind?: 'failed' | 'unknown' | 'scope'; at?: Step; ref?: string | null } = {}): NotDone & { scope: string } => ({ kind: 'failed', ref: null, id: 'i1', at: 'item', scope: A, ...p })

describe('실패 기록', () => {
  test('시작 범위·id·단계·초안·글을 같이 남겨요', () => {
    expect(pendingFrom(res({ kind: 'unknown' }), draft, '회의 준비')).toEqual({ id: 'i1', from: 'item', draft, text: '회의 준비', ref: null, unknown: true, scope: A })
  })
  test('사람 값과 부딪친 노트·속성(conflict)도 기록으로 남아 다시 확인만', () => {
    const p = pendingFrom({ kind: 'conflict', ref: 'item:b:i1', id: 'i1', at: 'props', scope: A }, draft, '회의 준비')
    expect(p).toMatchObject({ from: 'props', checked: 'conflict', ref: 'item:b:i1' })
  })
})

describe('다시 시도', () => {
  const p = pendingFrom(res({ kind: 'unknown' }), draft, '회의 준비')
  test('같은 범위면 그 범위·같은 id·같은 초안으로 이어요', () => {
    expect(retryPlan(p, '회의 준비', A)).toEqual({ kind: 'resume', draft, resume: { id: 'i1', from: 'item', scope: A } })
  })
  test('다른 계정이면 보내지 않고 안내(원래 계정으로 돌아가면 이어요)', () => {
    expect(retryPlan(p, '회의 준비', B)).toEqual({ kind: 'other-scope', message: '다른 계정에서 시작한 추가예요 · 그 계정으로 돌아가면 이어서 저장해요' })
  })
  test('결과 불명이면 글을 바꿔도 새로 만들지 않고 고정된 초안으로 이어요(입력도 잠가요)', () => {
    expect(inputLocked(p)).toBe(true)
    expect(retryPlan(p, '회의 준비 (고침)', A)).toEqual({ kind: 'resume', draft, resume: { id: 'i1', from: 'item', scope: A } })
  })
  test('항목이 거절된 실패(결과를 앎)는 글을 바꾸면 새 추가', () => {
    const q = pendingFrom(res({}), draft, '회의 준비')
    expect(inputLocked(q)).toBe(false)
    expect(retryPlan(q, '다른 일', A)).toEqual({ kind: 'new' })
  })
  test('앞 단계가 저장된 부분 완료는 잠그고 같은 초안으로 이어요', () => {
    const q = pendingFrom(res({ at: 'tags', ref: 'item:b:i1' }), draft, '회의 준비')
    expect(inputLocked(q)).toBe(true)
    expect(retryPlan(q, '아무거나', A)).toMatchObject({ kind: 'resume', resume: { from: 'tags', scope: A } })
  })
  test('범위가 바뀌어 멈춘 기록도 시작 범위로만', () => {
    const q = pendingFrom(res({ kind: 'scope', at: 'note', ref: 'item:b:i1' }), draft, '회의 준비')
    expect(retryPlan(q, '회의 준비', B).kind).toBe('other-scope')
    expect(retryPlan(q, '회의 준비', A).kind).toBe('resume')
  })
})

import { SmallStore } from '../smallStore'
import { aiAllowed, closeGuard, isSlots, putSlot, slotGate, SLOTS } from './recovery'

// (리뷰 4) 빠른 추가 실패 기록은 범위별 기기 저장(SmallStore = 서버·로그인 범위)에 자리(slot)별로 영속해요:
// 시트를 닫거나 앱을 다시 열어도 같은 id·단계·초안·시작 범위로 이어가요.
describe('(리뷰 4) 실패 기록 영속', () => {
  const memory = () => {
    const files: Record<string, string> = {}
    return { files, io: { read: async (n: string) => files[n] ?? null, write: async (n: string, t: string) => void (files[n] = t) } }
  }
  test('시트 자리의 기록은 앱을 다시 열어도(새 저장소) 그대로', async () => {
    const m = memory()
    const s1 = new SmallStore(m.io)
    await s1.load(SLOTS, isSlots)
    const p = pendingFrom(res({ kind: 'unknown' }), draft, '회의 준비')
    s1.set(SLOTS, putSlot(s1.get(SLOTS, {}), 'sheet', p))
    await s1.flush()
    const s2 = new SmallStore(m.io)
    await s2.load(SLOTS, isSlots)
    expect(s2.get<Record<string, unknown>>(SLOTS, {}).sheet).toEqual(p)
    expect(retryPlan(s2.get<Record<string, typeof p>>(SLOTS, {}).sheet!, '', A)).toEqual({ kind: 'resume', draft, resume: { id: 'i1', from: 'item', scope: A } })
  })
  test('끝나면 그 자리만 지워요(다른 자리는 그대로)', () => {
    const p = pendingFrom(res({}), draft, '회의 준비')
    const both = putSlot(putSlot({}, 'sheet', p), 'bar', p)
    expect(Object.keys(putSlot(both, 'sheet', null))).toEqual(['bar'])
  })
  test('깨진 기록은 버려요', () => {
    expect(isSlots({ sheet: { id: 1 } })).toBe(false)
    expect(isSlots({ sheet: pendingFrom(res({}), draft, 'x') })).toBe(true)
  })
})

describe('(리뷰 4) 닫기·✦', () => {
  test('기록이 있으면 결과 종류와 무관하게 닫을 때 확인 안내(리뷰 16 — 확실한 실패 기록에도 아직 안 보낸 초안), 기록이 없으면 그냥 닫아요', () => {
    expect(closeGuard(pendingFrom(res({ kind: 'unknown' }), draft, 'x'))).toBe('결과를 확인하지 못한 추가가 있어요 · 닫아도 기록은 남아 다음에 같은 내용으로 이어서 해요')
    expect(closeGuard(pendingFrom(res({ at: 'tags', ref: 'item:b:i1' }), draft, 'x'))).not.toBeNull()
    expect(closeGuard(pendingFrom(res({}), draft, 'x'))).toBe('저장하지 못한 추가가 있어요 · 닫아도 기록(쓴 내용)은 남아 다음에 열면 이어서 써요')
    expect(closeGuard(null)).toBeNull()
  })
  test('기록이 있는 동안 ✦ 는 막아요(누르면 기록을 지우던 길을 닫음 — 리뷰 16 부터 확실한 실패 기록도)', () => {
    expect(aiAllowed(pendingFrom(res({ kind: 'unknown' }), draft, 'x'))).toBe(false)
    expect(aiAllowed(pendingFrom(res({}), draft, 'x'))).toBe(false)
    expect(aiAllowed(null)).toBe(true)
  })
})

// 리뷰 6 P1: 기록을 못 읽었거나 깨졌으면 '기록 없음'으로 보지 않고 그 자리의 새 제출을 막아요(다시 읽기·버리고 새로).
// 기록을 못 남겼으면(쓰기 실패) 막지는 않되 확인을 요청해요.
describe('(리뷰 6) 기록 자리 상태', () => {
  test('읽기 전·읽기 실패·깨짐은 제출을 막고, 실패·깨짐은 안내와 다시 읽기·버리고 새로', () => {
    expect(slotGate({ ready: false, problem: null, writeFailed: false })).toEqual({ canSubmit: false, notice: null })
    expect(slotGate({ ready: true, problem: 'read', writeFailed: false })).toEqual({ canSubmit: false, notice: { kind: 'read', text: '빠른 추가 복구 기록을 읽지 못했어요 · 다시 읽거나, 버리고 새로 쓸 수 있어요(앞의 요청이 저장됐을 수 있어요)' } })
    expect(slotGate({ ready: true, problem: 'corrupt', writeFailed: false }).canSubmit).toBe(false)
    expect(slotGate({ ready: true, problem: 'corrupt', writeFailed: false }).notice?.kind).toBe('corrupt')
  })
  test('쓰기 실패는 제출은 두고 확인 요청', () => {
    const g = slotGate({ ready: true, problem: null, writeFailed: true })
    expect(g.canSubmit).toBe(true)
    expect(g.notice?.kind).toBe('write')
    expect(g.notice?.text).toContain('목록에서 저장됐는지 확인')
  })
  test('문제가 없으면 그대로', () => {
    expect(slotGate({ ready: true, problem: null, writeFailed: false })).toEqual({ canSubmit: true, notice: null })
  })
})
