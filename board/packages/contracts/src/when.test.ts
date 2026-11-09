import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { W } from './when.ts'

// 옛 when.js 를 가짜 window 에 올려 같은 입력으로 비교해요(웹은 아직 when.js 를 씀)
type Legacy = typeof W
const legacy = (() => {
  const fake: { W?: Legacy } = {}
  new Function('window', readFileSync(resolve(import.meta.dir, '../../../apps/server/public/when.js'), 'utf8'))(fake)
  return fake.W as Legacy
})()

const NOWS = [
  new Date(2026, 10, 7, 10, 0), // 토 오전
  new Date(2026, 10, 7, 18, 30), // 토 저녁
  new Date(2026, 10, 9, 23, 59), // 월 자정 직전
  new Date(2026, 10, 30, 12, 0), // 월말
  new Date(2026, 11, 31, 9, 0), // 연말
  new Date(2028, 1, 28, 15, 0), // 윤년 2월 말
  new Date(2026, 10, 11, 8, 0), // 수
]
const INPUTS = [
  '내일 3시 계약서', '금요일 저녁 회식', '다음주 월 10:30 회의', '11/24 마감', '3일 뒤 연락', '2시간 후 전화', '오늘', '모레 오전 9시',
  '12월 3일까지 보고서', '2026-12-01 출시', '날짜 없는 할 일', '#업무 내일 정리', '주말에 청소', '다음 주말 여행', '다음 주 계획', '정오 점심 약속',
  '아침 운동', '밤 11시 정리', '오후 12시 반', '13/40 이상한 날짜', '30분 뒤 알림', '1주 후 점검', '2개월 후 갱신', '수요일', '이번주 금 발표',
  '다다음주 화요일', '3시', '7시 저녁', '25:00 잘못', '글피', '낼 2시 30분', '1월 1일', '2/29', '오전 12시', 'C#언어 3시',
]
const VALUES = ['2026-11-07', '2026-11-07T15:00', '2026-11-06', '2026-11-05', '2026-11-08T09:00', '2026-11-12', '2026-11-20T10:30', '2027-01-03', '2025-12-31T23:00']

describe('when.ts 가 when.js 와 같음', () => {
  for (const now of NOWS) {
    test(`parse · ${now.toString().slice(0, 21)}`, () => {
      for (const t of INPUTS) expect([t, W.parse(t, now)]).toEqual([t, legacy.parse(t, now)])
    })
    test(`short·long·quick · ${now.toString().slice(0, 21)}`, () => {
      for (const v of VALUES) {
        expect([v, W.short(v, now)]).toEqual([v, legacy.short(v, now)])
        expect([v, W.long(v, now)]).toEqual([v, legacy.long(v, now)])
      }
      expect(W.quick(now)).toEqual(legacy.quick(now))
    })
  }
  test('예제가 실제로 날짜를 알아봐요(빈 대조가 아님)', () => {
    expect(W.parse('내일 3시 계약서', new Date(2026, 10, 7, 10, 0))).toEqual({ at: '2026-11-08T15:00', title: '계약서', spans: [[0, 2], [3, 5]] })
  })
})
