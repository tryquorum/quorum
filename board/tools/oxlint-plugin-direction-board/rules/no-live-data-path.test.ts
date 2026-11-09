import { expect, test } from 'bun:test'
import { lint } from './harness.ts'

const live = ['data', 'board.db'].join('/')
test('테스트의 실제 DB 경로를 막아요', () => {
  const result = lint('no-live-data-path', 'sample.test.ts', `const path = "${live}"`)
  expect(result.status).not.toBe(0)
  expect(result.output).toContain('no-live-data-path')
})
test('임시 경로와 제품 코드는 허용해요', () => {
  expect(lint('no-live-data-path', 'sample.test.ts', 'const path = "/tmp/test.db"').status).toBe(0)
  expect(lint('no-live-data-path', 'sample.ts', `const path = "${live}"`).status).toBe(0)
})
test('분리된 경로와 SQLite 보조 파일을 막아요', () => {
  for (const source of [
    'join(root, "data", "board.db")', 'join(root, "data", "board.db-wal")',
    'join(root, "data", "board.db-shm")', 'join(root, "data", "vault")',
    '"data/board.db-wal"', '"data/board.db-shm"', '"data/vault"',
  ]) expect(lint('no-live-data-path', 'sample.test.ts', source).status).not.toBe(0)
})
test('기준선까지 허용하고 한 건 초과하면 보고해요', () => {
  const budgets = { backlog: 1 }
  expect(lint('no-live-data-path', 'sample.test.ts', `const a = "${live}"`, budgets).status).toBe(0)
  expect(lint('no-live-data-path', 'sample.test.ts', `const a = "${live}", b = "${live}"`, budgets).status).not.toBe(0)
})
