import { expect, test } from "bun:test"
import { exactName } from "./palette-rank.ts"

const labels = ["홈", "보드", "로드맵", "전체 목록", "문서", "설정", "지금 순회 돌리기"]

test("정확히 같은 이름이면 참", () => {
  expect(exactName("설정", labels)).toBe(true)
  expect(exactName("  설정 ", labels)).toBe(true)
  expect(exactName("로드맵", labels)).toBe(true)
  expect(exactName("Settings", ["settings"])).toBe(true)
})

test("일부만 같거나 비어 있으면 거짓", () => {
  expect(exactName("설", labels)).toBe(false)
  expect(exactName("회의", labels)).toBe(false)
  expect(exactName("", labels)).toBe(false)
  expect(exactName("   ", labels)).toBe(false)
})
