import { describe, expect, test } from 'bun:test'
import type { Draft } from '@direction-board/contracts/quick-add'
import { aiAllowed, closeGuard, pendingFrom } from './quick/recovery'

// PR #39 리뷰 16(0a1d582) P1-2: iOS 상세 시트 뒤로 가기에서 closeGuard 가 없으면 기록을 지웠어요 — 확실한 거절(failed/item) 기록에도 아직 안 보낸 노트가 있어요.
const draft: Draft = { boardId: 'b', kind: 'todo', title: '회의 준비', at: null, areaId: null, tags: [], note: '아직 안 보낸 사람 노트', props: [] }
const failedItem = pendingFrom({ kind: 'failed', ref: null, id: 'q1', at: 'item', scope: 's' }, draft, '')
describe('(리뷰 16 P1-2) 확실한 거절 기록도 닫기·뒤로에서 확인, ✦ 막힘', () => {
  test('failed/item 기록: 닫기 확인 글이 있어요(없으면 화면이 확인 없이 지웠어요)', () => {
    expect(failedItem.draft.note).toBe('아직 안 보낸 사람 노트')
    expect(closeGuard(failedItem)).not.toBeNull()
  })
  test('기록이 있는 동안 ✦ 는 막혀요(✦ 가 기록을 지우던 길)', () => {
    expect(aiAllowed(failedItem)).toBe(false)
  })
})
