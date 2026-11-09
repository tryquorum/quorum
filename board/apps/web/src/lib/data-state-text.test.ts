import { expect, test } from "bun:test"
import { eul, joinSources } from "./data-state-text"

test("받침에 맞춰 을/를, 여러 출처는 가운뎃점으로", () => {
  expect(eul("보드")).toBe("보드를")
  expect(eul("목록")).toBe("목록을")
  expect(joinSources(["보드", "소식"])).toBe("보드·소식을")
  expect(joinSources(["소식"])).toBe("소식을")
  expect(joinSources(["운영 순회"])).toBe("운영 순회를")
})
