import { expect, test } from "bun:test"
import { Glob } from "bun"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// placeholder 도 글자예요(WCAG 1.4.3). 투명도를 섞으면 흰 바탕에서 2.5~3:1 로 떨어져요(GAP-36).
// 색은 muted-foreground 그대로 쓰고, 대비는 packages/design-tokens 의 글자 쌍 시험이 지켜요.
const root = resolve(import.meta.dirname, "..")
const files = [...new Glob("components/**/*.tsx").scanSync(root)]

test("placeholder 색에 투명도를 섞지 않아요", () => {
  const bad = files.flatMap((f) => [...readFileSync(resolve(root, f), "utf8").matchAll(/placeholder:(?:text-[a-z-]+\/\d+|opacity-\d+)/g)].map((m) => `${f}: ${m[0]}`))
  expect(bad).toEqual([])
})
