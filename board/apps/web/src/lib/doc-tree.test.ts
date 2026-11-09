import { describe, expect, test } from "bun:test"
import { readOpen, toggleOpen } from "./doc-tree"

describe("펼침 상태", () => {
  test("readOpen 은 깨진 값을 빈 상태로, toggleOpen 은 새 집합", () => {
    expect(readOpen({ getItem: () => "{" }).size).toBe(0)
    expect([...readOpen({ getItem: () => JSON.stringify(["doc:a", 3]) })]).toEqual(["doc:a"])
    const a = new Set(["doc:a"])
    const b = toggleOpen(a, "doc:a")
    expect(b.has("doc:a")).toBe(false)
    expect(a.has("doc:a")).toBe(true)
    expect(toggleOpen(b, "doc:x", true).has("doc:x")).toBe(true)
  })
})
