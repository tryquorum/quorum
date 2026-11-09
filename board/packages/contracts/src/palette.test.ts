import { describe, expect, test } from "bun:test"
import type { Board, Item, Signal } from "./api.ts"
import { eventEntries, paletteMatch, pickEvents, pickWork, workEntries } from "./palette.ts"

const board: Board = { id: "b", name: "개인", kind: "personal", mine: true, deleted: false, areas: [] }
const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, boardId: "b", type: "todo", text: id, x: 0, y: 0, w: 0, h: 0, ...extra })
const signal = (id: string, extra: Partial<Signal> = {}): Signal => ({
  id, ref: null, source: "github", kind: "done", title: id, body: null, url: null, area: null, task: null, agent: null, lane: "now", reason: null,
  needs_ai: false, status: "open", private: false, sample: false, due: null, meta: null, created_at: 0, updated_at: 0, resolved_at: null, ...extra,
})

describe("검색 결과(일·사건)", () => {
  test("지운 것·메모는 빼고, 끝낸 일은 뒤, 목표 힌트", () => {
    const rows = workEntries([item("a", { done: true }), item("b"), item("m", { type: "sticky" }), item("x", { deleted: true }), item("g", { type: "goal" })], [board])
    expect(rows.map((r) => r.label)).not.toContain("m")
    expect(rows.map((r) => r.label)).not.toContain("x")
    expect(rows[rows.length - 1]?.label).toBe("a")
    expect(rows.find((r) => r.label === "g")?.hint).toBe("개인 · 목표")
    expect(rows.find((r) => r.label === "a")?.hint).toBe("개인 · 할 일 · 끝냄")
    expect(rows.find((r) => r.label === "b")?.ref).toBe("item:b:b")
  })
  test("빈 검색은 안 끝난 일 8개, 검색은 30개까지", () => {
    const many = workEntries(Array.from({ length: 40 }, (_, i) => item("일" + i)), [board])
    expect(pickWork(many, "")).toHaveLength(8)
    expect(pickWork(many, "일")).toHaveLength(30)
    expect(pickWork(workEntries([item("a", { done: true })], [board]), "")).toEqual([])
  })
  test("사건: 열린 것 먼저·최근 순, 일을 가리키면 그 일로", () => {
    const rows = eventEntries([signal("old", { updated_at: 1 }), signal("closed", { status: "resolved", updated_at: 9 }), signal("new", { updated_at: 5, meta: { work: "item:b:a" } })])
    expect(rows.map((r) => r.label)).toEqual(["new", "old", "closed"])
    expect(rows[0]?.ref).toBe("item:b:a")
    expect(rows[1]?.ref).toBe("signal:old")
    expect(rows[2]?.hint).toBe("github · 끝남")
    expect(pickEvents(rows, "").map((r) => r.label)).toEqual(["new", "old"])
  })
  test("이름·키워드 부분 일치(소문자 검색어)", () => {
    expect(paletteMatch({ label: "README 고치기", keywords: [] }, "readme")).toBe(true)
    expect(paletteMatch({ label: "x", keywords: ["사건", "GitHub"] }, "github")).toBe(true)
    expect(paletteMatch({ label: "x", keywords: [""] }, "y")).toBe(false)
  })
})
