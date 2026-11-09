import { describe, expect, test } from 'bun:test'
import { storeProblemCopy } from './storedHook'

// 화면 설정 문제 안내 글(리뷰 23·24 P2): 깨짐이면 초기화 길, 읽기 실패면 다시 읽기만(값이 멀쩡할 수 있어요)
describe('화면 설정 문제 안내 글(storeProblemCopy)', () => {
  test('깨짐: 손상 안내 + 초기화(확인창 문구)', () => {
    const c = storeProblemCopy('집중 모드', 'corrupt')
    expect(c.text).toBe('집중 모드가 기기에서 깨져 있어요 · 초기화하면 처음 값으로 돌아가요')
    expect(c.reset).toEqual({ title: '집중 모드를 초기화할까요?', message: '깨진 설정을 지우고 처음 값으로 돌려요. 되돌릴 수 없어요.' })
  })
  test('읽기 실패: 다시 읽기만', () => {
    const c = storeProblemCopy('오늘 메인', 'read')
    expect(c.text).toBe('오늘 메인을 기기에서 읽지 못했어요 · 다시 읽어 주세요')
    expect(c.reset).toBeNull()
  })
})
