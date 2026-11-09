import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { color } from './index.ts'

// 웹 CSS 변수는 손으로 적어요. 토큰과 값이 어긋나면 여기서 실패해요.
const css = readFileSync(resolve(import.meta.dirname, '../../../apps/web/src/index.css'), 'utf8')

function block(selector: string): Map<string, string> {
  const start = css.search(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm'))
  if (start < 0) throw new Error(`${selector} 블록이 없어요`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const vars = new Map<string, string>()
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars.set(m[1]!, m[2]!.trim().toLowerCase())
  return vars
}

for (const [scheme, selector] of [['light', ':root'], ['dark', '.dark']] as const) {
  test(`${selector} 의 색 변수가 토큰과 같아요`, () => {
    const vars = block(selector)
    for (const [name, value] of Object.entries(color[scheme])) expect([name, vars.get(name)]).toEqual([name, value])
  })
  test(`${selector} 에 토큰에 없는 색 변수가 없어요`, () => {
    const extra = [...block(selector).keys()].filter((k) => k !== 'radius' && !(k in color[scheme]))
    expect(extra).toEqual([])
  })
}

