import { expect, test } from "bun:test"
import { RecentCache, sameJson } from "./work-cache"

test("한도를 넘으면 가장 오래 안 쓴 것부터 버려요", () => {
  const c = new RecentCache<number>(2)
  c.set("a", 1)
  c.set("b", 2)
  expect(c.get("a")).toBe(1) // a 를 다시 씀 → b 가 가장 오래됨
  c.set("c", 3)
  expect([c.get("a"), c.get("b"), c.get("c"), c.size]).toEqual([1, undefined, 3, 2])
})

test("같은 키에 다시 넣으면 값이 바뀌고 개수는 그대로예요", () => {
  const c = new RecentCache<string>(3)
  c.set("w", "old")
  c.set("w", "new")
  expect([c.get("w"), c.size]).toEqual(["new", 1])
  c.delete("w")
  expect(c.get("w")).toBeUndefined()
})

test("같은 내용인지는 값으로 봐요", () => {
  expect(sameJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true)
  expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
  expect(sameJson(null, null)).toBe(true)
})
