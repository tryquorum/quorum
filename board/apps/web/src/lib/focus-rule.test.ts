import { expect, test } from "bun:test"
import { Glob } from "bun"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// 포커스 표시 규칙(docs/internals/design-core.md): 한 요소에 한 가지 표시, 링은 --ring 단색 2px.
// 컴포넌트의 outline-none(utilities 층)이 index.css 의 base :focus-visible 외곽선을 이기므로, 링을 쓰는 문자열엔 outline-none 이 함께 있어야 이중 표시가 없어요.
const root = resolve(import.meta.dirname, "..")
const files = [...new Glob("components/**/*.tsx").scanSync(root)]
const strings = files.flatMap((f) => {
  const src = readFileSync(resolve(root, f), "utf8")
  return [...src.matchAll(/"([^"\n]*focus-visible:[^"\n]*)"/g)].map((m) => ({ f, s: m[1]! }))
})

test("포커스 문자열을 찾았어요", () => expect(strings.length).toBeGreaterThan(20))

test("포커스 링은 --ring 단색만 써요(투명도·다른 색·3px 금지)", () => {
  const bad = strings.filter(({ s }) => /focus-visible:ring-(?:ring\/\d+|3\b|\[3px\]|destructive|sidebar-ring\/)/.test(s))
  expect(bad.map(({ f, s }) => `${f}: ${s.slice(0, 80)}`)).toEqual([])
})

test("링을 그리는 문자열엔 outline-none 이 함께 있어요", () => {
  const bad = strings.filter(({ s }) => /focus-visible:ring-2(?!\S)/.test(s) && !/(?:^|\s)(?:focus-visible:)?outline-(?:none|hidden)(?:\s|$)/.test(s))
  expect(bad.map(({ f, s }) => `${f}: ${s.slice(0, 80)}`)).toEqual([])
})

test("링과 외곽선을 함께 쓰지 않아요", () => {
  const bad = strings.filter(({ s }) => /focus-visible:ring-2(?!\S)/.test(s) && /focus-visible:outline-\d/.test(s))
  expect(bad.map(({ f }) => f)).toEqual([])
})

