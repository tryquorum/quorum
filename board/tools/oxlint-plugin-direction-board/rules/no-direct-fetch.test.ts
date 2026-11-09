import { expect, test } from 'bun:test'
import { lint } from './harness.ts'

test('화면에서 직접 fetch 호출을 막아요', () => {
  const result = lint('no-direct-fetch', 'web/src/components/view.tsx', 'window.fetch("/api")')
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('no-direct-fetch')
  expect(lint('no-direct-fetch', 'apps/mobile/src/screens/view.tsx', 'fetch("/api")').status).not.toBe(0)
})
test('API 모듈과 테스트는 허용해요', () => {
  expect(lint('no-direct-fetch', 'apps/mobile/src/api/client.ts', 'fetch("/api")').status).toBe(0)
  expect(lint('no-direct-fetch', 'web/src/components/view.test.tsx', 'fetch("/api")').status).toBe(0)
})
