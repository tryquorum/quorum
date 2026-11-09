import { expect, test } from 'bun:test'
import { lint } from './harness.ts'

const origin = ['http://127.0.0.1', '3070'].join(':')
test('화면 코드의 고정 서버 주소를 막아요', () => {
  const result = lint('no-hardcoded-origin', 'web/src/app.ts', `const origin = "${origin}"`)
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('no-hardcoded-origin')
})
test('테스트와 Vite 프록시 설정은 허용해요', () => {
  expect(lint('no-hardcoded-origin', 'web/src/app.test.ts', `const origin = "${origin}"`).status).toBe(0)
  expect(lint('no-hardcoded-origin', 'web/vite.config.ts', `const origin = "${origin}"`).status).toBe(0)
})
test('포트와 상관없이 로컬 HTTP 주소를 막아요', () => {
  for (const address of ['http://localhost', 'https://127.0.0.1:443', 'http://0.0.0.0:1234'])
    expect(lint('no-hardcoded-origin', 'web/src/app.ts', `const origin = "${address}"`).status).not.toBe(0)
})
test('기존 기준선까지 허용하고 초과하면 보고해요', () => {
  const budgets = { backlog: 1 }
  expect(lint('no-hardcoded-origin', 'web/src/app.ts', `const a = "${origin}"`, budgets).status).toBe(0)
  expect(lint('no-hardcoded-origin', 'web/src/app.ts', `const a = "${origin}", b = "${origin}"`, budgets).status).not.toBe(0)
})
