import { expect, test } from 'bun:test'
import { lint } from './harness.ts'
import { rawStyleTokens } from './no-raw-style.ts'

const file = 'web/src/components/a.tsx'
const run = (source: string, baseline?: string[]) => lint('no-raw-style', file, source, baseline ? { rawStyle: { [file]: baseline } } : { rawStyle: {} })

test('팔레트 직접 색과 임의 글자 크기를 클래스 토큰 그대로 찾아요', () => {
  expect(rawStyleTokens('a dark:text-emerald-400 hover:!text-amber-500 text-amber-500/20 text-amber-500! text-[11px] md:text-[12.5px]'))
    .toEqual(['dark:text-emerald-400', 'hover:!text-amber-500', 'text-amber-500/20', 'text-amber-500!', 'text-[11px]', 'md:text-[12.5px]'])
})
test('색 리터럴: 문자열 전체 hex 와 CSS 같은 문자열 안의 색', () => {
  expect(rawStyleTokens('#a1a1aa')).toEqual(['#a1a1aa'])
  expect(rawStyleTokens('body{color:#0a0a0a;border:1px solid rgba(0,0,0,.1)}')).toEqual(['#0a0a0a', 'rgba('])
})
test('임의 색 클래스와 React Native 색 문자열도 찾아요', () => {
  expect(rawStyleTokens('p-2 bg-[#fff] hover:text-[rgb(1,2,3)]')).toEqual(['bg-[#fff]', 'hover:text-[rgb(1,2,3)]'])
  expect(rawStyleTokens('rgb(255, 0, 0)')).toEqual(['rgb(255, 0, 0)'])
  expect(rawStyleTokens('rgba(0,0,0,.1)')).toEqual(['rgba(0,0,0,.1)'])
})
test('React Native 스타일 객체의 색을 실제 lint 로 막아요', () => {
  const r = lint('no-raw-style', 'mobile/src/a.tsx', "const s = { backgroundColor: 'rgb(255, 0, 0)', color: '#202b37' }", { rawStyle: {} })
  expect(r.status).not.toBe(0)
  expect(r.output).toContain('rgb(255, 0, 0)')
})
test('일반 글과 토큰 클래스는 통과해요', () => {
  for (const ok of ['#8230 머지됨', '#tag', 'text-2xs bg-done text-done-foreground', 'border-warn/40', 'text-[var(--x)]']) expect(rawStyleTokens(ok)).toEqual([])
})
test('새 위반을 보고해요', () => {
  const r = run('const c = "text-amber-500"')
  expect(r.status).not.toBe(0)
  expect(r.output).toContain('no-raw-style')
})
test('기준선의 같은 토큰은 허용하고 하나 더 쓰면 실패해요', () => {
  expect(run('const c = "text-amber-500"', ['text-amber-500']).status).toBe(0)
  expect(run('const c = "text-amber-500 x", d = "text-amber-500"', ['text-amber-500']).status).not.toBe(0)
})
test('하나 지우고 다른 것을 더하면 실패해요', () => {
  expect(run('const c = "bg-sky-500"', ['text-amber-500']).status).not.toBe(0)
})
test('기준선 토큰이 사라지면 지우라고 해요', () => {
  const r = run('const c = "text-2xs"', ['text-amber-500'])
  expect(r.status).not.toBe(0)
  expect(r.output).toContain('raw-style-baseline.json')
})
test('시험 파일과 다른 폴더는 보지 않아요', () => {
  expect(lint('no-raw-style', 'web/src/components/a.test.tsx', 'const c = "text-amber-500"', { rawStyle: {} }).status).toBe(0)
  expect(lint('no-raw-style', 'packages/design-tokens/src/index.ts', 'const c = "#ffffff"', { rawStyle: {} }).status).toBe(0)
})

