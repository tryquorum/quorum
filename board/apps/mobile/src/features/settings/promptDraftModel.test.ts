import { expect, test } from 'bun:test'
import { afterSave, parseDraft, restorable } from './promptDraftModel'

test('지시문 초안: 모양 검사, 서버와 같으면 되살리지 않음, 저장 중 더 쓴 글은 새 rev 로 이어감', () => {
  expect(parseDraft('{"text":"a","rev":3}')).toEqual({ text: 'a', rev: 3 })
  expect(parseDraft('{"text":1,"rev":3}')).toBeNull()
  expect(parseDraft('{"text":"a","rev":1.5}')).toBeNull()
  expect(parseDraft('{bad')).toBeNull()
  expect(restorable({ text: 'a', rev: 1 }, 'a')).toBeNull()
  expect(restorable({ text: 'b', rev: 1 }, 'a')).toEqual({ text: 'b', rev: 1 })
  expect(afterSave('같음', '같음', 4)).toBeNull()
  expect(afterSave('더 씀', '같음', 4)).toEqual({ text: '더 씀', rev: 4 })
})
