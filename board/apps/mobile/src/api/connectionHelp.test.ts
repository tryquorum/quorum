import { expect, test } from 'bun:test'
import { ApiError, NetworkError } from './client'
import { connectionHelp } from './connectionHelp'

test('연결 실패는 이유·주소와 설정으로 가는 길을 보여요', () => {
  const h = connectionHelp(new NetworkError('offline'), 'https://board.example.com')
  expect(h).toEqual({ reason: '서버에 닿지 않아요', address: 'board.example.com', loginFirst: false, offerSettings: true })
})

test('HTTP 오류도 주소를 보여요', () => {
  const h = connectionHelp(new ApiError(500, 'boom', false), 'http://192.168.0.10:3070')
  expect(h.reason).toBe('불러오지 못했어요 (HTTP 500)')
  expect(h.address).toBe('192.168.0.10:3070')
  expect(h.offerSettings).toBe(true)
})

test('로그인이 필요하면 로그인이 먼저이고 주소를 바꾸라고 하지 않아요', () => {
  const h = connectionHelp(new ApiError(302, 'login', true), 'https://board.example.com')
  expect(h.loginFirst).toBe(true)
  expect(h.offerSettings).toBe(false)
  expect(h.reason).toBe('로그인이 필요해요')
})

test('읽을 수 없는 주소는 적힌 그대로', () => {
  expect(connectionHelp(new NetworkError('x'), 'not a url').address).toBe('not a url')
})
