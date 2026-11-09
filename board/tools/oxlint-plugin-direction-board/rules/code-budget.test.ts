import { expect, test } from 'bun:test'
import { nextBudget } from '../codeBudget.ts'
import { lint } from './harness.ts'

test('파일 길이와 타입 단언의 새 위반을 막아요', () => {
  const long = lint('code-budget', 'new.ts', Array(601).fill('// line').join('\n'))
  expect(long.status).not.toBe(0)
  expect(long.output).toContain('600')
  const assertions = lint('code-budget', 'new.ts', 'const a = value!; const b = value as any;')
  expect(assertions.status).not.toBe(0)
  expect(assertions.output).toContain('nonNull')
  expect(assertions.output).toContain('asAny')
})

test('600줄 이하와 테스트의 타입 단언은 허용해요', () => {
  expect(lint('code-budget', 'new.ts', Array(600).fill('// line').join('\n')).status).toBe(0)
  expect(lint('code-budget', 'sample.test.ts', 'const x = value!; const y = value as any;').status).toBe(0)
})
test('기존 줄 수 기준선까지 허용하고 초과하면 보고해요', () => {
  const budgets = { lines: 650 }
  expect(lint('code-budget', 'legacy.ts', Array(650).fill('// line').join('\n'), budgets).status).toBe(0)
  expect(lint('code-budget', 'legacy.ts', Array(651).fill('// line').join('\n'), budgets).status).not.toBe(0)
})

test('줄어든 기준선은 갱신 뒤 다시 늘 수 없어요', () => {
  // 700줄 기준선 파일을 640줄로 줄이면 갱신기가 640으로 내리고, 그 뒤 700줄로 되돌리면 거부해요.
  const shrunk = nextBudget('legacy.ts', { lines: 640, nonNull: 2, asAny: 0 }, { lines: 700, nonNull: 5 }, false)
  expect(shrunk).toEqual({ budget: { lines: 640, nonNull: 2 }, over: [] })
  const regrown = nextBudget('legacy.ts', { lines: 700, nonNull: 5, asAny: 0 }, shrunk.budget, false)
  expect(regrown.over).toEqual(['legacy.ts: lines 700 > 640', 'legacy.ts: nonNull 5 > 2'])
  expect(lint('code-budget', 'legacy.ts', Array(700).fill('// line').join('\n'), { lines: 640 }).status).not.toBe(0)
})
